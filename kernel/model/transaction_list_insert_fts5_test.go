// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"slices"
	"strconv"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestListItemInsertionReplaysAllSiblings(t *testing.T) {
	for _, marker := range []string{"* ", "1. ", "* [ ] "} {
		for _, anchor := range []string{"parent", "previous", "next"} {
			t.Run(marker+anchor, func(t *testing.T) {
				fixture := setupStructureTransactionTest(t)
				setupFoldTransactionDatabase(t, fixture)
				lute := util.NewLute()
				tree, err := LoadTreeByBlockID(fixture.sourceID)
				if err != nil {
					t.Fatal(err)
				}
				list := lute.BlockDOM2Tree(lute.Md2BlockDOM(marker+"anchor", false)).Root.FirstChild
				tree.Root.AppendChild(list)
				if _, err = filesys.WriteTree(tree); err != nil {
					t.Fatal(err)
				}
				treenode.UpsertBlockTree(tree)
				fragment := lute.BlockDOM2Tree(lute.Md2BlockDOM(marker+"first\n"+marker+"second", false)).Root.FirstChild
				var dom strings.Builder
				var insertedIDs []string
				var undo []*Operation
				for item := fragment.FirstChild; item != nil; item = item.Next {
					if item.Type != ast.NodeListItem {
						continue
					}
					item.SetIALAttr("custom-regression", item.ID)
					dom.WriteString(lute.RenderNodeBlockDOM(item))
					insertedIDs = append(insertedIDs, item.ID)
					undo = append(undo, &Operation{Action: "delete", ID: item.ID})
				}
				if len(insertedIDs) != 2 {
					t.Fatalf("expected two fixture items, got %v", insertedIDs)
				}
				anchorID := list.FirstChild.ID
				op := &Operation{Action: "insert", ID: insertedIDs[0], ParentID: list.ID, Data: dom.String()}
				expected := append(slices.Clone(insertedIDs), anchorID)
				if anchor == "previous" {
					op.PreviousID = anchorID
					expected = append([]string{anchorID}, insertedIDs...)
				} else if anchor == "next" {
					op.NextID = anchorID
				}
				tx := &Transaction{DoOperations: []*Operation{op}, UndoOperations: undo, fromAPI: true}
				if err = PerformTxSync(tx); err != nil {
					t.Fatal(err)
				}
				check := func(want []string) {
					t.Helper()
					cache.RemoveTreeData(fixture.sourceID)
					current, loadErr := LoadTreeByBlockID(fixture.sourceID)
					if loadErr != nil {
						t.Fatal(loadErr)
					}
					parent := treenode.GetNodeInTree(current, list.ID)
					if parent == nil {
						t.Fatal("list disappeared")
					}
					var got []string
					for item := parent.FirstChild; item != nil; item = item.Next {
						if item.Type == ast.NodeListItem {
							got = append(got, item.ID)
							if slices.Contains(insertedIDs, item.ID) && item.IALAttr("custom-regression") != item.ID {
								t.Fatalf("lost item attributes for %s", item.ID)
							}
						}
					}
					if !slices.Equal(got, want) {
						t.Fatalf("list items: got %v, want %v", got, want)
					}
				}
				check(expected)
				entry := GlobalUndoLog.Peek(fixture.sourceID)
				if entry == nil {
					t.Fatal("insertion was not recorded")
				}
				for range 2 {
					if err = PerformTxSync(&Transaction{DoOperations: entry.UndoOperationsForReplay(), isReplay: true}); err != nil {
						t.Fatal(err)
					}
					check([]string{anchorID})
					if err = PerformTxSync(&Transaction{DoOperations: entry.DoOperationsForReplay(), isReplay: true}); err != nil {
						t.Fatal(err)
					}
					check(expected)
				}
			})
		}
	}
}

