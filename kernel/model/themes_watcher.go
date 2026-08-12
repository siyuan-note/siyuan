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

//go:build !darwin

package model

import (
	"errors"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/88250/gulu"
	"github.com/fsnotify/fsnotify"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var (
	themesWatcher       *fsnotify.Watcher
	themesWatcherMu     sync.Mutex
	themesWatchThemeDir string
)

func WatchThemes() {
	if util.IsMobileContainer() {
		return
	}

	themesWatcherMu.Lock()
	defer themesWatcherMu.Unlock()
	if nil != themesWatcher {
		updateThemesWatchThemeDir(themesWatcher)
		return
	}

	themesDir := util.ThemesPath
	w, err := fsnotify.NewWatcher()
	if err != nil {
		logging.LogErrorf("add themes watcher for folder [%s] failed: %s", themesDir, err)
		return
	}

	if !gulu.File.IsDir(themesDir) {
		os.MkdirAll(themesDir, 0755)
	}

	if err = w.Add(themesDir); err != nil {
		logging.LogErrorf("add themes root watcher for folder [%s] failed: %s", themesDir, err)
		w.Close()
		return
	}

	themesWatcher = w
	updateThemesWatchThemeDir(w)

	go func(w *fsnotify.Watcher) {
		defer logging.Recover()

		timer := time.NewTimer(time.Hour)
		if !timer.Stop() {
			<-timer.C
		}
		defer timer.Stop()
		var lastEvent fsnotify.Event

		for {
			select {
			case event, ok := <-w.Events:
				if !ok {
					return
				}

				if event.Op&fsnotify.Create == fsnotify.Create {
					addThemesWatchThemeDir(w, event.Name)
				}
				if event.Op&fsnotify.Write != fsnotify.Write {
					continue
				}

				lastEvent = event
				timer.Reset(time.Millisecond * 100)
			case err, ok := <-w.Errors:
				if !ok {
					return
				}
				logging.LogErrorf("watch themes failed: %s", err)
			case <-timer.C:
				handleThemesEvent(lastEvent)
			}
		}
	}(w)
}

func updateThemesWatchThemeDir(w *fsnotify.Watcher) {
	themeDir := currentThemeDir()
	if themeDir == themesWatchThemeDir {
		return
	}

	if "" != themeDir && gulu.File.IsDir(themeDir) {
		if err := w.Add(themeDir); err != nil {
			logging.LogWarnf("add themes watcher for folder [%s] failed: %s", themeDir, err)
		}
	}
	if "" != themesWatchThemeDir {
		if err := w.Remove(themesWatchThemeDir); err != nil && !errors.Is(err, fsnotify.ErrNonExistentWatch) {
			logging.LogWarnf("remove themes watcher for folder [%s] failed: %s", themesWatchThemeDir, err)
		}
	}
	themesWatchThemeDir = themeDir
}

func addThemesWatchThemeDir(w *fsnotify.Watcher, path string) {
	themesWatcherMu.Lock()
	defer themesWatcherMu.Unlock()
	if themesWatcher != w || filepath.Clean(path) != themesWatchThemeDir || !gulu.File.IsDir(path) {
		return
	}
	if err := w.Add(path); err != nil {
		logging.LogWarnf("add themes watcher for new folder [%s] failed: %s", path, err)
	}
}

func handleThemesEvent(event fsnotify.Event) {
	if event.Op&fsnotify.Write != fsnotify.Write {
		return
	}
	broadcastRefreshThemeIfCurrent(event.Name)
}

func CloseWatchThemes() {
	themesWatcherMu.Lock()
	w := themesWatcher
	themesWatcher = nil
	themesWatchThemeDir = ""
	themesWatcherMu.Unlock()

	if nil != w {
		w.Close()
	}
}
