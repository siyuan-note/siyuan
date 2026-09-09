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
)

func TestBacklinkReferenceBlockID(t *testing.T) {
	for _, parentType := range []ast.NodeType{ast.NodeDocument, ast.NodeListItem, ast.NodeBlockquote, ast.NodeSuperBlock, ast.NodeCallout} {
		t.Run(parentType.String(), func(t *testing.T) {
			parent := &ast.Node{Type: parentType, ID: "parent"}
			ref := &ast.Node{Type: ast.NodeParagraph, ID: "reference"}
			ref.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "block-ref", TextMarkTextContent: "A"})
			ref.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte(" ")})
			ref.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "block-ref", TextMarkTextContent: "B"})
			parent.AppendChild(ref)
			nodes := []*ast.Node{parent}
			if got := getBacklinkReferenceBlockID(parent, nodes, ref.ID); "" != got {
				t.Fatal("a reference without other content must remain visible")
			}
			empty := &ast.Node{Type: ast.NodeParagraph, ID: "empty"}
			empty.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("  ")})
			parent.AppendChild(empty)
			if got := getBacklinkReferenceBlockID(parent, nodes, ref.ID); "" != got {
				t.Fatal("whitespace must not count as remaining content")
			}
			content := &ast.Node{Type: ast.NodeParagraph, ID: "content"}
			content.AppendChild(&ast.Node{Type: ast.NodeImage})
			parent.AppendChild(content)
			if got := getBacklinkReferenceBlockID(parent, nodes, ref.ID); ref.ID != got {
				t.Fatalf("multiple references with image content: got %q", got)
			}
			if parent.FirstChild != ref || ref.Next != empty || ref.FirstChild.Next.Next == nil {
				t.Fatal("reference detection must preserve the source tree")
			}
			if got := getBacklinkReferenceBlockID(parent, nodes, "missing"); "" != got {
				t.Fatal("only the original reference may be hidden")
			}
			ref.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("body")})
			if got := getBacklinkReferenceBlockID(parent, nodes, ref.ID); "" != got {
				t.Fatal("references with body text must remain visible")
			}
		})
	}
}

func TestBacklinkReferenceHeading(t *testing.T) {
	heading := &ast.Node{Type: ast.NodeHeading, ID: "heading"}
	heading.AppendChild(&ast.Node{Type: ast.NodeHeadingC8hMarker})
	heading.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "block-ref", TextMarkTextContent: "A"})
	paragraph := &ast.Node{Type: ast.NodeParagraph, ID: "paragraph"}
	paragraph.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("content")})
	if got := getBacklinkReferenceBlockID(heading, []*ast.Node{heading}, ""); "" != got {
		t.Fatal("standalone reference headings must remain visible")
	}
	if got := getBacklinkReferenceBlockID(heading, []*ast.Node{heading, paragraph}, ""); heading.ID != got {
		t.Fatal("a pure reference heading with content below it may be hidden")
	}
	ref := &ast.Node{Type: ast.NodeParagraph, ID: "reference"}
	ref.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "block-ref", TextMarkTextContent: "B"})
	if got := getBacklinkReferenceBlockID(heading, []*ast.Node{heading, ref}, ref.ID); "" != got {
		t.Fatal("the parent heading alone must not count as remaining content")
	}
	if got := getBacklinkReferenceBlockID(heading, []*ast.Node{heading, ref, paragraph}, ref.ID); ref.ID != got {
		t.Fatal("the propagated paragraph should be marked instead of its heading")
	}
	if got := getBacklinkReferenceBlockID(ref, []*ast.Node{ref}, ""); "" != got {
		t.Fatal("standalone reference paragraphs must remain visible")
	}
}

func TestPureBacklinkReferenceRejectsOtherInlineContent(t *testing.T) {
	for _, inlineType := range []ast.NodeType{ast.NodeImage, ast.NodeTag, ast.NodeCodeSpan, ast.NodeInlineMath} {
		paragraph := &ast.Node{Type: ast.NodeParagraph}
		paragraph.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "block-ref", TextMarkTextContent: "A"})
		paragraph.AppendChild(&ast.Node{Type: inlineType})
		if isPureBacklinkReferenceNode(paragraph) {
			t.Fatalf("a reference with %s must remain visible", inlineType)
		}
	}
}
