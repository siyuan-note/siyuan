package model

import (
	"fmt"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

func TestSwapBlockRefNodes(t *testing.T) {
	for _, sameTree := range []bool{false, true} {
		for _, includeChildren := range []bool{false, true} {
			for _, embed := range []bool{false, true} {
				for _, kind := range []string{"paragraph", "heading", "list", "refList", "bothLists"} {
					t.Run(fmt.Sprintf("%s/same=%t/children=%t/embed=%t", kind, sameTree, includeChildren, embed), func(t *testing.T) {
						refRoot := &ast.Node{Type: ast.NodeDocument, ID: ast.NewNodeID()}
						defRoot := &ast.Node{Type: ast.NodeDocument, ID: ast.NewNodeID()}
						if sameTree {
							defRoot = refRoot
						}
						ref := treenode.NewParagraph("")
						ref.SetIALAttr("custom-test", "preserved")
						def := treenode.NewParagraph("")
						ref.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "block-ref", TextMarkBlockRefID: def.ID, TextMarkBlockRefSubtype: "d"})
						def.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("definition")})
						refRoot.AppendChild(ref)
						defRoot.AppendChild(def)
						wrap := func(n *ast.Node) *ast.Node {
							list := &ast.Node{Type: ast.NodeList, ID: ast.NewNodeID(), ListData: &ast.ListData{Typ: 0}}
							li := &ast.Node{Type: ast.NodeListItem, ID: ast.NewNodeID(), ListData: &ast.ListData{Typ: 0}}
							list.SetIALAttr("id", list.ID)
							li.SetIALAttr("id", li.ID)
							n.InsertBefore(list)
							list.AppendChild(li)
							li.AppendChild(n)
							return li
						}
						if kind == "refList" || kind == "bothLists" {
							wrap(ref)
						}
						var child *ast.Node
						if kind == "heading" {
							def.Type = ast.NodeHeading
							def.HeadingLevel = 1
							child = treenode.NewParagraph("")
							def.InsertAfter(child)
						} else if kind == "list" || kind == "bothLists" {
							li := wrap(def)
							child = &ast.Node{Type: ast.NodeList, ListData: &ast.ListData{Typ: 0}}
							li.AppendChild(child)
						}
						refBefore := treenode.NewParagraph("")
						refTop := ref
						if ref.Parent.Type == ast.NodeListItem {
							refTop = ref.Parent
						}
						refTop.InsertBefore(refBefore)
						defBefore := treenode.NewParagraph("")
						defTop := def
						if def.Parent.Type == ast.NodeListItem {
							defTop = def.Parent
						}
						defTop.InsertBefore(defBefore)
						trees := []*parse.Tree{{ID: refRoot.ID, Root: refRoot}}
						if !sameTree {
							trees = append(trees, &parse.Tree{ID: defRoot.ID, Root: defRoot})
						}
						before := captureBlockSwapFragments(trees)
						swapBlockRefNodes(ref, def, def.ID, includeChildren, embed)
						contains := func(parent, node *ast.Node) bool {
							for n := node; n != nil; n = n.Parent {
								if n == parent {
									return true
								}
							}
							return false
						}
						if !contains(refBefore.Next, def) {
							t.Fatal("definition did not move to reference position")
						}
						var replacement *ast.Node
						ast.Walk(defBefore.Next, func(n *ast.Node, entering bool) ast.WalkStatus {
							if entering && n.ID == ref.ID {
								replacement = n
							}
							return ast.WalkContinue
						})
						if replacement == nil || replacement.IALAttr("custom-test") != "preserved" {
							t.Fatal("original position lost reference ID or attributes")
						}
						if embed {
							if replacement.Type != ast.NodeBlockQueryEmbed || replacement.FirstChild.TokensStr() != "select * from blocks where id='"+def.ID+"'" {
								t.Fatal("invalid embed replacement")
							}
							wantMode := ""
							if kind == "heading" {
								wantMode = "1"
								if includeChildren {
									wantMode = "0"
								}
							}
							if mode := replacement.IALAttr("custom-heading-mode"); mode != wantMode {
								t.Fatalf("heading embed mode = %q, want %q", mode, wantMode)
							}
						} else if replacement != ref {
							t.Fatal("default reference behavior changed")
						}
						if child != nil {
							if kind == "heading" {
								if includeChildren && def.Next != child || !includeChildren && defBefore.Next.Next != child {
									t.Fatal("heading children moved incorrectly")
								}
							} else if includeChildren != contains(def.Parent, child) {
								t.Fatal("list children moved incorrectly")
							}
						}
						after := captureBlockSwapFragments(trees)
						state := newBlockSwapState(before, after)
						treeMap := map[string]*parse.Tree{}
						for _, tree := range trees {
							treeMap[tree.ID] = tree
						}
						for cycle := 0; cycle < 2; cycle++ {
							if err := restoreBlockSwapFragments(state.after, state.before, treeMap); err != nil {
								t.Fatalf("undo: %v", err)
							}
							assertBlockSwapFragments(t, before, captureBlockSwapFragments(trees))
							if err := restoreBlockSwapFragments(state.before, state.after, treeMap); err != nil {
								t.Fatalf("redo: %v", err)
							}
							assertBlockSwapFragments(t, after, captureBlockSwapFragments(trees))
						}
					})
				}
			}
		}
	}
}

func assertBlockSwapFragments(t *testing.T, expected, actual []blockSwapFragment) {
	t.Helper()
	if len(expected) != len(actual) {
		t.Fatalf("fragment count: got %d, want %d", len(actual), len(expected))
	}
	for i, want := range expected {
		got := actual[i]
		if want.rootID != got.rootID || want.node.ID != got.node.ID || want.previousID != got.previousID ||
			blockSwapFingerprint(want.node) != blockSwapFingerprint(got.node) {
			t.Fatalf("fragment %d did not round trip: root %s/%s id %s/%s previous %s/%s\nwant %s\ngot %s", i,
				want.rootID, got.rootID, want.node.ID, got.node.ID, want.previousID, got.previousID,
				blockSwapFingerprint(want.node), blockSwapFingerprint(got.node))
		}
	}
}
