// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"regexp"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestReplaceDocumentTitleTextAcrossStyles(t *testing.T) {
	for _, tc := range []struct{ keyword, replacement, want string }{
		{"(BCDE)", "${1}/new", "ABCDE/newF"},
		{"BCDE", "", "AF"},
		{"^|$", "/", "/ABCDEF/"},
		{"[ACE]", "x", "xBxDxF"},
	} {
		t.Run(tc.keyword+tc.replacement, func(t *testing.T) {
			root := &ast.Node{Type: ast.NodeDocument}
			paragraph := &ast.Node{Type: ast.NodeParagraph}
			paragraph.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("AB")})
			paragraph.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "strong", TextMarkTextContent: "CD"})
			paragraph.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "a", TextMarkTextContent: "EF", TextMarkAHref: "https://example.com/ABCDEF", TextMarkATitle: "ABCDEF"})
			if err := treenode.SetDocumentTitleParagraph(root, paragraph); err != nil {
				t.Fatal(err)
			}
			changed, err := replaceDocumentTitleText(root, 3, tc.keyword, tc.replacement, regexp.MustCompile(tc.keyword))
			if err != nil || !changed || treenode.ReadDocumentTitle(root).Text != tc.want {
				t.Fatalf("replacement = %q, changed %v: %v", treenode.ReadDocumentTitle(root).Text, changed, err)
			}
			restored, err := treenode.DocumentTitleParagraph(root)
			if err != nil || restored.LastChild.TextMarkAHref != "https://example.com/ABCDEF" || restored.LastChild.TextMarkATitle != "ABCDEF" || restored.FirstChild.Next.TextMarkType != "strong" {
				t.Fatal("replacement lost inline structure or metadata", err)
			}
		})
	}
}

func TestReplaceDocumentTitleTextEscapesAndEmpty(t *testing.T) {
	for _, markdown := range []string{`A\*B`, "A &amp; B", "$A*B$"} {
		root := &ast.Node{Type: ast.NodeDocument}
		paragraph := parse.Parse("", []byte(markdown), util.NewLute().ParseOptions).Root.FirstChild
		if err := treenode.SetDocumentTitleParagraph(root, paragraph); err != nil {
			t.Fatal(err)
		}
		_, err := replaceDocumentTitleText(root, 3, "A.*B", "<literal>/", regexp.MustCompile("A.*B"))
		if err != nil || treenode.ReadDocumentTitle(root).Text != "<literal>/" {
			t.Fatal("replacement interpreted literal text or discarded escapes", markdown, err)
		}
	}
	root := &ast.Node{Type: ast.NodeDocument}
	if err := treenode.SetDocumentTitleParagraph(root, &ast.Node{Type: ast.NodeParagraph}); err != nil {
		t.Fatal(err)
	}
	if _, err := replaceDocumentTitleText(root, 3, "^", "A/B", regexp.MustCompile("^")); err != nil || treenode.ReadDocumentTitle(root).Text != "A/B" {
		t.Fatal("replacement could not fill an empty title", err)
	}
	if root.DocumentTitle != nil || treenode.ReadDocumentTitle(root).Format != "plain" {
		t.Fatal("ordinary replacement text unnecessarily created a rich title source")
	}
}
