// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package util

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/siyuan-note/dejavu"
	"github.com/siyuan-note/filelock"
)

func TestPreflightWriteMarksSnapshotChanges(t *testing.T) {
	for _, mapped := range []bool{false, true} {
		base := t.TempDir()
		dataDir := filepath.Join(base, "data")
		if err := os.MkdirAll(dataDir, 0755); err != nil {
			t.Fatal(err)
		}
		name := filepath.Join(dataDir, "source.txt")
		stamp := time.Unix(1700000100, 100000000)
		if err := os.WriteFile(name, []byte("before"), 0644); err != nil {
			t.Fatal(err)
		}
		if err := os.Chtimes(name, stamp, stamp); err != nil {
			t.Fatal(err)
		}
		repo, err := dejavu.NewRepo(dataDir, filepath.Join(base, "repo"), filepath.Join(base, "history"), filepath.Join(base, "temp"),
			"device", "device", "test", []byte("0123456789abcdef0123456789abcdef"), nil, nil)
		if err != nil {
			t.Fatal(err)
		}
		before, err := repo.Index("before", true, nil)
		if err != nil {
			t.Fatal(err)
		}
		if err = WriteFileWithPreflight(name, []byte("AFTER!"), mapped, func([]byte) error { return nil }); err != nil {
			t.Fatal(err)
		}
		if err = os.Chtimes(name, stamp, stamp); err != nil {
			t.Fatal(err)
		}
		changed, err := repo.CheckSnapshot()
		if err != nil || !changed {
			t.Fatalf("known same-attribute write missed: %v", err)
		}
		after, err := repo.Index("after", true, nil)
		if err != nil || before.ID == after.ID {
			t.Fatalf("known write not indexed: %v", err)
		}
		files, err := repo.GetFiles(after)
		if err != nil || len(files) != 1 {
			t.Fatalf("snapshot files: %v", err)
		}
		content, err := repo.OpenFile(files[0])
		if err != nil || string(content) != "AFTER!" {
			t.Fatalf("snapshot content %q: %v", content, err)
		}
		if err = WriteFileWithPreflight(name, []byte("AFTER!"), mapped, func([]byte) error { return nil }); err != nil {
			t.Fatal(err)
		}
		stable, created, err := repo.IndexWithResult("unchanged", true, nil)
		if err != nil || created || stable.ID != after.ID {
			t.Fatalf("unchanged write made a version: %v", err)
		}
	}
}

func TestPreflightWritePreservesRejectedSource(t *testing.T) {
	for _, mapped := range []bool{false, true} {
		name := filepath.Join(t.TempDir(), "source.sy")
		refused := errors.New("unsupported source")
		if err := WriteFileWithPreflight(name, []byte("new"), mapped, func(current []byte) error {
			if current != nil {
				t.Fatal("missing source did not pass nil")
			}
			return refused
		}); !errors.Is(err, refused) {
			t.Fatal(err)
		}
		if _, err := os.Stat(name); !os.IsNotExist(err) {
			t.Fatal("rejected creation wrote a file")
		}
		original := bytes.Repeat([]byte("protected"), os.Getpagesize())
		if err := os.WriteFile(name, original, 0644); err != nil {
			t.Fatal(err)
		}
		before, _ := os.Stat(name)
		if err := WriteFileWithPreflight(name, []byte("short"), mapped, func(current []byte) error {
			if !bytes.Equal(current, original) {
				t.Fatal("preflight did not see original bytes")
			}
			return refused
		}); !errors.Is(err, refused) {
			t.Fatal("preflight rejection fell through to a fallback write", err)
		}
		after, err := os.Stat(name)
		if err != nil || !after.ModTime().Equal(before.ModTime()) || after.Size() != before.Size() {
			t.Fatal("rejected write changed source metadata", err)
		}
		retained, _ := os.ReadFile(name)
		if !bytes.Equal(retained, original) {
			t.Fatal("rejected write changed source bytes")
		}
		if err = WriteFileWithPreflight(name, []byte("accepted"), mapped, func([]byte) error { return nil }); err != nil {
			t.Fatal(err)
		}
		retained, _ = os.ReadFile(name)
		if string(retained) != "accepted" {
			t.Fatal("supported source was not replaced")
		}
	}
}

func TestPreflightWriteSerializesConcurrentMutation(t *testing.T) {
	name := filepath.Join(t.TempDir(), "source.sy")
	if err := os.WriteFile(name, []byte("original"), 0644); err != nil {
		t.Fatal(err)
	}
	entered, proceed := make(chan struct{}), make(chan struct{})
	done := make(chan error, 1)
	go func() {
		done <- WriteFileWithPreflight(name, []byte("first"), true, func([]byte) error {
			close(entered)
			<-proceed
			return nil
		})
	}()
	<-entered
	second := make(chan error, 1)
	attempting := make(chan struct{})
	go func() {
		close(attempting)
		second <- filelock.WriteFile(name, []byte("second"))
	}()
	<-attempting
	select {
	case err := <-second:
		close(proceed)
		<-done
		t.Fatal("concurrent writer completed before source validation finished", err)
	case <-time.After(100 * time.Millisecond):
	}
	close(proceed)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if err := <-second; err != nil {
		t.Fatal(err)
	}
	actual, err := os.ReadFile(name)
	if err != nil || string(actual) != "second" {
		t.Fatal("source changed between validation and commit", err)
	}
}
