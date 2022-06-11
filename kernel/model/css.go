// SiYuan - Build Your Eternal Digital Garden
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
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/88250/css"
	"github.com/88250/gulu"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var colorKeys = map[string][]string{
	"colorPrimary": colorPrimary,
	"colorFont":    colorFont,
	"colorBorder":  colorBorder,
	"colorScroll":  colorScroll,
	"colorTab":     colorTab,
	"colorTip":     colorTip,
	"colorGraph":   colorGraph,
	"colorInline":  colorInline,
}

var colorPrimary = []string{
	"--b3-theme-primary",
	"--b3-theme-primary-light",
	"--b3-theme-primary-lighter",
	"--b3-theme-primary-lightest",
	"--b3-theme-secondary",
	"--b3-theme-background",
	"--b3-theme-surface",
	"--b3-theme-error",
}

var colorFont = []string{
	"--b3-theme-on-primary",
	"--b3-theme-on-secondary",
	"--b3-theme-on-background",
	"--b3-theme-on-surface",
	"--b3-theme-on-error",
}

var colorBorder = []string{
	"--b3-border-color",
}

var colorScroll = []string{
	"--b3-scroll-color",
}

var colorTab = []string{
	"--b3-tab-background",
}

var colorTip = []string{
	"--b3-tooltips-color",
}

var colorGraph = []string{
	"--b3-graph-line",
	"--b3-graph-hl-point",
	"--b3-graph-hl-line",
	"--b3-graph-p-point",
	"--b3-graph-heading-point",
	"--b3-graph-math-point",
	"--b3-graph-code-point",
	"--b3-graph-table-point",
	"--b3-graph-list-point",
	"--b3-graph-todo-point",
	"--b3-graph-olist-point",
	"--b3-graph-listitem-point",
	"--b3-graph-bq-point",
	"--b3-graph-super-point",
	"--b3-graph-doc-point",
	"--b3-graph-tag-point",
	"--b3-graph-asset-point",
	"--b3-graph-line",
	"--b3-graph-tag-line",
	"--b3-graph-ref-line",
	"--b3-graph-tag-tag-line",
	"--b3-graph-asset-line",
	"--b3-graph-hl-point",
	"--b3-graph-hl-line",
}

var colorInline = []string{
	"--b3-protyle-inline-strong-color",
	"--b3-protyle-inline-em-color",
	"--b3-protyle-inline-s-color",
	"--b3-protyle-inline-link-color",
	"--b3-protyle-inline-tag-color",
	"--b3-protyle-inline-blockref-color",
	"--b3-protyle-inline-mark-background",
	"--b3-protyle-inline-mark-color",
}

func currentCSSValue(key string) string {
	var themeName string
	if 0 == Conf.Appearance.Mode {
		themeName = Conf.Appearance.ThemeLight
	} else {
		themeName = Conf.Appearance.ThemeDark
	}

	themePath := filepath.Join(util.ThemesPath, themeName)
	theme := filepath.Join(themePath, "theme.css")
	custom := filepath.Join(themePath, "custom.css")

	var data []byte
	var err error
	if Conf.Appearance.CustomCSS {
		data, _ = os.ReadFile(custom)
	}
	if 1 > len(data) {
		data, err = os.ReadFile(theme)
		if nil != err {
			util.LogErrorf("read theme css [%s] failed: %s", theme, err)
			return "#ffffff"
		}
	}

	ss := css.Parse(string(data))
	rules := ss.GetCSSRuleList()
	for _, rule := range rules {
		for _, style := range rule.Style.Styles {
			fixStyle(style)

			if key == style.Property {
				return style.Value.Text()
			}
		}
	}
	return ""
}

