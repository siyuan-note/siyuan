// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package util

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestTrackedCopiesSerializeOppositeDirections(t *testing.T) {
	dir := t.TempDir()
	first, second := filepath.Join(dir, "first"), filepath.Join(dir, "second")
	one, two := bytes.Repeat([]byte("a"), 4096), bytes.Repeat([]byte("b"), 4096)
	if err := os.WriteFile(first, one, 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(second, two, 0644); err != nil {
		t.Fatal(err)
	}
	start, done := make(chan struct{}), make(chan error, 2)
	copyFiles := func(source, destination string) {
		<-start
		for i := 0; i < 20; i++ {
			if err := CopyFileWithChangeTracking(source, destination); err != nil {
				done <- err
				return
			}
		}
		done <- nil
	}
	go copyFiles(first, second)
	go copyFiles(second, first)
	close(start)
	deadline := time.After(10 * time.Second)
	for i := 0; i < 2; i++ {
		select {
		case err := <-done:
			if err != nil {
				t.Fatal(err)
			}
		case <-deadline:
			t.Fatal("opposite-direction copies deadlocked")
		}
	}
	for _, name := range []string{first, second} {
		content, err := os.ReadFile(name)
		if err != nil || (!bytes.Equal(content, one) && !bytes.Equal(content, two)) {
			t.Fatalf("concurrent copy produced incomplete content: size=%d err=%v", len(content), err)
		}
	}
}
