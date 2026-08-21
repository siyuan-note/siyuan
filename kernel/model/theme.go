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
	"os"
	"path/filepath"
	"strings"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
	"github.com/vanng822/css"
)

const maxCSSVarResolveDepth = 64

// 将文档中的 CSS 变量替换为具体的主题样式值
func fillThemeStyleVar(tree *parse.Tree) {
	if nil == tree || nil == tree.Root {
		return
	}

	isDarkMode := 1 == Conf.Appearance.Mode
	var themeStyles map[string]string
	if isDarkMode {
		themeStyles = getThemeStyleVar(Conf.Appearance.ThemeDark, true)
	} else {
		themeStyles = getThemeStyleVar(Conf.Appearance.ThemeLight, false)
	}
	inlineStyles, err := GetInlineStyles()
	if err != nil {
		logging.LogErrorf("load inline styles for theme variables failed: %s", err)
	} else {
		mergeInlineStyleThemeVars(themeStyles, inlineStyles, isDarkMode)
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

			ial[1] = resolveCSSVars(ial[1], themeStyles)
		}
		return ast.WalkContinue
	})
}

func mergeInlineStyleThemeVars(themeStyles map[string]string, styles *InlineStyles, isDarkMode bool) {
	if styles == nil {
		return
	}
	for _, style := range styles.Styles {
		if style == nil {
			continue
		}
		theme := style.Light
		if isDarkMode {
			theme = style.Dark
		}
		if theme == nil {
			continue
		}
		prefix := "--b3-inline-style-" + style.ID
		if theme.Color != "" {
			themeStyles[prefix+"-color"] = theme.Color
		}
		if theme.BackgroundColor != "" {
			themeStyles[prefix+"-background-color"] = theme.BackgroundColor
		}
	}
}

func resolveCSSVars(value string, variables map[string]string) string {
	ret, _ := resolveCSSVarsValue(value, variables, map[string]bool{}, 0)
	return ret
}

func resolveCSSVarsValue(value string, variables map[string]string, resolving map[string]bool, depth int) (ret string, valid bool) {
	if maxCSSVarResolveDepth < depth {
		return value, false
	}

	var builder strings.Builder
	valid = true
	position := 0
	for position < len(value) {
		start := findNextCSSVar(value, position)
		if start < 0 {
			builder.WriteString(value[position:])
			break
		}
		builder.WriteString(value[position:start])
		end, ok := findCSSFunctionEnd(value, start+3)
		if !ok {
			builder.WriteString(value[start:])
			valid = false
			break
		}

		original := value[start : end+1]
		name, fallback, hasFallback := splitCSSVarArguments(value[start+4 : end])
		resolved, ok := resolveCSSVar(name, fallback, hasFallback, original, variables, resolving, depth+1)
		builder.WriteString(resolved)
		if !ok {
			valid = false
		}
		position = end + 1
	}
	return builder.String(), valid
}

func resolveCSSVar(name, fallback string, hasFallback bool, original string, variables map[string]string,
	resolving map[string]bool, depth int) (ret string, valid bool) {
	name = normalizeCSSVarName(name)
	if strings.HasPrefix(name, "--") && !resolving[name] {
		if value, exists := variables[name]; exists {
			resolving[name] = true
			resolved, ok := resolveCSSVarsValue(value, variables, resolving, depth)
			delete(resolving, name)
			if ok {
				return resolved, true
			}
		}
	}

	if hasFallback {
		resolved, ok := resolveCSSVarsValue(strings.TrimSpace(fallback), variables, resolving, depth)
		if ok {
			return resolved, true
		}
	}
	return original, false
}

func findNextCSSVar(value string, start int) int {
	var quote byte
	for i := start; i < len(value); i++ {
		if quote != 0 {
			if value[i] == '\\' {
				i++
				continue
			}
			if value[i] == quote {
				quote = 0
			}
			continue
		}
		if value[i] == '\'' || value[i] == '"' {
			quote = value[i]
			continue
		}
		if i+1 < len(value) && value[i] == '/' && value[i+1] == '*' {
			if commentEnd := strings.Index(value[i+2:], "*/"); commentEnd >= 0 {
				i += commentEnd + 3
				continue
			}
			return -1
		}
		if i+4 <= len(value) && strings.EqualFold(value[i:i+4], "var(") &&
			(i == 0 || !isCSSIdentifierByte(value[i-1])) {
			return i
		}
	}
	return -1
}

func findCSSFunctionEnd(value string, openParen int) (ret int, ok bool) {
	if openParen >= len(value) || value[openParen] != '(' {
		return 0, false
	}
	depth := 0
	var quote byte
	for i := openParen; i < len(value); i++ {
		if quote != 0 {
			if value[i] == '\\' {
				i++
				continue
			}
			if value[i] == quote {
				quote = 0
			}
			continue
		}
		if value[i] == '\'' || value[i] == '"' {
			quote = value[i]
			continue
		}
		if i+1 < len(value) && value[i] == '/' && value[i+1] == '*' {
			if commentEnd := strings.Index(value[i+2:], "*/"); commentEnd >= 0 {
				i += commentEnd + 3
				continue
			}
			return 0, false
		}
		switch value[i] {
		case '(':
			depth++
		case ')':
			depth--
			if depth == 0 {
				return i, true
			}
		}
	}
	return 0, false
}

func splitCSSVarArguments(value string) (name, fallback string, hasFallback bool) {
	depth := 0
	var quote byte
	for i := 0; i < len(value); i++ {
		if quote != 0 {
			if value[i] == '\\' {
				i++
				continue
			}
			if value[i] == quote {
				quote = 0
			}
			continue
		}
		if value[i] == '\'' || value[i] == '"' {
			quote = value[i]
			continue
		}
		if i+1 < len(value) && value[i] == '/' && value[i+1] == '*' {
			commentEnd := strings.Index(value[i+2:], "*/")
			if commentEnd < 0 {
				return value, "", false
			}
			i += commentEnd + 3
			continue
		}
		switch value[i] {
		case '(':
			depth++
		case ')':
			if 0 < depth {
				depth--
			}
		case ',':
			if depth == 0 {
				return value[:i], value[i+1:], true
			}
		}
	}
	return value, "", false
}

func normalizeCSSVarName(value string) string {
	var builder strings.Builder
	position := 0
	for position < len(value) {
		commentStart := strings.Index(value[position:], "/*")
		if commentStart < 0 {
			builder.WriteString(value[position:])
			break
		}
		commentStart += position
		builder.WriteString(value[position:commentStart])
		commentEnd := strings.Index(value[commentStart+2:], "*/")
		if commentEnd < 0 {
			builder.WriteString(value[commentStart:])
			break
		}
		builder.WriteByte(' ')
		position = commentStart + commentEnd + 4
	}
	return strings.TrimSpace(builder.String())
}

func isCSSIdentifierByte(value byte) bool {
	return value == '-' || value == '_' || '0' <= value && value <= '9' ||
		'a' <= value && value <= 'z' || 'A' <= value && value <= 'Z'
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
			}

			return 1
		}
	}

	return 0
}
