// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package treenode

import (
	"strings"
	"testing"

	"github.com/88250/lute"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
)

func TestFoldHeadingStackHidesChildren(t *testing.T) {
	root := &ast.Node{Type: ast.NodeDocument}
	h4 := &ast.Node{Type: ast.NodeHeading, HeadingLevel: 4, ID: "h4"}
	h4.SetIALAttr("fold", "1")
	child := &ast.Node{Type: ast.NodeParagraph, ID: "p1"}
	h4Next := &ast.Node{Type: ast.NodeHeading, HeadingLevel: 4, ID: "h4b"}
	root.AppendChild(h4)
	root.AppendChild(child)
	root.AppendChild(h4Next)

	var stack FoldHeadingStack
	stack.Enter(h4)
	if stack.Hidden() {
		t.Fatal("folded heading itself should be visible")
	}
	stack.Enter(child)
	if !stack.Hidden() {
		t.Fatal("child under folded heading should be hidden")
	}
	stack.Enter(h4Next)
	if stack.Hidden() {
		t.Fatal("same-level heading after fold should be visible")
	}
}

func TestCollectFoldHiddenNodesKeepsCalloutChildren(t *testing.T) {
	callout := &ast.Node{Type: ast.NodeCallout, ID: "c1"}
	p := &ast.Node{Type: ast.NodeParagraph, ID: "p1"}
	callout.AppendChild(p)

	if hidden := CollectFoldHiddenNodes(callout); 0 != len(hidden) {
		t.Fatalf("callout without nested folded heading should keep children, got %d", len(hidden))
	}
}

func TestDocLoadDoesNotStripCalloutChildren(t *testing.T) {
	// 复现：前一段折叠标题下残留 fold=1 的兄弟块，getDoc AppendChild 改写兄弟链后，
	// 旧逻辑对 callout 子块逐块 IsInFoldedHeading 会误卸子块；新逻辑用栈 + CollectFoldHiddenNodes 应保留。
	root := &ast.Node{Type: ast.NodeDocument, ID: "doc"}
	h4Folded := &ast.Node{Type: ast.NodeHeading, HeadingLevel: 4, ID: "h4-folded"}
	h4Folded.SetIALAttr("id", "h4-folded")
	h4Folded.SetIALAttr("fold", "1")
	h5Folded := &ast.Node{Type: ast.NodeHeading, HeadingLevel: 5, ID: "h5-folded"}
	h5Folded.SetIALAttr("id", "h5-folded")
	h5Folded.SetIALAttr("fold", "1")
	h5Folded.SetIALAttr("heading-fold", "1")
	h4Visible := &ast.Node{Type: ast.NodeHeading, HeadingLevel: 4, ID: "h4-visible"}
	h4Visible.SetIALAttr("id", "h4-visible")
	h5Visible := &ast.Node{Type: ast.NodeHeading, HeadingLevel: 5, ID: "h5-visible"}
	h5Visible.SetIALAttr("id", "h5-visible")
	callout := &ast.Node{Type: ast.NodeCallout, ID: "callout", CalloutType: "NOTE", CalloutTitle: "Note", CalloutIcon: "✏️"}
	callout.SetIALAttr("id", "callout")
	para := &ast.Node{Type: ast.NodeParagraph, ID: "callout-p"}
	para.SetIALAttr("id", "callout-p")
	para.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("keep-me")})
	callout.AppendChild(para)

	root.AppendChild(h4Folded)
	root.AppendChild(h5Folded)
	root.AppendChild(h4Visible)
	root.AppendChild(h5Visible)
	root.AppendChild(callout)

	tree := &parse.Tree{ID: "doc", Root: root}

	// 模拟 loadNodes mode=0 isDoc：用折叠栈收集可见顶层块
	var nodes []*ast.Node
	node := tree.Root.FirstChild
	nodes = append(nodes, node)
	var stack FoldHeadingStack
	stack.Enter(node)
	for n := node.Next; nil != n; n = n.Next {
		stack.Enter(n)
		if stack.Hidden() {
			continue
		}
		nodes = append(nodes, n)
	}

	subTree := &parse.Tree{ID: tree.ID, Root: &ast.Node{Type: ast.NodeDocument}}
	for _, n := range nodes {
		foldHidden := map[*ast.Node]bool{}
		for _, h := range CollectFoldHiddenNodes(n) {
			foldHidden[h] = true
		}
		var unlinks []*ast.Node
		ast.Walk(n, func(cn *ast.Node, entering bool) ast.WalkStatus {
			if !entering || !cn.IsBlock() {
				return ast.WalkContinue
			}
			if foldHidden[cn] {
				unlinks = append(unlinks, cn)
				return ast.WalkSkipChildren
			}
			return ast.WalkContinue
		})
		for _, unlink := range unlinks {
			unlink.Unlink()
		}
		subTree.Root.AppendChild(n)
	}

	engine := lute.New()
	engine.SetProtyleWYSIWYG(true)
	engine.SetKramdownIAL(true)
	engine.SetCallout(true)
	dom := engine.Tree2BlockDOM(subTree, engine.RenderOptions, engine.ParseOptions)
	if !strings.Contains(dom, "keep-me") {
		t.Fatal("callout child text missing after stack-based doc load")
	}
	if !strings.Contains(dom, "callout-p") {
		t.Fatal("callout child block id missing after stack-based doc load")
	}
}
