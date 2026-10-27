// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build !darwin

package model

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestWatchThemesCurrentThemeOnly(t *testing.T) {
	originalConf, originalThemesPath := Conf, util.ThemesPath
	originalAppearancePath, originalMode := util.AppearancePath, util.Mode
	CloseWatchThemes()
	t.Cleanup(func() {
		CloseWatchThemes()
		Conf = originalConf
		util.ThemesPath = originalThemesPath
		util.AppearancePath, util.Mode = originalAppearancePath, originalMode
	})

	themesDir := t.TempDir()
	util.ThemesPath = themesDir
	util.AppearancePath, util.Mode = t.TempDir(), "prod"
	for _, name := range []string{"daylight", "midnight", "unused"} {
		if err := os.MkdirAll(util.AppearancePackagePath("themes", name), 0755); err != nil {
			t.Fatal(err)
		}
	}
	Conf = NewAppConf()
	Conf.Appearance.Store(conf.NewAppearance())

	WatchThemes()
	assertThemesWatchList(t, themesDir, util.AppearancePackagePath("themes", "daylight"))

	Conf.m.Lock()
	Conf.Appearance.Load().Mode = 1
	Conf.m.Unlock()
	WatchThemes()
	assertThemesWatchList(t, themesDir, util.AppearancePackagePath("themes", "midnight"))

	Conf.m.Lock()
	Conf.Appearance.Load().ThemeDark = "unused"
	Conf.m.Unlock()
	WatchThemes()
	assertThemesWatchList(t, themesDir, filepath.Join(themesDir, "unused"))

	Conf.m.Lock()
	Conf.Appearance.Load().Mode = -1
	Conf.m.Unlock()
	WatchThemes()
	assertThemesWatchList(t, themesDir)

	Conf.m.Lock()
	Conf.Appearance.Load().Mode = 0
	Conf.Appearance.Load().ThemeLight = ".."
	Conf.m.Unlock()
	WatchThemes()
	assertThemesWatchList(t, themesDir)
}

func assertThemesWatchList(t *testing.T, expected ...string) {
	t.Helper()
	if nil == themesWatcher {
		t.Fatal("themes watcher is not initialized")
	}
	actual := map[string]bool{}
	for _, path := range themesWatcher.WatchList() {
		actual[filepath.Clean(path)] = true
	}
	if len(actual) != len(expected) {
		t.Fatalf("unexpected themes watch list: %v", actual)
	}
	for _, path := range expected {
		if !actual[filepath.Clean(path)] {
			t.Fatalf("themes watcher does not contain [%s]: %v", path, actual)
		}
	}
}
