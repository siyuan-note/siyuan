// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package util

import (
	"path/filepath"
	"testing"
)

func TestAppearancePackagePaths(t *testing.T) {
	oldAppearance, oldThemes, oldIcons, oldWorking, oldMode := AppearancePath, ThemesPath, IconsPath, WorkingDir, Mode
	t.Cleanup(func() {
		AppearancePath, ThemesPath, IconsPath, WorkingDir, Mode = oldAppearance, oldThemes, oldIcons, oldWorking, oldMode
	})
	root := t.TempDir()
	AppearancePath, WorkingDir = filepath.Join(root, "conf", "appearance"), filepath.Join(root, "app")
	ThemesPath, IconsPath = filepath.Join(root, "data", "themes"), filepath.Join(root, "data", "icons")
	for _, mode := range []string{"prod", "dev"} {
		Mode = mode
		for _, test := range []struct{ kind, name, expected string }{
			{"themes", "daylight", filepath.Join(BuiltInAppearancePath(), "themes", "daylight")},
			{"themes", "MIDNIGHT", filepath.Join(BuiltInAppearancePath(), "themes", "midnight")},
			{"icons", "litheness", filepath.Join(BuiltInAppearancePath(), "icons", "litheness")},
			{"themes", "custom", filepath.Join(ThemesPath, "custom")},
			{"icons", "custom", filepath.Join(IconsPath, "custom")},
			{"plugins", "custom", ""},
			{"themes", "../conf", ""},
			{"themes", `..\conf`, ""},
			{"themes", "C:secret", ""},
			{"themes", "", ""},
		} {
			if actual := AppearancePackagePath(test.kind, test.name); actual != test.expected {
				t.Errorf("%s %s/%s: got %q, want %q", mode, test.kind, test.name, actual, test.expected)
			}
		}
	}
}
