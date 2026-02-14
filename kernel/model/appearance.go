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
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/88250/gulu"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/bazaar"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func InitAppearance() {
	util.SetBootDetails("Initializing appearance...")
	if err := os.Mkdir(util.AppearancePath, 0755); err != nil && !os.IsExist(err) {
		logging.LogErrorf("create appearance folder [%s] failed: %s", util.AppearancePath, err)
		util.ReportFileSysFatalError(err)
		return
	}

	from := filepath.Join(util.WorkingDir, "appearance")
	if err := filelock.Copy(from, util.AppearancePath); err != nil {
		logging.LogErrorf("copy appearance resources from [%s] to [%s] failed: %s", from, util.AppearancePath, err)
		util.ReportFileSysFatalError(err)
		return
	}
	loadThemes()
	LoadIcons()

	Conf.m.Lock()
	if !containTheme(Conf.Appearance.ThemeDark, Conf.Appearance.DarkThemes) {
		Conf.Appearance.ThemeDark = "midnight"
		Conf.Appearance.ThemeJS = false
	}
	if !containTheme(Conf.Appearance.ThemeLight, Conf.Appearance.LightThemes) {
		Conf.Appearance.ThemeLight = "daylight"
		Conf.Appearance.ThemeJS = false
	}
	if !gulu.Str.Contains(Conf.Appearance.Icon, Conf.Appearance.Icons) {
		Conf.Appearance.Icon = "material"
	}
	Conf.m.Unlock()

	Conf.Save()

	util.InitEmojiChars()
}

func containTheme(name string, themes []*conf.AppearanceTheme) bool {
	for _, t := range themes {
		if t.Name == name {
			return true
		}
	}
	return false
}

func loadThemes() {
	themeDirs, err := os.ReadDir(util.ThemesPath)
	if err != nil {
		logging.LogErrorf("read appearance themes folder failed: %s", err)
		util.ReportFileSysFatalError(err)
		return
	}

	var darkThemes, lightThemes []*conf.AppearanceTheme
	var daylightTheme, midnightTheme *conf.AppearanceTheme
	var themeVer string
	var themeJS bool
	mode := Conf.Appearance.Mode
	themeLight := Conf.Appearance.ThemeLight
	themeDark := Conf.Appearance.ThemeDark

	for _, themeDir := range themeDirs {
		if !util.IsDirRegularOrSymlink(themeDir) {
			continue
		}
		name := themeDir.Name()
		themeConf, parseErr := bazaar.ParsePackageJSON(filepath.Join(util.ThemesPath, name, "theme.json"))
		if nil != parseErr || nil == themeConf {
			continue
		}

		var modes []string
		if nil != themeConf.Modes {
			modes = *themeConf.Modes
		}
		for _, mode := range modes {
			t := &conf.AppearanceTheme{Name: name}
			if isBuiltInTheme(name) {
				t.Label = name + Conf.Language(281)
			} else {
				t.Label = name
				if len(themeConf.DisplayName) > 0 {
					v := strings.TrimSpace(themeConf.DisplayName[util.Lang])
					if "" == v {
						v = strings.TrimSpace(themeConf.DisplayName["default"])
					}
					if "" != v && name != v {
						t.Label = v + " (" + name + ")"
					}
				}
			}

			if "midnight" == name {
				midnightTheme = t
				continue
			} else if "daylight" == name {
				daylightTheme = t
				continue
			}

			if "dark" == mode {
				darkThemes = append(darkThemes, t)
			} else if "light" == mode {
				lightThemes = append(lightThemes, t)
			}
		}

		if 0 == mode {
			if themeLight == name {
				themeVer = themeConf.Version
				themeJS = gulu.File.IsExist(filepath.Join(util.ThemesPath, name, "theme.js"))
			}
		} else {
			if themeDark == name {
				themeVer = themeConf.Version
				themeJS = gulu.File.IsExist(filepath.Join(util.ThemesPath, name, "theme.js"))
			}
		}
	}

	lightThemes = append([]*conf.AppearanceTheme{daylightTheme}, lightThemes...)
	darkThemes = append([]*conf.AppearanceTheme{midnightTheme}, darkThemes...)

	Conf.m.Lock()
	Conf.Appearance.DarkThemes = darkThemes
	Conf.Appearance.LightThemes = lightThemes
	Conf.Appearance.ThemeVer = themeVer
	Conf.Appearance.ThemeJS = themeJS
	Conf.m.Unlock()
}

func LoadIcons() {
	iconDirs, err := os.ReadDir(util.IconsPath)
	if err != nil {
		logging.LogErrorf("read appearance icons folder failed: %s", err)
		util.ReportFileSysFatalError(err)
		return
	}

	var icons []string
	var iconVer string
	currentIcon := Conf.Appearance.Icon

	for _, iconDir := range iconDirs {
		if !util.IsDirRegularOrSymlink(iconDir) {
			continue
		}
		name := iconDir.Name()
		iconConf, err := bazaar.ParsePackageJSON(filepath.Join(util.IconsPath, name, "icon.json"))
		if err != nil || nil == iconConf {
			continue
		}
		icons = append(icons, name)
		if currentIcon == name {
			iconVer = iconConf.Version
		}
	}

	Conf.m.Lock()
	Conf.Appearance.Icons = icons
	Conf.Appearance.IconVer = iconVer
	Conf.m.Unlock()
}

func isCurrentUseTheme(themePath string) string {
	themeName := filepath.Base(filepath.Dir(themePath))
	if 0 == Conf.Appearance.Mode { // 明亮
		if Conf.Appearance.ThemeLight == themeName {
			return themeName
		}
	} else if 1 == Conf.Appearance.Mode { // 暗黑
		if Conf.Appearance.ThemeDark == themeName {
			return themeName
		}
	}
	return ""
}

func broadcastRefreshThemeIfCurrent(themeCssPath string) {
	if !strings.HasSuffix(themeCssPath, "theme.css") {
		return
	}
	// 只处理主题根目录中的 theme.css
	themeDir := filepath.Clean(filepath.Dir(themeCssPath))
	themesRoot := filepath.Clean(util.ThemesPath)
	if themeDir != filepath.Join(themesRoot, filepath.Base(themeDir)) {
		return
	}
	themeName := isCurrentUseTheme(themeCssPath)
	if themeName == "" {
		return
	}
	util.BroadcastByType("main", "refreshtheme", 0, "", map[string]interface{}{
		"theme": "/appearance/themes/" + themeName + "/theme.css?" + fmt.Sprintf("%d", time.Now().Unix()),
	})
}
