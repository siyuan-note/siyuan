package av

import (
	"strings"
	"testing"

	"github.com/88250/lute/ast"
)

func TestTableCellRichCodeSettings(t *testing.T) {
	for _, attribute := range []string{"linewrap", "linenumber", "ligatures", "custom-sy-code-tab-spaces"} {
		values := []string{"true", "false"}
		if attribute == "custom-sy-code-tab-spaces" {
			values = []string{"0", "2", "4", "6", "8"}
		}
		for _, value := range values {
			t.Run(attribute+"/"+value, func(t *testing.T) {
				source := "before\n\n```go\na | b\n```\n{: id=\"20260921000000-code001\" " + attribute + "=\"" + value + "\"}\n\nafter"
				rich := &ast.TableCellRich{Spec: 1, Format: "kramdown", Content: source}
				for pass := 0; pass < 3; pass++ {
					tree, err := ParseTableCellRich(rich)
					if err != nil {
						t.Fatal(err)
					}
					codes := tree.Root.ChildrenByType(ast.NodeCodeBlock)
					if len(codes) != 1 || codes[0].IALAttr(attribute) != value || codes[0].ChildByType(ast.NodeCodeBlockCode).TokensStr() != "a | b\n" {
						t.Fatalf("code setting or content changed: %s", rich.Content)
					}
					content, err := RenderTableCellRich(tree)
					if err != nil {
						t.Fatal(err)
					}
					if !strings.Contains(content, "before") || !strings.Contains(content, "after") || pass > 0 && content != rich.Content {
						t.Fatalf("table source is not stable: %q != %q", content, rich.Content)
					}
					rich.Content = content
				}
				if _, err := ParseValueTextRich(&ValueTextRich{Spec: ValueTextRichSpec, Format: ValueTextRichFormatKramdown, Content: source}); err == nil {
					t.Fatal("table code settings must not expand the database rich text whitelist")
				}
			})
		}
	}
}

func TestTableCellRichRejectsInvalidCodeSettings(t *testing.T) {
	sources := []string{
		"```go\ncode\n```\n{: id=\"20260921000000-code001\" linewrap=\"invalid\"}",
		"```go\ncode\n```\n{: id=\"20260921000000-code001\" ligatures=\"TRUE\"}",
		"```go\ncode\n```\n{: id=\"20260921000000-code001\" linenumber=\"1\"}",
		"```go\ncode\n```\n{: id=\"20260921000000-code001\" linewrap=\"true\" custom-other=\"value\"}",
		"paragraph\n{: id=\"20260921000000-code001\" linewrap=\"true\"}",
		"# heading\n{: id=\"20260921000000-code001\" linenumber=\"false\"}",
		"```mermaid\ngraph TD\n```\n{: id=\"20260921000000-code001\" linewrap=\"true\"}",
		"paragraph\n{: id=\"20260921000000-code001\" custom-sy-code-tab-spaces=\"2\"}",
	}
	for _, value := range []string{"", "3", "-2", "10", "02", "2.0", "true"} {
		sources = append(sources, "```go\ncode\n```\n{: id=\"20260921000000-code001\" custom-sy-code-tab-spaces=\""+value+"\"}")
	}
	for _, source := range sources {
		rich := &ast.TableCellRich{Spec: 1, Format: "kramdown", Content: source}
		if _, err := ParseTableCellRich(rich); err == nil {
			t.Fatalf("accepted unsupported code attributes: %s", source)
		}
		if rich.Content != source {
			t.Fatal("rejected source must remain unchanged")
		}
	}
}
