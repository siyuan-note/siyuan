// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package util

import (
	"os"
	"path/filepath"
	"testing"

	"golang.org/x/sys/windows"
)

func TestUserFilesReturnExclusiveAccessErrors(t *testing.T) {
	file := filepath.Join(t.TempDir(), "locked")
	source := filepath.Join(t.TempDir(), "source")
	if err := os.WriteFile(source, []byte("copy"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(file, []byte("original"), 0644); err != nil {
		t.Fatal(err)
	}
	p, err := windows.UTF16PtrFromString(file)
	if err != nil {
		t.Fatal(err)
	}
	handle, err := windows.CreateFile(p, windows.GENERIC_READ, 0, nil, windows.OPEN_EXISTING, windows.FILE_ATTRIBUTE_NORMAL, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer windows.CloseHandle(handle)
	if _, err = ReadUserFile(file); err == nil {
		t.Fatal("exclusive file read succeeded")
	}
	if err = CopyUserFile(file, filepath.Join(t.TempDir(), "copy")); err == nil {
		t.Fatal("exclusive file copy succeeded")
	}
	if err = CopyUserFile(source, file); err == nil {
		t.Fatal("copy to exclusive file succeeded")
	}
	if err = WriteUserFile(file, []byte("replacement")); err == nil {
		t.Fatal("exclusive file write succeeded")
	}
	if _, ok := GetMimeTypeByPath(file); ok {
		t.Fatal("exclusive file MIME detection succeeded")
	}
}
