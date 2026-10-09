//go:build linux || darwin || freebsd || openbsd || netbsd

// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// Licensed under the GNU Affero General Public License, version 3 or later.

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
