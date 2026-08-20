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

package model

import (
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

func TestCleanRenderNodesPreservesNestedFold(t *testing.T) {
	h1 := &ast.Node{Type: ast.NodeHeading, HeadingLevel: 1, ID: "h1"}
	h2 := &ast.Node{Type: ast.NodeHeading, HeadingLevel: 2, ID: "h2"}
	child := &ast.Node{Type: ast.NodeParagraph, ID: "child"}
	nextH1 := &ast.Node{Type: ast.NodeHeading, HeadingLevel: 1, ID: "next-h1"}
	treenode.SetSelfFolded(h2, true)

	nodes := cleanRenderNodes([]*ast.Node{h1, h2, child, nextH1}, true)
	if 3 != len(nodes) {
		t.Fatalf("visible render should omit nested folded content, got %d nodes", len(nodes))
	}
	if "h1" != nodes[0].ID || "h2" != nodes[1].ID || "next-h1" != nodes[2].ID {
		t.Fatalf("unexpected visible node order [%s, %s, %s]", nodes[0].ID, nodes[1].ID, nodes[2].ID)
	}
	if !treenode.IsSelfFolded(nodes[1]) {
		t.Fatal("nested heading should keep its own fold state")
	}
}

func TestCleanRenderNodesDoesNotMutateLegacySource(t *testing.T) {
	legacyHeading := &ast.Node{Type: ast.NodeHeading, HeadingLevel: 2, ID: "legacy-heading"}
	legacyHeading.SetIALAttr("fold", "1")
	legacyHeading.SetIALAttr("heading-fold", "1")
	child := &ast.Node{Type: ast.NodeParagraph, ID: "child"}

	nodes := cleanRenderNodes([]*ast.Node{legacyHeading, child}, true)
	if 2 != len(nodes) {
		t.Fatalf("legacy derived fold should not hide content, got %d nodes", len(nodes))
	}
	if "" != nodes[0].IALAttr("fold") || "" != nodes[0].IALAttr("heading-fold") {
		t.Fatal("legacy attributes should be removed from rendered clone")
	}
	if "1" != legacyHeading.IALAttr("fold") || "1" != legacyHeading.IALAttr("heading-fold") {
		t.Fatal("render cleanup should not mutate source tree")
	}
}

func TestCleanRenderNodesKeepsFoldedContainerChildren(t *testing.T) {
	listItem := &ast.Node{Type: ast.NodeListItem, ID: "item", ListData: &ast.ListData{}}
	child := &ast.Node{Type: ast.NodeParagraph, ID: "child"}
	treenode.SetSelfFolded(listItem, true)
	listItem.AppendChild(child)

	nodes := cleanRenderNodes([]*ast.Node{listItem}, true)
	if 1 != len(nodes) || nil == nodes[0].FirstChild || "child" != nodes[0].FirstChild.ID {
		t.Fatal("heading visibility projection should keep folded container children")
	}
	if !treenode.IsSelfFolded(nodes[0]) {
		t.Fatal("folded container should keep its own fold state")
	}
}

func TestCleanRenderDocumentHidesFoldedHeadingChildren(t *testing.T) {
	document := &ast.Node{Type: ast.NodeDocument, ID: "document"}
	heading := &ast.Node{Type: ast.NodeHeading, HeadingLevel: 1, ID: "heading"}
	child := &ast.Node{Type: ast.NodeParagraph, ID: "child"}
	treenode.SetSelfFolded(heading, true)
	document.AppendChild(heading)
	document.AppendChild(child)

	nodes := cleanRenderNodes([]*ast.Node{document}, true)
	if 1 != len(nodes) || nil == nodes[0].FirstChild || "heading" != nodes[0].FirstChild.ID {
		t.Fatal("document render should keep the folded heading")
	}
	if nil != nodes[0].FirstChild.Next {
		t.Fatal("document render should omit folded heading children")
	}
}

func TestPrepareHeadingChildrenDOMNodesDoesNotMutateSource(t *testing.T) {
	heading := &ast.Node{Type: ast.NodeHeading, HeadingLevel: 1, ID: "heading"}
	child := &ast.Node{Type: ast.NodeParagraph, ID: "child"}
	treenode.SetSelfFolded(heading, true)
	treenode.SetSelfFolded(child, true)
	child.SetIALAttr("parent-heading", "original-parent")

	kept := prepareHeadingChildrenDOMNodes(heading, []*ast.Node{child}, false)
	if 2 != len(kept) || "1" != kept[0].IALAttr("fold") || "1" != kept[1].IALAttr("fold") {
		t.Fatal("rendered clones should preserve explicit fold attributes")
	}
	if "heading" != kept[1].IALAttr("parent-heading") {
		t.Fatalf("rendered child has unexpected parent heading: %q", kept[1].IALAttr("parent-heading"))
	}

	removed := prepareHeadingChildrenDOMNodes(heading, []*ast.Node{child}, true)
	if 2 != len(removed) || "" != removed[0].IALAttr("fold") || "" != removed[1].IALAttr("fold") ||
		"" != removed[1].IALAttr("parent-heading") {
		t.Fatal("rendered clones should remove fold and parent-heading attributes")
	}
	if "1" != heading.IALAttr("fold") || "1" != child.IALAttr("fold") ||
		"original-parent" != child.IALAttr("parent-heading") {
		t.Fatal("heading children rendering mutated the source AST")
	}
}
