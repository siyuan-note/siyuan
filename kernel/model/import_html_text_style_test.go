// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"strings"
	"testing"

	"github.com/88250/lute/ast"
)

func TestImportHTMLTextStyles(t *testing.T) {
	for _, input := range []string{
		`before <small>small **bold** <small>nested</small> [link](https://example.com)</small> after`,
		`before <span style="color:rgb(216,57,49);background-color:rgb(255,165,61);font-family:Arial;font-size:18pt">colored <strong>bold</strong></span> after`,
		`<div style="font-family:Arial;font-size:24px"><small>small <strong>bold</strong></small></div>`,
	} {
		t.Run(input, func(t *testing.T) {
			tree, _, _, _ := parseStdMd([]byte(input), true)
			styled := 0
			bold := false
			ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
				if !entering {
					return ast.WalkContinue
				}
				if n.Type == ast.NodeTextMark && n.IALAttr("style") != "" {
					styled++
				}
				if n.Type == ast.NodeTextMark && strings.TrimSpace(n.TextMarkTextContent) == "bold" {
					bold = n.ContainTextMarkTypes("strong") && n.IALAttr("style") != ""
				}
				if n.Type == ast.NodeTextMark && n.ContainTextMarkTypes("a") && (n.TextMarkAHref != "https://example.com" || n.IALAttr("style") == "") {
					t.Errorf("link or its style was lost: %#v", n)
				}
				if n.Type == ast.NodeInlineHTML || n.Type == ast.NodeHTMLBlock || (n.Type == ast.NodeText && strings.Contains(n.TokensStr(), "<small")) {
					t.Errorf("unconverted HTML: %s", n.Tokens)
				}
				return ast.WalkContinue
			})
			if styled == 0 {
				t.Fatal("text styles were lost during import")
			}
			if !bold {
				t.Fatal("combined bold and text style was lost")
			}
		})
	}
}
