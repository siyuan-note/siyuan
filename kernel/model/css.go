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
	"github.com/88250/css"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
	"os"
	"path/filepath"
	"strings"
)

func currentCSSValue(key string) string {
	var themeName string
	if 0 == Conf.Appearance.Mode {
		themeName = Conf.Appearance.ThemeLight
	} else {
		themeName = Conf.Appearance.ThemeDark
	}

	themePath := filepath.Join(util.ThemesPath, themeName)
	theme := filepath.Join(themePath, "theme.css")

	data, err := os.ReadFile(theme)
	if nil != err {
		logging.LogErrorf("read theme css [%s] failed: %s", theme, err)
		return "#ffffff"
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
