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

	"github.com/88250/lute/ast"
	"github.com/88250/lute/html"
)

func prepareMarkdownFontFamilyTextMarks(root *ast.Node) {
	if nil == root {
		return
	}

	var textMarks []*ast.Node
	ast.Walk(root, func(node *ast.Node, entering bool) ast.WalkStatus {
		if entering && ast.NodeTextMark == node.Type {
			textMarks = append(textMarks, node)
		}
		return ast.WalkContinue
	})

	for _, textMark := range textMarks {
		if nil == textMark.Parent {
			continue
		}

		types := strings.Fields(textMark.TextMarkType)
		remainingTypes := make([]string, 0, len(types))
		hasText := false
		hasProtectedType := false
		for _, typ := range types {
			if "text" == typ {
				hasText = true
				continue
			}
			if isFontFamilyProtectedTextMarkType(typ) {
				hasProtectedType = true
			}
			remainingTypes = append(remainingTypes, typ)
		}
		if !hasText || hasProtectedType {
			continue
		}

		style := textMark.IALAttr("style")
		if !hasCSSFontFamily(style) {
			continue
		}

		openTag := `<span data-type="text" style="` + escapeMarkdownHTMLAttribute(style) + `">`
		textMark.InsertBefore(&ast.Node{Type: ast.NodeInlineHTML, Tokens: []byte(openTag)})
		textMark.InsertAfter(&ast.Node{Type: ast.NodeInlineHTML, Tokens: []byte("</span>")})
		if 0 < len(remainingTypes) {
			textMark.TextMarkType = strings.Join(remainingTypes, " ")
		}
		textMark.RemoveIALAttr("style")
	}
}

func isFontFamilyProtectedTextMarkType(typ string) bool {
	return "code" == typ || "kbd" == typ || "inline-math" == typ
}

func hasCSSFontFamily(style string) bool {
	start := 0
	quote := byte(0)
	escaped := false
	parentheses := 0
	for i := 0; i <= len(style); i++ {
		if i == len(style) {
			return isCSSFontFamilyDeclaration(style[start:])
		}

		character := style[i]
		if escaped {
			escaped = false
			continue
		}
		if '\\' == character {
			escaped = true
			continue
		}
		if 0 != quote {
			if quote == character {
				quote = 0
			}
			continue
		}
		if '"' == character || '\'' == character {
			quote = character
			continue
		}
		if '(' == character {
			parentheses++
			continue
		}
		if ')' == character {
			if 0 < parentheses {
				parentheses--
			}
			continue
		}
		if ';' == character && 0 == parentheses {
			if isCSSFontFamilyDeclaration(style[start:i]) {
				return true
			}
			start = i + 1
		}
	}
	return false
}

func isCSSFontFamilyDeclaration(declaration string) bool {
	property, _, found := strings.Cut(declaration, ":")
	return found && strings.EqualFold(strings.TrimSpace(property), "font-family")
}

func escapeMarkdownHTMLAttribute(value string) string {
	value = strings.ReplaceAll(value, "\r\n", "\n")
	value = strings.ReplaceAll(value, "\r", "\n")
	value = html.EscapeHTMLStr(value)
	value = strings.ReplaceAll(value, "|", "&#124;")
	return strings.ReplaceAll(value, "\n", "&#10;")
}
