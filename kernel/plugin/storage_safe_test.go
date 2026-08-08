// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package plugin

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func newStorageTestPlugin(t *testing.T) (*KernelPlugin, string) {
	t.Helper()
	workspace := t.TempDir()
	previousWorkspace := util.WorkspaceDir
	util.WorkspaceDir = workspace
	t.Cleanup(func() { util.WorkspaceDir = previousWorkspace })

	storageDir := filepath.Join(workspace, "data", "storage", "petal", "test")
	if err := os.MkdirAll(storageDir, 0755); err != nil {
		t.Fatal(err)
	}
	return &KernelPlugin{storageDir: storageDir, context: context.Background()}, storageDir
}

func TestStorageRootCreation(t *testing.T) {
	workspace := t.TempDir()
	previousWorkspace := util.WorkspaceDir
	util.WorkspaceDir = workspace
	t.Cleanup(func() { util.WorkspaceDir = previousWorkspace })

	storageDir := filepath.Join(workspace, "data", "storage", "petal", "test")
	plugin := &KernelPlugin{storageDir: storageDir, context: context.Background()}
	if err := plugin.ensureStorageRoot(); err != nil {
		t.Fatalf("ensure storage root: %v", err)
	}
	if info, err := os.Stat(storageDir); err != nil || !info.IsDir() {
		t.Fatalf("storage root was not created: %v", err)
	}
}

func TestStorageCRUD(t *testing.T) {
	plugin, storageDir := newStorageTestPlugin(t)

	if err := plugin.storagePut(filepath.Join("nested", "value.txt"), []byte("first")); err != nil {
		t.Fatalf("put: %v", err)
	}
	if err := plugin.storagePut(filepath.Join("nested", "value.txt"), []byte("second")); err != nil {
		t.Fatalf("overwrite: %v", err)
	}
	data, err := plugin.storageGet(filepath.Join("nested", "value.txt"))
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if !bytes.Equal(data, []byte("second")) {
		t.Fatalf("get = %q", data)
	}

	entries, err := plugin.storageList("nested")
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(entries) != 1 || entries[0]["name"] != "value.txt" || entries[0]["isDir"] != false || entries[0]["isSymlink"] != false {
		t.Fatalf("unexpected entries: %#v", entries)
	}
	rootEntries, err := plugin.storageList("")
	if err != nil || len(rootEntries) != 1 || rootEntries[0]["name"] != "nested" || rootEntries[0]["isDir"] != true {
		t.Fatalf("unexpected root entries: %#v, %v", rootEntries, err)
	}

	matches, err := filepath.Glob(filepath.Join(storageDir, "nested", ".siyuan-storage-*.tmp"))
	if err != nil || len(matches) != 0 {
		t.Fatalf("temporary files remain: %v, %v", matches, err)
	}
	if err = plugin.storageRemove("nested"); err != nil {
		t.Fatalf("remove: %v", err)
	}
	if _, err = os.Lstat(filepath.Join(storageDir, "nested")); !os.IsNotExist(err) {
		t.Fatalf("removed directory still exists: %v", err)
	}
	if err = plugin.storageRemove("nested"); err != nil {
		t.Fatalf("remove missing: %v", err)
	}
}

func TestStorageRejectsInvalidPaths(t *testing.T) {
	plugin, _ := newStorageTestPlugin(t)
	invalid := []string{"..", filepath.Join("..", "escape"), string(filepath.Separator) + "absolute"}
	for _, path := range invalid {
		if err := plugin.storagePut(path, []byte("data")); err == nil {
			t.Errorf("put accepted %q", path)
		}
		if _, err := plugin.storageGet(path); err == nil {
			t.Errorf("get accepted %q", path)
		}
		if err := plugin.storageRemove(path); err == nil {
			t.Errorf("remove accepted %q", path)
		}
		if _, err := plugin.storageList(path); err == nil {
			t.Errorf("list accepted %q", path)
		}
	}
	for _, path := range []string{"", "."} {
		if err := plugin.storagePut(path, []byte("data")); err == nil {
			t.Errorf("put accepted storage root %q", path)
		}
		if err := plugin.storageRemove(path); err == nil {
			t.Errorf("remove accepted storage root %q", path)
		}
	}
}

