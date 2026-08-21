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
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestFilterLocalStorageByPublishAccess(t *testing.T) {
	localStorage := map[string]any{
		"local-closed-tabs": []any{
			map[string]any{
				"title": "private-document-title",
				"children": map[string]any{
					"rootId": "20260729000000-private",
				},
			},
		},
		"local-searchkeys": map[string]any{
			"keys":        []any{"private-search-term"},
			"replaceKeys": []any{"private-replace-term"},
		},
		"future-private-key": "future-private-value",
	}

	filtered := FilterLocalStorageByPublishAccess(localStorage)
	if len(filtered) != 0 {
		t.Fatalf("publish reader received local storage data: %#v", filtered)
	}
	if len(localStorage) != 3 {
		t.Fatalf("filter modified the input local storage: %#v", localStorage)
	}
	searchKeys := localStorage["local-searchkeys"].(map[string]any)
	if len(searchKeys["keys"].([]any)) != 1 || len(searchKeys["replaceKeys"].([]any)) != 1 {
		t.Fatalf("filter modified nested input local storage: %#v", searchKeys)
	}
}

func TestAssetPathFromDataRelativePath(t *testing.T) {
	const boxID = "20260806000000-box0001"
	tests := []struct {
		name          string
		relativePath  string
		wantAssetPath string
		wantBoxID     string
		wantOK        bool
	}{
		{name: "global asset", relativePath: "assets/image.png", wantAssetPath: "assets/image.png", wantOK: true},
		{name: "global nested asset", relativePath: "assets/images/image.png", wantAssetPath: "assets/images/image.png", wantOK: true},
		{name: "notebook asset", relativePath: boxID + "/assets/image.png", wantAssetPath: "assets/image.png", wantBoxID: boxID, wantOK: true},
		{name: "document asset", relativePath: boxID + "/20260806000001-doc0001/assets/image.png", wantAssetPath: "assets/image.png", wantBoxID: boxID, wantOK: true},
		{name: "nested document asset", relativePath: boxID + "/20260806000001-doc0001/20260806000002-doc0002/assets/images/image.png", wantAssetPath: "assets/images/image.png", wantBoxID: boxID, wantOK: true},
		{name: "nested assets directory", relativePath: boxID + "/20260806000001-doc0001/assets/images/assets/image.png", wantAssetPath: "assets/images/assets/image.png", wantBoxID: boxID, wantOK: true},
		{name: "notebook directory", relativePath: boxID + "/assets"},
		{name: "document", relativePath: boxID + "/20260806000001-doc0001.sy"},
		{name: "non-notebook asset", relativePath: "storage/assets/image.png"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			assetPath, actualBoxID, ok := AssetPathFromDataRelativePath(test.relativePath)
			if assetPath != test.wantAssetPath || actualBoxID != test.wantBoxID || ok != test.wantOK {
				t.Fatalf("AssetPathFromDataRelativePath(%q) = [%q, %q, %v], want [%q, %q, %v]",
					test.relativePath, assetPath, actualBoxID, ok, test.wantAssetPath, test.wantBoxID, test.wantOK)
			}
		})
	}
}

func TestCheckBlockTreeAccessableByPublishAccess(t *testing.T) {
	const (
		boxID             = "20260721000000-boxid01"
		docID             = "20260721000001-docid01"
		protectedPassword = "password"
	)
	bt := &treenode.BlockTree{
		ID:    docID,
		BoxID: boxID,
		Path:  "/" + docID + ".sy",
	}
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodGet, "/", nil)

	if status := GetBlockTreePublishAccessStatus(c, PublishAccess{{ID: docID, Disable: true}}, bt); status != PublishAccessDenied {
		t.Fatalf("publish-disabled document status = %d, want denied", status)
	}
	if checkBlockTreeAccessableByPublishAccess(c, PublishAccess{{ID: docID, Disable: true}}, bt) {
		t.Fatal("publish-disabled document should not be accessible")
	}

	protectedAccess := PublishAccess{{ID: docID, Visible: true, Password: protectedPassword}}
	if status := GetBlockTreePublishAccessStatus(c, protectedAccess, bt); status != PublishAccessPasswordRequired {
		t.Fatalf("password-protected document status = %d, want password required", status)
	}
	if checkBlockTreeAccessableByPublishAccess(c, protectedAccess, bt) {
		t.Fatal("password-protected document should not be accessible without authorization")
	}

	c.Request.AddCookie(&http.Cookie{
		Name:  "publish-auth-" + docID,
		Value: util.SHA256Hash([]byte(docID + protectedPassword)),
	})
	if status := GetBlockTreePublishAccessStatus(c, protectedAccess, bt); status != PublishAccessAllowed {
		t.Fatalf("authorized document status = %d, want allowed", status)
	}
	if !checkBlockTreeAccessableByPublishAccess(c, protectedAccess, bt) {
		t.Fatal("password-protected document should be accessible after authorization")
	}

	if !checkBlockTreeAccessableByPublishAccess(c, PublishAccess{{ID: docID, Visible: false}}, bt) {
		t.Fatal("hidden document should remain directly accessible")
	}
}

func TestFilterContentByPublishAccessWithStatus(t *testing.T) {
	const (
		boxID    = "20260806000010-box0010"
		docID    = "20260806000011-doc0010"
		password = "password"
		content  = `<div data-node-id="20260806000012-block10">private content</div>`
	)

	oldConf := Conf
	Conf = NewAppConf()
	t.Cleanup(func() {
		Conf = oldConf
	})

	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodGet, "/", nil)
	protectedAccess := PublishAccess{{ID: docID, Visible: true, Password: password}}
	filtered, status := FilterContentByPublishAccessWithStatus(c, protectedAccess, boxID, "/"+docID+".sy", content, false)
	if status != PublishAccessPasswordRequired || filtered == content || strings.Contains(filtered, "private content") {
		t.Fatalf("unexpected protected content filter result: status=%d, content=%q", status, filtered)
	}

	c.Request.AddCookie(&http.Cookie{
		Name:  "publish-auth-" + docID,
		Value: util.SHA256Hash([]byte(docID + password)),
	})
	filtered, status = FilterContentByPublishAccessWithStatus(c, protectedAccess, boxID, "/"+docID+".sy", content, false)
	if status != PublishAccessAllowed || filtered != content {
		t.Fatalf("unexpected authorized content filter result: status=%d, content=%q", status, filtered)
	}

	filtered, status = FilterContentByPublishAccessWithStatus(c, PublishAccess{{ID: docID, Disable: true}}, boxID,
		"/"+docID+".sy", content, false)
	if status != PublishAccessDenied || strings.Contains(filtered, "private content") {
		t.Fatalf("unexpected disabled content filter result: status=%d, content=%q", status, filtered)
	}
}

func TestFilterBlockTreesByPublishAccess(t *testing.T) {
	const (
		boxID             = "20260729000000-boxid01"
		publicID          = "20260729000001-public1"
		protectedID       = "20260729000002-protect"
		hiddenID          = "20260729000003-hidden1"
		privateID         = "20260729000004-private"
		forbiddenID       = "20260729000005-forbid"
		inconsistentID    = "20260729000006-invalid"
		protectedParentID = "20260729000007-parent1"
		protectedChildID  = "20260729000008-child01"
		protectedPassword = "protected-password"
		privatePassword   = "private-password"
	)

	oldDataDir := util.DataDir
	util.DataDir = t.TempDir()
	invalidateEncryptedPublishAccessCache()
	t.Cleanup(func() {
		util.DataDir = oldDataDir
		invalidateEncryptedPublishAccessCache()
	})

	newBlockTree := func(id, blockPath string) *treenode.BlockTree {
		return &treenode.BlockTree{
			ID:    id,
			BoxID: boxID,
			Path:  blockPath,
		}
	}
	blockTrees := map[string]*treenode.BlockTree{
		publicID:           newBlockTree(publicID, "/"+publicID+".sy"),
		protectedID:        newBlockTree(protectedID, "/"+protectedID+".sy"),
		hiddenID:           newBlockTree(hiddenID, "/"+hiddenID+".sy"),
		privateID:          newBlockTree(privateID, "/"+privateID+".sy"),
		forbiddenID:        newBlockTree(forbiddenID, "/"+forbiddenID+".sy"),
		inconsistentID:     newBlockTree(inconsistentID, "/"+inconsistentID+".sy"),
		protectedChildID:   newBlockTree(protectedChildID, "/"+protectedParentID+"/"+protectedChildID+".sy"),
		"missing-block-id": nil,
	}
	publishAccess := PublishAccess{
		{ID: protectedID, Visible: true, Password: protectedPassword},
		{ID: hiddenID, Visible: false},
		{ID: privateID, Visible: false, Password: privatePassword},
		{ID: forbiddenID, Visible: false, Disable: true},
		{ID: inconsistentID, Visible: true, Disable: true},
		{ID: protectedParentID, Visible: true, Password: protectedPassword},
	}
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodGet, "/", nil)

	filtered := filterBlockTreesByPublishAccess(c, publishAccess, blockTrees)
	if len(filtered) != 1 || filtered[publicID] == nil {
		t.Fatalf("unauthorized publish reader received unexpected block trees: %+v", filtered)
	}

	c.Request.AddCookie(&http.Cookie{
		Name:  "publish-auth-" + protectedID,
		Value: util.SHA256Hash([]byte(protectedID + protectedPassword)),
	})
	c.Request.AddCookie(&http.Cookie{
		Name:  "publish-auth-" + protectedParentID,
		Value: util.SHA256Hash([]byte(protectedParentID + protectedPassword)),
	})
	c.Request.AddCookie(&http.Cookie{
		Name:  "publish-auth-" + privateID,
		Value: util.SHA256Hash([]byte(privateID + privatePassword)),
	})

	filtered = filterBlockTreesByPublishAccess(c, publishAccess, blockTrees)
	if len(filtered) != 3 || filtered[publicID] == nil || filtered[protectedID] == nil || filtered[protectedChildID] == nil {
		t.Fatalf("authorized publish reader received unexpected block trees: %+v", filtered)
	}
}

