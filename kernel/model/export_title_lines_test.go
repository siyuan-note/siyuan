// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/88250/lute/render"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestExportDocumentTitleLineBreakRoundTrip(t *testing.T) {
	for _, kind := range []ast.NodeType{ast.NodeSoftBreak, ast.NodeHardBreak, ast.NodeBr} {
		t.Run(kind.String(), func(t *testing.T) {
			root := &ast.Node{Type: ast.NodeDocument, ID: "20260101000000-abcdefg"}
			paragraph := &ast.Node{Type: ast.NodeParagraph}
			paragraph.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "strong", TextMarkTextContent: "First"})
			paragraph.AppendChild(&ast.Node{Type: kind})
			paragraph.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("Second\nThird")})
			paragraph.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "a", TextMarkTextContent: "Link\r\nlabel", TextMarkAHref: "https://example.org"})
			if err := treenode.SetDocumentTitleParagraph(root, paragraph); err != nil {
				t.Fatal(err)
			}
			original := root.DocumentTitle.Content
			body := &ast.Node{Type: ast.NodeParagraph}
			body.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("Body")})
			root.AppendChild(body)
			for repeat := 0; repeat < 3; repeat++ {
				heading, err := exportDocumentHeading(root, 1, "")
				if err != nil {
					t.Fatal(err)
				}
				tree := &parse.Tree{Root: &ast.Node{Type: ast.NodeDocument}}
				tree.Root.AppendChild(heading)
				markdown := render.NewProtyleExportMdRenderer(tree, util.NewLute().RenderOptions, util.NewLute().ParseOptions).Render()
				imported := parse.Parse("", markdown, util.NewLute().ParseOptions)
				blocks := 0
				for node := imported.Root.FirstChild; node != nil; node = node.Next {
					if node.Type == ast.NodeKramdownBlockIAL {
						continue
					}
					blocks++
					if node.Type != ast.NodeHeading {
						t.Fatalf("title split into body on reimport: %s", markdown)
					}
				}
				if blocks != 1 {
					t.Fatalf("reimported title has %d blocks: %s", blocks, markdown)
				}
				if text := treenode.DocumentTitleText(imported.Root.FirstChild); text != "First Second ThirdLink label" {
					t.Fatalf("reimported title = %q: %s", text, markdown)
				}
				if root.DocumentTitle.Content != original || root.FirstChild != body || body.Next != nil {
					t.Fatal("export changed the title source or document body")
				}
			}
		})
	}
}

func TestExportPlainAndCustomTitleLineBreaks(t *testing.T) {
	for _, custom := range []string{"", "Custom\r\nsecond\rthird\nfourth"} {
		root := &ast.Node{Type: ast.NodeDocument}
		root.SetIALAttr("title", "Plain\r\nsecond\rthird\nfourth")
		heading, err := exportDocumentHeading(root, 2, custom)
		if err != nil {
			t.Fatal(err)
		}
		want := "Plain second third fourth"
		if custom != "" {
			want = "Custom second third fourth"
		}
		if heading.FirstChild.TokensStr() != want || root.IALAttr("title") != "Plain\r\nsecond\rthird\nfourth" {
			t.Fatal("plain/custom export did not flatten line breaks without mutating source")
		}
	}
}
