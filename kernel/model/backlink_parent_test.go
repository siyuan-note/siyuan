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
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestIsPureBlockRefParagraph(t *testing.T) {
	luteEngine := util.NewLute()
	tests := []struct {
		name     string
		markdown string
		expected bool
	}{
		{"single reference", `((20240101000000-abcdefg "foo"))`, true},
		{"multiple references", `((20240101000000-abcdefg "foo")) ((20240101000001-abcdefg "bar"))`, true},
		{"reference with text", `topic ((20240101000000-abcdefg "foo"))`, false},
		{"reference with image", `((20240101000000-abcdefg "foo")) ![](assets/image.png)`, false},
		{"reference with tag", `((20240101000000-abcdefg "foo")) #tag#`, false},
		{"plain text", "topic", false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			block := &Block{Type: "NodeParagraph", Markdown: test.markdown}
			if actual := isPureBlockRefParagraph(block, luteEngine); actual != test.expected {
				t.Fatalf("isPureBlockRefParagraph(%q) = %v, expected %v", test.markdown, actual, test.expected)
			}
		})
	}
}

func TestIsFirstBacklinkParentParagraphNode(t *testing.T) {
	document := &ast.Node{Type: ast.NodeDocument, ID: "document"}
	firstParagraph := &ast.Node{Type: ast.NodeParagraph, ID: "first"}
	secondParagraph := &ast.Node{Type: ast.NodeParagraph, ID: "second"}
	document.AppendChild(firstParagraph)
	document.AppendChild(secondParagraph)

	documentBlock := &Block{ID: document.ID, Type: "NodeDocument"}
	if !isFirstBacklinkParentParagraphNode(firstParagraph, documentBlock) {
		t.Fatal("the first document paragraph should propagate to the document")
	}
	if isFirstBacklinkParentParagraphNode(secondParagraph, documentBlock) {
		t.Fatal("a non-first document paragraph should not propagate to the document")
	}

	heading := &ast.Node{Type: ast.NodeHeading, ID: "heading", HeadingLevel: 1}
	headingFirstParagraph := &ast.Node{Type: ast.NodeParagraph, ID: "heading-first"}
	headingSecondParagraph := &ast.Node{Type: ast.NodeParagraph, ID: "heading-second"}
	document.AppendChild(heading)
	document.AppendChild(headingFirstParagraph)
	document.AppendChild(headingSecondParagraph)

	headingBlock := &Block{ID: heading.ID, Type: "NodeHeading"}
	if !isFirstBacklinkParentParagraphNode(headingFirstParagraph, headingBlock) {
		t.Fatal("the first paragraph below a heading should propagate to the heading")
	}
	if isFirstBacklinkParentParagraphNode(headingSecondParagraph, headingBlock) {
		t.Fatal("a non-first paragraph below a heading should not propagate to the heading")
	}
}

func TestSelectDocumentAndHeadingBacklinkParentRef(t *testing.T) {
	document := &ast.Node{Type: ast.NodeDocument, ID: "document"}
	documentRefNode := &ast.Node{Type: ast.NodeParagraph, ID: "document-ref"}
	heading := &ast.Node{Type: ast.NodeHeading, ID: "heading", HeadingLevel: 1}
	headingRefNode := &ast.Node{Type: ast.NodeParagraph, ID: "heading-ref"}
	document.AppendChild(documentRefNode)
	document.AppendChild(heading)
	document.AppendChild(headingRefNode)

	treeCache := map[string]*parse.Tree{
		document.ID: {Root: document},
	}
	luteEngine := util.NewLute()
	documentRef := &Block{
		ID:       documentRefNode.ID,
		RootID:   document.ID,
		Type:     "NodeParagraph",
		Markdown: `((20240101000000-abcdefg "foo"))`,
	}
	headingRef := &Block{
		ID:       headingRefNode.ID,
		RootID:   document.ID,
		Type:     "NodeParagraph",
		Markdown: `((20240101000000-abcdefg "foo"))`,
	}
	if selected := selectBacklinkParentRef(
		&Block{ID: document.ID, Type: "NodeDocument"},
		[]*Block{documentRef},
		"",
		luteEngine,
		treeCache,
	); selected != documentRef {
		t.Fatal("the first pure-reference paragraph should propagate to the document")
	}
	if selected := selectBacklinkParentRef(
		&Block{ID: heading.ID, Type: "NodeHeading"},
		[]*Block{headingRef},
		"",
		luteEngine,
		treeCache,
	); selected != headingRef {
		t.Fatal("the first pure-reference paragraph below a heading should propagate to the heading")
	}

	documentRef.Markdown = `topic ((20240101000000-abcdefg "foo"))`
	if selected := selectBacklinkParentRef(
		&Block{ID: document.ID, Type: "NodeDocument"},
		[]*Block{documentRef},
		"",
		luteEngine,
		treeCache,
	); nil != selected {
		t.Fatal("a paragraph containing other text should not propagate to the document")
	}
}