func TestFilterAttributeViewBacklinksByPublishAccess(t *testing.T) {
	const (
		boxID         = "20260730140000-box0001"
		targetDocID   = "20260730140001-target1"
		sourceDocID   = "20260730140002-source1"
		targetAvID    = "20260730140003-targeta"
		sourceAvID    = "20260730140004-sourcea"
		sourceItemID  = "20260730140005-sourcei"
		targetItemID  = "20260730140006-targeti"
		relationKeyID = "20260730140007-relkey1"
	)

	oldDataDir := util.DataDir
	oldBlockTreeDBPath := util.BlockTreeDBPath
	util.DataDir = t.TempDir()
	util.BlockTreeDBPath = filepath.Join(util.DataDir, "blocktree.db")
	treenode.InitBlockTree(true)
	invalidateEncryptedPublishAccessCache()
	t.Cleanup(func() {
		treenode.CloseDatabase()
		util.DataDir = oldDataDir
		util.BlockTreeDBPath = oldBlockTreeDBPath
		invalidateEncryptedPublishAccessCache()
		if "" != oldBlockTreeDBPath {
			treenode.InitBlockTree(false)
		}
	})

	targetTree := treenode.NewTree(boxID, "/"+targetDocID+".sy", "/Target", "Target")
	sourceTree := treenode.NewTree(boxID, "/"+sourceDocID+".sy", "/Source", "Source")
	treenode.UpsertBlockTree(targetTree)
	treenode.UpsertBlockTree(sourceTree)
	av.UpsertBlockRel(targetAvID, targetDocID)

	newBacklinks := func() *AttributeViewBacklinks {
		return &AttributeViewBacklinks{
			Total: 1,
			Items: []*AttributeViewBacklink{{
				AvID:       sourceAvID,
				BlockIDs:   []string{sourceDocID},
				ItemID:     sourceItemID,
				IsDetached: true,
				Relations: []*AttributeViewBacklinkRelation{{
					KeyID:        relationKeyID,
					TargetAvID:   targetAvID,
					TargetItemID: targetItemID,
				}},
			}},
		}
	}
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodGet, "/", nil)

	tests := []struct {
		name          string
		publishAccess PublishAccess
		expectedTotal int
	}{
		{
			name:          "public source",
			expectedTotal: 1,
		},
		{
			name:          "hidden source",
			publishAccess: PublishAccess{{ID: sourceDocID, Visible: false}},
			expectedTotal: 0,
		},
		{
			name:          "disabled source with inconsistent visibility",
			publishAccess: PublishAccess{{ID: sourceDocID, Visible: true, Disable: true}},
			expectedTotal: 0,
		},
		{
			name:          "hidden target filtered from backlink relations",
			publishAccess: PublishAccess{{ID: targetDocID, Visible: false}},
			expectedTotal: 0,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			filtered := FilterAttributeViewBacklinksByPublishAccess(c, test.publishAccess, newBacklinks())
			if filtered.Total != test.expectedTotal || len(filtered.Items) != test.expectedTotal {
				t.Fatalf("unexpected attribute view backlinks: %+v", filtered)
			}
		})
	}
}

func TestFilterBlockAttributeViewKeysByPublishAccess(t *testing.T) {
	const (
		boxID      = "20260730150000-box0002"
		publicID   = "20260730150001-public2"
		hiddenID   = "20260730150002-hidden2"
		disabledID = "20260730150003-disable"
	)

	oldBlockTreeDBPath := util.BlockTreeDBPath
	setupAttributeViewValidationTest(t)
	util.DataDir = t.TempDir()
	util.BlockTreeDBPath = filepath.Join(util.DataDir, "blocktree.db")
	treenode.InitBlockTree(true)
	invalidateEncryptedPublishAccessCache()
	t.Cleanup(func() {
		treenode.CloseDatabase()
		util.BlockTreeDBPath = oldBlockTreeDBPath
		invalidateEncryptedPublishAccessCache()
		if "" != oldBlockTreeDBPath {
			treenode.InitBlockTree(false)
		}
	})

	for _, id := range []string{publicID, hiddenID, disabledID} {
		tree := treenode.NewTree(boxID, "/"+id+".sy", "/"+id, id)
		treenode.UpsertBlockTree(tree)
	}

	newKeys := func(avID, blockID string) *BlockAttributeViewKeys {
		attrView := av.NewAttributeView(avID)
		attrView.Name = avID
		blockKey := attrView.GetBlockKey()
		textKey := av.NewKey(ast.NewNodeID(), "Text", "", av.KeyTypeText)
		rowID := ast.NewNodeID()
		attrView.GetBlockKeyValues().Values = []*av.Value{{
			ID: ast.NewNodeID(), KeyID: blockKey.ID, BlockID: rowID, Type: av.KeyTypeBlock,
			Block: &av.ValueBlock{ID: blockID, Content: "row"},
		}}
		attrView.KeyValues = append(attrView.KeyValues, &av.KeyValues{
			Key: textKey,
			Values: []*av.Value{{
				ID: ast.NewNodeID(), KeyID: textKey.ID, BlockID: rowID, Type: av.KeyTypeText,
				Text: &av.ValueText{Content: "text-" + blockID},
			}},
		})
		if err := av.SaveAttributeView(attrView); nil != err {
			t.Fatal(err)
		}
		return newTestBlockAttributeViewKeys(attrView, []string{blockID}, rowID)
	}

	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodGet, "/", nil)

	tests := []struct {
		name          string
		publishAccess PublishAccess
		expectedAvIDs []string
	}{
		{
			name:          "public only",
			expectedAvIDs: []string{"20260730150004-aav0002", "20260730150006-aav0003", "20260730150008-aav0004"},
		},
		{
			name:          "hidden filtered",
			publishAccess: PublishAccess{{ID: hiddenID, Visible: false}},
			expectedAvIDs: []string{"20260730150004-aav0002", "20260730150008-aav0004"},
		},
		{
			name:          "disabled filtered",
			publishAccess: PublishAccess{{ID: disabledID, Visible: true, Disable: true}},
			expectedAvIDs: []string{"20260730150004-aav0002", "20260730150006-aav0003"},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			input := []*BlockAttributeViewKeys{
				newKeys("20260730150004-aav0002", publicID),
				newKeys("20260730150006-aav0003", hiddenID),
				newKeys("20260730150008-aav0004", disabledID),
			}
			filtered := FilterBlockAttributeViewKeysByPublishAccess(c, test.publishAccess, input)
			if len(filtered) != len(test.expectedAvIDs) {
				t.Fatalf("unexpected block attribute view keys: %+v", filtered)
			}
			for i, blockAttributeViewKey := range filtered {
				if blockAttributeViewKey.AvID != test.expectedAvIDs[i] {
					t.Fatalf("unexpected block attribute view keys: %+v", filtered)
				}
				if 2 != len(blockAttributeViewKey.KeyValues) {
					t.Fatalf("unexpected block attribute view key values: %+v", blockAttributeViewKey.KeyValues)
				}
				for _, keyValues := range blockAttributeViewKey.KeyValues {
					if 1 != len(keyValues.Values) {
						t.Fatalf("unexpected block attribute view key value count: %+v", keyValues)
					}
				}
			}
		})
	}
}

func newTestBlockAttributeViewKeys(attrView *av.AttributeView, blockIDs []string, itemID string) *BlockAttributeViewKeys {
	keyValues := []*av.KeyValues{}
	for _, sourceKeyValues := range attrView.KeyValues {
		itemKeyValues := &av.KeyValues{Key: sourceKeyValues.Key}
		for _, value := range sourceKeyValues.Values {
			if value.BlockID == itemID {
				itemKeyValues.Values = append(itemKeyValues.Values, value)
			}
		}
		if 0 < len(itemKeyValues.Values) {
			keyValues = append(keyValues, itemKeyValues)
		}
	}
	return &BlockAttributeViewKeys{
		AvID:      attrView.ID,
		AvName:    attrView.Name,
		BlockIDs:  blockIDs,
		KeyValues: keyValues,
	}
}

