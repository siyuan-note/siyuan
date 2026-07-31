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
