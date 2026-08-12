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
	"os"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestWatchThemesCurrentThemeOnly(t *testing.T) {
	originalConf, originalThemesPath := Conf, util.ThemesPath
	t.Cleanup(func() {
		CloseWatchThemes()
		Conf = originalConf
		util.ThemesPath = originalThemesPath
	})

	themesDir := t.TempDir()
	for _, name := range []string{"daylight", "midnight", "unused"} {
		if err := os.Mkdir(filepath.Join(themesDir, name), 0755); err != nil {
			t.Fatal(err)
		}
	}
	Conf = NewAppConf()
	Conf.Appearance = conf.NewAppearance()
	util.ThemesPath = themesDir

	WatchThemes()
	assertThemesWatchList(t, themesDir, filepath.Join(themesDir, "daylight"))

	Conf.m.Lock()
	Conf.Appearance.Mode = 1
	Conf.m.Unlock()
	WatchThemes()
	assertThemesWatchList(t, themesDir, filepath.Join(themesDir, "midnight"))

	Conf.m.Lock()
	Conf.Appearance.Mode = -1
	Conf.m.Unlock()
	WatchThemes()
	assertThemesWatchList(t, themesDir)

	Conf.m.Lock()
	Conf.Appearance.Mode = 0
	Conf.Appearance.ThemeLight = ".."
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
