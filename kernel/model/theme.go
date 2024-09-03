// SiYuan - Refactor your thinking
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
	"bytes"
	"os"
	"path/filepath"
	"strings"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/gorilla/css/scanner"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
	"github.com/vanng822/css"
)

func fillThemeStyleVar(tree *parse.Tree) {
	themeStyles := getThemeStyleVar(Conf.Appearance.ThemeLight)
	if 1 > len(themeStyles) {
		return
	}

	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}

		for _, ial := range n.KramdownIAL {
			if "style" != ial[0] {
				continue
			}

			styleSheet := css.Parse(ial[1])
			buf := bytes.Buffer{}
			for _, r := range styleSheet.GetCSSRuleList() {
				styles := getStyleVarName(r.Style.Selector)
				for style, name := range styles {
					buf.WriteString(style)
					buf.WriteString(": ")
					value := themeStyles[name]
					if "" == value {
						// 回退为变量
						buf.WriteString("var(")
						buf.WriteString(name)
						buf.WriteString(")")
					} else {
						buf.WriteString(value)
					}
					buf.WriteString("; ")
				}
			}
			if 0 < buf.Len() {
				ial[1] = strings.TrimSpace(buf.String())
			}
		}
		return ast.WalkContinue
	})
}

func getStyleVarName(value *css.CSSValue) (ret map[string]string) {
	ret = map[string]string{}

	var start, end int
	var style, name string
	for i, t := range value.Tokens {
		if scanner.TokenIdent == t.Type && 0 == start {
			style = strings.TrimSpace(t.Value)
			continue
		}

		if scanner.TokenFunction == t.Type && "var(" == t.Value {
			start = i
			continue
		}
		if scanner.TokenChar == t.Type && ")" == t.Value {
			end = i

			if 0 < start && 0 < end {
				for _, tt := range value.Tokens[start+1 : end] {
					name += tt.Value
				}
				name = strings.TrimSpace(name)
			}
			start, end = 0, 0
			ret[style] = name
			style, name = "", ""
		}
	}
	return
}

func getThemeStyleVar(theme string) (ret map[string]string) {
	ret = map[string]string{}

	data, err := os.ReadFile(filepath.Join(util.ThemesPath, theme, "theme.css"))
	if err != nil {
		logging.LogErrorf("read theme [%s] css file failed: %s", theme, err)
		return
	}

	styleSheet := css.Parse(string(data))
	for _, rule := range styleSheet.GetCSSRuleList() {
		for _, style := range rule.Style.Styles {
			ret[style.Property] = strings.TrimSpace(style.Value.Text())
			// 如果两个短横线开头 CSS 解析器有问题，--b3-theme-primary: #3575f0; 会被解析为 -b3-theme-primary:- #3575f0
			// 这里两种解析都放到结果中
			ret["-"+style.Property] = strings.TrimSpace(strings.TrimPrefix(style.Value.Text(), "-"))
		}
	}
	return
}
