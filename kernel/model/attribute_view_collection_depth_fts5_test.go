// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

func TestBlockCollectionDocumentDepthScope(t *testing.T) {
	for _, test := range []struct {
		name  string
		depth *int
		ids   []string
		box   string
		tree  *parse.Tree
		want  bool
	}{
		{"legacy descendants", nil, []string{"parent"}, "", &parse.Tree{ID: "grand", Path: "/parent/child/grand.sy"}, true},
		{"self", new(0), []string{"parent"}, "", &parse.Tree{ID: "parent", Path: "/ancestor/parent.sy"}, true},
		{"no children", new(0), []string{"parent"}, "", &parse.Tree{ID: "child", Path: "/parent/child.sy"}, false},
		{"direct child", new(1), []string{"parent"}, "", &parse.Tree{ID: "child", Path: "/ancestor/parent/child.sy"}, true},
		{"grandchild excluded", new(1), []string{"parent"}, "", &parse.Tree{ID: "grand", Path: "/parent/child/grand.sy"}, false},
		{"grandchild included", new(2), []string{"parent"}, "", &parse.Tree{ID: "grand", Path: "/parent/child/grand.sy"}, true},
		{"nested scope union", new(1), []string{"parent", "child"}, "", &parse.Tree{ID: "grand", Path: "/parent/child/grand.sy"}, true},
		{"explicit document union", new(0), []string{"parent", "grand"}, "", &parse.Tree{ID: "grand", Path: "/parent/child/grand.sy"}, true},
		{"notebook union", new(0), []string{"parent"}, "box", &parse.Tree{ID: "grand", Box: "box", Path: "/parent/child/grand.sy"}, true},
		{"unrelated", nil, []string{"parent"}, "", &parse.Tree{ID: "child", Path: "/other/child.sy"}, false},
		{"partial id", nil, []string{"parent"}, "", &parse.Tree{ID: "child", Path: "/prefix-parent/child.sy"}, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			source := &av.AutomationBlockSource{DocumentIDs: test.ids, DocumentDepth: test.depth}
			if test.box != "" {
				source.NotebookIDs = []string{test.box}
			}
			if got := collectionScopeMatches(source, test.tree); got != test.want {
				t.Fatalf("scope matches = %v, want %v", got, test.want)
			}
		})
	}
	// 文档层级不限制文档内部的容器嵌套。
	root := &ast.Node{ID: "parent", Type: ast.NodeDocument}
	quote := &ast.Node{ID: ast.NewNodeID(), Type: ast.NodeBlockquote}
	paragraph := treenode.NewParagraph("")
	root.AppendChild(quote)
	quote.AppendChild(paragraph)
	source := &av.AutomationBlockSource{DocumentIDs: []string{"parent"}, DocumentDepth: new(0), Types: []string{"p"}}
	if !collectionMatches(source, &parse.Tree{ID: "parent", Root: root})[paragraph.ID] {
		t.Fatal("document depth limited block nesting")
	}
}

