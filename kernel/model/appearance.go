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
	"sync"
	"time"

	"github.com/88250/gulu"
	"github.com/fsnotify/fsnotify"
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

	unloadThemes()
	from := filepath.Join(util.WorkingDir, "appearance")
	if err := filelock.Copy(from, util.AppearancePath); err != nil {
		logging.LogErrorf("copy appearance resources from [%s] to [%s] failed: %s", from, util.AppearancePath, err)
		util.ReportFileSysFatalError(err)
		return
	}
	loadThemes()

	if !containTheme(Conf.Appearance.ThemeDark, Conf.Appearance.DarkThemes) {
		Conf.Appearance.ThemeDark = "midnight"
		Conf.Appearance.ThemeJS = false
	}
	if !containTheme(Conf.Appearance.ThemeLight, Conf.Appearance.LightThemes) {
		Conf.Appearance.ThemeLight = "daylight"
		Conf.Appearance.ThemeJS = false
	}

	loadIcons()
	if !gulu.Str.Contains(Conf.Appearance.Icon, Conf.Appearance.Icons) {
		Conf.Appearance.Icon = "material"
	}

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

var themeWatchers = sync.Map{} // [string]*fsnotify.Watcher{}

func closeThemeWatchers() {
	themeWatchers.Range(func(key, value interface{}) bool {
		if err := value.(*fsnotify.Watcher).Close(); err != nil {
			logging.LogErrorf("close file watcher failed: %s", err)
		}
		return true
	})
}

func unloadThemes() {
	if !util.IsPathRegularDirOrSymlinkDir(util.ThemesPath) {
		return
	}

	themeDirs, err := os.ReadDir(util.ThemesPath)
	if err != nil {
		logging.LogErrorf("read appearance themes folder failed: %s", err)
		return
	}

	for _, themeDir := range themeDirs {
		if !util.IsDirRegularOrSymlink(themeDir) {
			continue
		}
		unwatchTheme(filepath.Join(util.ThemesPath, themeDir.Name()))
	}
}

func loadThemes() {
	themeDirs, err := os.ReadDir(util.ThemesPath)
	if err != nil {
		logging.LogErrorf("read appearance themes folder failed: %s", err)
		util.ReportFileSysFatalError(err)
		return
	}

	Conf.Appearance.DarkThemes = nil
	Conf.Appearance.LightThemes = nil
	var daylightTheme, midnightTheme *conf.AppearanceTheme
	for _, themeDir := range themeDirs {
		if !util.IsDirRegularOrSymlink(themeDir) {
			continue
		}
		name := themeDir.Name()
		themeConf, parseErr := bazaar.ThemeJSON(name)
		if nil != parseErr || nil == themeConf {
			continue
		}

		modes := themeConf.Modes
		for _, mode := range modes {
			t := &conf.AppearanceTheme{Name: name}
			if "zh_CN" == util.Lang {
				if "midnight" == name {
					t.Label = name + "（默认主题）"
				} else if "daylight" == name {
					t.Label = name + "（默认主题）"
				} else {
					if nil != themeConf.DisplayName && "" != themeConf.DisplayName.ZhCN && name != themeConf.DisplayName.ZhCN {
						t.Label = themeConf.DisplayName.ZhCN + "（" + name + "）"
					} else {
						t.Label = name
					}
				}
			} else {
				if "midnight" == name {
					t.Label = name + " (Default)"
				} else if "daylight" == name {
					t.Label = name + " (Default)"
				} else {
					t.Label = name
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
				Conf.Appearance.DarkThemes = append(Conf.Appearance.DarkThemes, t)
			} else if "light" == mode {
				Conf.Appearance.LightThemes = append(Conf.Appearance.LightThemes, t)
			}
		}

		if 0 == Conf.Appearance.Mode {
			if Conf.Appearance.ThemeLight == name {
				Conf.Appearance.ThemeVer = themeConf.Version
				Conf.Appearance.ThemeJS = gulu.File.IsExist(filepath.Join(util.ThemesPath, name, "theme.js"))
			}
		} else {
			if Conf.Appearance.ThemeDark == name {
				Conf.Appearance.ThemeVer = themeConf.Version
				Conf.Appearance.ThemeJS = gulu.File.IsExist(filepath.Join(util.ThemesPath, name, "theme.js"))
			}
		}

		go watchTheme(filepath.Join(util.ThemesPath, name))
	}

	Conf.Appearance.LightThemes = append([]*conf.AppearanceTheme{daylightTheme}, Conf.Appearance.LightThemes...)
	Conf.Appearance.DarkThemes = append([]*conf.AppearanceTheme{midnightTheme}, Conf.Appearance.DarkThemes...)
}

func loadIcons() {
	iconDirs, err := os.ReadDir(util.IconsPath)
	if err != nil {
		logging.LogErrorf("read appearance icons folder failed: %s", err)
		util.ReportFileSysFatalError(err)
		return
	}

	Conf.Appearance.Icons = nil
	for _, iconDir := range iconDirs {
		if !util.IsDirRegularOrSymlink(iconDir) {
			continue
		}
		name := iconDir.Name()
		iconConf, err := bazaar.IconJSON(name)
		if err != nil || nil == iconConf {
			continue
		}
		Conf.Appearance.Icons = append(Conf.Appearance.Icons, name)
		if Conf.Appearance.Icon == name {
			Conf.Appearance.IconVer = iconConf.Version
		}
	}
}

func ReloadIcon() {
	loadIcons()
}

func unwatchTheme(folder string) {
	val, _ := themeWatchers.Load(folder)
	if nil != val {
		themeWatcher := val.(*fsnotify.Watcher)
		themeWatcher.Close()
	}
}

func watchTheme(folder string) {
	val, _ := themeWatchers.Load(folder)
	var themeWatcher *fsnotify.Watcher
	if nil != val {
		themeWatcher = val.(*fsnotify.Watcher)
		themeWatcher.Close()
	}

	var err error
	if themeWatcher, err = fsnotify.NewWatcher(); err != nil {
		logging.LogErrorf("add theme file watcher for folder [%s] failed: %s", folder, err)
		return
	}
	themeWatchers.Store(folder, themeWatcher)

	done := make(chan bool)
	go func() {
		for {
			select {
			case event, ok := <-themeWatcher.Events:
				if !ok {
					return
				}

				//logging.LogInfof(event.String())
				if event.Op&fsnotify.Write == fsnotify.Write && (strings.HasSuffix(event.Name, "theme.css")) {
					var themeName string
					if themeName = isCurrentUseTheme(event.Name); "" == themeName {
						break
					}

					if strings.HasSuffix(event.Name, "theme.css") {
						util.BroadcastByType("main", "refreshtheme", 0, "", map[string]interface{}{
							"theme": "/appearance/themes/" + themeName + "/theme.css?" + fmt.Sprintf("%d", time.Now().Unix()),
						})
						break
					}
				}
			case err, ok := <-themeWatcher.Errors:
				if !ok {
					return
				}
				logging.LogErrorf("watch theme file failed: %s", err)
			}
		}
	}()

	//logging.LogInfof("add file watcher [%s]", folder)
	if err := themeWatcher.Add(folder); err != nil {
		logging.LogErrorf("add theme files watcher for folder [%s] failed: %s", folder, err)
	}
	<-done
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
