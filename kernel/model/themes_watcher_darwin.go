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

//go:build darwin

package model

import (
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/88250/gulu"
	"github.com/radovskyb/watcher"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var themesWatcher *watcher.Watcher

func WatchThemes() {
	go watchThemes()
}

func watchThemes() {
	CloseWatchThemes()
	themesDir := util.ThemesPath

	themesWatcher = watcher.New()

	if !gulu.File.IsDir(themesDir) {
		os.MkdirAll(themesDir, 0755)
	}

	if err := themesWatcher.Add(themesDir); err != nil {
		logging.LogErrorf("add themes watcher for folder [%s] failed: %s", themesDir, err)
		return
	}

	// 为每个子目录添加监听，以便收到 theme.css 的变更
	addThemesSubdirsDarwin(themesWatcher, themesDir)

	go func() {
		defer logging.Recover()

		for {
			select {
			case event, ok := <-themesWatcher.Event:
				if !ok {
					return
				}

				// 新目录创建时加入监听
				if watcher.Create == event.Op {
					if isThemesDirectSubdirDarwin(event.Path) {
						if addErr := themesWatcher.Add(event.Path); addErr != nil {
							logging.LogWarnf("add themes watcher for new folder [%s] failed: %s", event.Path, addErr)
						}
					}
				}

				handleThemesEventDarwin(event)
			case err, ok := <-themesWatcher.Error:
				if !ok {
					return
				}
				logging.LogErrorf("watch themes failed: %s", err)
			case <-themesWatcher.Closed:
				return
			}
		}
	}()

	if err := themesWatcher.Start(10 * time.Second); err != nil {
		logging.LogErrorf("start themes watcher for folder [%s] failed: %s", themesDir, err)
		return
	}
}

// addThemesSubdirsDarwin 为 themes 下每个子目录添加监听（Darwin 版）
func addThemesSubdirsDarwin(w *watcher.Watcher, themesDir string) {
	entries, err := os.ReadDir(themesDir)
	if err != nil {
		logging.LogErrorf("read themes folder failed: %s", err)
		return
	}
	for _, e := range entries {
		if !util.IsDirRegularOrSymlink(e) {
			continue
		}
		subdir := filepath.Join(themesDir, e.Name())
		if addErr := w.Add(subdir); addErr != nil {
			logging.LogWarnf("add themes watcher for folder [%s] failed: %s", subdir, addErr)
		}
	}
}

// isThemesDirectSubdirDarwin 判断 path 是否为 themes 下的直接子目录（Darwin 版）
func isThemesDirectSubdirDarwin(path string) bool {
	if !gulu.File.IsDir(path) {
		return false
	}
	rel, err := filepath.Rel(util.ThemesPath, path)
	if err != nil {
		return false
	}
	if filepath.Base(path) != rel {
		return false
	}
	entries, err := os.ReadDir(util.ThemesPath)
	if err != nil {
		return false
	}
	name := filepath.Base(path)
	for _, e := range entries {
		if e.Name() == name {
			return util.IsDirRegularOrSymlink(e)
		}
	}
	return false
}

func handleThemesEventDarwin(event watcher.Event) {
	if watcher.Write != event.Op {
		return
	}
	if !strings.HasSuffix(event.Path, "theme.css") {
		return
	}
	broadcastRefreshThemeIfCurrent(event.Path)
}

func CloseWatchThemes() {
	if nil != themesWatcher {
		themesWatcher.Close()
		themesWatcher = nil
	}
}
