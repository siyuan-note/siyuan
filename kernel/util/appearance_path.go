// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

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
