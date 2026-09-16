//go:build fts5

package model

import (
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestTabItemDragUndoRedo(t *testing.T) {
	fixture := setupStructureTransactionTest(t)
	setupFoldTransactionDatabase(t, fixture)
	tree, err := LoadTreeByBlockID(fixture.sourceID)
	if err != nil {
		t.Fatal(err)
	}
	lute := util.NewLute()
	parsed := lute.BlockDOM2Tree(lute.Md2BlockDOM("::: tabs\n@tab Title\n\nBody\n:::\n", false))
	tabs := parsed.Root.FirstChild
	tabs.SetIALAttr("tabs-position", "left")
	item := tabs.FirstChild
	tree.Root.AppendChild(tabs)
	if _, err = filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	treenode.UpsertBlockTree(tree)
	newTabs := &ast.Node{Type: ast.NodeTabs, ID: ast.NewNodeID()}
	newTabs.SetIALAttr("id", newTabs.ID)
	placeholder := &ast.Node{Type: ast.NodeTabItem, ID: ast.NewNodeID()}
	placeholder.SetIALAttr("id", placeholder.ID)
	placeholder.AppendChild(treenode.NewParagraph(""))
	newTabs.AppendChild(placeholder)
	restorePlaceholder := &ast.Node{Type: ast.NodeTabItem, ID: ast.NewNodeID()}
	restorePlaceholder.SetIALAttr("id", restorePlaceholder.ID)
	restorePlaceholder.AppendChild(treenode.NewParagraph(""))
	item.Unlink()
	tabs.AppendChild(restorePlaceholder)
	paragraph := treenode.NewParagraph(tabs.ID)
	forward := []*Operation{
		{Action: "insert", ID: newTabs.ID, ParentID: tree.ID, Data: lute.RenderNodeBlockDOM(newTabs)},
		{Action: "move", ID: item.ID, ParentID: newTabs.ID},
		{Action: "delete", ID: placeholder.ID},
		{Action: "update", ID: tabs.ID, Data: lute.RenderNodeBlockDOM(paragraph)},
	}
	undo := []*Operation{
		{Action: "update", ID: tabs.ID, Data: lute.RenderNodeBlockDOM(tabs)},
		{Action: "move", ID: item.ID, ParentID: tabs.ID},
		{Action: "delete", ID: newTabs.ID},
		{Action: "setAttrs", ID: tabs.ID, Data: `{"tabs-active-id":"` + item.ID + `"}`},
		{Action: "delete", ID: restorePlaceholder.ID},
	}
	for i, operations := range [][]*Operation{forward, undo, forward, undo} {
		if err = PerformTxSync(&Transaction{DoOperations: cloneOperations(operations), isReplay: i > 0}); err != nil {
			t.Fatalf("step %d: %v", i, err)
		}
		current, loadErr := LoadTreeByBlockID(item.ID)
		if loadErr != nil {
			t.Fatal(loadErr)
		}
		moved := treenode.GetNodeInTree(current, item.ID)
		wantParent := newTabs.ID
		if i%2 == 1 {
			wantParent = tabs.ID
			if moved.Parent.IALAttr("tabs-position") != "left" {
				t.Fatal("undo lost the vertical orientation")
			}
		}
		if moved.Parent.ID != wantParent || moved.Parent.IALAttr("tabs-active-id") != item.ID {
			t.Fatalf("step %d: parent=%s active=%s", i, moved.Parent.ID, moved.Parent.IALAttr("tabs-active-id"))
		}
	}
}