func TestListEdgeInsertionFragments(t *testing.T) {
	for _, marker := range []string{"* ", "1. ", "* [ ] "} {
		for _, action := range []string{"appendInsert", "prependInsert"} {
			for _, fragmentKind := range []string{"single", "multiple", "paragraph", "mixed"} {
				t.Run(marker+action+"/"+fragmentKind, func(t *testing.T) {
					fixture := setupStructureTransactionTest(t)
					setupFoldTransactionDatabase(t, fixture)
					lute := util.NewLute()
					tree, err := LoadTreeByBlockID(fixture.sourceID)
					if err != nil {
						t.Fatal(err)
					}
					list := lute.BlockDOM2Tree(lute.Md2BlockDOM(marker+"anchor", false)).Root.FirstChild
					tree.Root.AppendChild(list)
					if _, err = filesys.WriteTree(tree); err != nil {
						t.Fatal(err)
					}
					treenode.UpsertBlockTree(tree)
					markdown := marker + "first"
					switch fragmentKind {
					case "multiple":
						markdown += "\n" + marker + "second"
					case "paragraph":
						markdown = "paragraph"
					case "mixed":
						markdown = "before\n\n" + marker + "first\n" + marker + "second\n\nafter"
					}
					if marker == "* [ ] " {
						markdown = strings.ReplaceAll(markdown, marker+"second", "* [x] second")
					}
					fragment := lute.BlockDOM2Tree(lute.Md2BlockDOM(markdown, false))
					var retainedIDs []string
					ast.Walk(fragment.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
						if entering && n.IsBlock() && n.Type != ast.NodeDocument && n.Type != ast.NodeList && n.Type != ast.NodeKramdownBlockIAL {
							n.SetIALAttr("custom-regression", n.ID)
							retainedIDs = append(retainedIDs, n.ID)
						}
						return ast.WalkContinue
					})
					content := map[string]string{}
					ast.Walk(fragment.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
						if entering && slices.Contains(retainedIDs, n.ID) {
							content[n.ID] = blockSwapFingerprint(n)
						}
						return ast.WalkContinue
					})
					op := &Operation{Action: action, ParentID: list.ID, Data: lute.Tree2BlockDOM(fragment, lute.RenderOptions, lute.ParseOptions)}
					projection, err := newCollectionRemovalProjection([]*Operation{op})
					if err != nil {
						t.Fatal(err)
					}
					defer projection.close()
					if _, err = PerformBlockOperation(op); err != nil {
						t.Fatal(err)
					}
					cache.RemoveTreeData(fixture.sourceID)
					actual, _, err := filesys.LoadTreeSnapshot(tree.Box, tree.Path, lute)
					if err != nil {
						t.Fatal(err)
					}
					check := func(root *ast.Node) []string {
						t.Helper()
						var order []string
						ast.Walk(root, func(n *ast.Node, entering bool) ast.WalkStatus {
							if !entering {
								return ast.WalkContinue
							}
							if n.Type == ast.NodeListItem && n.Parent.Type != ast.NodeList {
								t.Errorf("list item %s has parent %s", n.ID, n.Parent.Type)
							}
							if expected, ok := content[n.ID]; ok && blockSwapFingerprint(n) != expected {
								t.Errorf("changed text, list data, or task state for %s", n.ID)
							}
							if n.Type == ast.NodeListItem && n.ID != list.FirstChild.ID && !slices.Contains(retainedIDs, n.ID) {
								if n.ListData.Typ != list.ListData.Typ {
									t.Errorf("changed wrapper type: %v", n.ListData)
								}
								if n.ListData.Typ == 1 {
									if n.ListData.Delimiter != '.' || string(n.ListData.Marker) != strconv.Itoa(n.ListData.Num)+"." {
										t.Errorf("invalid ordered wrapper marker: %v", n.ListData)
									}
								} else if n.ListData.BulletChar != '*' || string(n.ListData.Marker) != "*" {
									t.Errorf("invalid wrapper bullet: %v", n.ListData)
								}
								if n.ListData.Typ == 3 && (n.FirstChild == nil || n.FirstChild.Type != ast.NodeTaskListItemMarker || n.FirstChild.TaskListItemChecked || n.FirstChild.TaskListItemMarker != ' ') {
									t.Errorf("new task wrapper lacks unchecked task marker: %s", n.ID)
								}
							}
							if slices.Contains(retainedIDs, n.ID) || n.ID == list.FirstChild.ID {
								order = append(order, n.ID)
								if n.ID != list.FirstChild.ID && n.IALAttr("custom-regression") != n.ID {
									t.Errorf("lost attributes for %s", n.ID)
								}
							}
							return ast.WalkContinue
						})
						return order
					}
					want := append(slices.Clone(retainedIDs), list.FirstChild.ID)
					if action == "appendInsert" {
						want = append([]string{list.FirstChild.ID}, retainedIDs...)
					}
					for _, root := range []*ast.Node{actual.Root, projection.after[tree.ID].Root} {
						if got := check(root); !slices.Equal(got, want) {
							t.Fatalf("item order got %v, want %v", got, want)
						}
					}
					if op.Action != "insert" || op.ParentID != list.ID {
						t.Fatalf("invalid returned operation: action=%s id=%s parent=%s, want parent=%s", op.Action, op.ID, op.ParentID, list.ID)
					}
					var undo []*Operation
					parent := treenode.GetNodeInTree(actual, list.ID)
					for item := parent.FirstChild; item != nil; item = item.Next {
						if item.Type == ast.NodeListItem && item.ID != list.FirstChild.ID {
							undo = append(undo, &Operation{Action: "delete", ID: item.ID})
						}
					}
					if op.ID == "" || treenode.GetNodeInTree(actual, op.ID) == nil {
						t.Fatal("returned ID is not persisted")
					}
					for range 2 {
						if err = PerformTxSync(&Transaction{DoOperations: cloneOperations(undo), isReplay: true}); err != nil {
							t.Fatal(err)
						}
						if err = PerformTxSync(&Transaction{DoOperations: cloneOperations([]*Operation{op}), isReplay: true}); err != nil {
							t.Fatal(err)
						}
						cache.RemoveTreeData(fixture.sourceID)
						replayed, _, readErr := filesys.LoadTreeSnapshot(tree.Box, tree.Path, lute)
						if readErr != nil {
							t.Fatal(readErr)
						}
						if got := check(replayed.Root); !slices.Equal(got, want) {
							t.Fatalf("replay order got %v, want %v", got, want)
						}
					}

				})
			}
		}
	}
}

