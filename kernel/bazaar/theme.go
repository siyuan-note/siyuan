// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package bazaar

// IsIncompatibleTheme 判断主题是否与当前前端不兼容
func IsIncompatibleTheme(theme *Package, frontend string) bool {
	// frontend 为空时不检查兼容性（视为兼容）
	if "" == frontend {
		return false
	}
	// 移动端主题需要显式声明兼容性，避免旧主题破坏移动端界面
	if len(theme.Frontends) == 0 && ("mobile" == frontend || "browser-mobile" == frontend) {
		return true
	}

	return !IsTargetSupported(theme.Frontends, frontend)
}