func TestFilterBlockAttributeViewKeysByPublishAccessRemovesForbiddenRowValues(t *testing.T) {
	const (
		boxID                = "20260821000000-box0001"
		avBlockID            = "20260821000001-avblock"
		publicDocID          = "20260821000002-publicd"
		forbiddenDocID       = "20260821000003-forbidd"
		targetAvBlockID      = "20260821000004-tavbloc"
		targetPublicDocID    = "20260821000005-tpubdoc"
		targetForbiddenDocID = "20260821000006-tforbid"
		sourceAvID           = "20260821000007-sourcea"
		targetAvID           = "20260821000008-targeta"
	)

	oldBlockTreeDBPath := util.BlockTreeDBPath
	setupAttributeViewValidationTest(t)
	util.DataDir = t.TempDir()
	util.BlockTreeDBPath = filepath.Join(util.DataDir, "blocktree.db")
	treenode.InitBlockTree(true)
	invalidateEncryptedPublishAccessCache()
	t.Cleanup(func() {
		treenode.CloseDatabase()
		util.BlockTreeDBPath = oldBlockTreeDBPath
		invalidateEncryptedPublishAccessCache()
		if "" != oldBlockTreeDBPath {
			treenode.InitBlockTree(false)
		}
	})

	for _, id := range []string{avBlockID, publicDocID, forbiddenDocID, targetAvBlockID, targetPublicDocID, targetForbiddenDocID} {
		tree := treenode.NewTree(boxID, "/"+id+".sy", "/"+id, id)
		treenode.UpsertBlockTree(tree)
	}

	publicRowID := ast.NewNodeID()
	forbiddenRowID := ast.NewNodeID()
	detachedRowID := ast.NewNodeID()
	targetPublicRowID := ast.NewNodeID()
	targetForbiddenRowID := ast.NewNodeID()

	// 目标数据库：包含公开行和禁止访问行
	targetAttrView := av.NewAttributeView(targetAvID)
	targetAttrView.Name = targetAvID
	targetBlockKeyID := targetAttrView.GetBlockKey().ID
	targetTextKeyID := ast.NewNodeID()
	targetAttrView.GetBlockKeyValues().Values = []*av.Value{
		{ID: ast.NewNodeID(), KeyID: targetBlockKeyID, BlockID: targetPublicRowID, Type: av.KeyTypeBlock,
			Block: &av.ValueBlock{ID: targetPublicDocID, Content: "target public"}},
		{ID: ast.NewNodeID(), KeyID: targetBlockKeyID, BlockID: targetForbiddenRowID, Type: av.KeyTypeBlock,
			Block: &av.ValueBlock{ID: targetForbiddenDocID, Content: "target forbidden"}},
	}
	targetAttrView.KeyValues = append(targetAttrView.KeyValues, &av.KeyValues{
		Key: av.NewKey(targetTextKeyID, "Target Text", "", av.KeyTypeText),
		Values: []*av.Value{
			{ID: ast.NewNodeID(), KeyID: targetTextKeyID, BlockID: targetPublicRowID, Type: av.KeyTypeText,
				Text: &av.ValueText{Content: "target public text"}},
			{ID: ast.NewNodeID(), KeyID: targetTextKeyID, BlockID: targetForbiddenRowID, Type: av.KeyTypeText,
				Text: &av.ValueText{Content: "PRIVATE_TARGET_TEXT_CANARY"}},
		},
	})
	if err := av.SaveAttributeView(targetAttrView); nil != err {
		t.Fatal(err)
	}
	av.UpsertBlockRel(targetAvID, targetAvBlockID)

	// 源数据库：公开行、禁止访问行和游离行，覆盖文本、数字、日期、URL、资源、关联和汇总等单元格类型
	attrView := av.NewAttributeView(sourceAvID)
	attrView.Name = sourceAvID
	blockKeyID := attrView.GetBlockKey().ID
	textKeyID := ast.NewNodeID()
	numberKeyID := ast.NewNodeID()
	dateKeyID := ast.NewNodeID()
	urlKeyID := ast.NewNodeID()
	assetKeyID := ast.NewNodeID()
	relationKeyID := ast.NewNodeID()
	rollupKeyID := ast.NewNodeID()
	attrView.GetBlockKeyValues().Values = []*av.Value{
		{ID: ast.NewNodeID(), KeyID: blockKeyID, BlockID: publicRowID, Type: av.KeyTypeBlock,
			Block: &av.ValueBlock{ID: publicDocID, Content: "public row"}},
		{ID: ast.NewNodeID(), KeyID: blockKeyID, BlockID: forbiddenRowID, Type: av.KeyTypeBlock,
			Block: &av.ValueBlock{ID: forbiddenDocID, Content: "forbidden row"}},
		{ID: ast.NewNodeID(), KeyID: blockKeyID, BlockID: detachedRowID, Type: av.KeyTypeBlock, IsDetached: true,
			Block: &av.ValueBlock{Content: "detached row"}},
	}
	attrView.KeyValues = append(attrView.KeyValues,
		&av.KeyValues{
			Key: av.NewKey(textKeyID, "Text", "", av.KeyTypeText),
			Values: []*av.Value{
				{ID: ast.NewNodeID(), KeyID: textKeyID, BlockID: publicRowID, Type: av.KeyTypeText,
					Text: &av.ValueText{Content: "PUBLIC_TEXT_CANARY"}},
				{ID: ast.NewNodeID(), KeyID: textKeyID, BlockID: forbiddenRowID, Type: av.KeyTypeText,
					Text: &av.ValueText{Content: "PRIVATE_TEXT_CANARY"}},
				{ID: ast.NewNodeID(), KeyID: textKeyID, BlockID: detachedRowID, Type: av.KeyTypeText,
					Text: &av.ValueText{Content: "DETACHED_TEXT_CANARY"}},
			},
		},
		&av.KeyValues{
			Key: av.NewKey(numberKeyID, "Number", "", av.KeyTypeNumber),
			Values: []*av.Value{
				{ID: ast.NewNodeID(), KeyID: numberKeyID, BlockID: publicRowID, Type: av.KeyTypeNumber,
					Number: &av.ValueNumber{Content: 1}},
				{ID: ast.NewNodeID(), KeyID: numberKeyID, BlockID: forbiddenRowID, Type: av.KeyTypeNumber,
					Number: &av.ValueNumber{Content: 2}},
				{ID: ast.NewNodeID(), KeyID: numberKeyID, BlockID: detachedRowID, Type: av.KeyTypeNumber,
					Number: &av.ValueNumber{Content: 3}},
			},
		},
		&av.KeyValues{
			Key: av.NewKey(dateKeyID, "Date", "", av.KeyTypeDate),
			Values: []*av.Value{
				{ID: ast.NewNodeID(), KeyID: dateKeyID, BlockID: publicRowID, Type: av.KeyTypeDate,
					Date: &av.ValueDate{Content: 1700000000000}},
				{ID: ast.NewNodeID(), KeyID: dateKeyID, BlockID: forbiddenRowID, Type: av.KeyTypeDate,
					Date: &av.ValueDate{Content: 1800000000000}},
				{ID: ast.NewNodeID(), KeyID: dateKeyID, BlockID: detachedRowID, Type: av.KeyTypeDate,
					Date: &av.ValueDate{Content: 1900000000000}},
			},
		},
		&av.KeyValues{
			Key: av.NewKey(urlKeyID, "URL", "", av.KeyTypeURL),
			Values: []*av.Value{
				{ID: ast.NewNodeID(), KeyID: urlKeyID, BlockID: publicRowID, Type: av.KeyTypeURL,
					URL: &av.ValueURL{Content: "https://example.com/public"}},
				{ID: ast.NewNodeID(), KeyID: urlKeyID, BlockID: forbiddenRowID, Type: av.KeyTypeURL,
					URL: &av.ValueURL{Content: "https://example.com/PRIVATE_URL_CANARY"}},
				{ID: ast.NewNodeID(), KeyID: urlKeyID, BlockID: detachedRowID, Type: av.KeyTypeURL,
					URL: &av.ValueURL{Content: "https://example.com/detached"}},
			},
		},
		&av.KeyValues{
			Key: av.NewKey(assetKeyID, "Asset", "", av.KeyTypeMAsset),
			Values: []*av.Value{
				{ID: ast.NewNodeID(), KeyID: assetKeyID, BlockID: publicRowID, Type: av.KeyTypeMAsset,
					MAsset: []*av.ValueAsset{{Type: av.AssetTypeImage, Name: "public.png", Content: "assets/public.png"}}},
				{ID: ast.NewNodeID(), KeyID: assetKeyID, BlockID: forbiddenRowID, Type: av.KeyTypeMAsset,
					MAsset: []*av.ValueAsset{{Type: av.AssetTypeImage, Name: "private.png", Content: "assets/PRIVATE_ASSET_CANARY.png"}}},
				{ID: ast.NewNodeID(), KeyID: assetKeyID, BlockID: detachedRowID, Type: av.KeyTypeMAsset,
					MAsset: []*av.ValueAsset{{Type: av.AssetTypeImage, Name: "detached.png", Content: "assets/detached.png"}}},
			},
		},
		&av.KeyValues{
			Key: &av.Key{ID: relationKeyID, Name: "Relation", Type: av.KeyTypeRelation, Relation: &av.Relation{AvID: targetAvID}},
			Values: []*av.Value{
				{ID: ast.NewNodeID(), KeyID: relationKeyID, BlockID: publicRowID, Type: av.KeyTypeRelation,
					Relation: &av.ValueRelation{
						BlockIDs: []string{targetPublicRowID, targetForbiddenRowID},
						Contents: []*av.Value{
							{KeyID: targetBlockKeyID, BlockID: targetPublicRowID, Type: av.KeyTypeBlock,
								Block: &av.ValueBlock{ID: targetPublicDocID, Content: "target public"}},
							{KeyID: targetBlockKeyID, BlockID: targetForbiddenRowID, Type: av.KeyTypeBlock,
								Block: &av.ValueBlock{ID: targetForbiddenDocID, Content: "target forbidden"}},
						},
					}},
				{ID: ast.NewNodeID(), KeyID: relationKeyID, BlockID: forbiddenRowID, Type: av.KeyTypeRelation,
					Relation: &av.ValueRelation{
						BlockIDs: []string{targetForbiddenRowID},
						Contents: []*av.Value{
							{KeyID: targetBlockKeyID, BlockID: targetForbiddenRowID, Type: av.KeyTypeBlock,
								Block: &av.ValueBlock{ID: targetForbiddenDocID, Content: "target forbidden"}},
						},
					}},
			},
		},
		&av.KeyValues{
			Key: &av.Key{ID: rollupKeyID, Name: "Rollup", Type: av.KeyTypeRollup, Rollup: &av.Rollup{
				RelationKeyID: relationKeyID, KeyID: targetTextKeyID,
			}},
			Values: []*av.Value{
				{ID: ast.NewNodeID(), KeyID: rollupKeyID, BlockID: publicRowID, Type: av.KeyTypeRollup,
					Rollup: &av.ValueRollup{Contents: []*av.Value{
						{KeyID: targetTextKeyID, BlockID: targetPublicRowID, Type: av.KeyTypeText,
							Text: &av.ValueText{Content: "target public text"}},
						{KeyID: targetTextKeyID, BlockID: targetForbiddenRowID, Type: av.KeyTypeText,
							Text: &av.ValueText{Content: "PRIVATE_TARGET_TEXT_CANARY"}},
					}}},
			},
		},
	)
	if err := av.SaveAttributeView(attrView); nil != err {
		t.Fatal(err)
	}

	publicKeys := newTestBlockAttributeViewKeys(attrView, []string{avBlockID}, publicRowID)
	forbiddenKeys := newTestBlockAttributeViewKeys(attrView, []string{avBlockID}, forbiddenRowID)
	detachedKeys := newTestBlockAttributeViewKeys(attrView, []string{avBlockID}, detachedRowID)
	input := []*BlockAttributeViewKeys{forbiddenKeys, publicKeys, detachedKeys}

	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodGet, "/", nil)
	publishAccess := PublishAccess{
		{ID: forbiddenDocID, Visible: true, Disable: true},
		{ID: targetForbiddenDocID, Visible: true, Disable: true},
	}

	filtered := FilterBlockAttributeViewKeysByPublishAccess(c, publishAccess, input)
	if 2 != len(filtered) {
		t.Fatalf("unexpected block attribute view keys: %+v", filtered)
	}
	data, err := json.Marshal(filtered)
	if nil != err {
		t.Fatal(err)
	}
	if strings.Contains(string(data), "PRIVATE_") {
		t.Fatalf("forbidden row values leaked to publish reader: %s", data)
	}
	if !strings.Contains(string(data), "PUBLIC_TEXT_CANARY") || !strings.Contains(string(data), "DETACHED_TEXT_CANARY") {
		t.Fatalf("accessible row values should be kept: %s", data)
	}

	publicFiltered := filtered[0]
	var relationValue, rollupValue *av.Value
	for _, keyValues := range publicFiltered.KeyValues {
		if av.KeyTypeRelation == keyValues.Key.Type {
			relationValue = keyValues.Values[0]
		}
		if av.KeyTypeRollup == keyValues.Key.Type {
			rollupValue = keyValues.Values[0]
		}
	}
	if nil == relationValue || 1 != len(relationValue.Relation.BlockIDs) ||
		targetPublicRowID != relationValue.Relation.BlockIDs[0] ||
		1 != len(relationValue.Relation.Contents) {
		t.Fatalf("unexpected filtered relation value: %+v", relationValue)
	}
	if nil == rollupValue || 0 != len(rollupValue.Rollup.Contents) {
		t.Fatalf("rollup containing forbidden target rows should be cleared: %+v", rollupValue)
	}
	if 1 != len(filtered[1].KeyValues[0].Values) || !filtered[1].KeyValues[0].Values[0].IsDetached {
		t.Fatalf("detached row should be kept: %+v", filtered[1])
	}

	// 过滤不修改输入，且禁止访问行的值不因过滤而丢失
	if 3 != len(input) {
		t.Fatalf("filter should not mutate the input: %+v", input)
	}
	originData, err := json.Marshal(input)
	if nil != err {
		t.Fatal(err)
	}
	if !strings.Contains(string(originData), "PRIVATE_TEXT_CANARY") ||
		!strings.Contains(string(originData), "PRIVATE_TARGET_TEXT_CANARY") {
		t.Fatalf("filter should not mutate the input: %s", originData)
	}
}