func TestStorageConcurrentCRUD(t *testing.T) {
	plugin, _ := newStorageTestPlugin(t)
	if err := plugin.storagePut("value", []byte("initial")); err != nil {
		t.Fatal(err)
	}

	var wait sync.WaitGroup
	errors := make(chan error, 8)
	for worker := 0; worker < 8; worker++ {
		wait.Add(1)
		go func(worker int) {
			defer wait.Done()
			for iteration := 0; iteration < 25; iteration++ {
				value := []byte(fmt.Sprintf("%d-%d", worker, iteration))
				if err := plugin.storagePut("value", value); err != nil {
					errors <- err
					return
				}
				if _, err := plugin.storageGet("value"); err != nil {
					errors <- err
					return
				}
			}
		}(worker)
	}
	wait.Wait()
	close(errors)
	for err := range errors {
		t.Error(err)
	}
}

func TestStorageTreeLockRegistry(t *testing.T) {
	root := t.TempDir()
	first, err := storageTreeLock(filepath.Join(root, "storage"))
	if err != nil {
		t.Fatal(err)
	}
	alias, err := storageTreeLock(filepath.Join(root, "other", "..", "storage"))
	if err != nil {
		t.Fatal(err)
	}
	other, err := storageTreeLock(filepath.Join(root, "other"))
	if err != nil {
		t.Fatal(err)
	}
	if first != alias {
		t.Fatal("clean aliases did not share a storage tree lock")
	}
	if first == other {
		t.Fatal("different storage roots shared a storage tree lock")
	}
}

type observedStorageContext struct {
	context.Context
	checked chan struct{}
	once    sync.Once
}

func newObservedStorageContext(ctx context.Context) *observedStorageContext {
	return &observedStorageContext{Context: ctx, checked: make(chan struct{})}
}

func (ctx *observedStorageContext) Err() error {
	err := ctx.Context.Err()
	if err == nil {
		ctx.once.Do(func() { close(ctx.checked) })
	}
	return err
}

func waitForStorageTreeLock(t *testing.T, lock *sync.RWMutex) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if lock.TryLock() {
			lock.Unlock()
			time.Sleep(time.Millisecond)
			continue
		}
		return
	}
	t.Fatal("storage operation did not acquire the tree lock")
}

func TestStorageCrossGenerationWriteCompletesBeforeStartup(t *testing.T) {
	oldPlugin, storageDir := newStorageTestPlugin(t)
	newContext := newObservedStorageContext(context.Background())
	newPlugin := &KernelPlugin{storageDir: storageDir, context: newContext}
	lock, err := oldPlugin.storageTreeLock()
	if err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(storageDir, "value")
	filelock.Lock(target)
	fileLocked := true
	defer func() {
		if fileLocked {
			filelock.Unlock(target)
		}
	}()

	writeDone := make(chan error, 1)
	go func() { writeDone <- oldPlugin.storagePut("value", []byte("old")) }()
	waitForStorageTreeLock(t, lock)

	startupDone := make(chan error, 1)
	go func() { startupDone <- newPlugin.ensureStorageRoot() }()
	<-newContext.checked
	select {
	case err = <-startupDone:
		t.Fatalf("startup passed an active old-generation write: %v", err)
	case <-time.After(50 * time.Millisecond):
	}

	filelock.Unlock(target)
	fileLocked = false
	if err = <-writeDone; err != nil {
		t.Fatalf("old-generation write: %v", err)
	}
	if err = <-startupDone; err != nil {
		t.Fatalf("new-generation startup: %v", err)
	}
	data, err := os.ReadFile(target)
	if err != nil || string(data) != "old" {
		t.Fatalf("unexpected committed data %q: %v", data, err)
	}
}

