// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package search

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/siyuan-note/filelock"
)

func TestFilesystemScanWaitsForDocumentWrite(t *testing.T) {
	filename := filepath.Join(t.TempDir(), "document.sy")
	if err := os.WriteFile(filename, []byte("before"), 0600); err != nil {
		t.Fatal(err)
	}
	filelock.Lock(filename)
	locked := true
	defer func() {
		if locked {
			filelock.Unlock(filename)
		}
	}()
	started, done := make(chan struct{}), make(chan []string, 1)
	go func() {
		close(started)
		done <- scanFileForTargets(filename, map[byte][][]byte{'a': {[]byte("after")}}, len("after"))
	}()
	<-started
	select {
	case <-done:
		t.Fatal("filesystem scan bypassed the document write lock")
	case <-time.After(30 * time.Millisecond):
	}
	if err := os.WriteFile(filename, []byte("after"), 0600); err != nil {
		t.Fatal(err)
	}
	filelock.Unlock(filename)
	locked = false
	select {
	case matches := <-done:
		if len(matches) != 1 || matches[0] != "after" {
			t.Fatalf("scan did not read the committed source: %v", matches)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("scan stayed blocked after source commit")
	}
}