func TestEncryptedNotebookDeniedByPublishAccess(t *testing.T) {
	const (
		boxID = "20260726000000-encrypt"
		docID = "20260726000001-encrypt"
	)
	oldDataDir := util.DataDir
	util.DataDir = t.TempDir()
	t.Cleanup(func() {
		util.DataDir = oldDataDir
		invalidateEncryptedPublishAccessCache()
	})

	boxConf := conf.NewBoxConf()
	boxConf.Encrypted = true
	if err := (&Box{ID: boxID}).SaveConf(boxConf); err != nil {
		t.Fatal(err)
	}

	bt := &treenode.BlockTree{
		ID:    docID,
		BoxID: boxID,
		Path:  "/" + docID + ".sy",
	}
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodGet, "/", nil)
	publishAccess := PublishAccess{{ID: boxID, Visible: true, Password: "password"}}

	if CheckPathAccessableByPublishIgnore(boxID, bt.Path, GetInvisiblePublishAccess(publishAccess)) {
		t.Fatal("encrypted notebook should be invisible to publish readers")
	}
	if CheckPathAccessableByPublishIgnore(boxID, bt.Path, GetDisablePublishAccess(publishAccess)) {
		t.Fatal("encrypted notebook should be disabled for publish access")
	}
	if checkBlockTreeAccessableByPublishAccess(c, publishAccess, bt) {
		t.Fatal("encrypted notebook content should not be accessible through publish")
	}
	if CheckBlockTreeMetadataAccessableByPublishAccess(c, publishAccess, bt) {
		t.Fatal("encrypted notebook metadata should not be accessible through publish")
	}
	if CheckBlockTreeDiscoverableByPublishAccess(publishAccess, bt) {
		t.Fatal("encrypted notebook should not be discoverable through publish")
	}
}

func TestEncryptedPublishAccessCacheInvalidation(t *testing.T) {
	const boxID = "20260726000002-encrypt"
	oldDataDir := util.DataDir
	util.DataDir = t.TempDir()
	invalidateEncryptedPublishAccessCache()
	t.Cleanup(func() {
		forgetRuntimeEncryptedBox(boxID)
		util.DataDir = oldDataDir
		invalidateEncryptedPublishAccessCache()
	})

	boxConf := conf.NewBoxConf()
	boxConf.Encrypted = true
	box := &Box{ID: boxID}
	if err := box.SaveConf(boxConf); err != nil {
		t.Fatal(err)
	}
	if !IsEncryptedBoxDeniedByPublishAccess(boxID) {
		t.Fatal("encrypted notebook should be present in publish access cache")
	}

	boxConf.Encrypted = false
	data, err := json.MarshalIndent(boxConf, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(util.DataDir, boxID, ".siyuan", "conf.json"), data, 0644); err != nil {
		t.Fatal(err)
	}
	forgetRuntimeEncryptedBox(boxID)
	if !IsEncryptedBoxDeniedByPublishAccess(boxID) {
		t.Fatal("publish access should reuse its cached encrypted notebook snapshot")
	}

	invalidateEncryptedPublishAccessCache()
	if IsEncryptedBoxDeniedByPublishAccess(boxID) {
		t.Fatal("invalidated publish access cache should reload notebook encryption state")
	}
}

func TestCheckBlockTreeMetadataAccessableByPublishAccess(t *testing.T) {
	const (
		boxID          = "20260725000000-boxid01"
		docID          = "20260725000001-docid01"
		parentID       = "20260725000002-parent1"
		privateID      = "20260725000003-private"
		privatePass    = "password"
		protectedID    = "20260725000004-protect"
		protectedPass  = "protected-password"
		inconsistentID = "20260725000005-invalid"
		childID        = "20260725000006-child01"
	)
	newBlockTree := func(id, blockPath string) *treenode.BlockTree {
		return &treenode.BlockTree{
			ID:    id,
			BoxID: boxID,
			Path:  blockPath,
		}
	}
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodGet, "/", nil)

	tests := []struct {
		name          string
		publishAccess PublishAccess
		blockTree     *treenode.BlockTree
		metadata      bool
		discoverable  bool
	}{
		{
			name:         "missing",
			blockTree:    nil,
			metadata:     false,
			discoverable: false,
		},
		{
			name:         "public",
			blockTree:    newBlockTree(docID, "/"+docID+".sy"),
			metadata:     true,
			discoverable: true,
		},
		{
			name:          "protected",
			publishAccess: PublishAccess{{ID: protectedID, Visible: true, Password: protectedPass}},
			blockTree:     newBlockTree(protectedID, "/"+protectedID+".sy"),
			metadata:      true,
			discoverable:  true,
		},
		{
			name:          "hidden",
			publishAccess: PublishAccess{{ID: docID, Visible: false}},
			blockTree:     newBlockTree(docID, "/"+docID+".sy"),
			metadata:      true,
			discoverable:  false,
		},
		{
			name:          "private",
			publishAccess: PublishAccess{{ID: privateID, Visible: false, Password: privatePass}},
			blockTree:     newBlockTree(privateID, "/"+privateID+".sy"),
			metadata:      false,
			discoverable:  false,
		},
		{
			name:          "forbidden",
			publishAccess: PublishAccess{{ID: docID, Visible: false, Disable: true}},
			blockTree:     newBlockTree(docID, "/"+docID+".sy"),
			metadata:      false,
			discoverable:  false,
		},
		{
			name:          "hidden parent",
			publishAccess: PublishAccess{{ID: parentID, Visible: false}},
			blockTree:     newBlockTree(docID, "/"+parentID+"/"+docID+".sy"),
			metadata:      true,
			discoverable:  false,
		},
		{
			name:          "private parent",
			publishAccess: PublishAccess{{ID: privateID, Visible: false, Password: privatePass}},
			blockTree:     newBlockTree(docID, "/"+privateID+"/"+docID+".sy"),
			metadata:      false,
			discoverable:  false,
		},
		{
			name:          "hidden notebook",
			publishAccess: PublishAccess{{ID: boxID, Visible: false}},
			blockTree:     newBlockTree(docID, "/"+docID+".sy"),
			metadata:      true,
			discoverable:  false,
		},
		{
			name:          "inconsistent visible forbidden",
			publishAccess: PublishAccess{{ID: inconsistentID, Visible: true, Disable: true}},
			blockTree:     newBlockTree(inconsistentID, "/"+inconsistentID+".sy"),
			metadata:      false,
			discoverable:  false,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if actual := CheckBlockTreeMetadataAccessableByPublishAccess(c, test.publishAccess, test.blockTree); actual != test.metadata {
				t.Fatalf("metadata access = %v, want %v", actual, test.metadata)
			}
			if actual := CheckBlockTreeDiscoverableByPublishAccess(test.publishAccess, test.blockTree); actual != test.discoverable {
				t.Fatalf("discoverable = %v, want %v", actual, test.discoverable)
			}
		})
	}

	privateTree := newBlockTree(privateID, "/"+privateID+".sy")
	privateAccess := PublishAccess{{ID: privateID, Visible: false, Password: privatePass}}
	c.Request.AddCookie(&http.Cookie{
		Name:  "publish-auth-" + privateID,
		Value: util.SHA256Hash([]byte(privateID + privatePass)),
	})
	if !CheckBlockTreeMetadataAccessableByPublishAccess(c, privateAccess, privateTree) {
		t.Fatal("private document metadata should be accessible after authorization")
	}
	if CheckBlockTreeDiscoverableByPublishAccess(privateAccess, privateTree) {
		t.Fatal("private document should remain undiscoverable after authorization")
	}

	protectedChildTree := newBlockTree(childID, "/"+parentID+"/"+protectedID+"/"+childID+".sy")
	inheritedAccess := PublishAccess{
		{ID: parentID, Visible: false},
		{ID: protectedID, Visible: true, Password: protectedPass},
	}
	if CheckBlockTreeMetadataAccessableByPublishAccess(c, inheritedAccess, protectedChildTree) {
		t.Fatal("protected child metadata under a hidden parent should require authorization")
	}
	c.Request.AddCookie(&http.Cookie{
		Name:  "publish-auth-" + protectedID,
		Value: util.SHA256Hash([]byte(protectedID + protectedPass)),
	})
	if !CheckBlockTreeMetadataAccessableByPublishAccess(c, inheritedAccess, protectedChildTree) {
		t.Fatal("protected child metadata under a hidden parent should be accessible after authorization")
	}
	if CheckBlockTreeDiscoverableByPublishAccess(inheritedAccess, protectedChildTree) {
		t.Fatal("protected child under a hidden parent should remain undiscoverable")
	}
}

