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
	util.SetBootDetails(Conf.Language(302))
	if err := MigrateAppearancePackages(); err != nil {
		logging.LogErrorf("migrate appearance packages failed: %s", err)
		util.ReportFileSysFatalError(err)
		return
	}
	if err := os.Mkdir(util.AppearancePath, 0755); err != nil && !os.IsExist(err) {
		logging.LogErrorf("create appearance folder [%s] failed: %s", util.AppearancePath, err)
		util.ReportFileSysFatalError(err)
		return
	}

	from := filepath.Join(util.WorkingDir, "appearance")
	if err := filelock.CopyWritable(from, util.AppearancePath); err != nil {
		logging.LogErrorf("copy appearance resources from [%s] to [%s] failed: %s", from, util.AppearancePath, err)
		util.ReportFileSysFatalError(err)
		return
	}

	if err := util.CleanupLegacyFonts(util.AppearancePath); err != nil {
		logging.LogWarnf("clean up legacy fonts failed: %s", err)
	}

	refreshAppearanceConfig()
	util.InitEmojiChars()
}

// refreshAppearanceConfig 按完整可用的包刷新本机外观选择，缺失或不兼容时使用内置资源。
func refreshAppearanceConfig() {
	LoadThemes()
	LoadIcons()

	var reloadThemes, reloadIcons bool
	Conf.m.Lock()
	if !containTheme(Conf.Appearance.ThemeDark, Conf.Appearance.DarkThemes) {
		Conf.Appearance.ThemeDark = "midnight"
		reloadThemes = true
	}
	if !containTheme(Conf.Appearance.ThemeLight, Conf.Appearance.LightThemes) {
		Conf.Appearance.ThemeLight = "daylight"
		reloadThemes = true
	}
	if !containIcon(Conf.Appearance.Icon, Conf.Appearance.Icons) {
		Conf.Appearance.Icon = "litheness"
		reloadIcons = true
	}
	Conf.m.Unlock()
	if reloadThemes {
		LoadThemes()
	}
	if reloadIcons {
		LoadIcons()
	}
	Conf.Save()
}

func SetIcon(icon string) error {
	Conf.m.Lock()
	defer Conf.m.Unlock()

	if !containIcon(icon, Conf.Appearance.Icons) {
		return fmt.Errorf("icon [%s] not exists or not available", icon)
	}
	Conf.Appearance.Icon = icon
	return nil
}

func SetTheme(theme string, modes []int, appearanceMode string) error {
	Conf.m.Lock()
	defer Conf.m.Unlock()

	if theme != "" {
		for _, mode := range modes {
			switch mode {
			case 0:
				if !containTheme(theme, Conf.Appearance.LightThemes) {
					return fmt.Errorf("theme [%s] not exists or not available for light mode", theme)
				}
				Conf.Appearance.ThemeLight = theme
			case 1:
				if !containTheme(theme, Conf.Appearance.DarkThemes) {
					return fmt.Errorf("theme [%s] not exists or not available for dark mode", theme)
				}
				Conf.Appearance.ThemeDark = theme
			}
		}
	}

	if appearanceMode != "" {
		switch appearanceMode {
		case "light":
			Conf.Appearance.ModeOS = false
			Conf.Appearance.Mode = 0
		case "dark":
			Conf.Appearance.ModeOS = false
			Conf.Appearance.Mode = 1
		case "system":
			Conf.Appearance.ModeOS = true
		default:
			return fmt.Errorf("invalid appearance mode: %s", appearanceMode)
		}
	}
	return nil
}

func containTheme(name string, themes []*conf.AppearanceTheme) bool {
	for _, t := range themes {
		if t != nil && t.Name == name {
			return true
		}
	}
	return false
}

func containIcon(name string, icons []*conf.AppearanceIcon) bool {
	for _, i := range icons {
		if i != nil && i.Name == name {
			return true
		}
	}
	return false
}

// appearancePackageNames 保留内置包，并从数据目录读取第三方包，避免同名包覆盖内置资源。
func appearancePackageNames(kind string) ([]string, error) {
	root, names := util.ThemesPath, []string{"daylight", "midnight"}
	if kind == "icons" {
		root, names = util.IconsPath, []string{"litheness"}
	}
	dirs, err := os.ReadDir(root)
	if os.IsNotExist(err) {
		return names, nil
	}
	if err != nil {
		return nil, err
	}
	for _, dir := range dirs {
		name := dir.Name()
		if !util.IsDirRegularOrSymlink(dir) || !bazaar.IsValidPackageName(name) ||
			(kind == "themes" && isBuiltInTheme(name)) || (kind == "icons" && isBuiltInIcon(name)) {
			continue
		}
		names = append(names, name)
	}
	return names, nil
}

