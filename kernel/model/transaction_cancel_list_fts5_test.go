//go:build fts5

package model

import (
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

func TestCancelListPreservesDatabaseFields(t *testing.T) {
	for _, subtype := range []int{0, 1, 3} {
		t.Run(string(rune('0'+subtype)), func(t *testing.T) {
			fixture, before, deletion := setupAttributeViewDeletedBlockTest(t, "container")
			tree, err := LoadTreeByBlockID(fixture.sourceID)
			if err != nil {
				t.Fatal(err)
			}
			list := treenode.GetNodeInTree(tree, deletion.DoOperations[0].ID)
			var blocks []*ast.Node
			for child := list.FirstChild; child != nil; child = child.Next {
				blocks = append(blocks, child)
			}
			list.Type = ast.NodeList
			list.ListData = &ast.ListData{Typ: subtype, Start: 1, BulletChar: '*', Delimiter: '.'}
			var items []*ast.Node
			for _, block := range blocks {
				block.Type, block.HeadingLevel = ast.NodeHeading, 2
				block.SetIALAttr(av.NodeAttrViewStaticText+before.ID+"-field", "retained")
				item := &ast.Node{Type: ast.NodeListItem, ID: ast.NewNodeID(), ListData: list.ListData}
				item.SetIALAttr("id", item.ID)
				if subtype == 3 {
					item.AppendChild(&ast.Node{Type: ast.NodeTaskListItemMarker, TaskListItemChecked: true})
				}
				list.AppendChild(item)
				item.AppendChild(block)
				items = append(items, item)
			}
			if _, err = filesys.WriteTree(tree); err != nil {
				t.Fatal(err)
			}
			treenode.UpsertBlockTree(tree)
			sql.IndexTreeQueue(tree)
			sql.FlushQueue()

			tx := &Transaction{fromAPI: true}
			previousID := list.Previous.ID
			anchor := list.ID
			var restore []*Operation
			for i, block := range blocks {
				tx.DoOperations = append(tx.DoOperations, &Operation{Action: "move", ID: block.ID,
					PreviousID: anchor, ParentID: tree.ID})
				restore = append(restore, &Operation{Action: "move", ID: block.ID, ParentID: items[i].ID})
				anchor = block.ID
				block.Unlink()
			}
			// 与前端相同，只插入不含内容块的列表外壳。
			shell := NewLute().RenderNodeBlockDOM(list)
			for i, block := range blocks {
				items[i].AppendChild(block)
			}
			tx.DoOperations = append(tx.DoOperations, &Operation{Action: "delete", ID: list.ID})
			tx.UndoOperations = append([]*Operation{{Action: "insert", ID: list.ID, Data: shell,
				PreviousID: previousID, ParentID: tree.ID}}, restore...)
			if err = PerformTxSync(tx); err != nil {
				t.Fatal(err)
			}
			entry := GlobalUndoLog.Peek(fixture.sourceID)
			if entry == nil {
				t.Fatal("missing undo entry")
			}
			check := func(inList bool) {
				t.Helper()
				assertAttributeViewFieldsTest(t, before, readAttributeViewItemsTest(t, before.ID))
				current, loadErr := LoadTreeByBlockID(fixture.sourceID)
				if loadErr != nil {
					t.Fatal(loadErr)
				}
				for i, block := range blocks {
					node := treenode.GetNodeInTree(current, block.ID)
					if node == nil || node.IALAttr(av.NodeAttrNameAvs) != before.ID ||
						node.IALAttr(av.NodeAttrViewStaticText+before.ID+"-field") != "retained" {
						t.Fatal("content block lost database attributes")
					}
					parentID := current.ID
					if inList {
						parentID = items[i].ID
					}
					if node.Parent.ID != parentID {
						t.Fatalf("unexpected parent: got %s, want %s", node.Parent.ID, parentID)
					}
				}
			}
			for cycle := 0; cycle < 3; cycle++ {
				check(false)
				replayAttributeViewFieldsTest(t, entry.UndoOperationsForReplay())
				check(true)
				replayAttributeViewFieldsTest(t, entry.DoOperationsForReplay())
			}
		})
	}
}
