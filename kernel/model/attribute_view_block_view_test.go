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
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestNormalizeDatabaseBlockView(t *testing.T) {
	tests := []struct {
		name            string
		blockViewID     string
		views           []*av.View
		initialLayout   string
		expectedViewID  string
		expectedLayout  string
		expectedChanged bool
	}{
		{
			name:        "valid block view takes precedence",
			blockViewID: "gallery-view",
			views: []*av.View{
				{ID: "table-view", LayoutType: av.LayoutTypeTable},
				{ID: "gallery-view", LayoutType: av.LayoutTypeGallery},
			},
			initialLayout:   string(av.LayoutTypeTable),
			expectedViewID:  "gallery-view",
			expectedLayout:  string(av.LayoutTypeGallery),
			expectedChanged: true,
		},
		{
			name: "missing block view uses first view",
			views: []*av.View{
				{ID: "table-view", LayoutType: av.LayoutTypeTable},
				{ID: "gallery-view", LayoutType: av.LayoutTypeGallery},
			},
			initialLayout:   string(av.LayoutTypeTable),
			expectedViewID:  "table-view",
			expectedLayout:  string(av.LayoutTypeTable),
			expectedChanged: true,
		},
		{
			name:        "invalid block view uses first view",
			blockViewID: "missing-view",
			views: []*av.View{
				{ID: "table-view", LayoutType: av.LayoutTypeTable},
				{ID: "gallery-view", LayoutType: av.LayoutTypeGallery},
			},
			initialLayout:   string(av.LayoutTypeGallery),
			expectedViewID:  "table-view",
			expectedLayout:  string(av.LayoutTypeTable),
			expectedChanged: true,
		},
		{
			name:        "invalid block view uses first view",
			blockViewID: "missing-block-view",
			views: []*av.View{
				{ID: "table-view", LayoutType: av.LayoutTypeTable},
				{ID: "gallery-view", LayoutType: av.LayoutTypeGallery},
			},
			initialLayout:   string(av.LayoutTypeGallery),
			expectedViewID:  "table-view",
			expectedLayout:  string(av.LayoutTypeTable),
			expectedChanged: true,
		},
		{
			name:        "view ID distinguishes views with the same layout",
			blockViewID: "second-table-view",
			views: []*av.View{
				{ID: "first-table-view", LayoutType: av.LayoutTypeTable},
				{ID: "second-table-view", LayoutType: av.LayoutTypeTable},
			},
			initialLayout:   string(av.LayoutTypeGallery),
			expectedViewID:  "second-table-view",
			expectedLayout:  string(av.LayoutTypeTable),
			expectedChanged: true,
		},
		{
			name:           "missing views keep block unchanged",
			blockViewID:    "missing-view",
			initialLayout:  string(av.LayoutTypeGallery),
			expectedViewID: "missing-view",
			expectedLayout: string(av.LayoutTypeGallery),
		},
		{
			name:        "normalized block stays unchanged",
			blockViewID: "gallery-view",
			views: []*av.View{
				{ID: "table-view", LayoutType: av.LayoutTypeTable},
				{ID: "gallery-view", LayoutType: av.LayoutTypeGallery},
			},
			initialLayout:  string(av.LayoutTypeGallery),
			expectedViewID: "gallery-view",
			expectedLayout: string(av.LayoutTypeGallery),
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			node := &ast.Node{Type: ast.NodeAttributeView, AttributeViewType: test.initialLayout}
			if "" != test.blockViewID {
				node.SetIALAttr(av.NodeAttrView, test.blockViewID)
			}
			attrView := &av.AttributeView{Views: test.views}

			changed := normalizeDatabaseBlockView(node, attrView)

			if test.expectedViewID != node.IALAttr(av.NodeAttrView) {
				t.Fatalf("unexpected block view ID: %s", node.IALAttr(av.NodeAttrView))
			}
			if test.expectedLayout != node.AttributeViewType {
				t.Fatalf("unexpected block layout: %s", node.AttributeViewType)
			}
			if test.expectedChanged != changed {
				t.Fatalf("unexpected normalization result: %t", changed)
			}
		})
	}
}