func LoadThemes() {
	themeNames, err := appearancePackageNames("themes")
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
	for _, name := range themeNames {
		themePath := util.AppearancePackagePath("themes", name)
		themeConf, parseErr := bazaar.ParsePackageJSON(filepath.Join(themePath, "theme.json"))
		if nil != parseErr || !bazaar.IsValidInstalledPackage(themeConf, name) ||
			bazaar.IsBelowRequiredAppVersion(themeConf) || !gulu.File.IsExist(filepath.Join(themePath, "theme.css")) {
			continue
		}

		var modes []string
		if nil != themeConf.Modes {
			modes = *themeConf.Modes
		}
		for _, mode := range modes {
			t := &conf.AppearanceTheme{Name: name, Frontends: themeConf.Frontends}
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
				themeJS = gulu.File.IsExist(filepath.Join(themePath, "theme.js"))
			}
		} else {
			if themeDark == name {
				themeVer = themeConf.Version
				themeJS = gulu.File.IsExist(filepath.Join(themePath, "theme.js"))
			}
		}
	}

	if daylightTheme != nil {
		lightThemes = append([]*conf.AppearanceTheme{daylightTheme}, lightThemes...)
	}
	if midnightTheme != nil {
		darkThemes = append([]*conf.AppearanceTheme{midnightTheme}, darkThemes...)
	}

	Conf.m.Lock()
	Conf.Appearance.DarkThemes = darkThemes
	Conf.Appearance.LightThemes = lightThemes
	Conf.Appearance.ThemeVer = themeVer
	Conf.Appearance.ThemeJS = themeJS
	Conf.m.Unlock()
}

func LoadIcons() {
	iconNames, err := appearancePackageNames("icons")
	if err != nil {
		logging.LogErrorf("read appearance icons folder failed: %s", err)
		util.ReportFileSysFatalError(err)
		return
	}

	var icons []*conf.AppearanceIcon
	var iconVer string
	currentIcon := Conf.Appearance.Icon
	for _, name := range iconNames {
		iconPath := util.AppearancePackagePath("icons", name)
		iconConf, err := bazaar.ParsePackageJSON(filepath.Join(iconPath, "icon.json"))
		if err != nil || !bazaar.IsValidInstalledPackage(iconConf, name) ||
			bazaar.IsBelowRequiredAppVersion(iconConf) || !gulu.File.IsExist(filepath.Join(iconPath, "icon.js")) {
			continue
		}
		t := &conf.AppearanceIcon{Name: name}
		if isBuiltInIcon(name) {
			t.Label = name + Conf.Language(288)
		} else {
			t.Label = name
			if len(iconConf.DisplayName) > 0 {
				v := strings.TrimSpace(iconConf.DisplayName[util.Lang])
				if "" == v {
					v = strings.TrimSpace(iconConf.DisplayName["default"])
				}
				if "" != v && name != v {
					t.Label = v + " (" + name + ")"
				}
			}
		}
		icons = append(icons, t)
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

func currentThemeDir() string {
	if nil == Conf {
		return ""
	}

	Conf.m.RLock()
	defer Conf.m.RUnlock()
	if nil == Conf.Appearance {
		return ""
	}

	var themeName string
	switch Conf.Appearance.Mode {
	case 0:
		themeName = Conf.Appearance.ThemeLight
	case 1:
		themeName = Conf.Appearance.ThemeDark
	default:
		return ""
	}
	if "" == themeName || "." == themeName || ".." == themeName || filepath.Base(themeName) != themeName {
		return ""
	}
	return util.AppearancePackagePath("themes", themeName)
}

func broadcastRefreshThemeIfCurrent(themeCssPath string) {
	if !strings.HasSuffix(themeCssPath, "theme.css") {
		return
	}
	// 只处理主题根目录中的 theme.css
	themeDir := filepath.Clean(filepath.Dir(themeCssPath))
	if themeDir != util.AppearancePackagePath("themes", filepath.Base(themeDir)) {
		return
	}
	themeName := isCurrentUseTheme(themeCssPath)
	if themeName == "" {
		return
	}
	util.BroadcastByType("main", "refreshtheme", 0, "", map[string]any{
		"theme": "/appearance/themes/" + themeName + "/theme.css?" + fmt.Sprintf("%d", time.Now().Unix()),
	})
}
