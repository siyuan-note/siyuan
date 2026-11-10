// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestTaskListWrapperInsertionPreservesMovedBlocks(t *testing.T) {
	for _, action := range []string{"insert", "appendInsert", "prependInsert"} {
		for _, existingBlank := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/blank=%t", action, existingBlank), func(t *testing.T) {
				fixture := setupStructureTransactionTest(t)
				setupFoldTransactionDatabase(t, fixture)
				tree, err := LoadTreeByBlockID(fixture.sourceID)
				if err != nil {
					t.Fatal(err)
				}
				guard := tree.Root.FirstChild
				guard.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("Guard paragraph")})
				target := treenode.NewParagraph(ast.NewNodeID())
				target.SetIALAttr("custom-regression", "retained")
				target.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("Target content")})
				tree.Root.AppendChild(target)
				if _, err = filesys.WriteTree(tree); err != nil {
					t.Fatal(err)
				}
				treenode.UpsertBlockTree(tree)

				listID, itemID, blankID := ast.NewNodeID(), ast.NewNodeID(), ast.NewNodeID()
				blankDOM := ""
				if existingBlank {
					blankDOM = `<div data-type="NodeParagraph" data-node-id="` + blankID + `" custom-regression="blank"><div contenteditable="true"></div><div class="protyle-attr" contenteditable="false"></div></div>`
				}
				dom := `<div data-type="NodeList" data-subtype="t" data-node-id="` + listID + `"><div data-type="NodeListItem" data-subtype="t" data-task=" " data-marker="*" data-node-id="` + itemID + `"><div class="protyle-action protyle-action--task"><svg><use xlink:href="#iconUncheck"></use></svg></div>` + blankDOM + `<div class="protyle-attr" contenteditable="false"></div></div><div class="protyle-attr" contenteditable="false"></div></div>`
				insert := &Operation{Action: action, ID: listID, ParentID: tree.ID, Data: dom}
				if action == "insert" {
					insert.NextID = target.ID
				}
				tx := &Transaction{fromAPI: true, DoOperations: []*Operation{
					insert,
					{Action: "move", ID: target.ID, ParentID: itemID},
				}, UndoOperations: []*Operation{
					{Action: "move", ID: target.ID, ParentID: tree.ID, PreviousID: guard.ID},
					{Action: "delete", ID: listID},
				}}
				if err = PerformTxSync(tx); err != nil {
					t.Fatal(err)
				}
				checkInsertDOM := func(operations []*Operation) {
					t.Helper()
					parsed := util.NewLute().BlockDOM2Tree(operations[0].Data.(string))
					var ids []string
					ast.Walk(parsed.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
						if entering && node.ID != "" {
							ids = append(ids, node.ID)
							if node.IALAttr("id") != node.ID {
								t.Errorf("invalid returned block identity: %s", node.ID)
							}
						}
						return ast.WalkContinue
					})
					want := []string{listID, itemID}
					if existingBlank {
						want = append(want, blankID)
					}
					if !slices.Equal(ids, want) {
						t.Errorf("returned insertion DOM IDs: got %v, want %v", ids, want)
					}
				}
				checkInsertDOM(tx.DoOperations)
				type persistedNode struct {
					ID         string
					Type       string
					Data       string
					Properties map[string]string
					Children   []*persistedNode
				}
				check := func(converted bool) {
					t.Helper()
					data, readErr := os.ReadFile(filepath.Join(util.DataDir, fixture.box.ID, fixture.sourcePath))
					if readErr != nil {
						t.Fatal(readErr)
					}
					var root persistedNode
					if readErr = json.Unmarshal(data, &root); readErr != nil {
						t.Fatal(readErr)
					}
					nodes := map[string]*persistedNode{}
					var visit func(*persistedNode)
					visit = func(node *persistedNode) {
						if node.ID != "" {
							if nodes[node.ID] != nil || node.Properties["id"] != node.ID {
								t.Errorf("invalid persisted identity: %s %s properties=%v", node.Type, node.ID, node.Properties)
							}
							nodes[node.ID] = node
						}
						for _, child := range node.Children {
							visit(child)
						}
					}
					visit(&root)
					childIDs := func(node *persistedNode) (ids []string) {
						if node != nil {
							for _, child := range node.Children {
								if child.ID != "" {
									ids = append(ids, child.ID)
								}
							}
						}
						return
					}
					wantRoot := []string{guard.ID, target.ID}
					if converted {
						wantRoot = []string{guard.ID, listID}
						if action == "prependInsert" {
							wantRoot = []string{listID, guard.ID}
						}
						wantChildren := []string{target.ID}
						if existingBlank {
							wantChildren = append(wantChildren, blankID)
							if nodes[blankID] == nil || nodes[blankID].Properties["custom-regression"] != "blank" {
								t.Fatal("existing blank paragraph lost its identity or attributes")
							}
						}
						if got := childIDs(nodes[itemID]); !slices.Equal(got, wantChildren) {
							t.Fatalf("persisted task children: got %v, want %v", got, wantChildren)
						}
						if got := childIDs(nodes[listID]); !slices.Equal(got, []string{itemID}) {
							t.Fatalf("persisted list children: %v", got)
						}
						if nodes[itemID].Children[0].Type != "NodeTaskListItemMarker" || nodes[itemID].Children[0].ID != "" {
							t.Fatal("task marker changed")
						}
					}
					if got := childIDs(&root); !slices.Equal(got, wantRoot) {
						t.Fatalf("persisted root children: got %v, want %v", got, wantRoot)
					}
					if nodes[target.ID] == nil || nodes[target.ID].Properties["custom-regression"] != "retained" ||
						len(nodes[target.ID].Children) != 1 || nodes[target.ID].Children[0].Data != "Target content" {
						t.Fatal("moved paragraph lost its identity, content, or attributes")
					}
				}
				check(true)
				entry := GlobalUndoLog.Peek(tree.ID)
				if entry == nil {
					t.Fatal("missing undo entry")
				}
				checkInsertDOM(entry.DoOperationsForReplay())
				for range 2 {
					if err = PerformTxSync(&Transaction{DoOperations: entry.UndoOperationsForReplay(), isReplay: true}); err != nil {
						t.Fatal(err)
					}
					check(false)
					if err = PerformTxSync(&Transaction{DoOperations: entry.DoOperationsForReplay(), isReplay: true}); err != nil {
						t.Fatal(err)
					}
					check(true)
				}
			})
		}
	}
}