func TestNormalizeDatabaseBlockViewsUsesStoredBlockView(t *testing.T) {
	setupAttributeViewValidationTest(t)

	attrView := av.NewAttributeView("20260803090000-blockvw")
	galleryView := &av.View{ID: ast.NewNodeID(), LayoutType: av.LayoutTypeGallery}
	attrView.Views = append(attrView.Views, galleryView)
	if err := av.SaveAttributeView(attrView); nil != err {
		t.Fatalf("save attribute view failed: %s", err)
	}

	node := &ast.Node{
		Type:              ast.NodeAttributeView,
		AttributeViewID:   attrView.ID,
		AttributeViewType: string(av.LayoutTypeTable),
	}
	node.SetIALAttr(av.NodeAttrView, galleryView.ID)
	secondNode := &ast.Node{
		Type:              ast.NodeAttributeView,
		AttributeViewID:   attrView.ID,
		AttributeViewType: string(av.LayoutTypeTable),
	}
	secondNode.SetIALAttr(av.NodeAttrView, galleryView.ID)
	root := &ast.Node{Type: ast.NodeDocument}
	root.AppendChild(node)
	root.AppendChild(secondNode)
	attrViews := map[string]*av.AttributeView{}

	changed := normalizeDatabaseBlockViews(root, "", attrViews)

	if galleryView.ID != node.IALAttr(av.NodeAttrView) {
		t.Fatalf("unexpected block view ID: %s", node.IALAttr(av.NodeAttrView))
	}
	if string(av.LayoutTypeGallery) != node.AttributeViewType {
		t.Fatalf("unexpected block layout: %s", node.AttributeViewType)
	}
	if string(av.LayoutTypeGallery) != secondNode.AttributeViewType {
		t.Fatalf("unexpected second block layout: %s", secondNode.AttributeViewType)
	}
	if 1 != len(attrViews) {
		t.Fatalf("attribute view should be parsed once, cache size: %d", len(attrViews))
	}
	if !changed {
		t.Fatal("stored block view should normalize the block")
	}
}

func TestNormalizeDatabaseBlockViewsKeepsMissingAttributeViewLayout(t *testing.T) {
	setupAttributeViewValidationTest(t)

	node := &ast.Node{
		Type:              ast.NodeAttributeView,
		AttributeViewID:   "20260803090001-missing",
		AttributeViewType: string(av.LayoutTypeGallery),
	}
	node.SetIALAttr(av.NodeAttrView, "missing-view")

	changed := normalizeDatabaseBlockViews(node, "", map[string]*av.AttributeView{})

	if "missing-view" != node.IALAttr(av.NodeAttrView) {
		t.Fatalf("unexpected block view ID: %s", node.IALAttr(av.NodeAttrView))
	}
	if string(av.LayoutTypeGallery) != node.AttributeViewType {
		t.Fatalf("unexpected block layout: %s", node.AttributeViewType)
	}
	if changed {
		t.Fatal("missing attribute view should keep the block unchanged")
	}
}

func TestDatabaseBlockTransactionNormalization(t *testing.T) {
	tests := []struct {
		name            string
		initialDatabase bool
		run             func(*Transaction, *Operation, *parse.Tree) *TxErr
	}{
		{
			name: "insert",
			run: func(tx *Transaction, operation *Operation, tree *parse.Tree) *TxErr {
				operation.NextID = "20260803091002-anchor0"
				return tx.doInsert0(operation, tree)
			},
		},
		{
			name: "appendInsert",
			run: func(tx *Transaction, operation *Operation, tree *parse.Tree) *TxErr {
				operation.ParentID = tree.Root.ID
				return tx.doAppendInsert(operation)
			},
		},
		{
			name: "prependInsert",
			run: func(tx *Transaction, operation *Operation, tree *parse.Tree) *TxErr {
				operation.ParentID = tree.Root.ID
				return tx.doPrependInsert(operation)
			},
		},
		{
			name:            "update",
			initialDatabase: true,
			run: func(tx *Transaction, operation *Operation, tree *parse.Tree) *TxErr {
				operation.ID = "20260803091003-avblock"
				return tx.doUpdate(operation)
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			fixture := setupDatabaseBlockTransactionTest(t, test.initialDatabase)
			operation := &Operation{
				Action: test.name,
				Data: databaseBlockTestDOM(
					"20260803091003-avblock", fixture.attrView.ID, fixture.galleryView.ID, av.LayoutTypeTable),
			}
			tx := &Transaction{
				trees:      map[string]*parse.Tree{},
				nodes:      map[string]*ast.Node{},
				luteEngine: util.NewLute(),
			}

			if txErr := test.run(tx, operation, fixture.tree); nil != txErr {
				t.Fatal(txErr)
			}

			resultTree := fixture.tree
			if loaded := tx.trees[fixture.tree.ID]; nil != loaded {
				resultTree = loaded
			}
			assertNormalizedDatabaseBlock(t, resultTree, operation, fixture)
		})
	}
}

