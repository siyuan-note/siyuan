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

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/gorilla/css/scanner"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
	"github.com/vanng822/css"
)

// 将文档中的 CSS 变量替换为具体的主题样式值
func fillThemeStyleVar(tree *parse.Tree) {
	if nil == tree || nil == tree.Root {
		return
	}

	var themeStyles map[string]string
	if 1 == Conf.Appearance.Mode {
		themeStyles = getThemeStyleVar(Conf.Appearance.ThemeDark, true)
	} else {
		themeStyles = getThemeStyleVar(Conf.Appearance.ThemeLight, false)
	}
	if 1 > len(themeStyles) {
		return
	}

	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}

		// 遍历节点的 Kramdown IAL (Inline Attribute List) 属性
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

					// 解析嵌套的 CSS 变量
					value := resolveNestedCSSVar(themeStyles, name)

					if "" == value {
						// 回退为原始 var() 形式
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

// 递归解析嵌套的 CSS 变量
func resolveNestedCSSVar(themeStyles map[string]string, varName string) string {
	visited := make(map[string]bool) // 循环引用检测
	maxDepth := 10                   // 防止无限嵌套

	currentName := varName
	for depth := 0; depth < maxDepth; depth++ {
		if visited[currentName] {
			return ""
		}
		visited[currentName] = true

		value, exists := themeStyles[currentName]
		if !exists {
			return ""
		}

		// 如果不包含嵌套变量，直接返回最终值
		if !strings.Contains(value, "var(") {
			return value
		}

		// 提取嵌套变量名：var(--variable-name) -> --variable-name
		nestedVarName := gulu.Str.SubStringBetween(value, "(", ")")
		if "" == nestedVarName {
			return value
		}

		currentName = nestedVarName
	}

	return ""
}

// 从 CSS 选择器值中解析出样式属性和对应的 CSS 变量名
func getStyleVarName(value *css.CSSValue) (ret map[string]string) {
	ret = map[string]string{}

	var start, end int
	var style, name string
	for i, t := range value.Tokens {
		// 获取样式属性名
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

			// 提取 var() 中的变量名
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

// 获取主题的样式变量映射表
func getThemeStyleVar(theme string, isDarkMode bool) (ret map[string]string) {
	ret = map[string]string{}

	var cssContent string

	// 第三方主题可能缺少基础变量，先加载默认主题作为基础
	defaultTheme := map[bool]string{false: "daylight", true: "midnight"}[isDarkMode]
	if theme != defaultTheme {
		defaultData, err := os.ReadFile(filepath.Join(util.ThemesPath, defaultTheme, "theme.css"))
		if err != nil {
			logging.LogErrorf("read default theme [%s] css file failed: %s", defaultTheme, err)
		} else {
			cssContent = string(defaultData) + "\n"
		}
	}

	// 拼接主题 CSS，后面的规则覆盖前面的规则
	userData, err := os.ReadFile(filepath.Join(util.ThemesPath, theme, "theme.css"))
	if err != nil {
		logging.LogErrorf("read theme [%s] css file failed: %s", theme, err)
		return ret
	}
	cssContent += string(userData)

	// 解析拼接后的完整 CSS 内容
	styleSheet := css.Parse(cssContent)
	stylePriorities := map[string]int{}
	currentMode := map[bool]string{false: "light", true: "dark"}[isDarkMode]
	for _, rule := range styleSheet.GetCSSRuleList() {
		priority := getSelectorPriority(rule.Style.Selector.Text(), currentMode)
		for _, style := range rule.Style.Styles {
			propName := style.Property
			propValue := strings.TrimSpace(style.Value.Text())

			if existingPriority, exists := stylePriorities[propName]; !exists || priority >= existingPriority {
				ret[propName] = propValue
				stylePriorities[propName] = priority
			}

			// 如果两个短横线开头 CSS 解析器有问题，--b3-theme-primary: #3575f0; 会被解析为 -b3-theme-primary:- #3575f0
			// 这里两种解析都放到结果中
			bugFixPropName := "-" + propName
			bugFixPropValue := strings.TrimSpace(strings.TrimPrefix(propValue, "-"))
			if existingPriority, exists := stylePriorities[bugFixPropName]; !exists || priority >= existingPriority {
				ret[bugFixPropName] = bugFixPropValue
				stylePriorities[bugFixPropName] = priority
			}
		}
	}
	return ret
}

// 粗略计算 CSS 选择器的优先级
func getSelectorPriority(selector, currentMode string) int {
	selector = strings.TrimSpace(strings.ToLower(selector))

	modeSelectors := []string{
		"[data-theme-mode=\"" + currentMode + "\"]",
		"[data-theme-mode='" + currentMode + "']",
		"[data-theme-mode=" + currentMode + "]",
	}

	for _, modeSelector := range modeSelectors {
		if strings.Contains(selector, modeSelector) {
			if strings.Contains(selector, ":root") || strings.Contains(selector, "html") {
				return 2
			} else {
				return 1
			}
		}
	}

	return 0
}
