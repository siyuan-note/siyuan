// SiYuan - From thought to insight, with agents
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

func TestFoldHeadingStackPreservesNestedFold(t *testing.T) {
	root := &ast.Node{Type: ast.NodeDocument}
	h1 := &ast.Node{Type: ast.NodeHeading, HeadingLevel: 1, ID: "h1"}
	h2 := &ast.Node{Type: ast.NodeHeading, HeadingLevel: 2, ID: "h2"}
	child := &ast.Node{Type: ast.NodeParagraph, ID: "p1"}
	nextH1 := &ast.Node{Type: ast.NodeHeading, HeadingLevel: 1, ID: "h1-next"}
	SetSelfFolded(h1, true)
	SetSelfFolded(h2, true)
	root.AppendChild(h1)
	root.AppendChild(h2)
	root.AppendChild(child)
	root.AppendChild(nextH1)

	var foldedParentStack FoldHeadingStack
	foldedParentStack.Enter(h1)
	foldedParentStack.Enter(h2)
	if !foldedParentStack.Hidden() {
		t.Fatal("nested folded heading should be hidden by folded parent")
	}

	SetSelfFolded(h1, false)
	var unfoldedParentStack FoldHeadingStack
	unfoldedParentStack.Enter(h1)
	unfoldedParentStack.Enter(h2)
	if unfoldedParentStack.Hidden() {
		t.Fatal("nested folded heading should become visible after parent unfolds")
	}
	unfoldedParentStack.Enter(child)
	if !unfoldedParentStack.Hidden() {
		t.Fatal("nested folded heading should keep its own children hidden")
	}
	unfoldedParentStack.Enter(nextH1)
	if unfoldedParentStack.Hidden() {
		t.Fatal("same-level heading should end nested fold scope")
	}
}

func TestLegacyHeadingFoldIsNotSelfFold(t *testing.T) {
	legacy := &ast.Node{Type: ast.NodeHeading, HeadingLevel: 2, ID: "legacy"}
	legacy.SetIALAttr("fold", "1")
	legacy.SetIALAttr("heading-fold", "1")
	if IsSelfFolded(legacy) {
		t.Fatal("legacy derived fold should not be treated as self fold")
	}

	SetSelfFolded(legacy, true)
	if !IsSelfFolded(legacy) {
		t.Fatal("explicit fold should become self fold")
	}
	if "" != legacy.IALAttr("heading-fold") {
		t.Fatal("explicit fold should remove legacy heading-fold")
	}

	legacy.SetIALAttr("heading-fold", "1")
	if !ClearLegacyHeadingFold(legacy) {
		t.Fatal("legacy fold should be cleared")
	}
	if "" != legacy.IALAttr("fold") || "" != legacy.IALAttr("heading-fold") {
		t.Fatal("legacy fold attributes should both be removed")
	}
}

func TestHeadingDirectChildrenAndSiblings(t *testing.T) {
	root := &ast.Node{Type: ast.NodeDocument}
	h1 := &ast.Node{Type: ast.NodeHeading, HeadingLevel: 1, ID: "h1"}
	h3a := &ast.Node{Type: ast.NodeHeading, HeadingLevel: 3, ID: "h3-a"}
	h3b := &ast.Node{Type: ast.NodeHeading, HeadingLevel: 3, ID: "h3-b"}
	h2 := &ast.Node{Type: ast.NodeHeading, HeadingLevel: 2, ID: "h2"}
	h3Nested := &ast.Node{Type: ast.NodeHeading, HeadingLevel: 3, ID: "h3-nested"}
	h1Next := &ast.Node{Type: ast.NodeHeading, HeadingLevel: 1, ID: "h1-next"}
	root.AppendChild(h1)
	root.AppendChild(h3a)
	root.AppendChild(h3b)
	root.AppendChild(h2)
	root.AppendChild(h3Nested)
	root.AppendChild(h1Next)

	assertHeadingIDs(t, HeadingDirectChildren(h1), "h3-a", "h3-b", "h2")
	assertHeadingIDs(t, HeadingSiblings(h3a), "h3-a", "h3-b")
	assertHeadingIDs(t, HeadingSiblings(h3Nested), "h3-nested")
	assertHeadingIDs(t, HeadingSiblings(h1), "h1", "h1-next")
}