type databaseBlockTransactionTestFixture struct {
	tree        *parse.Tree
	attrView    *av.AttributeView
	tableView   *av.View
	galleryView *av.View
}

func setupDatabaseBlockTransactionTest(t *testing.T, initialDatabase bool) *databaseBlockTransactionTestFixture {
	t.Helper()
	setupAttributeViewValidationTest(t)

	oldBlockTreeDBPath := util.BlockTreeDBPath
	util.BlockTreeDBPath = filepath.Join(util.DataDir, "blocktree.db")
	treenode.InitBlockTree(true)
	var tree *parse.Tree
	t.Cleanup(func() {
		if nil != tree {
			cache.RemoveTreeDataInBox(tree.ID, tree.Box)
			cache.RemoveDocIALInBox(tree.Path, tree.Box)
		}
		treenode.CloseDatabase()
		util.BlockTreeDBPath = oldBlockTreeDBPath
		if "" != oldBlockTreeDBPath {
			treenode.InitBlockTree(false)
		}
	})

	attrView := av.NewAttributeView("20260803091000-avdata0")
	tableView := attrView.Views[0]
	galleryView := &av.View{ID: ast.NewNodeID(), LayoutType: av.LayoutTypeGallery}
	attrView.Views = append(attrView.Views, galleryView)
	if err := av.SaveAttributeView(attrView); nil != err {
		t.Fatalf("save attribute view failed: %s", err)
	}

	tree = treenode.NewTree(
		"20260803091001-box0000", "/20260803091001-doc0000.sy", "/Test", "Test")
	tree.Root.FirstChild.Unlink()
	if initialDatabase {
		data := databaseBlockTestDOM(
			"20260803091003-avblock", attrView.ID, tableView.ID, av.LayoutTypeTable)
		node := util.NewLute().BlockDOM2Tree(data).Root.FirstChild
		tree.Root.AppendChild(node)
	} else {
		anchor := treenode.NewParagraph("")
		anchor.ID = "20260803091002-anchor0"
		anchor.SetIALAttr("id", anchor.ID)
		tree.Root.AppendChild(anchor)
	}
	if _, err := filesys.WriteTree(tree); nil != err {
		t.Fatalf("write test tree failed: %s", err)
	}
	treenode.UpsertBlockTree(tree)

	return &databaseBlockTransactionTestFixture{
		tree: tree, attrView: attrView, tableView: tableView, galleryView: galleryView,
	}
}

func databaseBlockTestDOM(blockID, avID, viewID string, layout av.LayoutType) string {
	return `<div class="av" data-node-id="` + blockID + `" data-av-id="` + avID +
		`" data-type="NodeAttributeView" data-av-type="` + string(layout) +
		`" custom-sy-av-view="` + viewID + `"></div>`
}

func assertNormalizedDatabaseBlock(
	t *testing.T, tree *parse.Tree, operation *Operation, fixture *databaseBlockTransactionTestFixture,
) {
	t.Helper()
	const blockID = "20260803091003-avblock"

	node := treenode.GetNodeInTree(tree, blockID)
	if nil == node {
		t.Fatal("database block was not written to the target tree")
	}
	if fixture.galleryView.ID != node.IALAttr(av.NodeAttrView) ||
		string(av.LayoutTypeGallery) != node.AttributeViewType {
		t.Fatalf("unexpected persisted database block view: %s, %s",
			node.IALAttr(av.NodeAttrView), node.AttributeViewType)
	}

	data, ok := operation.Data.(string)
	if !ok {
		t.Fatalf("unexpected operation data: %#v", operation.Data)
	}
	operationTree := util.NewLute().BlockDOM2Tree(data)
	operationNode := treenode.GetNodeInTree(operationTree, blockID)
	if nil == operationNode {
		t.Fatal("normalized operation data does not contain the database block")
	}
	if fixture.galleryView.ID != operationNode.IALAttr(av.NodeAttrView) ||
		string(av.LayoutTypeGallery) != operationNode.AttributeViewType {
		t.Fatalf("unexpected operation database block view: %s, %s",
			operationNode.IALAttr(av.NodeAttrView), operationNode.AttributeViewType)
	}

}