func TestStorageAncestorRemoveAndDescendantPutAreLinearized(t *testing.T) {
	first, storageDir := newStorageTestPlugin(t)
	second := &KernelPlugin{storageDir: storageDir, context: context.Background()}
	for iteration := 0; iteration < 25; iteration++ {
		if err := first.storageRemove("dir"); err != nil {
			t.Fatal(err)
		}
		if err := first.storagePut(filepath.Join("dir", "old"), []byte("old")); err != nil {
			t.Fatal(err)
		}
		start := make(chan struct{})
		errors := make(chan error, 2)
		go func() {
			<-start
			errors <- first.storageRemove("dir")
		}()
		go func() {
			<-start
			errors <- second.storagePut(filepath.Join("dir", "new"), []byte("new"))
		}()
		close(start)
		for operation := 0; operation < 2; operation++ {
			if err := <-errors; err != nil {
				t.Fatalf("concurrent operation: %v", err)
			}
		}
		data, err := os.ReadFile(filepath.Join(storageDir, "dir", "new"))
		if err == nil && string(data) != "new" {
			t.Fatalf("partially committed descendant data: %q", data)
		}
		if err != nil && !os.IsNotExist(err) {
			t.Fatalf("unexpected descendant state: %v", err)
		}
	}
}

func TestStorageCanceledQueuedGenerationHasNoSideEffect(t *testing.T) {
	plugin, storageDir := newStorageTestPlugin(t)
	oldContext, cancelOld := context.WithCancel(context.Background())
	observedOldContext := newObservedStorageContext(oldContext)
	oldPlugin := &KernelPlugin{storageDir: storageDir, context: observedOldContext}
	newPlugin := &KernelPlugin{storageDir: storageDir, context: context.Background()}
	lock, err := plugin.storageTreeLock()
	if err != nil {
		t.Fatal(err)
	}
	lock.Lock()

	writeDone := make(chan error, 1)
	go func() { writeDone <- oldPlugin.storagePut("canceled", []byte("old")) }()
	<-observedOldContext.checked
	cancelOld()
	startupDone := make(chan error, 1)
	go func() { startupDone <- newPlugin.ensureStorageRoot() }()
	lock.Unlock()

	if err = <-writeDone; !errors.Is(err, context.Canceled) {
		t.Fatalf("queued old-generation write error = %v", err)
	}
	if err = <-startupDone; err != nil {
		t.Fatalf("new-generation startup: %v", err)
	}
	if _, err = os.Lstat(filepath.Join(storageDir, "canceled")); !os.IsNotExist(err) {
		t.Fatalf("canceled operation had a side effect: %v", err)
	}
}

func TestStorageDetectsRootAndParentReplacement(t *testing.T) {
	t.Run("root", func(t *testing.T) {
		plugin, storageDir := newStorageTestPlugin(t)
		root, err := plugin.openStorageRoot(false)
		if err != nil {
			t.Fatal(err)
		}
		defer root.Close()
		expected, err := root.Stat(".")
		if err != nil {
			t.Fatal(err)
		}
		moved := storageDir + "-moved"
		if err = os.Rename(storageDir, moved); err != nil {
			t.Fatal(err)
		}
		if err = os.Mkdir(storageDir, 0755); err != nil {
			t.Fatal(err)
		}
		if err = plugin.validateStorageRootIdentity(expected); err == nil {
			t.Fatal("storage root replacement was not detected")
		}
	})

	t.Run("parent", func(t *testing.T) {
		plugin, storageDir := newStorageTestPlugin(t)
		if err := os.Mkdir(filepath.Join(storageDir, "parent"), 0755); err != nil {
			t.Fatal(err)
		}
		root, err := plugin.openStorageRoot(false)
		if err != nil {
			t.Fatal(err)
		}
		defer root.Close()
		parent, parentRelative, _, err := openStorageParentNoLinks(context.Background(), root,
			filepath.Join("parent", "value"), false)
		if err != nil {
			t.Fatal(err)
		}
		defer parent.Close()
		moved := filepath.Join(storageDir, "parent-moved")
		if err = os.Rename(filepath.Join(storageDir, "parent"), moved); err != nil {
			t.Fatal(err)
		}
		if err = os.Mkdir(filepath.Join(storageDir, "parent"), 0755); err != nil {
			t.Fatal(err)
		}
		if err = validateStorageDirectoryBinding(context.Background(), root, parent, parentRelative); err == nil {
			t.Fatal("storage parent replacement was not detected")
		}
	})
}

