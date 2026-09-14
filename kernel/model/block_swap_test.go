package model

import (
	"fmt"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

func TestSwapBlockRefNodes(t *testing.T) {
	for _, sameTree := range []bool{false, true} {
		for _, includeChildren := range []bool{false, true} {
			for _, embed := range []bool{false, true} {
				for _, kind := range []string{"paragraph", "heading", "list", "refList", "bothLists"} {
					t.Run(fmt.Sprintf("%s/same=%t/children=%t/embed=%t", kind, sameTree, includeChildren, embed), func(t *testing.T) {
						refRoot := &ast.Node{Type: ast.NodeDocument}
						defRoot := &ast.Node{Type: ast.NodeDocument}
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
							list := &ast.Node{Type: ast.NodeList, ListData: &ast.ListData{Typ: 0}}
							li := &ast.Node{Type: ast.NodeListItem, ListData: &ast.ListData{Typ: 0}}
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
					})
				}
			}
		}
	}
}
