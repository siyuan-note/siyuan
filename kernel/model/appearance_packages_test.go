// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package model

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func setupAppearancePackagesTest(t *testing.T) {
	t.Helper()
	oldAppearance, oldThemes, oldIcons, oldMode, oldConf := util.AppearancePath, util.ThemesPath, util.IconsPath, util.Mode, Conf
	oldDataDir := util.DataDir
	oldConfDir := util.ConfDir
	oldRepoDir := util.RepoDir
	t.Cleanup(func() {
		util.AppearancePath, util.ThemesPath, util.IconsPath, util.Mode, Conf = oldAppearance, oldThemes, oldIcons, oldMode, oldConf
		util.DataDir = oldDataDir
		util.ConfDir = oldConfDir
		util.RepoDir = oldRepoDir
	})
	root := t.TempDir()
	util.AppearancePath = filepath.Join(root, "conf", "appearance")
	util.ConfDir = filepath.Join(root, "conf")
	util.RepoDir = filepath.Join(root, "repo")
	util.DataDir = filepath.Join(root, "data")
	util.ThemesPath, util.IconsPath = filepath.Join(root, "data", "themes"), filepath.Join(root, "data", "icons")
	util.Mode = "prod"
	Conf = NewAppConf()
	Conf.Appearance.Store(conf.NewAppearance())
	for _, name := range []string{"daylight", "midnight", "custom"} {
		writeAppearanceTestPackage(t, "themes", name, "1.0.0", "")
	}
	for _, name := range []string{"litheness", "custom"} {
		writeAppearanceTestPackage(t, "icons", name, "1.0.0", "")
	}
	writeAppearanceTestEmojiFont(t)
}

func writeAppearanceTestEmojiFont(t *testing.T) {
	t.Helper()
	writeAppearanceTestFile(t, filepath.Join(util.AppearancePath, "fonts", "Noto-COLRv1-2.051", "Noto-COLRv1.woff2"), "emoji font")
	writeAppearanceTestFile(t, filepath.Join(util.AppearancePath, "fonts", "Noto-COLRv1-2.051", "LICENSE"), "emoji license")
}

func writeAppearanceTestFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}
}

func writeAppearanceTestPackage(t *testing.T, kind, name, version, minVersion string) {
	t.Helper()
	manifest, entry := "theme.json", "theme.css"
	if kind == "icons" {
		manifest, entry = "icon.json", "icon.js"
	}
	data, err := json.Marshal(map[string]any{
		"name": name, "version": version, "minAppVersion": minVersion, "modes": []string{"light", "dark"},
	})
	if err != nil {
		t.Fatal(err)
	}
	root := util.AppearancePackagePath(kind, name)
	writeAppearanceTestFile(t, filepath.Join(root, manifest), string(data))
	writeAppearanceTestFile(t, filepath.Join(root, entry), "resource "+name)
}

func TestLoadAppearancePackagesPreservesBuiltInsAndChecksVersion(t *testing.T) {
	setupAppearancePackagesTest(t)
	writeAppearanceTestPackage(t, "themes", "future", "2.0.0", "999.0.0")
	writeAppearanceTestPackage(t, "icons", "future", "2.0.0", "999.0.0")
	writeAppearanceTestFile(t, filepath.Join(util.ThemesPath, "daylight", "theme.json"), `{"name":"daylight","version":"99.0.0"}`)
	writeAppearanceTestFile(t, filepath.Join(util.IconsPath, "litheness", "icon.json"), `{"name":"litheness","version":"99.0.0"}`)
	Conf.Appearance.Load().ThemeLight, Conf.Appearance.Load().Icon = "custom", "custom"
	LoadThemes()
	LoadIcons()
	if !containTheme("daylight", Conf.Appearance.Load().LightThemes) || !containTheme("midnight", Conf.Appearance.Load().DarkThemes) ||
		!containIcon("litheness", Conf.Appearance.Load().Icons) {
		t.Fatal("built-in packages were not retained")
	}
	if !containTheme("custom", Conf.Appearance.Load().LightThemes) || !containIcon("custom", Conf.Appearance.Load().Icons) {
		t.Fatal("data packages were not loaded")
	}
	if containTheme("future", Conf.Appearance.Load().LightThemes) || containIcon("future", Conf.Appearance.Load().Icons) {
		t.Fatal("packages requiring a newer application were loaded")
	}
	if Conf.Appearance.Load().ThemeLight != "custom" || Conf.Appearance.Load().Icon != "custom" ||
		Conf.Appearance.Load().ThemeVer != "1.0.0" || Conf.Appearance.Load().IconVer != "1.0.0" {
		t.Fatal("local selection or package version changed unexpectedly")
	}
	if err := os.Remove(filepath.Join(util.IconsPath, "custom", "icon.js")); err != nil {
		t.Fatal(err)
	}
	LoadIcons()
	if containIcon("custom", Conf.Appearance.Load().Icons) {
		t.Fatal("incomplete icon package was loaded")
	}
}

