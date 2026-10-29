// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build !windows

package testutil

import "testing"

// ShortPath 仅在 Windows 上提供短文件名夹具。
func ShortPath(t testing.TB, path string) string {
	t.Helper()
	t.Skip("short filenames require Windows")
	return ""
}
