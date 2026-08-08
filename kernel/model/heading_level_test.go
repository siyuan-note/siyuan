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
	"github.com/88250/lute/parse"
)

func TestHeadingLevelSelectionUsesDirectContainerAndLevel(t *testing.T) {
	root := &ast.Node{Type: ast.NodeDocument}
	h1First := newHeadingLevelTestNode("h1-first", 1)
	h2First := newHeadingLevelTestNode("h2-first", 2)
	h1Second := newHeadingLevelTestNode("h1-second", 1)
	h2Second := newHeadingLevelTestNode("h2-second", 2)
	root.AppendChild(h1First)
	root.AppendChild(h2First)
	root.AppendChild(h1Second)
	root.AppendChild(h2Second)
	tree := &parse.Tree{Root: root}

	selected, valid, missingID := headingLevelSelection(tree, []string{h2First.ID, h2First.ID, h2Second.ID})
	if !valid || "" != missingID {
		t.Fatalf("expected a valid selection, got valid [%v] and missing ID [%s]", valid, missingID)
	}
	assertHeadingLevelNodeIDs(t, selected, h2First.ID, h2Second.ID)

	selected, valid, missingID = headingLevelSelection(tree, []string{h1First.ID, h2First.ID})
	if valid || "" != missingID || nil != selected {
		t.Fatalf("expected mixed heading levels to be rejected")
	}

	selected, valid, missingID = headingLevelSelection(tree, []string{h1First.ID, "missing"})
	if valid || missingID != "missing" || nil != selected {
		t.Fatalf("expected the missing heading ID to be reported")
	}
}

func TestHeadingLevelSelectionRejectsNestedContainer(t *testing.T) {
	root := &ast.Node{Type: ast.NodeDocument}
	rootHeading := newHeadingLevelTestNode("root-heading", 1)
	list := &ast.Node{Type: ast.NodeList}
	item := &ast.Node{Type: ast.NodeListItem}
	nestedHeading := newHeadingLevelTestNode("nested-heading", 1)
	root.AppendChild(rootHeading)
	item.AppendChild(nestedHeading)
	list.AppendChild(item)
	root.AppendChild(list)

	selected, valid, missingID := headingLevelSelection(&parse.Tree{Root: root},
		[]string{rootHeading.ID, nestedHeading.ID})
	if valid || "" != missingID || nil != selected {
		t.Fatalf("expected headings in different direct containers to be rejected")
	}
}

func TestCollectHeadingLevelNodesKeepsDocumentOrder(t *testing.T) {
	root := &ast.Node{Type: ast.NodeDocument}
	h1First := newHeadingLevelTestNode("h1-first", 1)
	h2First := newHeadingLevelTestNode("h2-first", 2)
	paragraph := &ast.Node{Type: ast.NodeParagraph, ID: "paragraph"}
	h1Second := newHeadingLevelTestNode("h1-second", 1)
	h3Second := newHeadingLevelTestNode("h3-second", 3)
	root.AppendChild(h1First)
	root.AppendChild(h2First)
	root.AppendChild(paragraph)
	root.AppendChild(h1Second)
	root.AppendChild(h3Second)

	actual := collectHeadingLevelNodes(root, []*ast.Node{h1Second, h1First})
	assertHeadingLevelNodeIDs(t, actual, h1First.ID, h2First.ID, h1Second.ID, h3Second.ID)
}

func TestBuildHeadingLevelTransactionClampsLevels(t *testing.T) {
	h1 := newHeadingLevelTestNode("h1", 1)
	h2 := newHeadingLevelTestNode("h2", 2)
	h6 := newHeadingLevelTestNode("h6", 6)

	transaction := buildHeadingLevelTransaction([]*ast.Node{h1, h2, h6}, 1)
	if len(transaction.DoOperations) != 3 || len(transaction.UndoOperations) != 3 {
		t.Fatalf("expected three do and undo operations")
	}
	assertHeadingLevelNodeIDs(t, []*ast.Node{h1, h2, h6}, "h1", "h2", "h6")
	if h1.HeadingLevel != 2 || h2.HeadingLevel != 3 || h6.HeadingLevel != 6 {
		t.Fatalf("unexpected transformed levels [%d, %d, %d]", h1.HeadingLevel, h2.HeadingLevel, h6.HeadingLevel)
	}
	for i, id := range []string{"h1", "h2", "h6"} {
		if transaction.DoOperations[i].ID != id || transaction.UndoOperations[i].ID != id {
			t.Fatalf("expected operation for heading [%s] at index %d", id, i)
		}
	}
}

func newHeadingLevelTestNode(id string, level int) *ast.Node {
	heading := &ast.Node{Type: ast.NodeHeading, ID: id, HeadingLevel: level}
	heading.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte(id)})
	return heading
}

func assertHeadingLevelNodeIDs(t *testing.T, nodes []*ast.Node, expected ...string) {
	t.Helper()
	if len(nodes) != len(expected) {
		t.Fatalf("expected %d headings, got %d", len(expected), len(nodes))
	}
	for i, node := range nodes {
		if node.ID != expected[i] {
			t.Fatalf("expected heading [%s] at index %d, got [%s]", expected[i], i, node.ID)
		}
	}
}
