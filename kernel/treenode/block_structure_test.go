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
	"testing"

	"github.com/88250/lute/ast"
)

func TestCanContainBlock(t *testing.T) {
	tests := []struct {
		name       string
		parentType ast.NodeType
		childType  ast.NodeType
		expected   bool
	}{
		{"document paragraph", ast.NodeDocument, ast.NodeParagraph, true},
		{"document list item", ast.NodeDocument, ast.NodeListItem, false},
		{"list list item", ast.NodeList, ast.NodeListItem, true},
		{"list paragraph", ast.NodeList, ast.NodeParagraph, false},
		{"list item list", ast.NodeListItem, ast.NodeList, true},
		{"list item list item", ast.NodeListItem, ast.NodeListItem, false},
		{"blockquote list item", ast.NodeBlockquote, ast.NodeListItem, false},
		{"callout list item", ast.NodeCallout, ast.NodeListItem, false},
		{"super block list item", ast.NodeSuperBlock, ast.NodeListItem, true},
		{"paragraph paragraph", ast.NodeParagraph, ast.NodeParagraph, false},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if actual := CanContainBlock(test.parentType, test.childType); test.expected != actual {
				t.Fatalf("expected [%s] containing [%s] to be [%v], got [%v]",
					test.parentType.String(), test.childType.String(), test.expected, actual)
			}
		})
	}
}

func TestValidateBlockSubtree(t *testing.T) {
	list := &ast.Node{Type: ast.NodeList, ID: "list"}
	item := &ast.Node{Type: ast.NodeListItem, ID: "item"}
	paragraph := &ast.Node{Type: ast.NodeParagraph, ID: "paragraph"}
	list.AppendChild(item)
	item.AppendChild(paragraph)
	if err := ValidateBlockSubtree(list); nil != err {
		t.Fatalf("expected valid list structure, got [%s]", err)
	}

	invalidList := &ast.Node{Type: ast.NodeList, ID: "invalid-list"}
	invalidList.AppendChild(&ast.Node{Type: ast.NodeParagraph, ID: "invalid-paragraph"})
	if err := ValidateBlockSubtree(invalidList); nil == err {
		t.Fatal("expected paragraph directly under list to be rejected")
	}
}

func TestValidateBlockPlacement(t *testing.T) {
	document := &ast.Node{Type: ast.NodeDocument, ID: "document"}
	list := &ast.Node{Type: ast.NodeList, ID: "list"}
	item := &ast.Node{Type: ast.NodeListItem, ID: "item"}
	paragraph := &ast.Node{Type: ast.NodeParagraph, ID: "paragraph"}
	document.AppendChild(list)
	list.AppendChild(item)
	item.AppendChild(paragraph)

	if err := ValidateBlockPlacement(item); nil != err {
		t.Fatalf("expected list item placement to be valid, got [%s]", err)
	}
	if err := ValidateBlockPlacement(paragraph); nil != err {
		t.Fatalf("expected paragraph placement to be valid, got [%s]", err)
	}

	invalidParagraph := &ast.Node{Type: ast.NodeParagraph, ID: "invalid-paragraph"}
	list.AppendChild(invalidParagraph)
	if err := ValidateBlockPlacement(invalidParagraph); nil == err {
		t.Fatal("expected paragraph directly under list to be rejected")
	}

	invalidItem := &ast.Node{Type: ast.NodeListItem, ID: "invalid-item"}
	invalidItem.AppendChild(&ast.Node{Type: ast.NodeListItem, ID: "nested-item"})
	list.AppendChild(invalidItem)
	if err := ValidateBlockPlacement(invalidItem); nil == err {
		t.Fatal("expected invalid list item subtree to be rejected")
	}
}

func TestValidateBlockReplacement(t *testing.T) {
	list := &ast.Node{Type: ast.NodeList, ID: "list"}
	oldItem := &ast.Node{Type: ast.NodeListItem, ID: "item"}
	list.AppendChild(oldItem)

	newItem := &ast.Node{Type: ast.NodeListItem, ID: "new-item"}
	newItem.AppendChild(&ast.Node{Type: ast.NodeParagraph, ID: "paragraph"})
	if err := ValidateBlockReplacement(oldItem, newItem); nil != err {
		t.Fatalf("expected list item replacement to be valid, got [%s]", err)
	}

	if err := ValidateBlockReplacement(oldItem, &ast.Node{Type: ast.NodeParagraph, ID: "paragraph"}); nil == err {
		t.Fatal("expected paragraph replacing a list item to be rejected")
	}
}

