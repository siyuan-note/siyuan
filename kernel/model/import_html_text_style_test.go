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
)

func TestImportHTMLTextStyles(t *testing.T) {
	for _, input := range []string{
		`before <small>small **bold** <small>nested</small> [link](https://example.com)</small> after`,
		`before <span style="color:rgb(216,57,49);background-color:rgb(255,165,61);font-family:Arial;font-size:18pt">colored <strong>bold</strong></span> after`,
		`<div style="font-family:Arial;font-size:24px"><small>small <strong>bold</strong></small></div>`,
	} {
		t.Run(input, func(t *testing.T) {
			tree, _, _, _ := parseStdMd([]byte(input))
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
