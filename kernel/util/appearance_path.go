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

package util

import (
	"path/filepath"
	"strings"
)

// BuiltInAppearancePath 返回当前运行模式下内置外观资源的目录。
func BuiltInAppearancePath() string {
	if Mode == "dev" {
		return filepath.Join(WorkingDir, "appearance")
	}
	return AppearancePath
}

// AppearancePackagePath 按包名区分内置资源和参与同步的第三方资源。
func AppearancePackagePath(kind, name string) string {
	if name == "" || strings.HasPrefix(name, ".") || strings.TrimSpace(name) != name ||
		strings.ContainsAny(name, `/\:`) || filepath.Base(name) != name || strings.Contains(name, "..") {
		return ""
	}
	var root string
	switch kind {
	case "themes":
		if strings.EqualFold(name, "daylight") || strings.EqualFold(name, "midnight") {
			return filepath.Join(BuiltInAppearancePath(), kind, strings.ToLower(name))
		}
		root = ThemesPath
	case "icons":
		if strings.EqualFold(name, "litheness") {
			return filepath.Join(BuiltInAppearancePath(), kind, "litheness")
		}
		root = IconsPath
	default:
		return ""
	}
	if root == "" {
		return ""
	}
	return filepath.Join(root, name)
}
