// Copyright (c) 2020-present, b3log.org
// Licensed under the GNU Affero General Public License v3.0.

package tools

import (
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/editor"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestContentToolsShareMarkdownSyntax(t *testing.T) {
	for _, tc := range []struct {
		tool     *Tool
		property string
	}{
		{BlockTool, "data"}, {DocumentTool, "markdown"}, {DailynoteTool, "data"}, {TemplateTool, "content"},
	} {
		description := tc.tool.InputSchema.Properties[tc.property].Description
		for _, instruction := range []string{
			`((<blockID> "<static anchor text>"))`, `((<blockID> '<dynamic anchor text>'))`,
			"required whenever the anchor text differs", "only when the anchor text is the target block's own content",
			"Never use ((<blockID>)) or [[<blockID>]]", "col is horizontal and row is vertical",
			`data-type="text strong"`, `data-type="text em"`, `data-type="u"`, `data-type="sup"`,
			`data-type="sub"`, `data-type="kbd"`, `data-type="tag"`, "Never fake marks with CSS",
			`Never write a bare <span style="...">`, "wrap other roots", "Do not use an html code fence",
		} {
			if !strings.Contains(description, instruction) {
				t.Fatalf("%s.%s is missing content syntax %q", tc.tool.Name, tc.property, instruction)
			}
		}
	}
}

func TestDocumentedMarkdownExamplesCreateNativeContent(t *testing.T) {
	description := BlockTool.InputSchema.Properties["data"].Description
	for _, tc := range []struct {
		name, prefix, suffix string
		markers              []string
	}{
		{"color", `<span data-type="text" style="color:`, "</span>", []string{`data-type="text"`, "color: #ff0000"}},
		{"bold_color", `<span data-type="text strong"`, "</span>", []string{"strong", "color: #ff0000"}},
		{"keyboard", `<span data-type="kbd"`, "</span>", []string{`data-type="kbd"`, "Ctrl"}},
		{"html", "<div>\n<ruby>", "\n</div>", []string{`data-type="NodeHTMLBlock"`, "&lt;ruby&gt;"}},
		{"static_reference", `((<blockID> "`, "))", []string{`data-type="block-ref"`, `data-subtype="s"`}},
		{"dynamic_reference", "((<blockID> '", "))", []string{`data-type="block-ref"`, `data-subtype="d"`}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			start := strings.Index(description, tc.prefix)
			if start < 0 {
				t.Fatal("missing content example")
			}
			end := strings.Index(description[start:], tc.suffix)
			if end < 0 {
				t.Fatal("incomplete content example")
			}
			markdown := description[start : start+end+len(tc.suffix)]
			markdown = strings.ReplaceAll(markdown, "<blockID>", "20261007000000-ref0001")
			dom, err := markdownToBlockDOM(markdown)
			if err != nil {
				t.Fatal(err)
			}
			for _, marker := range tc.markers {
				if !strings.Contains(dom, marker) {
					t.Fatalf("example lost native content %q: %s", marker, dom)
				}
			}
		})
	}
}

func TestDocumentedSQLQueryEmbedCreatesNativeBlock(t *testing.T) {
	start := strings.Index(sqlEmbedMarkdownSyntax, "{{SELECT *")
	if start < 0 {
		t.Fatal("missing SQL embed example")
	}
	end := strings.Index(sqlEmbedMarkdownSyntax[start:], "}}")
	if end < 0 {
		t.Fatal("missing SQL embed example")
	}
	markdown := sqlEmbedMarkdownSyntax[start : start+end+2]
	for _, data := range []string{markdown, "before\n\n" + markdown + "\n\nafter"} {
		dom, err := prepareBlockWriteData(data, "markdown")
		if err != nil {
			t.Fatal(err)
		}
		tree := util.NewLute().BlockDOM2Tree(dom)
		count := 0
		ast.Walk(tree.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
			if entering && node.Type == ast.NodeBlockQueryEmbed {
				count++
				if script := node.ChildByType(ast.NodeBlockQueryEmbedScript); script == nil ||
					string(script.Tokens) != strings.TrimSuffix(strings.TrimPrefix(markdown, "{{"), "}}") {
					t.Fatalf("embedded SQL changed: %+v", script)
				}
			}
			return ast.WalkContinue
		})
		if count != 1 {
			t.Fatalf("expected one native SQL embed, got %d: %s", count, dom)
		}
	}
	codeDOM, err := prepareBlockWriteData("```sql\n"+markdown+"\n```", "markdown")
	if err != nil || !strings.Contains(codeDOM, `data-type="NodeCodeBlock"`) ||
		strings.Contains(codeDOM, `data-type="NodeBlockQueryEmbed"`) {
		t.Fatalf("code fence must remain a code block: %s, %v", codeDOM, err)
	}
}

func TestSQLQueryEmbedDOMPreservesMultilineSQL(t *testing.T) {
	const query = "-- first comment\nSELECT * FROM blocks WHERE content = 'A&B'"
	const data = `<div data-type="NodeBlockQueryEmbed" data-content="-- first comment&#10;SELECT * FROM blocks WHERE content = 'A&amp;B'"></div>`
	dom, err := prepareBlockWriteData(data, "dom")
	if err != nil {
		t.Fatal(err)
	}
	node := util.NewLute().BlockDOM2Tree(dom).Root.FirstChild
	if node.Type != ast.NodeBlockQueryEmbed {
		t.Fatalf("expected native embed, got %s", node.Type)
	}
	script := node.ChildByType(ast.NodeBlockQueryEmbedScript)
	if script == nil || strings.ReplaceAll(string(script.Tokens), editor.IALValEscNewLine, "\n") != query {
		t.Fatalf("multiline SQL changed: %+v", script)
	}
}
