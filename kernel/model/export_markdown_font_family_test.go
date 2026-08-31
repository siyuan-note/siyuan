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
	"github.com/88250/lute/render"
)

func TestPrepareMarkdownFontFamilyTextMarks(t *testing.T) {
	style := `font-family: "A&B"; color: red;`
	strong := &ast.Node{
		Type:                ast.NodeTextMark,
		TextMarkType:        "text strong",
		TextMarkTextContent: "bold",
	}
	strong.SetIALAttr("style", style)
	strong.SetIALAttr("custom", "kept")
	tree := markdownTextMarkTestTree(strong)
	prepareMarkdownFontFamilyTextMarks(tree.Root)

	if "strong" != strong.TextMarkType {
		t.Fatalf("unexpected remaining text mark types: %q", strong.TextMarkType)
	}
	if "" != strong.IALAttr("style") {
		t.Fatalf("style should be moved to the raw HTML wrapper: %q", strong.IALAttr("style"))
	}
	if "kept" != strong.IALAttr("custom") {
		t.Fatalf("unrelated IAL attribute should be preserved: %q", strong.IALAttr("custom"))
	}
	expectedOpen := `<span data-type="text" style="font-family: &quot;A&amp;B&quot;; color: red;">`
	if nil == strong.Previous || ast.NodeInlineHTML != strong.Previous.Type ||
		expectedOpen != string(strong.Previous.Tokens) {
		t.Fatalf("unexpected opening raw HTML: %q", string(strong.Previous.Tokens))
	}
	if nil == strong.Next || ast.NodeInlineHTML != strong.Next.Type || "</span>" != string(strong.Next.Tokens) {
		t.Fatalf("unexpected closing raw HTML: %q", string(strong.Next.Tokens))
	}

	markdown := renderMarkdownTextMarkTestTree(tree)
	expectedMarkdown := expectedOpen + "**bold**</span>"
	if expectedMarkdown != markdown {
		t.Fatalf("unexpected Markdown export:\nexpected: %q\nactual:   %q", expectedMarkdown, markdown)
	}
}

func TestPrepareMarkdownFontFamilyTextMarkPreservesLink(t *testing.T) {
	link := &ast.Node{
		Type:                ast.NodeTextMark,
		TextMarkType:        "text a strong",
		TextMarkTextContent: "link",
		TextMarkAHref:       "https://example.com",
	}
	link.SetIALAttr("style", "FONT-FAMILY: serif")
	tree := markdownTextMarkTestTree(link)
	prepareMarkdownFontFamilyTextMarks(tree.Root)

	markdown := renderMarkdownTextMarkTestTree(tree)
	expected := `<span data-type="text" style="FONT-FAMILY: serif">**[link](https://example.com)**</span>`
	if expected != markdown {
		t.Fatalf("unexpected Markdown link export:\nexpected: %q\nactual:   %q", expected, markdown)
	}
}

func TestPrepareMarkdownFontFamilyPlainTextMarkEscapesStyle(t *testing.T) {
	textMark := &ast.Node{
		Type:                ast.NodeTextMark,
		TextMarkType:        "text",
		TextMarkTextContent: "plain",
	}
	textMark.SetIALAttr("style", `font-family: "A|B", serif`)
	tree := markdownTextMarkTestTree(textMark)
	prepareMarkdownFontFamilyTextMarks(tree.Root)

	markdown := renderMarkdownTextMarkTestTree(tree)
	expected := `<span data-type="text" style="font-family: &quot;A&#124;B&quot;, serif"><span data-type="text">plain</span></span>`
	if expected != markdown {
		t.Fatalf("unexpected plain text Markdown export:\nexpected: %q\nactual:   %q", expected, markdown)
	}
}

func TestPrepareMarkdownFontFamilyTextMarksLeavesUnsupportedMarksAlone(t *testing.T) {
	tests := []struct {
		name  string
		types string
		style string
	}{
		{name: "no font family", types: "text strong", style: "color: red"},
		{name: "no text", types: "strong", style: "font-family: serif"},
		{name: "protected code", types: "text code", style: "font-family: serif"},
		{name: "protected keyboard", types: "text kbd", style: "font-family: serif"},
		{name: "protected math", types: "text inline-math", style: "font-family: serif"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			textMark := &ast.Node{
				Type:                ast.NodeTextMark,
				TextMarkType:        test.types,
				TextMarkTextContent: "content",
			}
			textMark.SetIALAttr("style", test.style)
			tree := markdownTextMarkTestTree(textMark)
			prepareMarkdownFontFamilyTextMarks(tree.Root)
			if test.types != textMark.TextMarkType || test.style != textMark.IALAttr("style") {
				t.Fatalf("text mark was unexpectedly changed: types=%q style=%q", textMark.TextMarkType, textMark.IALAttr("style"))
			}
			if nil != textMark.Previous || nil != textMark.Next {
				t.Fatal("raw HTML wrappers were unexpectedly inserted")
			}
		})
	}
}

func TestHasCSSFontFamily(t *testing.T) {
	tests := []struct {
		style string
		want  bool
	}{
		{style: "font-family: serif", want: true},
		{style: "color: red; FONT-FAMILY: serif", want: true},
		{style: `background: url("data:text/plain;x-font-family:value")`, want: false},
		{style: "--label: font-family: serif", want: false},
		{style: "color: red", want: false},
	}
	for _, test := range tests {
		if got := hasCSSFontFamily(test.style); test.want != got {
			t.Fatalf("hasCSSFontFamily(%q): expected %t, got %t", test.style, test.want, got)
		}
	}
}

func TestEscapeMarkdownHTMLAttribute(t *testing.T) {
	const value = "font-family: \"A&B<Font>|Fallback\";\r\ncolor: red"
	const expected = "font-family: &quot;A&amp;B&lt;Font&gt;&#124;Fallback&quot;;&#10;color: red"
	if actual := escapeMarkdownHTMLAttribute(value); expected != actual {
		t.Fatalf("unexpected escaped attribute:\nexpected: %q\nactual:   %q", expected, actual)
	}
}

func markdownTextMarkTestTree(textMark *ast.Node) *parse.Tree {
	root := &ast.Node{Type: ast.NodeDocument}
	paragraph := &ast.Node{Type: ast.NodeParagraph}
	root.AppendChild(paragraph)
	paragraph.AppendChild(textMark)
	return &parse.Tree{Root: root}
}

func renderMarkdownTextMarkTestTree(tree *parse.Tree) string {
	renderer := render.NewProtyleExportMdRenderer(tree, render.NewOptions(), parse.NewOptions())
	return strings.TrimSpace(string(renderer.Render()))
}
