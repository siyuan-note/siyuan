// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build (!windows && !darwin) || ios

package util

import "errors"

// 当前仅在 Windows、macOS 上实现，其他平台返回错误
func WriteFilePaths(paths []string) error {
	return errors.New("writing file paths to clipboard is not supported on this platform")
}
