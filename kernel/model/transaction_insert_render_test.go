// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"encoding/json"
	"fmt"
	"reflect"
	"slices"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestInsertFragmentRenderingPreservesEmptyTaskItems(t *testing.T) {
	for _, types := range [][2]ast.NodeType{{ast.NodeList, ast.NodeListItem}, {ast.NodeMindmap, ast.NodeMindmapItem}} {
		for _, marker := range []byte{' ', 'x', '!'} {
			for _, fragment := range []string{"tree", "node"} {
				t.Run(fmt.Sprintf("%s/%c/%s", types[0], marker, fragment), func(t *testing.T) {
					tx := &Transaction{luteEngine: util.NewLute()}
					root := &ast.Node{Type: ast.NodeDocument}
					list := &ast.Node{Type: types[0], ID: ast.NewNodeID(), ListData: &ast.ListData{Typ: 3}}
					list.SetIALAttr("id", list.ID)
					root.AppendChild(list)
					var items []*ast.Node
					for range 2 {
						item := newListEdgeItem(3)
						item.Type = types[1]
						item.FirstChild.ReviveFromMarker(marker)
						list.AppendChild(item)
						items = append(items, item)
					}
					blank := treenode.NewParagraph(ast.NewNodeID())
					blank.SetIALAttr("custom-regression", "blank")
					items[1].AppendChild(blank)
					nested := &ast.Node{Type: types[0], ID: ast.NewNodeID(), ListData: &ast.ListData{Typ: 3}}
					nested.SetIALAttr("id", nested.ID)
					items[1].AppendChild(nested)
					for range 2 {
						item := newListEdgeItem(3)
						item.Type = types[1]
						item.FirstChild.ReviveFromMarker(marker)
						nested.AppendChild(item)
						items = append(items, item)
					}
					items[3].AppendChild(&ast.Node{Type: ast.NodeKramdownBlockIAL, Tokens: []byte(`{: custom-regression="existing"}`)})
					type nodeState struct {
						Parent, Previous, Next, First, Last *ast.Node
						ID, Attributes                      string
						Marker                              byte
						Checked                             bool
					}
					state := func() map[*ast.Node]nodeState {
						ret := map[*ast.Node]nodeState{}
						ast.Walk(root, func(node *ast.Node, entering bool) ast.WalkStatus {
							if entering {
								attrs, err := json.Marshal(node.KramdownIAL)
								if err != nil {
									t.Fatal(err)
								}
								ret[node] = nodeState{node.Parent, node.Previous, node.Next, node.FirstChild, node.LastChild,
									node.ID, string(attrs), node.TaskListItemMarker, node.TaskListItemChecked}
							}
							return ast.WalkContinue
						})
						return ret
					}
					before := state()
					wantMarker := marker
					if marker == 'x' {
						wantMarker = 'X'
					}
					for range 2 {
						var dom string
						if fragment == "tree" {
							dom = tx.renderInsertBlockDOM(&parse.Tree{Root: root})
						} else {
							dom = tx.renderInsertNodeBlockDOM(list)
						}
						if !reflect.DeepEqual(before, state()) {
							t.Fatal("rendering changed the source nodes, links, identities, or attributes")
						}
						parsed := tx.luteEngine.BlockDOM2Tree(dom)
						var got []string
						ast.Walk(parsed.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
							if entering && node.ID != "" {
								got = append(got, node.ID)
								if node.IALAttr("id") != node.ID {
									t.Fatal("rendered block identity changed")
								}
								if node.Type == types[1] && (node.FirstChild.Type != ast.NodeTaskListItemMarker ||
									node.FirstChild.TaskListItemMarker != wantMarker || node.FirstChild.TaskListItemChecked != (marker != ' ')) {
									t.Fatal("rendered task marker changed")
								}
							}
							return ast.WalkContinue
						})
						if !slices.Equal(got, []string{list.ID, items[0].ID, items[1].ID, blank.ID, nested.ID, items[2].ID, items[3].ID}) {
							t.Fatalf("rendered fragment changed block identities: %v", got)
						}
						if treenode.GetNodeInTree(parsed, blank.ID).IALAttr("custom-regression") != "blank" {
							t.Fatal("rendered fragment lost the real blank paragraph attributes")
						}
					}
				})
			}
		}
	}
}

func TestInsertFragmentRenderingRestoresTreeOnPanic(t *testing.T) {
	item := newListEdgeItem(3)
	marker := item.FirstChild
	func() {
		defer func() {
			if recover() != "render failed" {
				t.Fatal("expected the renderer failure")
			}
		}()
		renderInsertFragment(item, func() string { panic("render failed") })
	}()
	if item.FirstChild != marker || item.LastChild != marker || marker.Next != nil {
		t.Fatal("failed rendering left temporary nodes in the source")
	}
}
