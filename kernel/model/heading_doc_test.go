// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/88250/lute/render"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestHeadingDocTitle(t *testing.T) {
	for _, tc := range []struct {
		name, markdown, text string
	}{
		{"plain", "Test", "Test"},
		{"escaped text", "A & B", "A & B"},
		{"slash", "A/B", "A/B"},
		{"literal slash retained in title", "A/B／C", "A/B／C"},
		{"long title retained without display truncation", strings.Repeat("标题", 300), strings.Repeat("标题", 300)},
		{"image", "Test ![image](assets/test.png)", "Test image"},
		{"image only", "![](assets/test.png)", ""},
		{"link", "[Test](https://example.com)", "Test"},
		{"mixed", "Before ![image](assets/test.png) [link](https://example.com) after", "Before image link after"},
		{"strong", "**Test**", "Test"},
		{"code", "`Test`", "Test"},
		{"formula", "$a^2+b^2$", "a^2+b^2"},
		{"tag", "#Tag#", "Tag"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			engine := util.NewLute()
			tree := parse.Parse("", []byte("# "+tc.markdown+"\n\n123\n\n## Child\n\nBody\n\n# Next\n"), engine.ParseOptions)
			heading := tree.Root.FirstChild
			heading.ID = "20260909120000-heading"
			heading.SetIALAttr("id", heading.ID)
			originalDOM := engine.RenderNodeBlockDOM(heading)
			children := treenode.HeadingChildren(heading)
			paragraph, err := headingDocTitle(heading)
			if err != nil {
				t.Fatal(err)
			}
			if paragraph.Type != ast.NodeParagraph || paragraph.ID != "" || paragraph.Parent != nil {
				t.Fatal("title source must be an anonymous detached inline fragment")
			}
			if got := treenode.DocumentTitleText(paragraph); got != tc.text {
				t.Fatalf("title text = %q, want %q", got, tc.text)
			}
			if engine.RenderNodeBlockDOM(heading) != originalDOM || heading.ID != "20260909120000-heading" {
				t.Fatal("copying title source changed the original heading")
			}
			after := treenode.HeadingChildren(heading)
			if len(after) != len(children) || len(after) != 3 {
				t.Fatal("heading section changed")
			}
			for i, child := range children {
				if after[i] != child {
					t.Fatal("section order changed")
				}
			}
			if children[1].HeadingLevel != 2 {
				t.Fatal("child heading level changed")
			}
			root := &ast.Node{Type: ast.NodeDocument, ID: heading.ID}
			expected, err := render.NewDocumentTitle(paragraph)
			if err != nil {
				t.Fatal(err)
			}
			if err := treenode.SetDocumentTitleParagraph(root, paragraph); err != nil {
				t.Fatal(err)
			}
			restored, err := treenode.DocumentTitleParagraph(root)
			if err != nil {
				t.Fatal(err)
			}
			source, err := render.NewDocumentTitle(restored)
			if err != nil || source.Content != expected.Content {
				t.Fatalf("title source did not round-trip: %v", err)
			}
			if root.FirstChild != nil {
				t.Fatal("title persistence created a duplicate body block")
			}
		})
	}
}

func TestHeadingDocTitleTextMarks(t *testing.T) {
	nodes := []*ast.Node{
		{Type: ast.NodeTextMark, TextMarkType: "a strong em", TextMarkTextContent: "Link", TextMarkAHref: "https://example.com/a/b", TextMarkATitle: "Link title"},
		{Type: ast.NodeTextMark, TextMarkType: "block-ref", TextMarkBlockRefID: "20260909120000-abcdefg", TextMarkBlockRefSubtype: "d", TextMarkTextContent: "Dynamic"},
		{Type: ast.NodeTextMark, TextMarkType: "block-ref", TextMarkBlockRefID: "20260909120001-abcdefg", TextMarkBlockRefSubtype: "s", TextMarkTextContent: "Static"},
		{Type: ast.NodeTextMark, TextMarkType: "inline-memo", TextMarkTextContent: "Memo", TextMarkInlineMemoContent: "Private memo"},
		{Type: ast.NodeTextMark, TextMarkType: "file-annotation-ref", TextMarkTextContent: "Annotation", TextMarkFileAnnotationRefID: "assets/test.pdf/20260909120002-abcdefg"},
		{Type: ast.NodeTextMark, TextMarkType: "inline-math", TextMarkInlineMathContent: "a^2"},
		{Type: ast.NodeTextMark, TextMarkType: "u s mark sup sub kbd code", TextMarkTextContent: "Style"},
	}
	for _, node := range nodes {
		t.Run(node.TextMarkType+node.TextMarkBlockRefSubtype, func(t *testing.T) {
			heading := &ast.Node{Type: ast.NodeHeading, HeadingLevel: 2}
			heading.AppendChild(node)
			paragraph, err := headingDocTitle(heading)
			if err != nil {
				t.Fatal(err)
			}
			got := paragraph.FirstChild
			if got == nil || got == node || heading.FirstChild != node || node.Parent != heading {
				t.Fatal("title conversion moved or omitted source nodes")
			}
			if got.TextMarkType != node.TextMarkType || got.TextMarkTextContent != node.TextMarkTextContent ||
				got.TextMarkAHref != node.TextMarkAHref || got.TextMarkATitle != node.TextMarkATitle ||
				got.TextMarkBlockRefID != node.TextMarkBlockRefID || got.TextMarkBlockRefSubtype != node.TextMarkBlockRefSubtype ||
				got.TextMarkInlineMathContent != node.TextMarkInlineMathContent || got.TextMarkInlineMemoContent != node.TextMarkInlineMemoContent ||
				got.TextMarkFileAnnotationRefID != node.TextMarkFileAnnotationRefID {
				t.Fatalf("inline attributes changed: %#v, want %#v", got, node)
			}
		})
	}
}