func TestCheckAttributeViewItemIDAccessableByPublishAccess(t *testing.T) {
	attrView := &av.AttributeView{
		KeyValues: []*av.KeyValues{
			{
				Key: &av.Key{Type: av.KeyTypeBlock},
				Values: []*av.Value{
					{BlockID: "detached-item", Type: av.KeyTypeBlock, IsDetached: true},
				},
			},
		},
	}
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodGet, "/", nil)

	if !checkAttributeViewItemIDAccessableByPublishAccess(c, PublishAccess{}, attrView, "detached-item") {
		t.Fatal("detached attribute view item should remain accessible")
	}
	if checkAttributeViewItemIDAccessableByPublishAccess(c, PublishAccess{}, attrView, "missing-item") {
		t.Fatal("attribute view item without a primary value should not expose assets")
	}

	detachedRow := &av.TableRow{Cells: []*av.TableCell{{
		BaseValue: &av.BaseValue{
			ValueType: av.KeyTypeBlock,
			Value:     &av.Value{Type: av.KeyTypeBlock, IsDetached: true},
		},
	}}}
	if !checkAttributeViewItemAccessableByPublishAccess(c, PublishAccess{}, detachedRow) {
		t.Fatal("detached attribute view row should remain accessible")
	}

	missingPrimaryRow := &av.TableRow{Cells: []*av.TableCell{{
		BaseValue: &av.BaseValue{
			ValueType: av.KeyTypeText,
			Value:     &av.Value{Type: av.KeyTypeText, Text: &av.ValueText{Content: "text"}},
		},
	}}}
	if checkAttributeViewItemAccessableByPublishAccess(c, PublishAccess{}, missingPrimaryRow) {
		t.Fatal("attribute view row without a primary value should not be accessible")
	}

	malformedPrimaryRow := &av.TableRow{Cells: []*av.TableCell{{
		BaseValue: &av.BaseValue{
			ValueType: av.KeyTypeBlock,
			Value:     &av.Value{Type: av.KeyTypeBlock},
		},
	}}}
	if checkAttributeViewItemAccessableByPublishAccess(c, PublishAccess{}, malformedPrimaryRow) {
		t.Fatal("non-detached attribute view row without a block should not be accessible")
	}
}

func TestCheckAttributeViewBlockTreesAccessableByPublishAccess(t *testing.T) {
	const (
		boxID             = "20260726000000-boxid01"
		publicID          = "20260726000001-public1"
		forbiddenID       = "20260726000002-forbid1"
		protectedID       = "20260726000003-protect"
		protectedPassword = "password"
	)
	newBlockTree := func(id string) *treenode.BlockTree {
		return &treenode.BlockTree{
			ID:    id,
			BoxID: boxID,
			Path:  "/" + id + ".sy",
		}
	}
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodGet, "/", nil)

	if checkAttributeViewBlockTreesAccessableByPublishAccess(c, PublishAccess{}, nil) {
		t.Fatal("attribute view without a mirror should not be accessible")
	}
	if !checkAttributeViewBlockTreesAccessableByPublishAccess(c, PublishAccess{}, map[string]*treenode.BlockTree{
		publicID: newBlockTree(publicID),
	}) {
		t.Fatal("attribute view with a public mirror should be accessible")
	}
	if checkAttributeViewBlockTreesAccessableByPublishAccess(c, PublishAccess{{ID: forbiddenID, Disable: true}}, map[string]*treenode.BlockTree{
		forbiddenID: newBlockTree(forbiddenID),
	}) {
		t.Fatal("attribute view with only a forbidden mirror should not be accessible")
	}
	if !checkAttributeViewBlockTreesAccessableByPublishAccess(c, PublishAccess{{ID: forbiddenID, Disable: true}}, map[string]*treenode.BlockTree{
		forbiddenID: newBlockTree(forbiddenID),
		publicID:    newBlockTree(publicID),
	}) {
		t.Fatal("attribute view should be accessible when any mirror is public")
	}

	protectedAccess := PublishAccess{{ID: protectedID, Visible: true, Password: protectedPassword}}
	protectedTrees := map[string]*treenode.BlockTree{protectedID: newBlockTree(protectedID)}
	if checkAttributeViewBlockTreesAccessableByPublishAccess(c, protectedAccess, protectedTrees) {
		t.Fatal("attribute view with only a protected mirror should require authorization")
	}
	c.Request.AddCookie(&http.Cookie{
		Name:  "publish-auth-" + protectedID,
		Value: util.SHA256Hash([]byte(protectedID + protectedPassword)),
	})
	if !checkAttributeViewBlockTreesAccessableByPublishAccess(c, protectedAccess, protectedTrees) {
		t.Fatal("attribute view with a protected mirror should be accessible after authorization")
	}
}

func TestFilterAttributeViewRelatedValuesByPublishAccess(t *testing.T) {
	const (
		sourceAvID       = "20260726000100-source1"
		targetAvID       = "20260726000101-target1"
		sourceItemID     = "20260726000102-sourcei"
		publicItemID     = "20260726000103-publici"
		privateItemID    = "20260726000104-private"
		blockKeyID       = "20260726000105-blockky"
		relationKeyID    = "20260726000106-relkey1"
		rollupKeyID      = "20260726000107-rollkey"
		targetBlockKeyID = "20260726000108-tblockk"
		targetTextKeyID  = "20260726000109-ttextk"
	)
	publicBlock := &av.Value{
		KeyID:      targetBlockKeyID,
		BlockID:    publicItemID,
		Type:       av.KeyTypeBlock,
		IsDetached: true,
		Block:      &av.ValueBlock{Content: "public"},
	}
	privateBlock := &av.Value{
		KeyID:      targetBlockKeyID,
		BlockID:    privateItemID,
		Type:       av.KeyTypeBlock,
		IsDetached: true,
		Block:      &av.ValueBlock{Content: "private"},
	}
	relationValue := &av.Value{
		KeyID:   relationKeyID,
		BlockID: sourceItemID,
		Type:    av.KeyTypeRelation,
		Relation: &av.ValueRelation{
			BlockIDs: []string{publicItemID, privateItemID},
			Contents: []*av.Value{publicBlock, privateBlock},
		},
	}
	rollupValue := &av.Value{
		KeyID:   rollupKeyID,
		BlockID: sourceItemID,
		Type:    av.KeyTypeRollup,
		Rollup: &av.ValueRollup{Contents: []*av.Value{
			{KeyID: targetTextKeyID, BlockID: publicItemID, Type: av.KeyTypeText, Text: &av.ValueText{Content: "public rollup"}},
			{KeyID: targetTextKeyID, BlockID: privateItemID, Type: av.KeyTypeText, Text: &av.ValueText{Content: "private rollup"}},
		}},
	}
	groupValue := relationValue.Clone()

	relationKey := &av.Key{
		ID:       relationKeyID,
		Type:     av.KeyTypeRelation,
		Relation: &av.Relation{AvID: targetAvID},
	}
	rollupKey := &av.Key{
		ID:   rollupKeyID,
		Type: av.KeyTypeRollup,
		Rollup: &av.Rollup{
			RelationKeyID: relationKeyID,
			KeyID:         targetTextKeyID,
		},
	}
	sourceAttrView := &av.AttributeView{
		ID: sourceAvID,
		KeyValues: []*av.KeyValues{
			{Key: &av.Key{ID: blockKeyID, Type: av.KeyTypeBlock}},
			{Key: relationKey, Values: []*av.Value{relationValue}},
			{Key: rollupKey, Values: []*av.Value{rollupValue}},
		},
	}
	targetAttrView := &av.AttributeView{
		ID: targetAvID,
		KeyValues: []*av.KeyValues{
			{Key: &av.Key{ID: targetBlockKeyID, Type: av.KeyTypeBlock}, Values: []*av.Value{publicBlock, privateBlock}},
			{Key: &av.Key{ID: targetTextKeyID, Type: av.KeyTypeText}, Values: []*av.Value{
				{KeyID: targetTextKeyID, BlockID: publicItemID, Type: av.KeyTypeText, Text: &av.ValueText{Content: "public rollup"}},
				{KeyID: targetTextKeyID, BlockID: privateItemID, Type: av.KeyTypeText, Text: &av.ValueText{Content: "private rollup"}},
			}},
		},
	}
	table := &av.Table{
		BaseInstance: &av.BaseInstance{GroupKey: relationKey, GroupValue: groupValue},
		Rows: []*av.TableRow{{
			ID: sourceItemID,
			Cells: []*av.TableCell{
				{BaseValue: &av.BaseValue{Value: relationValue, ValueType: av.KeyTypeRelation}},
				{BaseValue: &av.BaseValue{Value: rollupValue, ValueType: av.KeyTypeRollup}},
			},
		}},
	}
	filter := &attributeViewPublishAccessFilter{
		attributeViews: map[string]*av.AttributeView{
			sourceAvID: sourceAttrView,
			targetAvID: targetAttrView,
		},
		attributeAccess: map[string]bool{
			sourceAvID: true,
			targetAvID: true,
		},
		itemAccess: map[string]map[string]bool{
			targetAvID: {
				publicItemID:  true,
				privateItemID: false,
			},
		},
	}

	filter.filterViewable(sourceAttrView, table)

	filteredRelation := table.Rows[0].Cells[0].Value
	if filteredRelation == relationValue {
		t.Fatal("filtered relation should use a response-only clone")
	}
	if 1 != len(filteredRelation.Relation.BlockIDs) || publicItemID != filteredRelation.Relation.BlockIDs[0] {
		t.Fatalf("unexpected filtered relation IDs: %v", filteredRelation.Relation.BlockIDs)
	}
	if 1 != len(filteredRelation.Relation.Contents) || publicItemID != filteredRelation.Relation.Contents[0].BlockID {
		t.Fatalf("unexpected filtered relation contents: %v", filteredRelation.Relation.Contents)
	}
	if 2 != len(relationValue.Relation.BlockIDs) || 2 != len(relationValue.Relation.Contents) {
		t.Fatal("filtering the response should not mutate the source relation")
	}

	filteredRollup := table.Rows[0].Cells[1].Value
	if filteredRollup == rollupValue || 0 != len(filteredRollup.Rollup.Contents) {
		t.Fatal("rollup containing an inaccessible target should be cleared on a response-only clone")
	}
	if 2 != len(rollupValue.Rollup.Contents) {
		t.Fatal("filtering the response should not mutate the source rollup")
	}

	if table.GroupValue == groupValue || 1 != len(table.GroupValue.Relation.BlockIDs) ||
		publicItemID != table.GroupValue.Relation.BlockIDs[0] {
		t.Fatal("relation group value should be filtered on a response-only clone")
	}
	if 2 != len(groupValue.Relation.BlockIDs) {
		t.Fatal("filtering the group value should not mutate the source value")
	}
}

