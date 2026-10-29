// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package util

import (
	"strings"
	"testing"

	"github.com/88250/lute"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
)

func TestLuteTextMarkEscapedContentRoundTrip(t *testing.T) {
	for _, blockType := range []string{"NodeHeading", "NodeParagraph"} {
		for _, mark := range []string{"em", "strong", "s", "mark", "sup", "sub", "em strong", "code"} {
			t.Run(blockType+"/"+mark, func(t *testing.T) {
				engine := NewLute()
				const content = "&lt;vitae&gt; &amp; &amp;lt;literal&amp;gt;"
				dom := `<div data-node-id="20260918120000-abcdefg" data-type="` + blockType + `" data-subtype="h1"><div contenteditable="true">before <span data-type="` + mark + `">` + content + `</span> after</div></div>`
				for i := range 3 {
					tree := engine.BlockDOM2Tree(dom)
					found := false
					ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
						if entering && n.Type == ast.NodeTextMark {
							found = true
							if n.TextMarkTextContent != content {
								t.Fatalf("round %d: content = %q, want %q", i, n.TextMarkTextContent, content)
							}
							if rendered := engine.RenderNodeBlockDOM(n); !strings.Contains(rendered, content) {
								t.Fatalf("outline text lost: %s", rendered)
							}
						}
						return ast.WalkContinue
					})
					if !found {
						t.Fatal("text mark lost")
					}
					dom = engine.Tree2BlockDOM(tree, engine.RenderOptions, engine.ParseOptions)
				}
			})
		}
	}
}

func TestLuteFactoriesEnableCustomBlock(t *testing.T) {
	factories := []struct {
		name string
		new  func() *lute.Lute
	}{
		{name: "SiYuan", new: NewLute},
		{name: "standard import", new: NewStdLute},
	}

	for _, factory := range factories {
		t.Run(factory.name, func(t *testing.T) {
			luteEngine := factory.new()
			tree := parse.Parse("", []byte(";;;example-plugin/chart\npayload\n;;;"), luteEngine.ParseOptions)
			if nil == tree || nil == tree.Root || nil == tree.Root.FirstChild {
				t.Fatal("custom block Markdown was not parsed")
			}
			node := tree.Root.FirstChild
			if ast.NodeCustomBlock != node.Type || "example-plugin/chart" != node.CustomBlockInfo || "payload\n" != string(node.Tokens) {
				t.Fatalf("unexpected custom block: type=%s, info=%q, content=%q", node.Type, node.CustomBlockInfo, node.Tokens)
			}
		})
	}
}

func TestLuteUnicode17Callout(t *testing.T) {
	engine := NewLute()
	for alias, emoji := range map[string]string{
		"distorted_face": "🫪",
		"fight_cloud":    "🫯",
		"hairy_creature": "🫈",
		"ballet_dancer":  "🧑‍🩰",
		"orca":           "🫍",
		"landslide":      "🛘",
		"trombone":       "🪊",
		"treasure_chest": "🪎",
		"people_wrestling_light_skin_tone_dark_skin_tone": "🧑🏻‍🫯‍🧑🏿",
	} {
		t.Run(alias, func(t *testing.T) {
			for _, icon := range []string{emoji, ":" + alias + ":"} {
				tree := parse.Parse("", []byte("> [!NOTE] "+icon+" Title\n> Content\n"), engine.ParseOptions)
				node := tree.Root.FirstChild
				if node == nil || node.Type != ast.NodeCallout {
					t.Fatalf("callout was not parsed for %q", icon)
				}
				if node.CalloutIcon != emoji || node.CalloutTitle != "Title" {
					t.Fatalf("unexpected callout: icon=%q, title=%q", node.CalloutIcon, node.CalloutTitle)
				}
			}
		})
	}
}
