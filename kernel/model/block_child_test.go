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
	"slices"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

func TestHeadingChildBlocksSkipSuperBlockCloseMarker(t *testing.T) {
	const (
		rootID       = "20260803160000-root001"
		superBlockID = "20260803160001-super01"
		headingID    = "20260803160002-heading"
		paragraphAID = "20260803160003-para001"
		paragraphBID = "20260803160004-para002"
	)

	root := &ast.Node{Type: ast.NodeDocument, ID: rootID}
	superBlock := &ast.Node{Type: ast.NodeSuperBlock, ID: superBlockID}
	root.AppendChild(superBlock)
	superBlock.AppendChild(&ast.Node{Type: ast.NodeSuperBlockOpenMarker})
	superBlock.AppendChild(&ast.Node{Type: ast.NodeSuperBlockLayoutMarker})
	heading := &ast.Node{Type: ast.NodeHeading, ID: headingID, HeadingLevel: 4}
	superBlock.AppendChild(heading)
	paragraphA := treenode.NewParagraph(paragraphAID)
	paragraphA.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("Paragraph A")})
	superBlock.AppendChild(paragraphA)
	paragraphB := treenode.NewParagraph(paragraphBID)
	paragraphB.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("Paragraph B")})
	superBlock.AppendChild(paragraphB)
	superBlock.AppendChild(&ast.Node{Type: ast.NodeSuperBlockCloseMarker})
	tree := &parse.Tree{Root: root, ID: rootID}

	children := getChildBlocksFromTree(headingID, tree)
	if 2 != len(children) {
		t.Fatalf("expected two child blocks, got [%d]", len(children))
	}
	if paragraphAID != children[0].ID || paragraphBID != children[1].ID {
		t.Fatalf("unexpected child block IDs: [%s, %s]", children[0].ID, children[1].ID)
	}
	if "p" != children[0].Type || "p" != children[1].Type {
		t.Fatalf("unexpected child block types: [%s, %s]", children[0].Type, children[1].Type)
	}

	tail := getTailChildBlocksFromTree(headingID, 1, tree)
	if 1 != len(tail) || paragraphBID != tail[0].ID {
		t.Fatalf("unexpected tail child blocks: [%v]", tail)
	}

	ids := headingChildrenIDs(heading)
	if !slices.Equal(ids, []string{paragraphAID, paragraphBID}) {
		t.Fatalf("unexpected heading child IDs: [%v]", ids)
	}
}

func TestGetOrderedListContinueStartFromTree(t *testing.T) {
	newList := func(id string, numbers ...int) *ast.Node {
		list := &ast.Node{Type: ast.NodeList, ID: id, ListData: &ast.ListData{Typ: 1}}
		for _, number := range numbers {
			list.AppendChild(&ast.Node{Type: ast.NodeListItem, ID: id + "-item", ListData: &ast.ListData{Typ: 1, Num: number}})
		}
		return list
	}

	root := &ast.Node{Type: ast.NodeDocument, ID: "root"}
	previousList := newList("previous", 6, 7)
	root.AppendChild(previousList)
	root.AppendChild(&ast.Node{Type: ast.NodeList, ID: "unordered", ListData: &ast.ListData{Typ: 0}})
	root.AppendChild(&ast.Node{Type: ast.NodeParagraph, ID: "paragraph"})
	currentList := newList("current", 1, 2, 3)
	root.AppendChild(currentList)
	tree := &parse.Tree{Root: root, ID: root.ID}

	start, found := getOrderedListContinueStartFromTree(currentList.ID, tree)
	if !found || 8 != start {
		t.Fatalf("unexpected continue start: [%d, %v]", start, found)
	}

	innerCurrent := newList("inner-current", 1)
	previousList.FirstChild.AppendChild(innerCurrent)
	if _, found = getOrderedListContinueStartFromTree(innerCurrent.ID, tree); found {
		t.Fatal("expected list numbering not to continue across parent boundaries")
	}

	if _, found = getOrderedListContinueStartFromTree(previousList.FirstChild.ID, tree); found {
		t.Fatal("expected a list item to be rejected")
	}

	overflowRoot := &ast.Node{Type: ast.NodeDocument, ID: "overflow-root"}
	overflowRoot.AppendChild(newList("overflow-previous", maxOrderedListNumber))
	overflowCurrent := newList("overflow-current", 1)
	overflowRoot.AppendChild(overflowCurrent)
	overflowTree := &parse.Tree{Root: overflowRoot, ID: overflowRoot.ID}
	if _, found = getOrderedListContinueStartFromTree(overflowCurrent.ID, overflowTree); found {
		t.Fatal("expected overflowing list numbering to be unavailable")
	}
}