func TestHeadingSiblingsKeepContainerBoundary(t *testing.T) {
	root := &ast.Node{Type: ast.NodeDocument}
	rootHeading := &ast.Node{Type: ast.NodeHeading, HeadingLevel: 1, ID: "root-heading"}
	superBlock := &ast.Node{Type: ast.NodeSuperBlock, ID: "super-block"}
	containerHeading := &ast.Node{Type: ast.NodeHeading, HeadingLevel: 1, ID: "container-heading"}
	containerHeadingNext := &ast.Node{Type: ast.NodeHeading, HeadingLevel: 1, ID: "container-heading-next"}
	root.AppendChild(rootHeading)
	superBlock.AppendChild(containerHeading)
	superBlock.AppendChild(containerHeadingNext)
	root.AppendChild(superBlock)

	assertHeadingIDs(t, HeadingSiblings(rootHeading), "root-heading")
	assertHeadingIDs(t, HeadingSiblings(containerHeading), "container-heading", "container-heading-next")
}

func TestHeadingChildrenKeepSuperBlockBoundary(t *testing.T) {
	superBlock := &ast.Node{Type: ast.NodeSuperBlock, ID: "super-block"}
	heading := &ast.Node{Type: ast.NodeHeading, HeadingLevel: 1, ID: "heading"}
	paragraph := &ast.Node{Type: ast.NodeParagraph, ID: "paragraph"}
	closeMarker := &ast.Node{Type: ast.NodeSuperBlockCloseMarker}
	superBlock.AppendChild(&ast.Node{Type: ast.NodeSuperBlockOpenMarker})
	superBlock.AppendChild(&ast.Node{Type: ast.NodeSuperBlockLayoutMarker})
	superBlock.AppendChild(heading)
	superBlock.AppendChild(paragraph)
	superBlock.AppendChild(closeMarker)

	children := HeadingChildren(heading)
	if 1 != len(children) || paragraph != children[0] {
		t.Fatalf("heading children should stop before the super block close marker, got %d nodes", len(children))
	}
	if superBlock != closeMarker.Parent {
		t.Fatal("heading child lookup should keep the close marker in the super block")
	}
}

func assertHeadingIDs(t *testing.T, headings []*ast.Node, expected ...string) {
	t.Helper()
	if len(headings) != len(expected) {
		t.Fatalf("expected %d headings, got %d", len(expected), len(headings))
	}
	for i, heading := range headings {
		if heading.ID != expected[i] {
			t.Fatalf("expected heading [%s] at index %d, got [%s]", expected[i], i, heading.ID)
		}
	}
}

func TestCollectFoldHiddenNodesKeepsContainerScope(t *testing.T) {
	root := &ast.Node{Type: ast.NodeDocument}
	list := &ast.Node{Type: ast.NodeList, ID: "list", ListData: &ast.ListData{}}
	item := &ast.Node{Type: ast.NodeListItem, ID: "item", ListData: &ast.ListData{}}
	heading := &ast.Node{Type: ast.NodeHeading, HeadingLevel: 2, ID: "heading"}
	child := &ast.Node{Type: ast.NodeParagraph, ID: "child"}
	outside := &ast.Node{Type: ast.NodeParagraph, ID: "outside"}
	SetSelfFolded(item, true)
	SetSelfFolded(heading, true)
	item.AppendChild(heading)
	item.AppendChild(child)
	list.AppendChild(item)
	root.AppendChild(list)
	root.AppendChild(outside)

	hidden := CollectFoldHiddenNodes(root)
	if 1 != len(hidden) || hidden[0] != child {
		t.Fatalf("heading fold should only hide siblings in the same container, got %d nodes", len(hidden))
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
