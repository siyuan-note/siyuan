// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package model

import (
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func setupAttributeViewValidationTest(t *testing.T) {
	t.Helper()

	oldDataDir := util.DataDir
	oldConf, oldKernelLangs := Conf, util.Langs
	oldLang, oldAttrViewLangs := util.Lang, util.AttrViewLangs
	util.DataDir = t.TempDir()
	util.Lang = "en"
	util.Langs = map[string]map[int]string{"en": {105: "Database"}}
	util.AttrViewLangs = map[string]map[string]any{
		"en": {
			"key":    "Key",
			"select": "Select",
			"table":  "Table",
		},
	}
	Conf = NewAppConf()
	Conf.Lang = "en"
	Conf.FileTree = conf.NewFileTree()
	Conf.Sync = conf.NewSync()
	cache.ClearAVCache()
	t.Cleanup(func() {
		cache.ClearAVCache()
		util.DataDir = oldDataDir
		Conf, util.Langs = oldConf, oldKernelLangs
		util.Lang, util.AttrViewLangs = oldLang, oldAttrViewLangs
	})
}

func TestAddAttributeViewBlockRejectsMissingBlockKey(t *testing.T) {
	setupAttributeViewValidationTest(t)

	avID := "20260730130000-missing"
	attrView := av.NewAttributeView(avID)
	attrView.KeyValues = attrView.KeyValues[1:]
	if err := av.SaveAttributeView(attrView); nil != err {
		t.Fatalf("save attribute view failed: %s", err)
	}

	srcs := []map[string]any{{
		"itemID":     ast.NewNodeID(),
		"isDetached": true,
		"content":    "",
	}}
	err := AddAttributeViewBlock(nil, srcs, avID, "", "", "", "", false)
	if nil == err || !strings.Contains(err.Error(), "has no block key") {
		t.Fatalf("expected missing block key error, got [%v]", err)
	}
}

func TestAddAttributeViewBlockSkipsInvalidBlockValue(t *testing.T) {
	setupAttributeViewValidationTest(t)

	avID := "20260730130001-invalid"
	attrView := av.NewAttributeView(avID)
	blockValues := attrView.GetBlockKeyValues()
	invalidItemID := ast.NewNodeID()
	blockValues.Values = append(blockValues.Values, &av.Value{
		ID:      ast.NewNodeID(),
		KeyID:   blockValues.Key.ID,
		BlockID: invalidItemID,
		Type:    av.KeyTypeBlock,
	})
	if err := av.SaveAttributeView(attrView); nil != err {
		t.Fatalf("save attribute view failed: %s", err)
	}

	itemID := ast.NewNodeID()
	srcs := []map[string]any{{
		"itemID":     itemID,
		"isDetached": true,
		"content":    "Test",
	}}
	if err := AddAttributeViewBlock(nil, srcs, avID, "", "", "", "", false); nil != err {
		t.Fatalf("add detached attribute view item failed: %s", err)
	}

	parsed, err := av.ParseAttributeView(avID)
	if nil != err {
		t.Fatalf("parse attribute view failed: %s", err)
	}
	if invalid := parsed.GetBlockValue(invalidItemID); nil == invalid || nil != invalid.Block {
		t.Fatalf("unexpected invalid block value: %+v", invalid)
	}
	added := parsed.GetBlockValue(itemID)
	if nil == added || nil == added.Block || "Test" != added.Block.Content {
		t.Fatalf("unexpected added block value: %+v", added)
	}
}

func TestAddAttributeViewBlockAcceptsValidDetachedItem(t *testing.T) {
	setupAttributeViewValidationTest(t)

	avID := "20260730130002-validav"
	attrView := av.NewAttributeView(avID)
	if err := av.SaveAttributeView(attrView); nil != err {
		t.Fatalf("save attribute view failed: %s", err)
	}

	itemID := ast.NewNodeID()
	srcs := []map[string]any{{
		"itemID":     itemID,
		"isDetached": true,
		"content":    "Test",
	}}
	if err := AddAttributeViewBlock(nil, srcs, avID, "", "", "", "", false); nil != err {
		t.Fatalf("add detached attribute view item failed: %s", err)
	}

	parsed, err := av.ParseAttributeView(avID)
	if nil != err {
		t.Fatalf("parse attribute view failed: %s", err)
	}
	blockValue := parsed.GetBlockValue(itemID)
	if nil == blockValue || nil == blockValue.Block || !blockValue.IsDetached || "Test" != blockValue.Block.Content {
		t.Fatalf("unexpected detached block value: %+v", blockValue)
	}
}

func TestAddAttributeViewBlocksAcceptsDetachedItemsInBatch(t *testing.T) {
	setupAttributeViewValidationTest(t)

	avID := "20260811190000-batchav"
	attrView := av.NewAttributeView(avID)
	if err := av.SaveAttributeView(attrView); nil != err {
		t.Fatalf("save attribute view failed: %s", err)
	}

	const itemCount = 100
	itemIDs := make([]string, 0, itemCount)
	srcs := make([]map[string]any, 0, itemCount)
	for i := 0; i < itemCount; i++ {
		itemID := ast.NewNodeID()
		itemIDs = append(itemIDs, itemID)
		srcs = append(srcs, map[string]any{
			"itemID":     itemID,
			"isDetached": true,
			"content":    "Test",
		})
	}
	if err := AddAttributeViewBlock(nil, srcs, avID, "", "", "", "", false); nil != err {
		t.Fatalf("add detached attribute view items failed: %s", err)
	}

	parsed, err := av.ParseAttributeView(avID)
	if nil != err {
		t.Fatalf("parse attribute view failed: %s", err)
	}
	for _, itemID := range itemIDs {
		blockValue := parsed.GetBlockValue(itemID)
		if nil == blockValue || nil == blockValue.Block || !blockValue.IsDetached || "Test" != blockValue.Block.Content {
			t.Fatalf("unexpected detached block value: %+v", blockValue)
		}
	}
}

func TestAddAttributeViewBlockAcceptsValidBoundItemWithoutDatabaseBlock(t *testing.T) {
	setupAttributeViewValidationTest(t)

	oldBlockTreeDBPath := util.BlockTreeDBPath
	util.BlockTreeDBPath = filepath.Join(util.DataDir, "blocktree.db")
	treenode.InitBlockTree(true)
	t.Cleanup(func() {
		treenode.CloseDatabase()
		util.BlockTreeDBPath = oldBlockTreeDBPath
		if "" != oldBlockTreeDBPath {
			treenode.InitBlockTree(false)
		}
	})

	avID := "20260730130004-boundav"
	attrView := av.NewAttributeView(avID)
	if err := av.SaveAttributeView(attrView); nil != err {
		t.Fatalf("save attribute view failed: %s", err)
	}

	tree := treenode.NewTree("20260730130005-box0001", "/20260730130006-doc0001.sy", "/Test", "Test")
	boundBlockID := tree.Root.ID
	t.Cleanup(func() {
		cache.RemoveBlockIALInBox(boundBlockID, tree.Box)
	})
	itemID := ast.NewNodeID()
	src := map[string]any{
		"itemID":     itemID,
		"id":         boundBlockID,
		"isDetached": false,
	}
	tx := &Transaction{trees: map[string]*parse.Tree{}}
	result := &insertAttrViewBlockResult{}
	err := addAttributeViewBlock(time.Now().UnixMilli(), avID, "", "", "", "", itemID, boundBlockID, "Test", src, false,
		true, tree, tx, result)
	if nil != err {
		t.Fatalf("add bound attribute view item failed: %s", err)
	}

	parsed, err := av.ParseAttributeView(avID)
	if nil != err {
		t.Fatalf("parse attribute view failed: %s", err)
	}
	blockValue := parsed.GetBlockValue(itemID)
	if nil == blockValue || nil == blockValue.Block || blockValue.IsDetached || boundBlockID != blockValue.Block.ID {
		t.Fatalf("unexpected bound block value: %+v", blockValue)
	}
	if !strings.Contains(tree.Root.IALAttr(av.NodeAttrNameAvs), avID) {
		t.Fatalf("bound block does not contain attribute view ID [%s]", avID)
	}
}

func TestAddAttributeViewKeyRejectsUnsupportedTypes(t *testing.T) {
	setupAttributeViewValidationTest(t)

	avID := "20260730130003-keytype"
	attrView := av.NewAttributeView(avID)
	if err := av.SaveAttributeView(attrView); nil != err {
		t.Fatalf("save attribute view failed: %s", err)
	}
	initialKeyCount := len(attrView.KeyValues)

	tests := []struct {
		name       string
		keyType    string
		errMessage string
	}{
		{name: "block key", keyType: string(av.KeyTypeBlock), errMessage: "cannot add an attribute view block key"},
		{name: "unknown key", keyType: "unknown", errMessage: "unsupported attribute view key type"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := AddAttributeViewKey(avID, "", ast.NewNodeID(), "Test", test.keyType, "", "", av.DateDisplayFormatFull)
			if nil == err || !strings.Contains(err.Error(), test.errMessage) {
				t.Fatalf("expected error containing [%s], got [%v]", test.errMessage, err)
			}

			parsed, parseErr := av.ParseAttributeView(avID)
			if nil != parseErr {
				t.Fatalf("parse attribute view failed: %s", parseErr)
			}
			if len(parsed.KeyValues) != initialKeyCount {
				t.Fatalf("unsupported key type changed key count from [%d] to [%d]", initialKeyCount, len(parsed.KeyValues))
			}
		})
	}
}
