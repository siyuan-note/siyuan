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
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestNormalizeListItemBlockUpdateTree(t *testing.T) {
	root := &ast.Node{Type: ast.NodeDocument}
	list := &ast.Node{Type: ast.NodeList}
	firstItem := &ast.Node{Type: ast.NodeListItem, ID: "first-item"}
	firstItem.AppendChild(&ast.Node{Type: ast.NodeParagraph, ID: "paragraph"})
	secondItem := &ast.Node{Type: ast.NodeListItem, ID: "second-item"}
	list.AppendChild(firstItem)
	list.AppendChild(secondItem)
	root.AppendChild(list)

	oldNode := &ast.Node{Type: ast.NodeListItem, ID: "old-item"}
	normalizedTree, updatedNode, err := normalizeBlockUpdateTree(oldNode, &parse.Tree{Root: root}, util.NewLute())
	if err != nil {
		t.Fatalf("normalize list item update failed: %s", err)
	}
	if ast.NodeListItem != updatedNode.Type || "first-item" != updatedNode.ID {
		t.Fatalf("unexpected normalized node [%s] [%s]", updatedNode.Type.String(), updatedNode.ID)
	}
	if normalizedTree.Root.FirstChild != updatedNode || normalizedTree.Root.LastChild != updatedNode || nil != updatedNode.Next {
		t.Fatal("normalized update tree should contain only the first list item")
	}
}

func TestValidateBlockUpdateType(t *testing.T) {
	oldNode := &ast.Node{Type: ast.NodeCodeBlock, ID: "code"}
	paragraph := &ast.Node{Type: ast.NodeParagraph, ID: "paragraph"}
	if err := validateBlockUpdateType(oldNode, paragraph, false); nil != err {
		t.Fatalf("unlocked type update should be allowed: %s", err)
	}
	if err := validateBlockUpdateType(oldNode, paragraph, true); nil == err {
		t.Fatal("locked type update should be rejected")
	}

	heading := &ast.Node{Type: ast.NodeHeading, ID: "heading"}
	if err := validateBlockUpdateType(heading, &ast.Node{Type: ast.NodeHeading}, true); nil != err {
		t.Fatalf("heading subtype update should be allowed: %s", err)
	}

	emptyParagraph := &ast.Node{Type: ast.NodeParagraph, ID: "empty-paragraph"}
	if err := validateBlockUpdateType(emptyParagraph, oldNode, true); nil != err {
		t.Fatalf("empty paragraph conversion should be allowed: %s", err)
	}

	emptyParagraph.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("\u200b \n")})
	if err := validateBlockUpdateType(emptyParagraph, oldNode, true); nil != err {
		t.Fatalf("paragraph containing only blank text should be convertible: %s", err)
	}
	emptyParagraph.FirstChild.Tokens = []byte("content")
	if err := validateBlockUpdateType(emptyParagraph, oldNode, true); nil == err {
		t.Fatal("non-empty paragraph conversion should be rejected")
	}
}

func TestDataBlockDOMEmptyData(t *testing.T) {
	data, err := DataBlockDOM("", util.NewLute())
	if err != nil {
		t.Fatalf("convert empty markdown failed: %s", err)
	}
	if "" == data {
		t.Fatal("empty markdown should produce a blank paragraph")
	}
}
