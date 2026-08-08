// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

//go:build windows

package api

import (
	"os"
	"path/filepath"
	"testing"

	"golang.org/x/sys/windows"
)

func TestCopyExportFileToOccupiedDestination(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "source.zip")
	dest := filepath.Join(dir, "destination.zip")

	if err := os.WriteFile(src, []byte("new export"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(dest, []byte("old export"), 0644); err != nil {
		t.Fatal(err)
	}

	destUTF16, err := windows.UTF16PtrFromString(dest)
	if err != nil {
		t.Fatal(err)
	}
	handle, err := windows.CreateFile(
		destUTF16,
		windows.GENERIC_READ,
		0,
		nil,
		windows.OPEN_EXISTING,
		windows.FILE_ATTRIBUTE_NORMAL,
		0,
	)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if handle != windows.InvalidHandle {
			_ = windows.CloseHandle(handle)
		}
	}()

	if err = copyExportFileToDestination(src, dest); err == nil {
		t.Fatal("expected replacing an occupied destination to fail")
	}
	if err = windows.CloseHandle(handle); err != nil {
		t.Fatal(err)
	}
	handle = windows.InvalidHandle

	data, err := os.ReadFile(dest)
	if err != nil {
		t.Fatal(err)
	}
	if got, want := string(data), "old export"; got != want {
		t.Fatalf("occupied destination content = %q, want %q", got, want)
	}
	assertNoExportTempFiles(t, dir)
}
