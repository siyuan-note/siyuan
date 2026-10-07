// Copyright (c) 2020-present, b3log.org
// Licensed under the GNU Affero General Public License v3.0.

package tools

import (
	"strings"
	"testing"
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