func TestFilterAttributeViewRelatedValuesKeepsPublicResponse(t *testing.T) {
	const (
		sourceAvID    = "20260726000200-source1"
		targetAvID    = "20260726000201-target1"
		sourceItemID  = "20260726000202-sourcei"
		targetItemID  = "20260726000203-targeti"
		relationKeyID = "20260726000204-relkey1"
		targetKeyID   = "20260726000205-blockky"
		rollupKeyID   = "20260726000206-rollkey"
		targetTextID  = "20260726000207-textkey"
	)
	targetBlock := &av.Value{
		KeyID:      targetKeyID,
		BlockID:    targetItemID,
		Type:       av.KeyTypeBlock,
		IsDetached: true,
		Block:      &av.ValueBlock{Content: "public"},
	}
	relationValue := &av.Value{
		KeyID:   relationKeyID,
		BlockID: sourceItemID,
		Type:    av.KeyTypeRelation,
		Relation: &av.ValueRelation{
			BlockIDs: []string{targetItemID},
			Contents: []*av.Value{targetBlock},
		},
	}
	rollupValue := &av.Value{
		KeyID:   rollupKeyID,
		BlockID: sourceItemID,
		Type:    av.KeyTypeRollup,
		Rollup: &av.ValueRollup{Contents: []*av.Value{{
			KeyID: targetTextID, BlockID: targetItemID, Type: av.KeyTypeText, Text: &av.ValueText{Content: "public rollup"},
		}}},
	}
	relationKey := &av.Key{ID: relationKeyID, Type: av.KeyTypeRelation, Relation: &av.Relation{AvID: targetAvID}}
	rollupKey := &av.Key{
		ID:   rollupKeyID,
		Type: av.KeyTypeRollup,
		Rollup: &av.Rollup{
			RelationKeyID: relationKeyID,
			KeyID:         targetTextID,
		},
	}
	sourceAttrView := &av.AttributeView{
		ID: sourceAvID,
		KeyValues: []*av.KeyValues{
			{Key: relationKey, Values: []*av.Value{relationValue}},
			{Key: rollupKey, Values: []*av.Value{rollupValue}},
		},
	}
	targetAttrView := &av.AttributeView{
		ID: targetAvID,
		KeyValues: []*av.KeyValues{
			{
				Key:    &av.Key{ID: targetKeyID, Type: av.KeyTypeBlock},
				Values: []*av.Value{targetBlock},
			},
			{
				Key: &av.Key{ID: targetTextID, Type: av.KeyTypeText},
				Values: []*av.Value{{
					KeyID: targetTextID, BlockID: targetItemID, Type: av.KeyTypeText, Text: &av.ValueText{Content: "public rollup"},
				}},
			},
		},
	}
	table := &av.Table{
		BaseInstance: &av.BaseInstance{},
		Rows: []*av.TableRow{{
			ID: sourceItemID,
			Cells: []*av.TableCell{
				{BaseValue: &av.BaseValue{Value: relationValue, ValueType: av.KeyTypeRelation}},
				{BaseValue: &av.BaseValue{Value: rollupValue, ValueType: av.KeyTypeRollup}},
			},
		}},
	}
	filter := &attributeViewPublishAccessFilter{
		attributeViews: map[string]*av.AttributeView{
			sourceAvID: sourceAttrView,
			targetAvID: targetAttrView,
		},
		attributeAccess: map[string]bool{sourceAvID: true, targetAvID: true},
		itemAccess: map[string]map[string]bool{
			targetAvID: {targetItemID: true},
		},
	}

	filter.filterViewable(sourceAttrView, table)
	if table.Rows[0].Cells[0].Value != relationValue {
		t.Fatal("fully accessible relation should remain unchanged")
	}
	if table.Rows[0].Cells[1].Value != rollupValue {
		t.Fatal("fully accessible rollup should remain unchanged")
	}

	filter.attributeAccess[targetAvID] = false
	filter.filterViewable(sourceAttrView, table)
	if table.Rows[0].Cells[0].Value == relationValue || 0 != len(table.Rows[0].Cells[0].Value.Relation.BlockIDs) {
		t.Fatal("relation to an inaccessible attribute view should be cleared on a response-only clone")
	}
	if 1 != len(relationValue.Relation.BlockIDs) {
		t.Fatal("clearing the response should not mutate the source relation")
	}
}

func TestFilterSearchDocsByPublishAccess(t *testing.T) {
	const (
		boxID             = "20260720000000-boxid01"
		hiddenBoxID       = "20260720000001-boxid02"
		hiddenDocID       = "20260720000002-hiddend"
		protectedDocID    = "20260720000003-protect"
		disabledDocID     = "20260720000006-disable"
		protectedPassword = "password"
	)
	publishAccess := PublishAccess{
		{ID: hiddenBoxID, Visible: false},
		{ID: hiddenDocID, Visible: false},
		{ID: protectedDocID, Visible: true, Password: protectedPassword},
		{ID: disabledDocID, Visible: true, Disable: true},
	}
	docs := []map[string]string{
		{"box": boxID, "path": "/20260720000004-public1.sy"},
		{"box": hiddenBoxID, "path": "/"},
		{"box": boxID, "path": "/" + hiddenDocID + "/20260720000005-child01.sy"},
		{"box": boxID, "path": "/" + protectedDocID + ".sy"},
		{"box": boxID, "path": "/" + disabledDocID + ".sy"},
		{"box": boxID, "path": ""},
	}

	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodGet, "/", nil)
	filtered := FilterSearchDocsByPublishAccess(c, publishAccess, docs)
	if len(filtered) != 1 || filtered[0]["path"] != docs[0]["path"] {
		t.Fatalf("unexpected unauthenticated search docs: %v", filtered)
	}

	c.Request.AddCookie(&http.Cookie{
		Name:  "publish-auth-" + protectedDocID,
		Value: util.SHA256Hash([]byte(protectedDocID + protectedPassword)),
	})
	filtered = FilterSearchDocsByPublishAccess(c, publishAccess, docs)
	if len(filtered) != 2 || filtered[1]["path"] != docs[3]["path"] {
		t.Fatalf("unexpected authenticated search docs: %v", filtered)
	}
}

func TestFilterGraphByPublishAccess(t *testing.T) {
	const (
		boxID             = "20260724000000-boxid01"
		publicDocID       = "20260724000001-public1"
		protectedDocID    = "20260724000002-protect"
		protectedBlockID  = "20260724000003-block01"
		hiddenDocID       = "20260724000004-hidden1"
		disabledDocID     = "20260724000005-disable"
		protectedPassword = "password"
		sharedTagID       = "shared"
		protectedTagID    = "protected"
	)
	publishAccess := PublishAccess{
		{ID: protectedDocID, Visible: true, Password: protectedPassword},
		{ID: hiddenDocID, Visible: false},
		{ID: disabledDocID, Visible: true, Disable: true},
	}
	newGraph := func() ([]*GraphNode, []*GraphLink) {
		return []*GraphNode{
				{ID: publicDocID, Box: boxID, Path: "/" + publicDocID + ".sy", Size: 10, Type: "NodeDocument"},
				{ID: protectedBlockID, Box: boxID, Path: "/" + protectedDocID + "/" + protectedBlockID + ".sy", Size: 10, Type: "NodeParagraph"},
				{ID: hiddenDocID, Box: boxID, Path: "/" + hiddenDocID + ".sy", Size: 10, Type: "NodeDocument"},
				{ID: disabledDocID, Box: boxID, Path: "/" + disabledDocID + ".sy", Size: 10, Type: "NodeDocument"},
				{ID: sharedTagID, Label: sharedTagID, Size: 10, Type: "NodeTag"},
				{ID: protectedTagID, Label: protectedTagID, Size: 10, Type: "NodeTag"},
			}, []*GraphLink{
				{From: sharedTagID, To: publicDocID},
				{From: sharedTagID, To: protectedBlockID},
				{From: protectedTagID, To: protectedBlockID},
				{From: publicDocID, To: protectedBlockID, Ref: true},
				{From: publicDocID, To: hiddenDocID, Ref: true},
				{From: publicDocID, To: disabledDocID, Ref: true},
			}
	}

	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodGet, "/", nil)
	nodes, links := newGraph()
	filteredNodes, filteredLinks := FilterGraphByPublishAccess(c, publishAccess, nodes, links)
	if len(filteredNodes) != 2 || filteredNodes[0].ID != publicDocID || filteredNodes[1].ID != sharedTagID {
		t.Fatalf("unexpected unauthenticated graph nodes: %+v", filteredNodes)
	}
	if len(filteredLinks) != 1 || filteredLinks[0].From != sharedTagID || filteredLinks[0].To != publicDocID {
		t.Fatalf("unexpected unauthenticated graph links: %+v", filteredLinks)
	}
	if filteredNodes[0].Refs != 0 || filteredNodes[0].Defs != 0 || filteredNodes[1].Refs != 1 {
		t.Fatalf("unexpected unauthenticated graph counts: %+v", filteredNodes)
	}

	c.Request.AddCookie(&http.Cookie{
		Name:  "publish-auth-" + protectedDocID,
		Value: util.SHA256Hash([]byte(protectedDocID + protectedPassword)),
	})
	nodes, links = newGraph()
	filteredNodes, filteredLinks = FilterGraphByPublishAccess(c, publishAccess, nodes, links)
	if len(filteredNodes) != 4 || filteredNodes[1].ID != protectedBlockID || filteredNodes[3].ID != protectedTagID {
		t.Fatalf("unexpected authenticated graph nodes: %+v", filteredNodes)
	}
	if len(filteredLinks) != 4 {
		t.Fatalf("unexpected authenticated graph links: %+v", filteredLinks)
	}
	if filteredNodes[0].Refs != 1 || filteredNodes[1].Defs != 1 || filteredNodes[1].Size != 10 {
		t.Fatalf("unexpected authenticated graph counts: %+v", filteredNodes)
	}
}

