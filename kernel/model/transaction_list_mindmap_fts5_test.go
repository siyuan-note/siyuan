//go:build fts5

package model

import (
	"encoding/json"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

func TestListMindmapDeletionPersistsAndReplays(t *testing.T) {
	fixture := setupStructureTransactionTest(t)
	setupFoldTransactionDatabase(t, fixture)
	listID, itemID := addOrderedListForStructureTest(t, fixture.sourceID)
	tree, err := LoadTreeByBlockID(fixture.sourceID)
	if err != nil {
		t.Fatal(err)
	}
	list := treenode.GetNodeInTree(tree, listID)
	sibling := &ast.Node{Type: ast.NodeListItem, ID: "20260918000000-sibling", ListData: &ast.ListData{Typ: 1}}
	sibling.SetIALAttr("id", sibling.ID)
	sibling.AppendChild(treenode.NewParagraph("20260918000000-content"))
	list.AppendChild(sibling)
	if _, err = filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	treenode.UpsertBlockTree(tree)
	original := `{"version":1,"nodes":{"` + itemID + `":{"bold":true}},"relations":[{"id":"r","from":"` + listID + `","to":"` + itemID + `","label":"test"}]}`
	attrs, _ := json.Marshal(map[string]string{listMindmapMetadataAttr: original})
	if err := PerformTxSync(&Transaction{DoOperations: []*Operation{{Action: "setAttrs", ID: listID, Data: string(attrs)}}}); err != nil {
		t.Fatal(err)
	}
	dom := GetBlockDOM(itemID)
	tx := &Transaction{
		DoOperations:   []*Operation{{Action: "delete", ID: itemID}},
		UndoOperations: []*Operation{{Action: "insert", ID: itemID, ParentID: listID, Data: dom}},
	}
	if err := PerformTxSync(tx); err != nil {
		t.Fatal(err)
	}
	check := func(deleted bool) {
		t.Helper()
		cache.RemoveTreeData(fixture.sourceID)
		tree, err := LoadTreeByBlockID(fixture.sourceID)
		if err != nil {
			t.Fatal(err)
		}
		list := treenode.GetNodeInTree(tree, listID)
		if list == nil {
			t.Fatal("list disappeared")
		}
		value := list.IALAttr(listMindmapMetadataAttr)
		if deleted {
			var metadata map[string]any
			if err = json.Unmarshal([]byte(value), &metadata); err != nil {
				t.Fatal(err)
			}
			if len(metadata["nodes"].(map[string]any)) != 0 || len(metadata["relations"].([]any)) != 0 || treenode.GetNodeInTree(tree, itemID) != nil {
				t.Fatalf("deletion left node or configuration behind: %s", value)
			}
		} else if value != original || treenode.GetNodeInTree(tree, itemID) == nil {
			t.Fatalf("undo did not restore node and configuration: %s", value)
		}
	}
	check(true)
	for i, operations := range [][]*Operation{tx.UndoOperations, tx.DoOperations} {
		replay := &Transaction{DoOperations: operations}
		replay.MarkReplay()
		if err := PerformTxSync(replay); err != nil {
			t.Fatal(err)
		}
		check(i == 1)
	}
	restore := &Transaction{DoOperations: tx.UndoOperations}
	restore.MarkReplay()
	if err := PerformTxSync(restore); err != nil {
		t.Fatal(err)
	}
	if _, err := PerformBlockOperation(&Operation{Action: "delete", ID: itemID}); err != nil {
		t.Fatal(err)
	}
	check(true)
}
