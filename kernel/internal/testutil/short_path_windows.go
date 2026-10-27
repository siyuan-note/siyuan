// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package testutil

import (
	"path/filepath"
	"strings"
	"testing"

	"golang.org/x/sys/windows"
)

// ShortPath 返回现有文件的短路径；卷未生成短文件名时跳过对应子测试。
func ShortPath(t testing.TB, path string) string {
	t.Helper()
	name, err := windows.UTF16PtrFromString(path)
	if err != nil {
		t.Fatal(err)
	}
	buffer := make([]uint16, 512)
	for {
		length, err := windows.GetShortPathName(name, &buffer[0], uint32(len(buffer)))
		if err != nil {
			t.Fatal(err)
		}
		if length < uint32(len(buffer)) {
			short := windows.UTF16ToString(buffer[:length])
			if strings.EqualFold(filepath.Base(short), filepath.Base(path)) {
				t.Skip("volume does not generate a short filename for this fixture")
			}
			return short
		}
		buffer = make([]uint16, length+1)
	}
}
