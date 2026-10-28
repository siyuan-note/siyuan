// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build darwin

package model

import (
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/88250/gulu"
	"github.com/radovskyb/watcher"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var (
	themesWatcher       *watcher.Watcher
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
	w := watcher.New()

	if !gulu.File.IsDir(themesDir) {
		os.MkdirAll(themesDir, 0755)
	}

	if err := w.Add(themesDir); err != nil {
		logging.LogErrorf("add themes watcher for folder [%s] failed: %s", themesDir, err)
		return
	}

	themesWatcher = w
	updateThemesWatchThemeDir(w)

	go func(w *watcher.Watcher) {
		defer logging.Recover()

		for {
			select {
			case event, ok := <-w.Event:
				if !ok {
					return
				}

				if watcher.Create == event.Op {
					addThemesWatchThemeDir(w, event.Path)
				}

				handleThemesEvent(event)
			case err, ok := <-w.Error:
				if !ok {
					return
				}
				logging.LogErrorf("watch themes failed: %s", err)
			case <-w.Closed:
				return
			}
		}
	}(w)

	go func() {
		if err := w.Start(10 * time.Second); err != nil {
			logging.LogErrorf("start themes watcher for folder [%s] failed: %s", themesDir, err)
		}
	}()
	w.Wait()
}

func updateThemesWatchThemeDir(w *watcher.Watcher) {
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
		if err := w.Remove(themesWatchThemeDir); err != nil {
			logging.LogWarnf("remove themes watcher for folder [%s] failed: %s", themesWatchThemeDir, err)
		}
	}
	themesWatchThemeDir = themeDir
}

func addThemesWatchThemeDir(w *watcher.Watcher, path string) {
	themesWatcherMu.Lock()
	defer themesWatcherMu.Unlock()
	if themesWatcher != w || filepath.Clean(path) != themesWatchThemeDir || !gulu.File.IsDir(path) {
		return
	}
	if err := w.Add(path); err != nil {
		logging.LogWarnf("add themes watcher for new folder [%s] failed: %s", path, err)
	}
}

func handleThemesEvent(event watcher.Event) {
	if watcher.Write != event.Op {
		return
	}
	if !strings.HasSuffix(event.Path, "theme.css") {
		return
	}
	broadcastRefreshThemeIfCurrent(event.Path)
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