func TestListInsertionFailureRollsBack(t *testing.T) {
	for _, action := range []string{"insert", "appendInsert", "prependInsert"} {
		t.Run(action, func(t *testing.T) {
			fixture := setupStructureTransactionTest(t)
			setupFoldTransactionDatabase(t, fixture)
			lute := util.NewLute()
			tree, err := LoadTreeByBlockID(fixture.sourceID)
			if err != nil {
				t.Fatal(err)
			}
			list := lute.BlockDOM2Tree(lute.Md2BlockDOM("* anchor", false)).Root.FirstChild
			tree.Root.AppendChild(list)
			if _, err = filesys.WriteTree(tree); err != nil {
				t.Fatal(err)
			}
			treenode.UpsertBlockTree(tree)
			before := blockSwapFingerprint(tree.Root)
			ops := []*Operation{
				{Action: action, ParentID: list.ID, Data: lute.Md2BlockDOM("* first\n* second", false)},
				{Action: "insert", ParentID: list.ID, Data: lute.Md2BlockDOM("invalid paragraph", false)},
			}
			if _, err = newCollectionRemovalProjection(ops); err == nil {
				t.Fatal("projection accepted invalid list child")
			}
			if err = PerformTxSync(&Transaction{DoOperations: cloneOperations(ops), fromAPI: true}); err == nil {
				t.Fatal("transaction accepted invalid list child")
			}
			cached, loadErr := LoadTreeByBlockID(fixture.sourceID)
			if loadErr != nil || blockSwapFingerprint(cached.Root) != before {
				t.Fatal("failed insertion changed cached tree", loadErr)
			}
			ast.Walk(lute.BlockDOM2Tree(ops[0].Data.(string)).Root, func(n *ast.Node, entering bool) ast.WalkStatus {
				if entering && n.IsBlock() && n.Type != ast.NodeDocument && n.ID != "" && treenode.GetBlockTree(n.ID) != nil {
					t.Errorf("failed insertion retained block index %s", n.ID)
				}
				return ast.WalkContinue
			})
			cache.RemoveTreeData(fixture.sourceID)
			actual, _, err := filesys.LoadTreeSnapshot(tree.Box, tree.Path, lute)
			if err != nil {
				t.Fatal(err)
			}
			if got := blockSwapFingerprint(actual.Root); got != before {
				t.Fatal("failed insertion changed persisted tree")
			}
		})
	}
}