func ReadCustomCSS(themeName string) (ret map[string]map[string]string, err error) {
	ret = map[string]map[string]string{}

	themePath := filepath.Join(util.ThemesPath, themeName)
	theme := filepath.Join(themePath, "theme.css")
	custom := filepath.Join(themePath, "custom.css")

	if !gulu.File.IsExist(custom) {
		if err = gulu.File.CopyFile(theme, custom); nil != err {
			util.LogErrorf("copy theme [%s] to [%s] failed: %s", theme, custom, err)
			return
		}
	}

	data, err := os.ReadFile(custom)
	if nil != err {
		util.LogErrorf("read custom css [%s] failed: %s", custom, err)
		return
	}

	fullColorMap := map[string]string{}
	ss := css.Parse(string(data))
	rules := ss.GetCSSRuleList()
	for _, rule := range rules {
		for _, style := range rule.Style.Styles {
			fixStyle(style)

			fullColorMap[style.Property] = style.Value.Text()
		}
	}

	// 补充现有主题中的样式
	data, err = os.ReadFile(theme)
	if nil != err {
		util.LogErrorf("read theme css [%s] failed: %s", theme, err)
		return
	}
	ss = css.Parse(string(data))
	rules = ss.GetCSSRuleList()
	for _, rule := range rules {
		for _, style := range rule.Style.Styles {
			fixStyle(style)
			if _, ok := fullColorMap[style.Property]; !ok {
				fullColorMap[style.Property] = style.Value.ParsedText()
			}
		}
	}

	buildColor(&ret, fullColorMap, "colorPrimary")
	buildColor(&ret, fullColorMap, "colorFont")
	buildColor(&ret, fullColorMap, "colorBorder")
	buildColor(&ret, fullColorMap, "colorScroll")
	buildColor(&ret, fullColorMap, "colorTab")
	buildColor(&ret, fullColorMap, "colorTip")
	buildColor(&ret, fullColorMap, "colorGraph")
	buildColor(&ret, fullColorMap, "colorInline")
	return
}

func buildColor(ret *map[string]map[string]string, fullColorMap map[string]string, colorMapKey string) {
	colorMap := map[string]string{}
	for _, colorKey := range colorKeys[colorMapKey] {
		colorMap[colorKey] = fullColorMap[colorKey]
	}
	(*ret)[colorMapKey] = colorMap
}

func WriteCustomCSS(themeName string, cssMap map[string]interface{}) (err error) {
	customCSS := map[string]string{}
	for _, vMap := range cssMap {
		cssKV := vMap.(map[string]interface{})
		for k, v := range cssKV {
			customCSS[k] = v.(string)
		}
	}

	themePath := filepath.Join(util.ThemesPath, themeName)
	custom := filepath.Join(themePath, "custom.css")
	data, err := os.ReadFile(custom)
	if nil != err {
		util.LogErrorf("read custom css [%s] failed: %s", custom, err)
		return
	}

	cssData := gulu.Str.RemoveInvisible(string(data))
	customStyleSheet := css.Parse(cssData)

	buf := &bytes.Buffer{}
	customRules := customStyleSheet.CssRuleList
	for _, customRule := range customRules {
		if css.KEYFRAMES_RULE == customRule.Type {
			keyframes(customRule, buf)
			continue
		} else if css.STYLE_RULE != customRule.Type {
			buf.WriteString(customRule.Type.Text())
			buf.WriteString(customRule.Style.Text())
			buf.WriteString("\n\n")
			continue
		}

		for _, style := range customRule.Style.Styles {
			fixStyle(style)

			if val, ok := customCSS[style.Property]; ok {
				style.Value = css.NewCSSValue(val)
				delete(customCSS, style.Property)
			}
		}
		for k, v := range customCSS {
			customRule.Style.Styles = append(customRule.Style.Styles, &css.CSSStyleDeclaration{Property: k, Value: css.NewCSSValue(v)})
		}
		buf.WriteString(customRule.Style.Text())
		buf.WriteString("\n\n")
	}

	if err := gulu.File.WriteFileSafer(custom, buf.Bytes(), 0644); nil != err {
		util.LogErrorf("write custom css [%s] failed: %s", custom, err)
	}

	util.BroadcastByType("main", "refreshtheme", 0, "", map[string]interface{}{
		"theme": "/appearance/themes/" + themeName + "/custom.css?" + fmt.Sprintf("%d", time.Now().Unix()),
	})
	return
}

func keyframes(rule *css.CSSRule, buf *bytes.Buffer) {
	buf.WriteString(rule.Type.Text())
	buf.WriteString(" ")
	buf.WriteString(rule.Style.Selector.Text())
	buf.WriteString(" {\n")
	for _, r := range rule.Rules {
		buf.WriteString(r.Style.Text())
		buf.WriteString("\n")
	}
	buf.WriteString("\n\n")
}

func fixStyle(style *css.CSSStyleDeclaration) {
	// css 解析库似乎有 bug，这里做修正

	if strings.HasPrefix(style.Property, "-") && !strings.HasPrefix(style.Property, "--") {
		style.Property = "-" + style.Property
	}

	if strings.HasPrefix(style.Value.Text(), "- ") {
		value := style.Value.Text()[2:]
		style.Value = css.NewCSSValue(value)
	}
}