func TestBlockCollectionDocumentDepthTransitionsPreviewAndCleanup(t *testing.T) {
	fixture, view, keyID := setupBlockCollectionTest(t)
	parent, err := LoadTreeByBlockID(fixture.sourceID)
	if err != nil {
		t.Fatal(err)
	}
	child, err := CreateDocByMdSync(fixture.box.ID, strings.TrimSuffix(parent.Path, ".sy")+"/"+ast.NewNodeID()+".sy", "Child", "Child content", nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	grand, err := CreateDocByMdSync(fixture.box.ID, strings.TrimSuffix(child.Path, ".sy")+"/"+ast.NewNodeID()+".sy", "Grandchild", "Grandchild content", nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	setDepth := func(depth *int) {
		t.Helper()
		view = readAttributeViewItemsTest(t, view.ID)
		view.Automations.Spec = 5
		view.Automations.Rules[0].BlockSource.DocumentDepth = depth
		if err := PerformAttributeViewOperations([]*Operation{{Action: "setAttrViewAutomations", AvID: view.ID, Data: view.Automations}}); err != nil {
			t.Fatal(err)
		}
	}
	setDepth(new(1))
	for _, id := range []string{parent.ID, child.ID, grand.ID} {
		if err = PerformTxSync(blockCollectionTags(t, id, "todo")); err != nil {
			t.Fatal(err)
		}
	}
	view = readAttributeViewItemsTest(t, view.ID)
	if view.GetBlockValueByBoundID(parent.ID) == nil || view.GetBlockValueByBoundID(child.ID) == nil || view.GetBlockValueByBoundID(grand.ID) != nil {
		t.Fatal("depth 1 must collect self and direct children only")
	}
	childItem := view.GetBlockValueByBoundID(child.ID).BlockID
	view.GetValue(keyID, childItem).Text.Content = "Edited"
	if err = av.SaveAttributeView(view); err != nil {
		t.Fatal(err)
	}
	preview, err := PreviewAttributeViewCollection(view.ID, view.Automations.Rules[0].ID, 1)
	if err != nil || len(preview.Blocks) != 2 {
		t.Fatalf("depth 1 preview: %+v %v", preview, err)
	}
	setDepth(new(0))
	review, err := ReviewAttributeViewCollection(view.ID, 1, "")
	if err != nil || review.Matched != 1 || review.Unmatched != 1 {
		t.Fatalf("depth 0 review: %+v %v", review, err)
	}
	view = readAttributeViewItemsTest(t, view.ID)
	if view.GetValue(keyID, childItem).Text.Content != "Edited" {
		t.Fatal("shrinking depth reset existing fields")
	}
	preview, err = PreviewAttributeViewCollection(view.ID, view.Automations.Rules[0].ID, 1)
	if err != nil || len(preview.Blocks) != 1 || preview.Blocks[0].ID != parent.ID {
		t.Fatalf("depth 0 preview: %+v %v", preview, err)
	}
	cleanup := collectionCleanupOperation(view.ID, review)
	setDepth(new(2))
	if err = PerformAttributeViewOperations([]*Operation{cleanup}); err == nil {
		t.Fatal("depth change accepted stale cleanup")
	}
	view = readAttributeViewItemsTest(t, view.ID)
	if view.GetBlockValueByBoundID(grand.ID) != nil {
		t.Fatal("changing depth backfilled existing content")
	}
	preview, err = PreviewAttributeViewCollection(view.ID, view.Automations.Rules[0].ID, 1)
	if err != nil || len(preview.Blocks) != 3 {
		t.Fatalf("depth 2 preview: %+v %v", preview, err)
	}
	if err = PerformAttributeViewOperations([]*Operation{{Action: "collectAttrViewBlocks", AvID: view.ID,
		Data: map[string]any{"ruleID": view.Automations.Rules[0].ID, "blockIDs": []string{grand.ID}}}}); err != nil {
		t.Fatal(err)
	}
	if readAttributeViewItemsTest(t, view.ID).GetBlockValueByBoundID(grand.ID) == nil {
		t.Fatal("explicit depth match not collected")
	}
	setDepth(new(0))
	review, err = ReviewAttributeViewCollection(view.ID, 1, "")
	if err != nil || review.Matched != 1 || review.Unmatched != 2 {
		t.Fatalf("cleanup review: %+v %v", review, err)
	}
	op := collectionCleanupOperation(view.ID, review)
	tx := &Transaction{fromAPI: true, DoOperations: []*Operation{op}, UndoOperations: []*Operation{op}}
	if err = PerformTxSync(tx); err != nil {
		t.Fatal(err)
	}
	if readAttributeViewItemsTest(t, view.ID).GetBlockValue(childItem) != nil {
		t.Fatal("confirmed depth mismatch was not removed")
	}
	if err = PerformTxSync(&Transaction{isReplay: true, DoOperations: cloneOperations(tx.UndoOperations)}); err != nil {
		t.Fatal(err)
	}
	view = readAttributeViewItemsTest(t, view.ID)
	if view.GetValue(keyID, childItem).Text.Content != "Edited" {
		t.Fatal("undo did not restore original fields")
	}
	if err = PerformTxSync(&Transaction{isReplay: true, DoOperations: cloneOperations(tx.DoOperations)}); err != nil {
		t.Fatal(err)
	}
	if readAttributeViewItemsTest(t, view.ID).GetBlockValue(childItem) != nil {
		t.Fatal("redo did not restore cleanup")
	}
	view = readAttributeViewItemsTest(t, view.ID)
	view.Automations.Rules[0].BlockSource.DocumentDepth = new(-1)
	if err = PerformAttributeViewOperations([]*Operation{{Action: "setAttrViewAutomations", AvID: view.ID, Data: view.Automations}}); err == nil {
		t.Fatal("negative document depth accepted")
	}
	if *readAttributeViewItemsTest(t, view.ID).Automations.Rules[0].BlockSource.DocumentDepth != 0 {
		t.Fatal("invalid depth overwrote saved configuration")
	}
}

func TestBlockCollectionDocumentDepthBlockMoves(t *testing.T) {
	fixture, view, _ := setupBlockCollectionTest(t)
	parent, err := LoadTreeByBlockID(fixture.sourceID)
	if err != nil {
		t.Fatal(err)
	}
	child, err := CreateDocByMdSync(fixture.box.ID, strings.TrimSuffix(parent.Path, ".sy")+"/"+ast.NewNodeID()+".sy", "Child", "Child content", nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	grand, err := CreateDocByMdSync(fixture.box.ID, strings.TrimSuffix(child.Path, ".sy")+"/"+ast.NewNodeID()+".sy", "Grandchild", "Moved content", nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	view.Automations.Spec = 5
	source := view.Automations.Rules[0].BlockSource
	source.DocumentDepth, source.Tags, source.Types = new(1), nil, []string{"p"}
	if err = av.SaveAttributeView(view); err != nil {
		t.Fatal(err)
	}
	blockID := grand.Root.FirstChild.ID
	if err = PerformTxSync(&Transaction{fromAPI: true, DoOperations: []*Operation{{Action: "move", ID: blockID, ParentID: child.ID}}}); err != nil {
		t.Fatal(err)
	}
	if readAttributeViewItemsTest(t, view.ID).GetBlockValueByBoundID(blockID) == nil {
		t.Fatal("move into allowed depth did not collect")
	}
	if err = PerformTxSync(&Transaction{fromAPI: true, DoOperations: []*Operation{{Action: "move", ID: blockID, ParentID: grand.ID}}}); err != nil {
		t.Fatal(err)
	}
	if readAttributeViewItemsTest(t, view.ID).GetBlockValueByBoundID(blockID) == nil {
		t.Fatal("move out of allowed depth removed existing entry")
	}
	view = readAttributeViewItemsTest(t, view.ID)
	view.Automations.Rules[0].BlockSource.Types = []string{"d"}
	if err = av.SaveAttributeView(view); err != nil {
		t.Fatal(err)
	}
	created, err := CreateDocByMdSync(fixture.box.ID, strings.TrimSuffix(parent.Path, ".sy")+"/"+ast.NewNodeID()+".sy", "New child", "", nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	excluded, err := CreateDocByMdSync(fixture.box.ID, strings.TrimSuffix(created.Path, ".sy")+"/"+ast.NewNodeID()+".sy", "New grandchild", "", nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	view = readAttributeViewItemsTest(t, view.ID)
	if view.GetBlockValueByBoundID(created.ID) == nil || view.GetBlockValueByBoundID(excluded.ID) != nil {
		t.Fatal("new documents did not respect relative depth")
	}
}