func TestNativeContainerInsertModes(t *testing.T) {
	for _, types := range [][2]ast.NodeType{{ast.NodeTabs, ast.NodeTabItem}, {ast.NodeMindmap, ast.NodeMindmapItem}} {
		for _, unwrapList := range []bool{false, true} {
			parent := &ast.Node{Type: types[0]}
			root := &ast.Node{Type: ast.NodeDocument}
			fragment := &ast.Node{Type: types[0]}
			root.AppendChild(fragment)
			first, second := &ast.Node{Type: types[1], ID: ast.NewNodeID()}, &ast.Node{Type: types[1], ID: ast.NewNodeID()}
			first.SetIALAttr("custom-test", "first")
			fragment.AppendChild(first)
			fragment.AppendChild(second)
			changed, err := unwrapNativeContainerInsert(root, parent, unwrapList)
			if err != nil || !changed || root.FirstChild != first || first.Next != second || second.Next != nil || first.IALAttr("custom-test") != "first" {
				t.Fatalf("native container %s mode %t: changed %t, err %v", types[0], unwrapList, changed, err)
			}
			root.AppendChild(&ast.Node{Type: ast.NodeParagraph})
			if _, err = unwrapNativeContainerInsert(root, parent, unwrapList); err == nil {
				t.Fatalf("native container %s accepted paragraph", types[0])
			}
		}
	}
}

func TestListEdgeInsertionUndoLog(t *testing.T) {
	for _, action := range []string{"appendInsert", "prependInsert"} {
		for _, marker := range []string{"* ", "1. ", "* [ ] "} {
			for _, markdown := range []string{marker + "first\n" + marker + "second", "paragraph"} {
				if marker == "* [ ] " {
					markdown = strings.ReplaceAll(markdown, marker+"second", "* [x] second")
				}
				t.Run(action+marker+markdown, func(t *testing.T) {
					fixture := setupStructureTransactionTest(t)
					setupFoldTransactionDatabase(t, fixture)
					lute := util.NewLute()
					tree, err := LoadTreeByBlockID(fixture.sourceID)
					if err != nil {
						t.Fatal(err)
					}
					list := lute.BlockDOM2Tree(lute.Md2BlockDOM(marker+"anchor", false)).Root.FirstChild
					tree.Root.AppendChild(list)
					if _, err = filesys.WriteTree(tree); err != nil {
						t.Fatal(err)
					}
					treenode.UpsertBlockTree(tree)
					before := blockSwapFingerprint(tree.Root)
					tx := &Transaction{fromAPI: true,
						DoOperations:   []*Operation{{Action: action, ParentID: list.ID, Data: lute.Md2BlockDOM(markdown, false)}},
						UndoOperations: []*Operation{{Action: "update", ID: list.ID, Data: lute.RenderNodeBlockDOM(list)}},
					}
					if err = PerformTxSync(tx); err != nil {
						t.Fatal(err)
					}
					entry := GlobalUndoLog.Peek(fixture.sourceID)
					if entry == nil {
						t.Fatal("edge insertion was not recorded")
					}
					read := func() string {
						t.Helper()
						cache.RemoveTreeData(fixture.sourceID)
						current, _, readErr := filesys.LoadTreeSnapshot(tree.Box, tree.Path, lute)
						if readErr != nil {
							t.Fatal(readErr)
						}
						return blockSwapFingerprint(current.Root)
					}
					after := read()
					for range 2 {
						if err = PerformTxSync(&Transaction{DoOperations: entry.UndoOperationsForReplay(), isReplay: true}); err != nil {
							t.Fatal(err)
						}
						if read() != before {
							t.Fatal("undo changed original list")
						}
						if err = PerformTxSync(&Transaction{DoOperations: entry.DoOperationsForReplay(), isReplay: true}); err != nil {
							t.Fatal(err)
						}
						if got := read(); got != after {
							t.Fatalf("redo changed inserted list\nbefore: %s\nafter: %s", after, got)
						}
					}
				})
			}
		}
	}
}
