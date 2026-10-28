// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package util

import "strings"

// ParentHPath 返回 hPath 的父路径：去掉最后一个 "/" 段，根路径及单段路径返回 "/"。
func ParentHPath(hPath string) string {
	i := strings.LastIndex(hPath, "/")
	if i <= 0 {
		return "/"
	}
	return hPath[:i]
}
