//go:build fts5

package model

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

func TestListConversionFrontendTransactions(t *testing.T) {
	data, err := os.ReadFile("testdata/list_conversion.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct {
		Before, After                string
		TargetIDs                    []string
		DoOperations, UndoOperations []*Operation
	}
	if err = json.Unmarshal(data, &cases); err != nil {
		t.Fatal(err)
	}
	for index, testCase := range cases {
		t.Run(fmt.Sprint(index), func(t *testing.T) {
			fixture, view, _, _ := setupAttributeViewItemsTest(t, false)
			tree, loadErr := LoadTreeByBlockID(fixture.sourceID)
			if loadErr != nil {
				t.Fatal(loadErr)
			}
			lute := NewLute()
			originalIDs := map[string]bool{}
			ast.Walk(tree.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
				if entering && node.ID != "" {
					originalIDs[node.ID] = true
				}
				return ast.WalkContinue
			})
			before := strings.ReplaceAll(testCase.Before, "database", view.ID)
			parsed := lute.BlockDOM2Tree(before)
			for child := parsed.Root.FirstChild; child != nil; {
				next := child.Next
				tree.Root.AppendChild(child)
				child = next
			}
			for i, id := range testCase.TargetIDs {
				value := view.GetBlockKeyValues().Values[i]
				value.IsDetached, value.Block.ID = false, id
				value.Block.RefSubtype = "d"
				value.Block.Content = treenode.GetNodeInTree(tree, id).Text()
			}
			if _, err = filesys.WriteTree(tree); err != nil {
				t.Fatal(err)
			}
			treenode.UpsertBlockTree(tree)
			sql.IndexTreeQueue(tree)
			sql.FlushQueue()
			if err = av.SaveAttributeView(view); err != nil {
				t.Fatal(err)
			}
			for _, operations := range [][]*Operation{testCase.DoOperations, testCase.UndoOperations} {
				for _, operation := range operations {
					if operation.ParentID == "document" {
						operation.ParentID = tree.ID
					}
					if html, ok := operation.Data.(string); ok {
						operation.Data = strings.ReplaceAll(html, "database", view.ID)
					}
				}
			}
			tx := &Transaction{fromAPI: true, DoOperations: testCase.DoOperations, UndoOperations: testCase.UndoOperations}
			if err = PerformTxSync(tx); err != nil {
				t.Fatal(err)
			}
			entry := GlobalUndoLog.Peek(tree.ID)
			if entry == nil {
				t.Fatal("missing undo entry")
			}
			check := func(expectedDOM string) {
				t.Helper()
				current, readErr := LoadTreeByBlockID(tree.ID)
				if readErr != nil {
					t.Fatal(readErr)
				}
				expected := lute.BlockDOM2Tree(strings.ReplaceAll(expectedDOM, "database", view.ID))
				var expectedIDs, actualIDs []string
				ast.Walk(expected.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
					if !entering || node.ID == "" || node.Type == ast.NodeDocument {
						return ast.WalkContinue
					}
					actual := treenode.GetNodeInTree(current, node.ID)
					expectedIDs = append(expectedIDs, node.ID)
					if actual == nil || actual.Type != node.Type || actual.HeadingLevel != node.HeadingLevel {
						t.Fatalf("block %s changed identity or type", node.ID)
					}
					parentID := tree.ID
					if node.Parent != expected.Root {
						parentID = node.Parent.ID
					}
					if actual.Parent.ID != parentID || actual.IALAttr(av.NodeAttrNameAvs) != node.IALAttr(av.NodeAttrNameAvs) {
						t.Fatalf("block %s changed parent or database binding", node.ID)
					}
					if actual.Text() != node.Text() || node.Type == ast.NodeList && actual.ListData.Start != node.ListData.Start {
						t.Fatalf("block %s changed content or list numbering", node.ID)
					}
					return ast.WalkContinue
				})
				ast.Walk(current.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
					if entering && node.ID != "" && !originalIDs[node.ID] {
						actualIDs = append(actualIDs, node.ID)
					}
					return ast.WalkContinue
				})
				if strings.Join(actualIDs, ",") != strings.Join(expectedIDs, ",") {
					t.Fatalf("block order or contents changed: got %v, want %v", actualIDs, expectedIDs)
				}
				assertAttributeViewFieldsTest(t, view, readAttributeViewItemsTest(t, view.ID))
			}
			for cycle := 0; cycle < 2; cycle++ {
				check(testCase.After)
				replayAttributeViewFieldsTest(t, entry.UndoOperationsForReplay())
				check(testCase.Before)
				replayAttributeViewFieldsTest(t, entry.DoOperationsForReplay())
			}
		})
	}
}

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
