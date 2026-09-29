package treenode

import (
	"testing"

	"github.com/88250/lute/ast"
)

func TestHasHeadingChildren(t *testing.T) {
	for _, test := range []struct {
		name string
		next []*ast.Node
		want bool
	}{
		{"end", nil, false},
		{"same level", []*ast.Node{{Type: ast.NodeHeading, HeadingLevel: 2}}, false},
		{"higher level", []*ast.Node{{Type: ast.NodeHeading, HeadingLevel: 1}}, false},
		{"lower level", []*ast.Node{{Type: ast.NodeHeading, HeadingLevel: 3}}, true},
		{"empty paragraph", []*ast.Node{{Type: ast.NodeParagraph}}, true},
		{"IAL only", []*ast.Node{{Type: ast.NodeKramdownBlockIAL}}, false},
		{"IAL and paragraph", []*ast.Node{{Type: ast.NodeKramdownBlockIAL}, {Type: ast.NodeParagraph}}, true},
		{"super block end", []*ast.Node{{Type: ast.NodeSuperBlockCloseMarker}}, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			parent := &ast.Node{Type: ast.NodeBlockquote}
			heading := &ast.Node{Type: ast.NodeHeading, HeadingLevel: 2}
			parent.AppendChild(heading)
			for _, next := range test.next {
				parent.AppendChild(next)
			}
			root := &ast.Node{Type: ast.NodeDocument}
			root.AppendChild(parent)
			root.AppendChild(&ast.Node{Type: ast.NodeParagraph})
			for _, folded := range []bool{false, true} {
				SetSelfFolded(heading, folded)
				if got := HasHeadingChildren(heading); got != test.want {
					t.Fatalf("folded=%v: got %v, want %v", folded, got, test.want)
				}
			}
		})
	}
	if HasHeadingChildren(nil) || HasHeadingChildren(&ast.Node{Type: ast.NodeParagraph}) {
		t.Fatal("only headings have heading children")
	}
}
