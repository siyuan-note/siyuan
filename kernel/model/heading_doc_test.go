// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/88250/lute"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

func TestHeadingDocParagraph(t *testing.T) {
	for _, tc := range []struct {
		name     string
		markdown string
		title    string
		preserve bool
	}{
		{"plain", "Test", "Test", false},
		{"escaped text", "A & B", "A &amp; B", false},
		{"slash", "A/B", "A_B", true},
		{"literal slash retained in title", "A/B", "A/B", false},
		{"truncated", strings.Repeat("标题", 20), "标题...", true},
		{"image", "Test ![image](assets/test.png)", "Test image", true},
		{"image only", "![](assets/test.png)", "image", true},
		{"link", "[Test](https://example.com)", "Test", true},
		{"mixed", "Before ![image](assets/test.png) [link](https://example.com) after", "Before image link after", true},
		{"strong", "**Test**", "Test", true},
		{"code", "`Test`", "Test", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			engine := lute.New()
			tree := parse.Parse("", []byte("# "+tc.markdown+"\n\n123\n\n## Child\n\nBody\n\n# Next\n"), engine.ParseOptions)
			heading := tree.Root.FirstChild
			heading.ID = "20260909120000-heading"
			heading.SetIALAttr("id", heading.ID)
			var inlines []*ast.Node
			var before [][]byte
			for c := heading.FirstChild; c != nil; c = c.Next {
				if c.Type == ast.NodeHeadingC8hMarker || c.Type == ast.NodeHeadingID {
					continue
				}
				inlines = append(inlines, c)
				data, err := json.Marshal(c)
				if err != nil {
					t.Fatal(err)
				}
				before = append(before, data)
			}
			children := treenode.HeadingChildren(heading)
			paragraph := headingDocParagraph(heading, tc.title)
			if (paragraph != nil) != tc.preserve {
				t.Fatalf("preserve = %v, expected %v", paragraph != nil, tc.preserve)
			}
			if paragraph == nil {
				if heading.ChildByType(ast.NodeText) != inlines[0] {
					t.Fatal("plain heading content changed")
				}
				return
			}
			if paragraph.Type != ast.NodeParagraph || paragraph.ID == "" || paragraph.ID == heading.ID || paragraph.IALAttr("id") != paragraph.ID {
				t.Fatal("expected a paragraph with its own block ID")
			}
			i := 0
			for c := paragraph.FirstChild; c != nil; c = c.Next {
				if i >= len(inlines) || c != inlines[i] || c.Parent != paragraph {
					t.Fatal("inline order or parent changed")
				}
				data, err := json.Marshal(c)
				if err != nil || string(data) != string(before[i]) {
					t.Fatalf("inline content changed: %s, error: %v", data, err)
				}
				i++
			}
			if i != len(inlines) {
				t.Fatal("inline content lost")
			}
			if heading.ID != "20260909120000-heading" || heading.IALAttr("id") != heading.ID {
				t.Fatal("source heading ID changed")
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
		})
	}
}

func TestHeadingDocParagraphTextMark(t *testing.T) {
	heading := &ast.Node{Type: ast.NodeHeading}
	link := &ast.Node{Type: ast.NodeTextMark, TextMarkType: "a", TextMarkTextContent: "Test", TextMarkAHref: "https://example.com"}
	heading.AppendChild(link)
	paragraph := headingDocParagraph(heading, "Test")
	if paragraph == nil || paragraph.FirstChild != link || link.TextMarkAHref != "https://example.com" {
		t.Fatal("text mark link lost")
	}
}
