// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package bazaar

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"golang.org/x/sys/windows"
)

func readInstallTestFile(t *testing.T, path string) string {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

func TestPackageRenameRetriesWindowsBusyErrors(t *testing.T) {
	for _, failure := range []error{windows.ERROR_ACCESS_DENIED, windows.ERROR_SHARING_VIOLATION, windows.ERROR_LOCK_VIOLATION} {
		for _, persistent := range []bool{false, true} {
			calls := 0
			err := renamePackageDirectoryWithRetry("source", "target", func(source, target string) error {
				calls++
				if !persistent && calls == 2 {
					return nil
				}
				return &os.LinkError{Op: "rename", Old: source, New: target, Err: failure}
			})
			if persistent && (!errors.Is(err, failure) || calls != 3) || !persistent && (err != nil || calls != 2) {
				t.Fatalf("persistent=%v: %v after %d attempts", persistent, err, calls)
			}
		}
	}
}

func TestPackageReplacementHandlesWindowsDirectoryLock(t *testing.T) {
	for _, release := range []bool{false, true} {
		t.Run(map[bool]string{false: "persistent", true: "transient"}[release], func(t *testing.T) {
			source, target := useInstallRevisionFixture(t)
			before := readInstallTestFile(t, filepath.Join(target, "index.js"))
			path, err := windows.UTF16PtrFromString(target)
			if err != nil {
				t.Fatal(err)
			}
			handle, err := windows.CreateFile(path, windows.GENERIC_READ,
				windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE, nil, windows.OPEN_EXISTING,
				windows.FILE_FLAG_BACKUP_SEMANTICS, 0)
			if err != nil {
				t.Fatal(err)
			}
			closed := make(chan struct{})
			if release {
				go func() {
					time.Sleep(100 * time.Millisecond)
					_ = windows.CloseHandle(handle)
					close(closed)
				}()
			} else {
				defer windows.CloseHandle(handle)
			}
			err = replacePackageDirectory(source, target, true)
			if release {
				<-closed
				if err != nil {
					t.Fatal(err)
				}
				if got := readInstallTestFile(t, filepath.Join(target, "index.js")); got != readInstallTestFile(t, filepath.Join(source, "index.js")) {
					t.Fatal("replacement content differs from source")
				}
			} else if err == nil || readInstallTestFile(t, filepath.Join(target, "index.js")) != before {
				t.Fatalf("locked package was replaced: %v", err)
			}
			entries, err := filepath.Glob(filepath.Join(filepath.Dir(target), ".siyuan-package-install-*"))
			if err != nil || len(entries) != 0 {
				t.Fatalf("temporary replacement directories remain: %v, %v", entries, err)
			}
		})
	}
}