func TestFilterTagsByPublishAccess(t *testing.T) {
	const (
		boxID             = "20260726000000-boxid01"
		publicDocID       = "20260726000001-public1"
		protectedDocID    = "20260726000002-protect"
		hiddenDocID       = "20260726000003-hidden1"
		disabledDocID     = "20260726000004-disable"
		protectedPassword = "password"
	)
	publishAccess := PublishAccess{
		{ID: protectedDocID, Visible: true, Password: protectedPassword},
		{ID: hiddenDocID, Visible: false},
		{ID: disabledDocID, Visible: true, Disable: true},
	}
	spans := []*sql.Span{
		{Box: boxID, Path: "/" + publicDocID + ".sy", Content: "shared"},
		{Box: boxID, Path: "/" + protectedDocID + ".sy", Content: "shared"},
		{Box: boxID, Path: "/" + protectedDocID + ".sy", Content: "protected"},
		{Box: boxID, Path: "/" + hiddenDocID + ".sy", Content: "hidden"},
		{Box: boxID, Path: "/" + disabledDocID + ".sy", Content: "disabled"},
	}
	newTags := func() *Tags {
		return &Tags{
			{Name: "shared", Label: "shared", Type: "tag", Count: 2},
			{Name: "protected", Label: "protected", Type: "tag", Count: 1},
			{Name: "hidden", Label: "hidden", Type: "tag", Count: 1},
			{Name: "disabled", Label: "disabled", Type: "tag", Count: 1},
		}
	}

	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodGet, "/", nil)
	filtered := filterTagsByPublishAccess(c, publishAccess, newTags(), spans)
	if len(*filtered) != 1 || (*filtered)[0].Label != "shared" || (*filtered)[0].Count != 1 {
		t.Fatalf("unexpected unauthenticated tags: %+v", *filtered)
	}

	c.Request.AddCookie(&http.Cookie{
		Name:  "publish-auth-" + protectedDocID,
		Value: util.SHA256Hash([]byte(protectedDocID + protectedPassword)),
	})
	filtered = filterTagsByPublishAccess(c, publishAccess, newTags(), spans)
	if len(*filtered) != 2 ||
		(*filtered)[0].Label != "shared" || (*filtered)[0].Count != 2 ||
		(*filtered)[1].Label != "protected" || (*filtered)[1].Count != 1 {
		t.Fatalf("unexpected authenticated tags: %+v", *filtered)
	}
}

func TestFilterEmbedBlocksByPublishAccessRemovesInternalFields(t *testing.T) {
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodGet, "/", nil)
	embedBlocks := []*EmbedBlock{{
		Block: &Block{
			Box:      "20260720000000-boxid01",
			Path:     "/20260720000004-public1.sy",
			HPath:    "/private/path",
			ID:       "20260720000005-block01",
			Content:  "<div>visible</div>",
			Markdown: "sensitive markdown",
			IAL:      map[string]string{"custom-secret": "sensitive ial"},
		},
		BlockPaths:          []*BlockPath{{ID: "20260720000004-public1", Name: "Public"}},
		AllowChildOperation: true,
	}}

	filtered := FilterEmbedBlocksByPublishAccess(c, PublishAccess{}, embedBlocks)
	if 1 != len(filtered) {
		t.Fatalf("unexpected filtered embed block count: %d", len(filtered))
	}
	block := filtered[0].Block
	if "20260720000005-block01" != block.ID || "<div>visible</div>" != block.Content {
		t.Fatalf("required embed block fields were not preserved: %+v", block)
	}
	if "" != block.Box || "" != block.Path || "" != block.HPath || "" != block.Markdown || nil != block.IAL {
		t.Fatalf("internal embed block fields were not removed: %+v", block)
	}
	if 1 != len(filtered[0].BlockPaths) || !filtered[0].AllowChildOperation {
		t.Fatalf("embed rendering metadata was not preserved: %+v", filtered[0])
	}
}

func TestFilterEmbedBlocksByPublishAccessDropsInaccessibleResults(t *testing.T) {
	const (
		boxID             = "20260720000000-boxid01"
		unlistedDocID     = "20260720000001-unliste"
		hiddenDocID       = "20260720000002-hiddend"
		protectedDocID    = "20260720000003-protect"
		protectedPassword = "password"
	)
	publishAccess := PublishAccess{
		{ID: unlistedDocID, Visible: false},
		{ID: hiddenDocID, Disable: true},
		{ID: protectedDocID, Visible: true, Password: protectedPassword},
	}
	embedBlocks := []*EmbedBlock{
		{Block: &Block{ID: "20260720000004-unliste", Box: boxID, Path: "/" + unlistedDocID + ".sy", Content: "unlisted"}},
		{Block: &Block{ID: "20260720000004-hidden1", Box: boxID, Path: "/" + hiddenDocID + ".sy", Content: "hidden"}},
		{Block: &Block{ID: "20260720000005-protect", Box: boxID, Path: "/" + protectedDocID + ".sy", Content: "protected"}},
	}

	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodGet, "/", nil)
	if filtered := FilterEmbedBlocksByPublishAccess(c, publishAccess, embedBlocks); 0 != len(filtered) {
		t.Fatalf("不可访问的嵌入块结果不应返回：%+v", filtered)
	}

	c.Request.AddCookie(&http.Cookie{
		Name:  "publish-auth-" + protectedDocID,
		Value: util.SHA256Hash([]byte(protectedDocID + protectedPassword)),
	})
	filtered := FilterEmbedBlocksByPublishAccess(c, publishAccess, embedBlocks)
	if 1 != len(filtered) || "20260720000005-protect" != filtered[0].Block.ID {
		t.Fatalf("密码验证后应仅返回已授权结果：%+v", filtered)
	}
}

func TestFilterPathsByPublishAccess(t *testing.T) {
	const (
		boxID             = "20260804000000-boxid01"
		publicID          = "20260804000001-public1"
		protectedID       = "20260804000002-protect"
		hiddenID          = "20260804000003-hidden1"
		disabledID        = "20260804000004-disable"
		protectedPassword = "password"
	)

	oldDataDir := util.DataDir
	oldBlockTreeDBPath := util.BlockTreeDBPath
	util.DataDir = t.TempDir()
	util.BlockTreeDBPath = filepath.Join(util.DataDir, "blocktree.db")
	treenode.InitBlockTree(true)
	invalidateEncryptedPublishAccessCache()
	t.Cleanup(func() {
		treenode.CloseDatabase()
		util.DataDir = oldDataDir
		util.BlockTreeDBPath = oldBlockTreeDBPath
		invalidateEncryptedPublishAccessCache()
		if "" != oldBlockTreeDBPath {
			treenode.InitBlockTree(false)
		}
	})

	for _, id := range []string{publicID, protectedID, hiddenID, disabledID} {
		tree := treenode.NewTree(boxID, "/"+id+".sy", "/"+id, id)
		treenode.UpsertBlockTree(tree)
	}

	newPaths := func() []*Path {
		return []*Path{
			{ID: protectedID, Name: "/" + protectedID + ".sy", HPath: "/protected", Type: "path", NodeType: "NodeDocument"},
			{ID: publicID, Name: "/" + publicID + ".sy", HPath: "/public", Type: "path", NodeType: "NodeDocument"},
			{ID: hiddenID, Name: "/" + hiddenID + ".sy", HPath: "/hidden", Type: "path", NodeType: "NodeDocument"},
			{ID: disabledID, Name: "/" + disabledID + ".sy", HPath: "/disabled", Type: "path", NodeType: "NodeDocument"},
		}
	}
	publishAccess := PublishAccess{
		{ID: protectedID, Visible: true, Password: protectedPassword},
		{ID: hiddenID, Visible: false},
		{ID: disabledID, Visible: true, Disable: true},
	}

	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodGet, "/", nil)
	filtered := FilterPathsByPublishAccess(c, publishAccess, newPaths())
	if len(filtered) != 1 || filtered[0].ID != publicID {
		t.Fatalf("unexpected unauthenticated backlink paths: %+v", filtered)
	}

	c.Request.AddCookie(&http.Cookie{
		Name:  "publish-auth-" + protectedID,
		Value: util.SHA256Hash([]byte(protectedID + protectedPassword)),
	})
	filtered = FilterPathsByPublishAccess(c, publishAccess, newPaths())
	if len(filtered) != 2 || filtered[0].ID != protectedID || filtered[1].ID != publicID {
		t.Fatalf("unexpected authenticated backlink paths: %+v", filtered)
	}
}

