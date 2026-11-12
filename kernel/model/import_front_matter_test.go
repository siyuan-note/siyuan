// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"os"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/render"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestParseStdMdInvalidFrontMatterPreservesMarkdown(t *testing.T) {
	fixture, err := os.ReadFile("testdata/import_invalid_front_matter.md")
	if err != nil {
		t.Fatal(err)
	}
	for _, source := range []string{string(fixture), strings.ReplaceAll(string(fixture), "\n", "\r\n")} {
		tree, id, title, updated := parseStdMd([]byte(source), true)
		if id != "" || title != "" || updated != "" {
			t.Fatalf("Markdown was treated as metadata: %q, %q, %q", id, title, updated)
		}
		var text strings.Builder
		breaks, quotes := 0, 0
		ast.Walk(tree.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
			if !entering {
				return ast.WalkContinue
			}
			switch node.Type {
			case ast.NodeThematicBreak:
				breaks++
			case ast.NodeBlockquote:
				quotes++
			case ast.NodeText, ast.NodeTextMark:
				text.WriteString(node.TokensStr())
				text.WriteString(node.TextMarkTextContent)
			case ast.NodeYamlFrontMatter:
				t.Fatal("invalid YAML remained in the imported tree")
			}
			return ast.WalkContinue
		})
		if breaks != 3 || quotes == 0 || !strings.Contains(text.String(), "Deepseek API搜索关键词") ||
			!strings.Contains(text.String(), "Claude网页版提示词") || !strings.Contains(text.String(), "此处为站点表格") {
			t.Fatalf("lost Markdown content: breaks=%d, quotes=%d, text=%q", breaks, quotes, text.String())
		}
	}
}

func TestParseStdMdValidFrontMatterCompatibility(t *testing.T) {
	tree, id, title, updated := parseStdMd([]byte("---\ntitle: Note\ndate: 2020-01-24\nlastmod: 2023-08-27\ntag: book\n---\n\nBody\n"), false)
	if !strings.HasPrefix(id, "20200124000000-") || title != "Note" || updated != "20230827000000" ||
		tree.Root.IALAttr("custom-tag") != "book" {
		t.Fatalf("front matter metadata changed: %q, %q, %q, %v", id, title, updated, tree.Root.KramdownIAL)
	}
	if tree.Root.FirstChild.Type != ast.NodeCodeBlock ||
		!strings.Contains(tree.Root.FirstChild.ChildByType(ast.NodeCodeBlockCode).TokensStr(), "title: Note") {
		t.Fatal("valid front matter was not preserved as YAML code")
	}
}

func TestImportedFrontMatterExportsAsFencedCode(t *testing.T) {
	const source = "---\ntitle: Home\ntags: [index, personal]\n---\n\n# Home\n\nSome text.\n"
	engine := util.NewLute()
	tree, _, _, _ := parseStdMd([]byte(source), false)
	stored := render.NewJSONRenderer(tree, engine.RenderOptions, engine.ParseOptions).Render()
	tree, err := treenode.ParseJSONWithoutFix(stored, engine.ParseOptions)
	if err != nil {
		t.Fatal(err)
	}
	markdown := string(render.NewProtyleExportMdRenderer(tree, engine.RenderOptions, engine.ParseOptions).Render())
	if strings.Count(markdown, "```") != 2 || !strings.Contains(markdown, "```yaml\n---\ntitle: Home\ntags: [index, personal]\n---\n```") ||
		!strings.Contains(markdown, "# Home\n") || !strings.Contains(markdown, "Some text.") {
		t.Fatalf("front matter or body lost during Markdown export: %q", markdown)
	}
	preview := string(render.NewProtyleExportRenderer(tree, engine.RenderOptions, engine.ParseOptions).Render())
	if !strings.Contains(preview, "title: Home") || !strings.Contains(preview, "tags: [index, personal]") {
		t.Fatalf("front matter lost during HTML export: %s", preview)
	}
}

func TestParseStdMdTagsTypes(t *testing.T) {
	for _, tc := range []struct {
		name, yaml, tags string
	}{
		{"string", "tags: ' book, note '", "book, note"},
		{"list", "tags: [note, 1111]", "note,1111"},
		{"empty", "tags:", ""},
		{"integer", "tags: 2026", ""},
		{"boolean", "tags: true", ""},
		{"mapping", "tags: {name: note}", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			source := "---\ntitle: Note\n" + tc.yaml + "\n---\n\nBody\n"
			tree, _, title, _ := parseStdMd([]byte(source), false)
			if title != "Note" || tree.Root.IALAttr("tags") != tc.tags {
				t.Fatalf("unexpected metadata: title=%q, tags=%q", title, tree.Root.IALAttr("tags"))
			}
			code := tree.Root.FirstChild.ChildByType(ast.NodeCodeBlockCode)
			if code == nil || !strings.Contains(code.TokensStr(), tc.yaml) {
				t.Fatal("original metadata was not preserved")
			}
			if body := tree.Root.ChildByType(ast.NodeParagraph); body == nil || body.Text() != "Body" {
				t.Fatalf("body was not preserved: %v", body)
			}
		})
	}
}

func TestParseStdMdEmptyFrontMatter(t *testing.T) {
	for _, header := range []string{"", "\n", " \n\t\n", "# comment\n# another comment\n"} {
		for _, newline := range []string{"\n", "\r\n"} {
			source := strings.ReplaceAll("---\n"+header+"---\n\nBody\n", "\n", newline)
			tree, id, title, updated := parseStdMd([]byte(source), false)
			if id != "" || title != "" || updated != "" {
				t.Fatalf("unexpected attributes: %q %q %q", id, title, updated)
			}
			bodies := 0
			ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
				if !entering {
					return ast.WalkContinue
				}
				if n.Type == ast.NodeThematicBreak {
					t.Fatalf("empty front matter became separator: %q", source)
				}
				if n.Type == ast.NodeParagraph && n.Text() == "Body" {
					bodies++
				}
				return ast.WalkContinue
			})
			if bodies != 1 {
				t.Fatalf("body count = %d", bodies)
			}
		}
	}
}

func TestParseStdMdNegativeZero(t *testing.T) {
	tree, _, title, _ := parseStdMd([]byte("---\ntitle: -0\nnumber: -0\n---\nBody\n"), false)
	if title != "-0" || tree.Root.IALAttr("custom-number") != "-0" {
		t.Fatalf("negative zero lost its sign: %q %v", title, tree.Root.KramdownIAL)
	}
}
