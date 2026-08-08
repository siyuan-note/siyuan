//go:build !windows

// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package plugin

import (
	"context"
	"os"
	"path/filepath"
	"syscall"
	"testing"
	"time"

	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestStorageRootCreationRejectsSymlink(t *testing.T) {
	workspace := t.TempDir()
	previousWorkspace := util.WorkspaceDir
	util.WorkspaceDir = workspace
	t.Cleanup(func() { util.WorkspaceDir = previousWorkspace })

	outside := filepath.Join(workspace, "outside")
	if err := os.MkdirAll(filepath.Join(workspace, "data"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(outside, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(workspace, "data", "storage")); err != nil {
		t.Fatal(err)
	}
	storageDir := filepath.Join(workspace, "data", "storage", "petal", "test")
	plugin := &KernelPlugin{storageDir: storageDir, context: context.Background()}
	if err := plugin.ensureStorageRoot(); err == nil {
		t.Fatal("storage root creation accepted symlink component")
	}
	if _, err := os.Lstat(filepath.Join(outside, "petal")); !os.IsNotExist(err) {
		t.Fatalf("storage root creation escaped through symlink: %v", err)
	}
}

func TestStorageRejectsLinksAndContainsRemove(t *testing.T) {
	plugin, storageDir := newStorageTestPlugin(t)
	outside := filepath.Join(filepath.Dir(storageDir), "outside")
	if err := os.MkdirAll(outside, 0755); err != nil {
		t.Fatal(err)
	}
	outsideFile := filepath.Join(outside, "keep")
	if err := os.WriteFile(outsideFile, []byte("keep"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outsideFile, filepath.Join(storageDir, "file-link")); err != nil {
		t.Fatal(err)
	}
	if _, err := plugin.storageGet("file-link"); err == nil {
		t.Fatal("get accepted symlink")
	}
	if err := plugin.storagePut("file-link", []byte("replace")); err == nil {
		t.Fatal("put accepted symlink")
	}
	if err := plugin.storageRemove("file-link"); err == nil {
		t.Fatal("remove accepted symlink")
	}

	if err := os.Symlink(outside, filepath.Join(storageDir, "dir-link")); err != nil {
		t.Fatal(err)
	}
	if _, err := plugin.storageList("dir-link"); err == nil {
		t.Fatal("list accepted symlink directory")
	}
	if err := plugin.storagePut(filepath.Join("dir-link", "escaped"), []byte("data")); err == nil {
		t.Fatal("put traversed symlink directory")
	}

	contained := filepath.Join(storageDir, "contained")
	if err := os.Mkdir(contained, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(contained, "link")); err != nil {
		t.Fatal(err)
	}
	if err := plugin.storageRemove("contained"); err != nil {
		t.Fatalf("remove contained directory: %v", err)
	}
	if data, err := os.ReadFile(outsideFile); err != nil || string(data) != "keep" {
		t.Fatalf("remove escaped storage root: %q, %v", data, err)
	}
}

func TestStorageGetRejectsFIFOWithoutBlocking(t *testing.T) {
	plugin, storageDir := newStorageTestPlugin(t)
	if err := syscall.Mkfifo(filepath.Join(storageDir, "fifo"), 0600); err != nil {
		t.Fatal(err)
	}

	done := make(chan error, 1)
	go func() {
		_, err := plugin.storageGet("fifo")
		done <- err
	}()
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("get accepted FIFO")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("get blocked while opening FIFO")
	}
}
