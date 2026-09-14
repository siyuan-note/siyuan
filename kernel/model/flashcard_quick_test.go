package model

import (
	"testing"

	"github.com/88250/lute/ast"
)

func TestEmptyQuickFlashcardParagraph(t *testing.T) {
	for _, test := range []struct {
		name   string
		typeID ast.NodeType
		child  *ast.Node
		empty  bool
	}{
		{"empty paragraph", ast.NodeParagraph, nil, true},
		{"whitespace", ast.NodeParagraph, &ast.Node{Type: ast.NodeText, Tokens: []byte(" \t\n\u00a0\u3000\u200b")}, true},
		{"line break", ast.NodeParagraph, &ast.Node{Type: ast.NodeBr}, true},
		{"formatted whitespace", ast.NodeParagraph, &ast.Node{Type: ast.NodeTextMark, TextMarkType: "strong em", TextMarkTextContent: " "}, true},
		{"text", ast.NodeParagraph, &ast.Node{Type: ast.NodeText, Tokens: []byte("question")}, false},
		{"image", ast.NodeParagraph, &ast.Node{Type: ast.NodeImage}, false},
		{"formula", ast.NodeParagraph, &ast.Node{Type: ast.NodeInlineMath}, false},
		{"formula mark", ast.NodeParagraph, &ast.Node{Type: ast.NodeTextMark, TextMarkType: "inline-math"}, false},
		{"reference", ast.NodeParagraph, &ast.Node{Type: ast.NodeTextMark, TextMarkType: "block-ref", TextMarkBlockRefID: "target"}, false},
		{"link", ast.NodeParagraph, &ast.Node{Type: ast.NodeTextMark, TextMarkType: "a", TextMarkAHref: "https://example.com"}, false},
		{"heading", ast.NodeHeading, nil, false},
		{"list item", ast.NodeListItem, nil, false},
		{"blockquote", ast.NodeBlockquote, nil, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			node := &ast.Node{Type: test.typeID}
			if test.child != nil {
				node.AppendChild(test.child)
			}
			if got := isEmptyQuickFlashcardParagraph(node); got != test.empty {
				t.Fatalf("empty = %v, want %v", got, test.empty)
			}
		})
	}
}
