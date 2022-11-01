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
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/88250/gulu"
	"github.com/fsnotify/fsnotify"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/bazaar"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func InitAppearance() {
	util.SetBootDetails("Initializing appearance...")
	if err := os.Mkdir(util.AppearancePath, 0755); nil != err && !os.IsExist(err) {
		logging.LogFatalf("create appearance folder [%s] failed: %s", util.AppearancePath, err)
	}

	unloadThemes()
	from := filepath.Join(util.WorkingDir, "appearance")
	if err := gulu.File.Copy(from, util.AppearancePath); nil != err {
		logging.LogFatalf("copy appearance resources from [%s] to [%s] failed: %s", from, util.AppearancePath, err)
	}
	loadThemes()

	if !gulu.Str.Contains(Conf.Appearance.ThemeDark, Conf.Appearance.DarkThemes) {
		Conf.Appearance.ThemeDark = "midnight"
		Conf.Appearance.ThemeJS = false
	}
	if !gulu.Str.Contains(Conf.Appearance.ThemeLight, Conf.Appearance.LightThemes) {
		Conf.Appearance.ThemeLight = "daylight"
		Conf.Appearance.ThemeJS = false
	}

	loadIcons()
	if !gulu.Str.Contains(Conf.Appearance.Icon, Conf.Appearance.Icons) {
		Conf.Appearance.Icon = "material"
	}

	Conf.Save()
}

var themeWatchers = sync.Map{} // [string]*fsnotify.Watcher{}

func closeThemeWatchers() {
	themeWatchers.Range(func(key, value interface{}) bool {
		if err := value.(*fsnotify.Watcher).Close(); nil != err {
			logging.LogErrorf("close file watcher failed: %s", err)
		}
		return true
	})
}

func unloadThemes() {
	if !gulu.File.IsDir(util.ThemesPath) {
		return
	}

	themeDirs, err := os.ReadDir(util.ThemesPath)
	if nil != err {
		logging.LogErrorf("read appearance themes folder failed: %s", err)
		return
	}

	for _, themeDir := range themeDirs {
		if !themeDir.IsDir() {
			continue
		}
		unwatchTheme(filepath.Join(util.ThemesPath, themeDir.Name()))
	}
}

func loadThemes() {
	themeDirs, err := os.ReadDir(util.ThemesPath)
	if nil != err {
		logging.LogFatalf("read appearance themes folder failed: %s", err)
	}

	Conf.Appearance.DarkThemes = nil
	Conf.Appearance.LightThemes = nil
	for _, themeDir := range themeDirs {
		if !themeDir.IsDir() {
			continue
		}
		name := themeDir.Name()
		themeConf, parseErr := bazaar.ThemeJSON(name)
		if nil != parseErr || nil == themeConf {
			continue
		}

		modes := themeConf["modes"].([]interface{})
		for _, mode := range modes {
			if "dark" == mode {
				Conf.Appearance.DarkThemes = append(Conf.Appearance.DarkThemes, name)
			} else if "light" == mode {
				Conf.Appearance.LightThemes = append(Conf.Appearance.LightThemes, name)
			}
		}

		if 0 == Conf.Appearance.Mode {
			if Conf.Appearance.ThemeLight == name {
				Conf.Appearance.ThemeVer = themeConf["version"].(string)
				Conf.Appearance.ThemeJS = gulu.File.IsExist(filepath.Join(util.ThemesPath, name, "theme.js"))
			}
		} else {
			if Conf.Appearance.ThemeDark == name {
				Conf.Appearance.ThemeVer = themeConf["version"].(string)
				Conf.Appearance.ThemeJS = gulu.File.IsExist(filepath.Join(util.ThemesPath, name, "theme.js"))
			}
		}

		go watchTheme(filepath.Join(util.ThemesPath, name))
	}
}

func iconJSON(iconName string) (ret map[string]interface{}, err error) {
	p := filepath.Join(util.IconsPath, iconName, "icon.json")
	if !gulu.File.IsExist(p) {
		err = os.ErrNotExist
		return
	}
	data, err := os.ReadFile(p)
	if nil != err {
		logging.LogErrorf("read icon.json [%s] failed: %s", p, err)
		return
	}
	if err = gulu.JSON.UnmarshalJSON(data, &ret); nil != err {
		logging.LogErrorf("parse icon.json [%s] failed: %s", p, err)
		return
	}
	if 4 > len(ret) {
		logging.LogWarnf("invalid icon.json [%s]", p)
		return nil, errors.New("invalid icon.json")
	}
	return
}

func templateJSON(templateName string) (ret map[string]interface{}, err error) {
	p := filepath.Join(util.DataDir, "templates", templateName, "template.json")
	if !gulu.File.IsExist(p) {
		err = os.ErrNotExist
		return
	}
	data, err := os.ReadFile(p)
	if nil != err {
		logging.LogErrorf("read template.json [%s] failed: %s", p, err)
		return
	}
	if err = gulu.JSON.UnmarshalJSON(data, &ret); nil != err {
		logging.LogErrorf("parse template.json [%s] failed: %s", p, err)
		return
	}
	if 4 > len(ret) {
		logging.LogWarnf("invalid template.json [%s]", p)
		return nil, errors.New("invalid template.json")
	}
	return
}

func widgetJSON(widgetName string) (ret map[string]interface{}, err error) {
	p := filepath.Join(util.DataDir, "widgets", widgetName, "widget.json")
	if !gulu.File.IsExist(p) {
		err = os.ErrNotExist
		return
	}
	data, err := os.ReadFile(p)
	if nil != err {
		logging.LogErrorf("read widget.json [%s] failed: %s", p, err)
		return
	}
	if err = gulu.JSON.UnmarshalJSON(data, &ret); nil != err {
		logging.LogErrorf("parse widget.json [%s] failed: %s", p, err)
		return
	}
	if 4 > len(ret) {
		logging.LogWarnf("invalid widget.json [%s]", p)
		return nil, errors.New("invalid widget.json")
	}
	return
}

func loadIcons() {
	iconDirs, err := os.ReadDir(util.IconsPath)
	if nil != err {
		logging.LogFatalf("read appearance icons folder failed: %s", err)
	}

	Conf.Appearance.Icons = nil
	for _, iconDir := range iconDirs {
		if !iconDir.IsDir() {
			continue
		}
		name := iconDir.Name()
		iconConf, err := iconJSON(name)
		if nil != err || nil == iconConf {
			continue
		}
		Conf.Appearance.Icons = append(Conf.Appearance.Icons, name)
		if Conf.Appearance.Icon == name {
			Conf.Appearance.IconVer = iconConf["version"].(string)
		}
	}
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
	if themeWatcher, err = fsnotify.NewWatcher(); nil != err {
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
				if event.Op&fsnotify.Write == fsnotify.Write &&
					(strings.HasSuffix(event.Name, "theme.css") || strings.HasSuffix(event.Name, "custom.css")) {
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

					if strings.HasSuffix(event.Name, "custom.css") {
						util.BroadcastByType("main", "refreshtheme", 0, "", map[string]interface{}{
							"theme": "/appearance/themes/" + themeName + "/custom.css?" + fmt.Sprintf("%d", time.Now().Unix()),
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