func TestExportAppearancePackagesUsesDataAndCopiesResources(t *testing.T) {
	setupAppearancePackagesTest(t)
	writeAppearanceTestFile(t, filepath.Join(util.ThemesPath, "custom", "assets", "font.woff2"), "font")
	writeAppearanceTestFile(t, filepath.Join(util.IconsPath, "custom", "assets", "image.png"), "image")
	writeAppearanceTestFile(t, filepath.Join(util.AppearancePath, "themes", "custom", "theme.css"), "legacy")
	writeAppearanceTestFile(t, filepath.Join(util.AppearancePath, "fonts", "custom", "private.ttf"), "private font")
	writeAppearanceTestFile(t, filepath.Join(util.AppearancePath, "fonts", "Noto-COLRv1-2.047", "Noto-COLRv1.woff2"), "old emoji font")
	destination := t.TempDir()
	if err := copyExportAppearance(destination, "custom", "custom"); err != nil {
		t.Fatal(err)
	}
	for name, expected := range map[string]string{
		"themes/custom/theme.css":                   "resource custom",
		"themes/custom/assets/font.woff2":           "font",
		"themes/daylight/theme.css":                 "resource daylight",
		"themes/midnight/theme.css":                 "resource midnight",
		"icons/custom/assets/image.png":             "image",
		"icons/litheness/icon.js":                   "resource litheness",
		"fonts/Noto-COLRv1-2.051/Noto-COLRv1.woff2": "emoji font",
		"fonts/Noto-COLRv1-2.051/LICENSE":           "emoji license",
	} {
		data, err := os.ReadFile(filepath.Join(destination, "appearance", name))
		if err != nil || string(data) != expected {
			t.Errorf("%s: got %q, error %v", name, data, err)
		}
	}
	for _, name := range []string{"custom", "Noto-COLRv1-2.047"} {
		if _, err := os.Stat(filepath.Join(destination, "appearance", "fonts", name)); !os.IsNotExist(err) {
			t.Errorf("unexpected exported font directory %s: %v", name, err)
		}
		if _, err := os.Stat(filepath.Join(util.AppearancePath, "fonts", name)); err != nil {
			t.Errorf("source font directory %s was not preserved: %v", name, err)
		}
	}
}

func TestExportAppearanceReportsMissingEmojiFont(t *testing.T) {
	setupAppearancePackagesTest(t)
	if err := os.Remove(filepath.Join(util.AppearancePath, "fonts", "Noto-COLRv1-2.051", "Noto-COLRv1.woff2")); err != nil {
		t.Fatal(err)
	}
	if err := copyExportAppearance(t.TempDir(), "daylight", "litheness"); err == nil {
		t.Fatal("missing bundled emoji font was silently ignored")
	}
}

func TestRefreshAppearanceConfigFallsBackAfterRemoval(t *testing.T) {
	setupAppearancePackagesTest(t)
	writeAppearanceTestFile(t, filepath.Join(util.ThemesPath, "custom", "theme.js"), "script")
	Conf.Appearance.Load().ThemeLight, Conf.Appearance.Load().Icon = "custom", "custom"
	Conf.Appearance.Load().ThemeDark = "missing"
	refreshAppearanceConfig()
	if !Conf.Appearance.Load().ThemeJS || Conf.Appearance.Load().ThemeLight != "custom" || Conf.Appearance.Load().ThemeDark != "midnight" {
		t.Fatal("fallback for an unused mode changed the current theme script")
	}
	if err := os.Remove(filepath.Join(util.ThemesPath, "custom", "theme.json")); err != nil {
		t.Fatal(err)
	}
	writeAppearanceTestPackage(t, "icons", "custom", "2.0.0", "999.0.0")
	refreshAppearanceConfig()
	if Conf.Appearance.Load().ThemeLight != "daylight" || Conf.Appearance.Load().Icon != "litheness" || Conf.Appearance.Load().ThemeJS ||
		Conf.Appearance.Load().ThemeVer != "1.0.0" || Conf.Appearance.Load().IconVer != "1.0.0" {
		t.Fatalf("appearance fallback retained stale package state: %+v", Conf.Appearance.Load())
	}
}

