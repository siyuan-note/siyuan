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

package model

import (
	"testing"

	"github.com/88250/lute/ast"
)

func TestUnfoldHeadingForRender(t *testing.T) {
	root := &ast.Node{Type: ast.NodeDocument}
	heading := &ast.Node{Type: ast.NodeHeading, HeadingLevel: 2, ID: "heading"}
	paragraph := &ast.Node{Type: ast.NodeParagraph, ID: "paragraph"}
	list := &ast.Node{Type: ast.NodeList, ID: "list"}
	listItem := &ast.Node{Type: ast.NodeListItem, ID: "list-item"}
	nextHeading := &ast.Node{Type: ast.NodeHeading, HeadingLevel: 2, ID: "next-heading"}
	for _, node := range []*ast.Node{heading, paragraph, list, listItem, nextHeading} {
		node.SetIALAttr("fold", "1")
		node.SetIALAttr("heading-fold", "1")
	}
	list.AppendChild(listItem)
	root.AppendChild(heading)
	root.AppendChild(paragraph)
	root.AppendChild(list)
	root.AppendChild(nextHeading)

	nodes, _ := loadNodesByMode(heading, 0, 0, 100, false, true)
	if 1 != len(nodes) {
		t.Fatalf("folded heading returned %d nodes, want 1", len(nodes))
	}

	unfoldBlockForRender(heading)

	nodes, _ = loadNodesByMode(heading, 0, 0, 100, false, true)
	if 3 != len(nodes) {
		t.Fatalf("unfolded heading returned %d nodes, want 3", len(nodes))
	}
	for _, node := range []*ast.Node{heading, paragraph, list, listItem} {
		if "" != node.IALAttr("fold") || "" != node.IALAttr("heading-fold") {
			t.Fatalf("render node [%s] remains folded", node.ID)
		}
	}
	if "1" != nextHeading.IALAttr("fold") || "1" != nextHeading.IALAttr("heading-fold") {
		t.Fatal("the following heading fold state was changed")
	}
}

func TestUnfoldContainerForRender(t *testing.T) {
	list := &ast.Node{Type: ast.NodeList, ID: "list"}
	listItem := &ast.Node{Type: ast.NodeListItem, ID: "list-item"}
	childList := &ast.Node{Type: ast.NodeList, ID: "child-list"}
	childItem := &ast.Node{Type: ast.NodeListItem, ID: "child-item"}
	siblingItem := &ast.Node{Type: ast.NodeListItem, ID: "sibling-item"}
	for _, node := range []*ast.Node{listItem, childList, childItem, siblingItem} {
		node.SetIALAttr("fold", "1")
		node.SetIALAttr("heading-fold", "1")
	}
	childList.AppendChild(childItem)
	listItem.AppendChild(childList)
	list.AppendChild(listItem)
	list.AppendChild(siblingItem)

	unfoldBlockForRender(listItem)

	for _, node := range []*ast.Node{listItem, childList, childItem} {
		if "" != node.IALAttr("fold") || "" != node.IALAttr("heading-fold") {
			t.Fatalf("render node [%s] remains folded", node.ID)
		}
	}
	if "1" != siblingItem.IALAttr("fold") || "1" != siblingItem.IALAttr("heading-fold") {
		t.Fatal("the sibling list item fold state was changed")
	}
}
