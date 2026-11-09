// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// The editor replaces an empty parent item with pasted items and keeps its child
// list below the last pasted item. Reusing the child IDs in separate insert
// operations is invalid while the old parent is still present (#21342).
func TestListPastePreservesNestedBlocksWithContainerUpdate(t *testing.T) {
	childOfType := func(parent *ast.Node, kind ast.NodeType) *ast.Node {
		for n := parent.FirstChild; n != nil; n = n.Next {
			if n.Type == kind {
				return n
			}
		}
		return nil
	}
	for _, marker := range []string{"- ", "1. ", "- [ ] "} {
		for _, populated := range []bool{false, true} {
			for _, merge := range []bool{false, true} {
				t.Run(fmt.Sprintf("%s/populated=%t/merge=%t", marker, populated, merge), func(t *testing.T) {
					fixture := setupStructureTransactionTest(t)
					setupFoldTransactionDatabase(t, fixture)
					engine := util.NewLute()
					tree, err := LoadTreeByBlockID(fixture.sourceID)
					if err != nil {
						t.Fatal(err)
					}
					text := ""
					if populated {
						text = "retained child"
					}
					indent := "  "
					if marker == "1. " {
						indent = "   "
					}
					list := engine.BlockDOM2Tree(engine.Md2BlockDOM(marker+"\n"+indent+marker+text, false)).Root.FirstChild
					oldItem := childOfType(list, ast.NodeListItem)
					sublist := childOfType(oldItem, ast.NodeList)
					if sublist == nil {
						t.Fatal("fixture has no nested list")
					}
					childItem := childOfType(sublist, ast.NodeListItem)
					childParagraph := childOfType(childItem, ast.NodeParagraph)
					if childParagraph == nil {
						t.Fatal("fixture has no nested paragraph")
					}
					childItem.SetIALAttr("custom-regression", "retained-item")
					childParagraph.SetIALAttr("custom-regression", "retained-paragraph")
					childID, paragraphID, sublistID, oldItemID, listID := childItem.ID, childParagraph.ID, sublist.ID, oldItem.ID, list.ID
					reference := &ast.Node{Type: ast.NodeTextMark, TextMarkType: "block-ref", TextMarkBlockRefID: paragraphID, TextMarkBlockRefSubtype: "s", TextMarkTextContent: "reference"}
					tree.Root.FirstChild.AppendChild(reference)
					tree.Root.AppendChild(list)
					if _, err = filesys.WriteTree(tree); err != nil {
						t.Fatal(err)
					}
					treenode.UpsertBlockTree(tree)
					before := engine.RenderNodeBlockDOM(list)
					pastedMD := marker + "first\n" + marker + "second"
					if merge {
						pastedMD += "\n" + indent + marker + "pasted child"
					}
					pasted := engine.BlockDOM2Tree(engine.Md2BlockDOM(pastedMD, false)).Root.FirstChild
					var pastedItems []*ast.Node
					for n := pasted.FirstChild; n != nil; n = n.Next {
						if n.Type == ast.NodeListItem {
							pastedItems = append(pastedItems, n)
						}
					}
					if len(pastedItems) != 2 {
						t.Fatal("fixture must contain two pasted items")
					}
					last := pastedItems[1]
					copied := engine.BlockDOM2Tree(engine.RenderNodeBlockDOM(sublist)).Root.FirstChild
					targetSublist := childOfType(last, ast.NodeList)
					if targetSublist == nil {
						last.AppendChild(copied)
					} else {
						for n := copied.FirstChild; n != nil; {
							next := n.Next
							if n.Type == ast.NodeListItem {
								n.Unlink()
								targetSublist.AppendChild(n)
							}
							n = next
						}
					}
					oldTx := &Transaction{fromAPI: true, DoOperations: []*Operation{
						{Action: "insert", ID: last.ID, PreviousID: oldItemID, Data: engine.RenderNodeBlockDOM(last)},
						{Action: "insert", ID: pastedItems[0].ID, PreviousID: oldItemID, Data: engine.RenderNodeBlockDOM(pastedItems[0])},
						{Action: "delete", ID: oldItemID},
					}}
					if err = PerformTxSync(oldTx); err == nil || !strings.Contains(err.Error(), "block ID already exists") {
						t.Fatalf("old operation sequence should reject existing child IDs: %v", err)
					}

					// Build the same final DOM as the editor, but replace the list atomically.
					replacement := engine.BlockDOM2Tree(before).Root.FirstChild
					for n := replacement.FirstChild; n != nil; {
						next := n.Next
						n.Unlink()
						n = next
					}
					for _, item := range pastedItems {
						item.Unlink()
						replacement.AppendChild(item)
					}
					after := engine.RenderNodeBlockDOM(replacement)
					tx := &Transaction{fromAPI: true, DoOperations: []*Operation{{Action: "update", ID: listID, Data: after}}, UndoOperations: []*Operation{{Action: "update", ID: listID, Data: before}}}
					if err = PerformTxSync(tx); err != nil {
						t.Fatalf("atomic list update: %v", err)
					}
					check := func(updated bool) {
						t.Helper()
						cache.RemoveTreeData(fixture.sourceID)
						current, loadErr := LoadTreeByBlockID(fixture.sourceID)
						if loadErr != nil {
							t.Fatal(loadErr)
						}
						seen := map[string]bool{}
						refs := 0
						ast.Walk(current.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
							if !entering {
								return ast.WalkContinue
							}
							if n.IsBlock() && n.ID != "" {
								if seen[n.ID] {
									t.Errorf("duplicate persisted ID %s", n.ID)
								}
								seen[n.ID] = true
							}
							if n.Type == ast.NodeTextMark && n.TextMarkType == "block-ref" && n.TextMarkBlockRefID == paragraphID {
								refs++
							}
							return ast.WalkContinue
						})
						if refs != 1 {
							t.Errorf("retained child reference count = %d", refs)
						}
						item := treenode.GetNodeInTree(current, childID)
						p := treenode.GetNodeInTree(current, paragraphID)
						if item == nil || p == nil {
							t.Fatal("existing child identity was lost")
						}
						if item.IALAttr("custom-regression") != "retained-item" || p.IALAttr("custom-regression") != "retained-paragraph" {
							t.Fatal("existing custom attributes were lost")
						}
						if populated && !strings.Contains(engine.RenderNodeBlockDOM(p), text) {
							t.Fatal("existing child text was lost")
						}
						currentList := treenode.GetNodeInTree(current, listID)
						if currentList == nil {
							t.Fatal("target list identity was lost")
						}
						var actualItems []string
						for n := currentList.FirstChild; n != nil; n = n.Next {
							if n.Type == ast.NodeListItem {
								actualItems = append(actualItems, n.ID)
							}
						}
						expectedItems := []string{oldItemID}
						if updated {
							expectedItems = []string{pastedItems[0].ID, last.ID}
						}
						if !slices.Equal(actualItems, expectedItems) {
							t.Fatalf("list item order: got %v, want %v", actualItems, expectedItems)
						}
						if !updated {
							if treenode.GetNodeInTree(current, oldItemID) == nil || treenode.GetNodeInTree(current, sublistID) == nil {
								t.Fatal("undo did not restore original containers")
							}
							for _, n := range pastedItems {
								if treenode.GetNodeInTree(current, n.ID) != nil {
									t.Fatal("undo left pasted item behind")
								}
							}
						} else {
							if treenode.GetNodeInTree(current, oldItemID) != nil {
								t.Fatal("empty parent item was not replaced")
							}
							if treenode.GetNodeInTree(current, last.ID) == nil {
								t.Fatal("last pasted item missing")
							}
							if !merge && treenode.GetNodeInTree(current, sublistID) == nil {
								t.Fatal("unmerged child list identity was lost")
							}
							if item.Parent.Parent.ID != last.ID {
								t.Fatal("existing child is not below final pasted item")
							}
						}
					}
					check(true)
					entry := GlobalUndoLog.Peek(fixture.sourceID)
					if entry == nil {
						t.Fatal("list update not recorded for undo")
					}
					for range 2 {
						if err = PerformTxSync(&Transaction{DoOperations: entry.UndoOperationsForReplay(), isReplay: true}); err != nil {
							t.Fatalf("undo: %v", err)
						}
						check(false)
						if err = PerformTxSync(&Transaction{DoOperations: entry.DoOperationsForReplay(), isReplay: true}); err != nil {
							t.Fatalf("redo: %v", err)
						}
						check(true)
					}
				})
			}
		}
	}
}