func TestApplyAppearanceRefreshesUnchangedPackageSelection(t *testing.T) {
	for _, change := range []string{"remove-theme", "remove-icon", "incompatible-packages", "update-versions", "remove-script"} {
		t.Run(change, func(t *testing.T) {
			prepareConfConsistencyTest(t)
			setupAppearancePackagesTest(t)
			oldWorkingDir := util.WorkingDir
			util.WorkingDir = t.TempDir()
			t.Cleanup(func() {
				CloseWatchThemes()
				util.WorkingDir = oldWorkingDir
			})
			writeAppearanceTestFile(t, filepath.Join(util.WorkingDir, "appearance", "emojis", "conf.json"), "[]")
			writeAppearanceTestFile(t, filepath.Join(util.ThemesPath, "custom", "theme.js"), "script")
			selected := cloneConfSection(Conf.Appearance.Load())
			selected.ThemeLight, selected.ThemeDark, selected.Icon = "custom", "custom", "custom"
			Conf.Appearance.Store(selected)
			refreshAppearanceConfig()
			held := Conf.Appearance.Load()
			before, err := json.Marshal(held)
			if err != nil {
				t.Fatal(err)
			}
			if !held.ThemeJS || held.ThemeVer != "1.0.0" || held.IconVer != "1.0.0" {
				t.Fatalf("initial packages were not loaded: %+v", held)
			}
			light, dark, icon, version, script := "custom", "custom", "custom", "1.0.0", true
			switch change {
			case "remove-theme":
				err = os.RemoveAll(filepath.Join(util.ThemesPath, "custom"))
				light, dark, script = "daylight", "midnight", false
			case "remove-icon":
				err = os.RemoveAll(filepath.Join(util.IconsPath, "custom"))
				icon = "litheness"
			case "incompatible-packages":
				writeAppearanceTestPackage(t, "themes", "custom", "2.0.0", "999.0.0")
				writeAppearanceTestPackage(t, "icons", "custom", "2.0.0", "999.0.0")
				light, dark, icon, script = "daylight", "midnight", "litheness", false
			case "update-versions":
				writeAppearanceTestPackage(t, "themes", "custom", "2.0.0", "")
				writeAppearanceTestPackage(t, "icons", "custom", "2.0.0", "")
				version = "2.0.0"
			case "remove-script":
				err = os.Remove(filepath.Join(util.ThemesPath, "custom", "theme.js"))
				script = false
			}
			if err != nil {
				t.Fatal(err)
			}
			// 包文件变化不改变设置请求，提交仍应刷新资源及可用包列表。
			if _, err = ApplyAppearanceSetting(held); err != nil {
				t.Fatal(err)
			}
			actual := Conf.Appearance.Load()
			if actual.ThemeLight != light || actual.ThemeDark != dark || actual.Icon != icon ||
				actual.ThemeVer != version || actual.IconVer != version || actual.ThemeJS != script {
				t.Fatalf("unchanged selection retained stale package state: %+v", actual)
			}
			if containTheme("custom", actual.LightThemes) != (light == "custom") ||
				containTheme("custom", actual.DarkThemes) != (dark == "custom") ||
				containIcon("custom", actual.Icons) != (icon == "custom") {
				t.Fatal("package availability was not refreshed")
			}
			after, err := json.Marshal(held)
			if err != nil || string(before) != string(after) {
				t.Fatal("resource refresh mutated the submitted snapshot")
			}
			data, err := os.ReadFile(filepath.Join(util.ConfDir, "conf.json"))
			if err != nil {
				t.Fatal(err)
			}
			var saved struct {
				Appearance conf.Appearance `json:"appearance"`
			}
			if err = json.Unmarshal(data, &saved); err != nil {
				t.Fatal(err)
			}
			if saved.Appearance.ThemeLight != light || saved.Appearance.ThemeDark != dark || saved.Appearance.Icon != icon ||
				saved.Appearance.ThemeVer != version || saved.Appearance.IconVer != version || saved.Appearance.ThemeJS != script {
				t.Fatalf("refreshed selection was not persisted: %+v", saved.Appearance)
			}
		})
	}
}
