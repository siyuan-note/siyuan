// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestFindReplaceCollectsTagTransitionsAcrossDocuments(t *testing.T) {
	fixture, view, keyID := setupBlockCollectionTest(t)
	Conf.Search.Store(conf.NewSearch())
	rule := view.Automations.Rules[0]
	rule.BlockSource.DocumentIDs = nil
	rule.BlockSource.NotebookIDs = []string{fixture.box.ID}
	rule.BlockSource.Types = []string{"p"}
	if err := av.SaveAttributeView(view); err != nil {
		t.Fatal(err)
	}
	var ids []string
	for _, rootID := range []string{fixture.sourceID, fixture.targetID} {
		tree, err := LoadTreeByBlockID(rootID)
		if err != nil {
			t.Fatal(err)
		}
		node := tree.Root.FirstChild
		node.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "tag", TextMarkTextContent: "test"})
		ids = append(ids, node.ID)
		if _, err = filesys.WriteTree(tree); err != nil {
			t.Fatal(err)
		}
		treenode.UpsertBlockTree(tree)
		sql.UpsertTreeQueue(tree)
	}
	sql.FlushQueue()
	revision := pendingSync.begin()
	if err := FindReplaceInBox("#test#", "#todo#", map[string]bool{"tag": true}, ids, nil, nil, nil, nil, 0, ""); err != nil {
		t.Fatal(err)
	}
	view = readAttributeViewItemsTest(t, view.ID)
	if len(view.GetBlockKeyValues().Values) != 2 {
		t.Fatalf("replacement did not collect both documents exactly once: %+v", view.GetBlockKeyValues().Values)
	}
	for _, id := range ids {
		row := view.GetBlockValueByBoundID(id)
		if row == nil || view.GetValue(keyID, row.BlockID).Text.Content != "New" {
			t.Fatalf("replacement did not initialize collected row: %s", id)
		}
		tree, err := LoadTreeByBlockID(id)
		if err != nil || treenode.GetNodeInTree(tree, id).IALAttr(av.NodeAttrNameAvs) != view.ID {
			t.Fatalf("replacement lost the committed binding: %s %v", id, err)
		}
	}
	if pendingSync.begin() <= revision {
		t.Fatal("replacement did not schedule sync")
	}
}

func TestFindReplaceBodySchedulesSyncWithoutCollections(t *testing.T) {
	fixture := setupStructureTransactionTest(t)
	setupFoldTransactionDatabase(t, fixture)
	Conf.Search.Store(conf.NewSearch())
	tree, err := LoadTreeByBlockID(fixture.childID)
	if err != nil {
		t.Fatal(err)
	}
	tree.Root.FirstChild.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("FOO")})
	if _, err = filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	revision := pendingSync.begin()
	if err = FindReplaceInBox("FOO", "BAR", map[string]bool{"text": true}, []string{fixture.childID}, nil, nil, nil, nil, 0, ""); err != nil {
		t.Fatal(err)
	}
	if pendingSync.begin() != revision+1 {
		t.Fatal("body replacement did not schedule exactly one sync change")
	}
}

func TestFindReplaceCollectionWriteFailureRestoresSourceAndRows(t *testing.T) {
	fixture, view, _ := setupBlockCollectionTest(t)
	tree, err := LoadTreeByBlockID(fixture.sourceID)
	if err != nil {
		t.Fatal(err)
	}
	abs := filepath.Join(util.DataDir, tree.Box, tree.Path)
	original, err := os.ReadFile(abs)
	if err != nil {
		t.Fatal(err)
	}
	tree.Root.SetIALAttr("tags", "todo")
	injected := errors.New("injected replacement write failure")
	flushLock.Lock()
	handled, err := writeDocumentWithCollections(tree, func(*parse.Tree) error { return injected })
	flushLock.Unlock()
	if !handled || !errors.Is(err, injected) {
		t.Fatalf("collection commit hid the write failure: handled=%t err=%v", handled, err)
	}
	if len(readAttributeViewItemsTest(t, view.ID).GetBlockKeyValues().Values) != 0 {
		t.Fatal("failed replacement retained a collected row")
	}
	current, err := os.ReadFile(abs)
	if err != nil || !bytes.Equal(current, original) {
		t.Fatalf("failed replacement changed its source: %v", err)
	}
}
