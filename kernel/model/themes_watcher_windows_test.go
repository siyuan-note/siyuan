// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"path/filepath"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/internal/testutil"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestWatchThemesCurrentThemeJunction(t *testing.T) {
	themesDir := setupThemesWatchTest(t)
	link := filepath.Join(themesDir, "linked")
	target := t.TempDir()
	testutil.Junction(t, link, target)

	WatchThemes()
	assertThemesWatchList(t, themesDir, util.AppearancePackagePath("themes", "daylight"))

	Conf.m.Lock()
	Conf.Appearance.Load().ThemeLight = "linked"
	Conf.m.Unlock()
	WatchThemes()
	assertThemesWatchList(t, themesDir, link)

	Conf.m.Lock()
	Conf.Appearance.Load().ThemeLight = "created"
	Conf.m.Unlock()
	WatchThemes()
	assertThemesWatchList(t, themesDir)

	created := filepath.Join(themesDir, "created")
	testutil.Junction(t, created, target)
	addThemesWatchThemeDir(themesWatcher, created)
	assertThemesWatchList(t, themesDir, created)
}
