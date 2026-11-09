// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package testutil

import (
	"errors"
	"os"
	"testing"

	"golang.org/x/sys/windows"
)

// LockUserFile 阻止其他句柄读取首字节及替换文件，并校验真实读取错误。
func LockUserFile(t testing.TB, path string) func() {
	t.Helper()
	name, err := windows.UTF16PtrFromString(path)
	if err != nil {
		t.Fatal(err)
	}
	handle, err := windows.CreateFile(name, windows.GENERIC_READ,
		windows.FILE_SHARE_READ,
		nil, windows.OPEN_EXISTING, windows.FILE_ATTRIBUTE_NORMAL, 0)
	if err != nil {
		t.Fatal(err)
	}
	var overlapped windows.Overlapped
	locked := false
	release := func() {
		t.Helper()
		if handle == windows.InvalidHandle {
			return
		}
		var unlockErr error
		if locked {
			unlockErr = windows.UnlockFileEx(handle, 0, 1, 0, &overlapped)
		}
		closeErr := windows.CloseHandle(handle)
		handle = windows.InvalidHandle
		if err := errors.Join(unlockErr, closeErr); err != nil {
			t.Fatalf("release file lock: %v", err)
		}
	}
	t.Cleanup(release)
	if err = windows.LockFileEx(handle, windows.LOCKFILE_EXCLUSIVE_LOCK|windows.LOCKFILE_FAIL_IMMEDIATELY, 0, 1, 0, &overlapped); err != nil {
		t.Fatal(err)
	}
	locked = true
	if info, err := os.Stat(path); err != nil || !info.Mode().IsRegular() || info.Size() == 0 {
		t.Fatalf("lock fixture must be a nonempty regular file: %v", err)
	}
	if _, err = os.ReadFile(path); !errors.Is(err, windows.ERROR_LOCK_VIOLATION) {
		t.Fatalf("expected byte-range read lock violation, got %v", err)
	}
	return release
}