func TestSelectListItemBacklinkParentRefPrefersFirstLeaf(t *testing.T) {
	luteEngine := util.NewLute()
	firstLeaf := &Block{
		ID:       "first-leaf",
		Type:     "NodeParagraph",
		Content:  "topic reference",
		Markdown: `topic ((20240101000000-abcdefg "foo"))`,
	}
	pureRef := &Block{
		ID:       "pure-reference",
		Type:     "NodeParagraph",
		Content:  "reference",
		Markdown: `((20240101000000-abcdefg "foo"))`,
	}
	parent := &Block{ID: "list-item", Type: "NodeListItem", FContent: firstLeaf.Content}

	selected := selectBacklinkParentRef(
		parent,
		[]*Block{pureRef, firstLeaf},
		"",
		luteEngine,
		map[string]*parse.Tree{},
	)
	if selected != firstLeaf {
		t.Fatal("the first leaf reference should be selected regardless of SQL result order")
	}
}

func TestGetBacklinkRenderNodesExpandsPropagatedHeading(t *testing.T) {
	document := &ast.Node{Type: ast.NodeDocument, ID: "document"}
	heading := &ast.Node{Type: ast.NodeHeading, ID: "heading", HeadingLevel: 1}
	heading.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("Heading")})
	paragraph := &ast.Node{Type: ast.NodeParagraph, ID: "paragraph"}
	document.AppendChild(heading)
	document.AppendChild(paragraph)

	nodes, expand := getBacklinkRenderNodes(heading, map[string]string{heading.ID: paragraph.ID})
	if !expand {
		t.Fatal("a heading propagated by its first paragraph should be expanded")
	}
	if 2 != len(nodes) || nodes[0] != heading || nodes[1] != paragraph {
		t.Fatal("the propagated heading should render the heading and its children")
	}
}

func TestRenderBacklinkDocument(t *testing.T) {
	document := &ast.Node{Type: ast.NodeDocument, ID: "document"}
	paragraph := &ast.Node{Type: ast.NodeParagraph, ID: "paragraph"}
	paragraph.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("document content")})
	document.AppendChild(paragraph)

	nodes, _ := getBacklinkRenderNodes(document, nil)
	dom := renderVisibleBlockDOMByNodes(nodes, util.NewLute())
	if !strings.Contains(dom, "document content") {
		t.Fatalf("rendered document backlink does not contain its content: %s", dom)
	}
}

func TestMergeBacklinkRefDefs(t *testing.T) {
	if refDefs := mergeBacklinkRefDefs(nil); nil == refDefs || 0 != len(refDefs) {
		t.Fatal("empty merged ref defs should remain an empty slice")
	}

	refDefs := mergeBacklinkRefDefs([]*RefDefs{
		{RefID: "parent", DefIDs: []string{"definition-a"}},
		{RefID: "parent", DefIDs: []string{"definition-a", "definition-b"}},
		{RefID: "other", DefIDs: []string{"definition-c"}},
	})
	if 2 != len(refDefs) {
		t.Fatalf("merged ref defs length = %d, expected 2", len(refDefs))
	}
	if 2 != len(refDefs[0].DefIDs) {
		t.Fatalf("merged definition IDs length = %d, expected 2", len(refDefs[0].DefIDs))
	}
}