type storageTestDirEntry struct {
	name string
	info os.FileInfo
	err  error
}

func (entry storageTestDirEntry) Name() string               { return entry.name }
func (entry storageTestDirEntry) IsDir() bool                { return entry.info != nil && entry.info.IsDir() }
func (entry storageTestDirEntry) Type() os.FileMode          { return entry.info.Mode().Type() }
func (entry storageTestDirEntry) Info() (os.FileInfo, error) { return entry.info, entry.err }

func TestStorageListSnapshotSkipsEntryFailuresAndChurn(t *testing.T) {
	directory := t.TempDir()
	for _, name := range []string{"a", "b"} {
		if err := os.WriteFile(filepath.Join(directory, name), []byte(name), 0644); err != nil {
			t.Fatal(err)
		}
	}
	entries, err := os.ReadDir(directory)
	if err != nil {
		t.Fatal(err)
	}
	lstat := func(name string) (os.FileInfo, error) { return os.Lstat(filepath.Join(directory, name)) }
	if _, ok := snapshotStorageListEntry(storageTestDirEntry{name: "broken", err: errors.New("metadata")}, lstat); ok {
		t.Fatal("entry metadata failure was not skipped")
	}

	snapshot := make([]storageListSnapshotEntry, 0, len(entries))
	for _, entry := range entries {
		candidate, ok := snapshotStorageListEntry(entry, lstat)
		if !ok {
			t.Fatalf("failed to snapshot %q", entry.Name())
		}
		snapshot = append(snapshot, candidate)
	}
	if err = os.Remove(filepath.Join(directory, "b")); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(directory, "c"), []byte("c"), 0644); err != nil {
		t.Fatal(err)
	}
	results, err := filterStorageListSnapshot(context.Background(), snapshot, lstat)
	if err != nil {
		t.Fatal(err)
	}
	if len(results) != 1 || results[0]["name"] != "a" {
		t.Fatalf("unexpected filtered snapshot: %#v", results)
	}
}

func TestStorageListSortedAndSnapshotMetadata(t *testing.T) {
	plugin, storageDir := newStorageTestPlugin(t)
	for _, name := range []string{"z", "a", "m"} {
		if err := os.WriteFile(filepath.Join(storageDir, name), []byte(name), 0644); err != nil {
			t.Fatal(err)
		}
	}
	results, err := plugin.storageList("")
	if err != nil {
		t.Fatal(err)
	}
	if len(results) != 3 || results[0]["name"] != "a" || results[1]["name"] != "m" || results[2]["name"] != "z" {
		t.Fatalf("storage list is not sorted: %#v", results)
	}
	for _, result := range results {
		name := result["name"].(string)
		info, statErr := os.Lstat(filepath.Join(storageDir, name))
		if statErr != nil {
			t.Fatal(statErr)
		}
		if result["isDir"] != info.IsDir() || result["isSymlink"] != (info.Mode()&os.ModeSymlink != 0) ||
			result["updated"] != info.ModTime().Unix() {
			t.Fatalf("inconsistent metadata for %q: %#v", name, result)
		}
	}
}
