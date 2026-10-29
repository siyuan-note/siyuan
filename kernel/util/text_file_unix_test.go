// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build linux || darwin || freebsd || openbsd || netbsd

package util

import (
	"context"
	"path/filepath"
	"syscall"
	"testing"
)

func TestTextFileRejectsSpecialFileWithoutOpening(t *testing.T) {
	root, dir := textFileFixture(t, "original")
	if err := syscall.Mkfifo(filepath.Join(dir, "fifo"), 0600); err != nil {
		t.Skipf("fixture fifo unsupported: %v", err)
	}
	_, err := ReadTextFile(root, "fifo")
	requireTextFileError(t, err, "invalid_path")
	_, err = MutateTextFile(context.Background(), root, "fifo", TextFileMutation{ExpectedRevision: TextFileRevision(nil), Content: "new"})
	requireTextFileError(t, err, "invalid_path")
	assertTextFileUnchanged(t, root, "original")
}
