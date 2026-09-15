package model

import (
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestExportPreviewTabsAsLists(t *testing.T) {
	l := util.NewLute()
	for _, marker := range []string{"", " ", "x", "/"} {
		t.Run("marker="+marker, func(t *testing.T) {
			attrs := ""
			if marker != "" {
				attrs = "{: tabs-task=\"" + marker + "\"}\n"
			}
			source := ":::: tabs\n@tab **First**\n" + attrs + "\nFirst body\n\n::: tabs\n@tab Nested\n\nNested body\n:::\n\n@tab Second\n\nSecond body\n::::\n"
			tree := normalizeExportPreviewTree(parse.Parse("", []byte(source), l.ParseOptions), l)
			html := l.ProtylePreview(tree, l.RenderOptions, l.ParseOptions)
			for _, want := range []string{"<ul", "<li", "data-type=\"strong\">First</span>", "First body", "Nested body", "Second body"} {
				if !strings.Contains(html, want) {
					t.Fatalf("missing %q: %s", want, html)
				}
			}
			nested := 0
			ast.Walk(tree.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
				if entering && node.Type == ast.NodeList && node.ParentIs(ast.NodeListItem) {
					nested++
				}
				return ast.WalkContinue
			})
			if strings.Contains(html, "tab-item") || nested != 1 {
				t.Fatalf("unexpected tab structure: %s", html)
			}
			md := treenode.FormatNode(tree.Root, l)
			if marker != "" && !strings.Contains(strings.ToLower(md), "["+marker+"]") {
				t.Fatalf("missing task state: %s", md)
			}
		})
	}
}
