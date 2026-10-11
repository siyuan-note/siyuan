package model

import (
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
)

func TestImportMarkdownTableStructure(t *testing.T) {
	for _, source := range []string{
		"- [ ] task<br />- [x] done",
		"<ul><li>outer<ul><li>nested</li></ul></li></ul>",
		"<p>first</p><pre><code class=\"language-go\">a &#124; b&#10;c&#10;</code></pre>",
	} {
		t.Run(source, func(t *testing.T) {
			tree, _, _, _ := parseStdMd([]byte("| head |\n| --- |\n| "+source+" |"), true)
			found := false
			ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
				if entering && n.TableCellRich != nil {
					found = true
					if _, err := parse.ParseTableCellRich(n.TableCellRich); err != nil {
						t.Fatal(err)
					}
					if strings.Contains(source, "language-go") && !strings.Contains(n.TableCellRich.Content, "a | b\nc\n") {
						t.Fatalf("code content changed: %s", n.TableCellRich.Content)
					}
				}
				return ast.WalkContinue
			})
			if !found {
				t.Fatal("rich table content was not restored")
			}
		})
	}
}