func TestFilterRecentDocsByPublishAccess(t *testing.T) {
	const (
		boxID             = "20260804010000-boxid01"
		publicID          = "20260804010001-public1"
		protectedID       = "20260804010002-protect"
		hiddenID          = "20260804010003-hidden1"
		disabledID        = "20260804010004-disable"
		protectedPassword = "password"
	)

	oldDataDir := util.DataDir
	oldBlockTreeDBPath := util.BlockTreeDBPath
	util.DataDir = t.TempDir()
	util.BlockTreeDBPath = filepath.Join(util.DataDir, "blocktree.db")
	treenode.InitBlockTree(true)
	invalidateEncryptedPublishAccessCache()
	t.Cleanup(func() {
		treenode.CloseDatabase()
		util.DataDir = oldDataDir
		util.BlockTreeDBPath = oldBlockTreeDBPath
		invalidateEncryptedPublishAccessCache()
		if "" != oldBlockTreeDBPath {
			treenode.InitBlockTree(false)
		}
	})

	for _, id := range []string{publicID, protectedID, hiddenID, disabledID} {
		tree := treenode.NewTree(boxID, "/"+id+".sy", "/"+id, id)
		treenode.UpsertBlockTree(tree)
	}

	newRecentDocs := func() []*RecentDoc {
		return []*RecentDoc{
			{RootID: publicID, Title: "Public"},
			{RootID: protectedID, Title: "Protected"},
			{RootID: hiddenID, Title: "Hidden"},
			{RootID: disabledID, Title: "Disabled"},
		}
	}
	publishAccess := PublishAccess{
		{ID: protectedID, Visible: true, Password: protectedPassword},
		{ID: hiddenID, Visible: false},
		{ID: disabledID, Visible: true, Disable: true},
	}

	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodGet, "/", nil)
	filtered := FilterRecentDocsByPublishAccess(c, publishAccess, newRecentDocs())
	if len(filtered) != 1 || filtered[0].RootID != publicID {
		t.Fatalf("unexpected unauthenticated recent docs: %+v", filtered)
	}

	c.Request.AddCookie(&http.Cookie{
		Name:  "publish-auth-" + protectedID,
		Value: util.SHA256Hash([]byte(protectedID + protectedPassword)),
	})
	filtered = FilterRecentDocsByPublishAccess(c, publishAccess, newRecentDocs())
	if len(filtered) != 2 || filtered[0].RootID != publicID || filtered[1].RootID != protectedID {
		t.Fatalf("unexpected authenticated recent docs: %+v", filtered)
	}
}

func TestFilterCriteriaByPublishAccess(t *testing.T) {
	const (
		boxID             = "20260804020000-boxid01"
		publicID          = "20260804020001-public1"
		protectedID       = "20260804020002-protect"
		hiddenID          = "20260804020003-hidden1"
		disabledID        = "20260804020004-disable"
		protectedPassword = "password"
	)

	oldDataDir := util.DataDir
	oldBlockTreeDBPath := util.BlockTreeDBPath
	util.DataDir = t.TempDir()
	util.BlockTreeDBPath = filepath.Join(util.DataDir, "blocktree.db")
	treenode.InitBlockTree(true)
	invalidateEncryptedPublishAccessCache()
	t.Cleanup(func() {
		treenode.CloseDatabase()
		util.DataDir = oldDataDir
		util.BlockTreeDBPath = oldBlockTreeDBPath
		invalidateEncryptedPublishAccessCache()
		if "" != oldBlockTreeDBPath {
			treenode.InitBlockTree(false)
		}
	})

	for _, id := range []string{publicID, protectedID, hiddenID, disabledID} {
		tree := treenode.NewTree(boxID, "/"+id+".sy", "/"+id, id)
		treenode.UpsertBlockTree(tree)
	}

	newCriteria := func() []*Criterion {
		return []*Criterion{
			{Name: "public", HPath: "/public", IDPath: []string{publicID}},
			{Name: "protected", HPath: "/protected", IDPath: []string{protectedID}},
			{Name: "hidden", HPath: "/hidden", IDPath: []string{hiddenID}},
			{Name: "disabled", HPath: "/disabled", IDPath: []string{disabledID}},
		}
	}
	publishAccess := PublishAccess{
		{ID: protectedID, Visible: true, Password: protectedPassword},
		{ID: hiddenID, Visible: false},
		{ID: disabledID, Visible: true, Disable: true},
	}

	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodGet, "/", nil)
	filtered := FilterCriteriaByPublishAccess(c, publishAccess, newCriteria())
	if len(filtered) != 1 || filtered[0].Name != "public" {
		t.Fatalf("unexpected unauthenticated criteria: %+v", filtered)
	}

	c.Request.AddCookie(&http.Cookie{
		Name:  "publish-auth-" + protectedID,
		Value: util.SHA256Hash([]byte(protectedID + protectedPassword)),
	})
	filtered = FilterCriteriaByPublishAccess(c, publishAccess, newCriteria())
	if len(filtered) != 2 || filtered[0].Name != "public" || filtered[1].Name != "protected" {
		t.Fatalf("unexpected authenticated criteria: %+v", filtered)
	}
}

func TestFilterAssetContentByPublishAccess(t *testing.T) {
	const (
		boxID             = "20260804030000-boxid01"
		publicDocID       = "20260804030001-public1"
		protectedDocID    = "20260804030002-protect"
		hiddenDocID       = "20260804030003-hidden1"
		disabledDocID     = "20260804030004-disable"
		publicAsset       = "assets/public.png"
		protectedAsset    = "assets/protected.png"
		hiddenAsset       = "assets/hidden.png"
		disabledAsset     = "assets/disabled.png"
		protectedPassword = "password"
	)

	oldDataDir := util.DataDir
	oldBlockTreeDBPath := util.BlockTreeDBPath
	util.DataDir = t.TempDir()
	util.BlockTreeDBPath = filepath.Join(util.DataDir, "blocktree.db")
	treenode.InitBlockTree(true)
	invalidateEncryptedPublishAccessCache()
	t.Cleanup(func() {
		treenode.CloseDatabase()
		util.DataDir = oldDataDir
		util.BlockTreeDBPath = oldBlockTreeDBPath
		invalidateEncryptedPublishAccessCache()
		if "" != oldBlockTreeDBPath {
			treenode.InitBlockTree(false)
		}
	})

	newDocTree := func(docID, asset string) {
		tree := treenode.NewTree(boxID, "/"+docID+".sy", "/"+docID, docID)
		tree.Root.FirstChild.Unlink()
		dom := `<div data-node-id="` + docID + `" data-type="htmlblock"><img src="` + asset + `" data-src="` + asset + `" /></div>`
		node := util.NewLute().BlockDOM2Tree(dom).Root.FirstChild
		tree.Root.AppendChild(node)
		if _, err := filesys.WriteTree(tree); err != nil {
			t.Fatal(err)
		}
		treenode.UpsertBlockTree(tree)
	}
	newDocTree(publicDocID, publicAsset)
	newDocTree(protectedDocID, protectedAsset)
	newDocTree(hiddenDocID, hiddenAsset)
	newDocTree(disabledDocID, disabledAsset)

	newAssetContents := func() []*AssetContent {
		return []*AssetContent{
			{ID: publicDocID, Name: "public.png", Path: publicAsset},
			{ID: protectedDocID, Name: "protected.png", Path: protectedAsset},
			{ID: hiddenDocID, Name: "hidden.png", Path: hiddenAsset},
			{ID: disabledDocID, Name: "disabled.png", Path: disabledAsset},
		}
	}
	publishAccess := PublishAccess{
		{ID: protectedDocID, Visible: true, Password: protectedPassword},
		{ID: hiddenDocID, Visible: false},
		{ID: disabledDocID, Visible: true, Disable: true},
	}

	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodGet, "/", nil)
	filtered := FilterAssetContentByPublishAccess(c, publishAccess, newAssetContents())
	if len(filtered) != 1 || filtered[0].Path != publicAsset {
		t.Fatalf("unexpected unauthenticated asset contents: %+v", filtered)
	}

	c.Request.AddCookie(&http.Cookie{
		Name:  "publish-auth-" + protectedDocID,
		Value: util.SHA256Hash([]byte(protectedDocID + protectedPassword)),
	})
	filtered = FilterAssetContentByPublishAccess(c, publishAccess, newAssetContents())
	if len(filtered) != 2 || filtered[0].Path != publicAsset || filtered[1].Path != protectedAsset {
		t.Fatalf("unexpected authenticated asset contents: %+v", filtered)
	}
}

// TestCheckAbsPathAccessableByPublishAccessKeepsHiddenNotebookAccessible 验证原始文件通道
// 保持「仅隐藏」语义：显式隐藏（Visible:false）的笔记本不构成机密边界，
// 普通文件与 .sy 文档仍可直接访问，禁用与密码保护照常生效。
func TestCheckAbsPathAccessableByPublishAccessKeepsHiddenNotebookAccessible(t *testing.T) {
	const (
		boxID    = "20260821000005-visboxa"
		docID    = "20260821000006-visdoca"
		password = "password"
	)
	oldDataDir := util.DataDir
	util.DataDir = t.TempDir()
	invalidateEncryptedPublishAccessCache()
	t.Cleanup(func() {
		util.DataDir = oldDataDir
		invalidateEncryptedPublishAccessCache()
	})

	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodGet, "/", nil)
	fileAbs := filepath.Join(util.DataDir, boxID, "private.txt")
	docAbs := filepath.Join(util.DataDir, boxID, docID+".sy")

	// 显式隐藏的笔记本保持可直接访问语义（与文档内容 API 一致）
	if !CheckAbsPathAccessableByPublishAccess(c, fileAbs, PublishAccess{{ID: boxID, Visible: false}}) {
		t.Fatal("hidden notebook file should remain directly accessible")
	}
	if !CheckAbsPathAccessableByPublishAccess(c, docAbs, PublishAccess{{ID: boxID, Visible: false}}) {
		t.Fatal("hidden notebook doc should remain directly accessible")
	}

	// 可见与未配置场景不受影响
	if !CheckAbsPathAccessableByPublishAccess(c, fileAbs, PublishAccess{{ID: boxID, Visible: true}}) {
		t.Fatal("visible notebook file should be accessible")
	}
	if !CheckAbsPathAccessableByPublishAccess(c, fileAbs, PublishAccess{}) {
		t.Fatal("unconfigured notebook file should be accessible")
	}

	// 禁用与密码保护仍构成访问控制
	if CheckAbsPathAccessableByPublishAccess(c, fileAbs, PublishAccess{{ID: boxID, Visible: true, Disable: true}}) {
		t.Fatal("disabled notebook should be denied")
	}
	if CheckAbsPathAccessableByPublishAccess(c, fileAbs, PublishAccess{{ID: boxID, Visible: true, Password: password}}) {
		t.Fatal("password protected notebook should be denied without auth cookie")
	}
	c.Request.AddCookie(&http.Cookie{
		Name:  "publish-auth-" + boxID,
		Value: util.SHA256Hash([]byte(boxID + password)),
	})
	if !CheckAbsPathAccessableByPublishAccess(c, fileAbs, PublishAccess{{ID: boxID, Visible: true, Password: password}}) {
		t.Fatal("password protected notebook should be accessible after authorization")
	}
}
