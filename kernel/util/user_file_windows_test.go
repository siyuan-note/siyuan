// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package util_test

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/internal/testutil"
	"github.com/siyuan-note/siyuan/kernel/util"
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
	release := testutil.LockUserFile(t, file)
	if _, err := util.ReadUserFile(file); err == nil {
		t.Fatal("exclusive file read succeeded")
	}
	if err := util.CopyUserFile(file, filepath.Join(t.TempDir(), "copy")); err == nil {
		t.Fatal("exclusive file copy succeeded")
	}
	if err := util.CopyUserFile(source, file); err == nil {
		t.Fatal("copy to exclusive file succeeded")
	}
	if err := util.WriteUserFile(file, []byte("replacement")); err == nil {
		t.Fatal("exclusive file write succeeded")
	}
	if _, ok := util.GetMimeTypeByPath(file); ok {
		t.Fatal("exclusive file MIME detection succeeded")
	}
	release()
	if data, err := util.ReadUserFile(file); err != nil || string(data) != "original" {
		t.Fatalf("locked file changed: %q, %v", data, err)
	}
}
