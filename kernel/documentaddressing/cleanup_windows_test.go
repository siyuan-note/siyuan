// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package documentaddressing

import (
	"os"
	"path/filepath"
	"testing"

	"golang.org/x/sys/windows"
)

func TestCleanupRetiredRecordsLockedFile(t *testing.T) {
	conf := t.TempDir()
	name := filepath.Join(conf, "document-addressing.json")
	if err := os.WriteFile(name, []byte("original"), 0600); err != nil {
		t.Fatal(err)
	}
	ptr, err := windows.UTF16PtrFromString(name)
	if err != nil {
		t.Fatal(err)
	}
	handle, err := windows.CreateFile(ptr, windows.GENERIC_READ, windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE, nil, windows.OPEN_EXISTING, windows.FILE_ATTRIBUTE_NORMAL, 0)
	if err != nil {
		t.Fatal(err)
	}
	locked := true
	defer func() {
		if locked {
			windows.CloseHandle(handle)
		}
	}()
	if err := CleanupRetiredRecords(conf); err == nil {
		t.Fatal("locked record deletion did not report failure")
	}
	if data, err := os.ReadFile(name); err != nil || string(data) != "original" {
		t.Fatal("failed cleanup changed the record", err)
	}
	if err := windows.CloseHandle(handle); err != nil {
		t.Fatal(err)
	}
	locked = false
	if err := CleanupRetiredRecords(conf); err != nil {
		t.Fatal("cleanup did not recover on next attempt", err)
	}
}