func TestFixInvalidListChildren(t *testing.T) {
	document := &ast.Node{Type: ast.NodeDocument, ID: "document"}
	list := &ast.Node{Type: ast.NodeList, ID: "list", ListData: &ast.ListData{Typ: 1, Start: 4}}
	firstItem := &ast.Node{Type: ast.NodeListItem, ID: "first-item", ListData: &ast.ListData{
		Typ: 1, Delimiter: '.', Marker: []byte("4."), Num: 4,
	}}
	paragraph := &ast.Node{Type: ast.NodeParagraph, ID: "paragraph"}
	heading := &ast.Node{Type: ast.NodeHeading, ID: "heading"}
	lastItem := &ast.Node{Type: ast.NodeListItem, ID: "last-item", ListData: &ast.ListData{
		Typ: 1, Delimiter: '.', Marker: []byte("5."), Num: 5,
	}}
	document.AppendChild(list)
	list.AppendChild(firstItem)
	list.AppendChild(paragraph)
	list.AppendChild(heading)
	list.AppendChild(lastItem)

	if !FixInvalidListChildren(document) {
		t.Fatal("expected invalid list children to be fixed")
	}
	paragraphItem := firstItem.Next
	if nil == paragraphItem || ast.NodeListItem != paragraphItem.Type {
		t.Fatal("expected paragraph to be wrapped by a list item")
	}
	headingItem := paragraphItem.Next
	if nil == headingItem || ast.NodeListItem != headingItem.Type {
		t.Fatal("expected heading to be wrapped by a list item")
	}
	if paragraph != paragraphItem.FirstChild || heading != headingItem.FirstChild || lastItem != headingItem.Next {
		t.Fatal("expected content and sibling order to be preserved")
	}
	if nil == paragraphItem.ListData || list.ListData.Typ != paragraphItem.ListData.Typ {
		t.Fatal("expected wrapped item to inherit the list type")
	}
	if 5 != paragraphItem.ListData.Num || 6 != headingItem.ListData.Num || 7 != lastItem.ListData.Num {
		t.Fatal("expected ordered list numbers to include the wrapped items")
	}
	if "5." != string(paragraphItem.ListData.Marker) || "6." != string(headingItem.ListData.Marker) ||
		"7." != string(lastItem.ListData.Marker) {
		t.Fatal("expected ordered list markers to include the wrapped items")
	}
	if "" == paragraphItem.ID || paragraphItem.ID != paragraphItem.IALAttr("id") {
		t.Fatal("expected wrapped item to have a persisted block ID")
	}
	if err := ValidateBlockSubtree(list); nil != err {
		t.Fatalf("expected repaired list structure to be valid, got [%s]", err)
	}
	if FixInvalidListChildren(document) {
		t.Fatal("expected a second repair pass to be idempotent")
	}
}

func TestFixInvalidTaskListChild(t *testing.T) {
	list := &ast.Node{Type: ast.NodeList, ID: "list", ListData: &ast.ListData{Typ: 3}}
	marker := &ast.Node{Type: ast.NodeTaskListItemMarker, TaskListItemChecked: true}
	heading := &ast.Node{Type: ast.NodeHeading, ID: "heading"}
	list.AppendChild(marker)
	list.AppendChild(heading)

	if !FixInvalidListChildren(list) {
		t.Fatal("expected invalid task list child to be fixed")
	}
	item := list.FirstChild
	if nil == item || nil == item.ListData || 3 != item.ListData.Typ {
		t.Fatal("expected a task list item wrapper")
	}
	if marker != item.FirstChild || heading != item.LastChild || !marker.TaskListItemChecked {
		t.Fatal("expected the existing task marker before the content block")
	}
	if '*' != item.ListData.BulletChar || "*" != string(item.ListData.Marker) {
		t.Fatal("expected the task item to have a list marker")
	}
}

func TestFixInvalidOrderedListStartingAtZero(t *testing.T) {
	list := &ast.Node{Type: ast.NodeList, ID: "list", ListData: &ast.ListData{Typ: 1}}
	firstItem := &ast.Node{Type: ast.NodeListItem, ID: "first-item", ListData: &ast.ListData{
		Typ: 1, Delimiter: '.', Marker: []byte("0."), Num: 0,
	}}
	paragraph := &ast.Node{Type: ast.NodeParagraph, ID: "paragraph"}
	lastItem := &ast.Node{Type: ast.NodeListItem, ID: "last-item", ListData: &ast.ListData{
		Typ: 1, Delimiter: '.', Marker: []byte("1."), Num: 1,
	}}
	list.AppendChild(firstItem)
	list.AppendChild(paragraph)
	list.AppendChild(lastItem)

	if !FixInvalidListChildren(list) {
		t.Fatal("expected invalid ordered list child to be fixed")
	}
	wrappedItem := firstItem.Next
	if 0 != firstItem.ListData.Num || 1 != wrappedItem.ListData.Num || 2 != lastItem.ListData.Num {
		t.Fatal("expected ordered list numbering to preserve a zero start")
	}
	if "0." != string(firstItem.ListData.Marker) || "1." != string(wrappedItem.ListData.Marker) ||
		"2." != string(lastItem.ListData.Marker) {
		t.Fatal("expected ordered list markers to preserve a zero start")
	}
}
