//go:build windows

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
	"encoding/binary"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"
	"unicode/utf16"

	"golang.org/x/sys/windows"
)

type storageWindowsFileInfo struct {
	name       string
	mode       os.FileMode
	attributes uint32
}

func (info storageWindowsFileInfo) Name() string       { return info.name }
func (info storageWindowsFileInfo) Size() int64        { return 0 }
func (info storageWindowsFileInfo) Mode() os.FileMode  { return info.mode }
func (info storageWindowsFileInfo) ModTime() time.Time { return time.Unix(123, 0) }
func (info storageWindowsFileInfo) IsDir() bool        { return info.mode.IsDir() }
func (info storageWindowsFileInfo) Sys() any {
	return &syscall.Win32FileAttributeData{FileAttributes: info.attributes}
}

func TestStorageWindowsTreeLockAliases(t *testing.T) {
	root := t.TempDir()
	first, err := storageTreeLock(filepath.Join(root, "Storage"))
	if err != nil {
		t.Fatal(err)
	}
	alias, err := storageTreeLock(strings.ToUpper(filepath.Join(root, "alias", "..", "storage")))
	if err != nil {
		t.Fatal(err)
	}
	if first != alias {
		t.Fatal("Windows clean and case aliases did not share a storage tree lock")
	}
}

func TestStorageWindowsReparseMetadataPolicy(t *testing.T) {
	reparse := storageWindowsFileInfo{
		name:       "reparse",
		mode:       0644,
		attributes: syscall.FILE_ATTRIBUTE_REPARSE_POINT,
	}
	if !storagePathInfoIsLink(reparse) {
		t.Fatal("reparse point was not rejected by the traversal classification")
	}
	if storageListSnapshotResult(storageListSnapshotEntry{name: reparse.Name(), info: reparse})["isSymlink"] != false {
		t.Fatal("non-symlink reparse point was reported as a symlink")
	}

	symlink := storageWindowsFileInfo{
		name:       "symlink",
		mode:       os.ModeSymlink | 0777,
		attributes: syscall.FILE_ATTRIBUTE_REPARSE_POINT,
	}
	if storageListSnapshotResult(storageListSnapshotEntry{name: symlink.Name(), info: symlink})["isSymlink"] != true {
		t.Fatal("Go ModeSymlink entry was not reported as a symlink")
	}
}

func createStorageJunction(t *testing.T, target, junction string) {
	t.Helper()
	if err := os.Mkdir(junction, 0755); err != nil {
		t.Fatal(err)
	}
	junctionPointer, err := windows.UTF16PtrFromString(junction)
	if err != nil {
		t.Fatal(err)
	}
	handle, err := windows.CreateFile(junctionPointer, windows.GENERIC_WRITE,
		windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|windows.FILE_SHARE_DELETE, nil, windows.OPEN_EXISTING,
		windows.FILE_FLAG_OPEN_REPARSE_POINT|windows.FILE_FLAG_BACKUP_SEMANTICS, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer windows.CloseHandle(handle)

	substituteName := utf16.Encode([]rune(`\??\` + target))
	printName := utf16.Encode([]rune(target))
	pathBuffer := make([]uint16, 0, len(substituteName)+len(printName)+2)
	pathBuffer = append(pathBuffer, substituteName...)
	pathBuffer = append(pathBuffer, 0)
	printNameOffset := len(pathBuffer) * 2
	pathBuffer = append(pathBuffer, printName...)
	pathBuffer = append(pathBuffer, 0)
	buffer := make([]byte, 16+len(pathBuffer)*2)
	binary.LittleEndian.PutUint32(buffer[0:4], windows.IO_REPARSE_TAG_MOUNT_POINT)
	binary.LittleEndian.PutUint16(buffer[4:6], uint16(8+len(pathBuffer)*2))
	binary.LittleEndian.PutUint16(buffer[10:12], uint16(len(substituteName)*2))
	binary.LittleEndian.PutUint16(buffer[12:14], uint16(printNameOffset))
	binary.LittleEndian.PutUint16(buffer[14:16], uint16(len(printName)*2))
	for index, value := range pathBuffer {
		binary.LittleEndian.PutUint16(buffer[16+index*2:], value)
	}
	if err = windows.DeviceIoControl(handle, windows.FSCTL_SET_REPARSE_POINT, &buffer[0], uint32(len(buffer)), nil, 0,
		nil, nil); err != nil {
		t.Fatal(err)
	}
}

func TestStorageWindowsJunctionTraversalAndRemove(t *testing.T) {
	plugin, storageDir := newStorageTestPlugin(t)
	outside := filepath.Join(filepath.Dir(storageDir), "outside")
	if err := os.MkdirAll(outside, 0755); err != nil {
		t.Fatal(err)
	}
	sentinel := filepath.Join(outside, "keep")
	if err := os.WriteFile(sentinel, []byte("keep"), 0644); err != nil {
		t.Fatal(err)
	}

	topLevel := filepath.Join(storageDir, "junction")
	createStorageJunction(t, outside, topLevel)
	listed, err := plugin.storageList("")
	if err != nil {
		t.Fatal(err)
	}
	var junctionEntry R
	for _, entry := range listed {
		if entry["name"] == "junction" {
			junctionEntry = entry
			break
		}
	}
	if junctionEntry == nil {
		t.Fatalf("junction missing from list: %#v", listed)
	}
	info, err := os.Lstat(topLevel)
	if err != nil {
		t.Fatal(err)
	}
	if junctionEntry["isSymlink"] != (info.Mode()&os.ModeSymlink != 0) {
		t.Fatalf("junction symlink metadata does not follow Go mode: %#v, mode=%v", junctionEntry, info.Mode())
	}
	if _, err = plugin.storageList("junction"); err == nil {
		t.Fatal("list traversed a junction")
	}
	if err = plugin.storagePut(filepath.Join("junction", "escaped"), []byte("data")); err == nil {
		t.Fatal("put traversed a junction")
	}
	if err = plugin.storageRemove("junction"); err == nil {
		t.Fatal("remove accepted a top-level junction")
	}

	contained := filepath.Join(storageDir, "contained")
	if err = os.Mkdir(contained, 0755); err != nil {
		t.Fatal(err)
	}
	createStorageJunction(t, outside, filepath.Join(contained, "junction"))
	if err = plugin.storageRemove("contained"); err != nil {
		t.Fatalf("remove directory containing junction: %v", err)
	}
	data, err := os.ReadFile(sentinel)
	if err != nil || string(data) != "keep" {
		t.Fatalf("static junction removal changed sentinel %q: %v", data, err)
	}
}

func openStorageTargetWithoutDeleteSharing(t *testing.T, path string) windows.Handle {
	t.Helper()
	pathPointer, err := windows.UTF16PtrFromString(path)
	if err != nil {
		t.Fatal(err)
	}
	handle, err := windows.CreateFile(pathPointer, windows.GENERIC_READ,
		windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE, nil, windows.OPEN_EXISTING, windows.FILE_ATTRIBUTE_NORMAL, 0)
	if err != nil {
		t.Fatal(err)
	}
	return handle
}

func TestStorageWindowsPutRetriesSharingConflict(t *testing.T) {
	plugin, storageDir := newStorageTestPlugin(t)
	if err := plugin.storagePut("value", []byte("initial")); err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(storageDir, "value")

	t.Run("transient", func(t *testing.T) {
		handle := openStorageTargetWithoutDeleteSharing(t, target)
		done := make(chan error, 1)
		go func() { done <- plugin.storagePut("value", []byte("updated")) }()
		time.Sleep(250 * time.Millisecond)
		if err := windows.CloseHandle(handle); err != nil {
			t.Fatal(err)
		}
		if err := <-done; err != nil {
			t.Fatalf("put after transient sharing conflict: %v", err)
		}
		data, err := os.ReadFile(target)
		if err != nil || string(data) != "updated" {
			t.Fatalf("unexpected data %q: %v", data, err)
		}
	})

	t.Run("persistent", func(t *testing.T) {
		handle := openStorageTargetWithoutDeleteSharing(t, target)
		defer windows.CloseHandle(handle)
		if err := plugin.storagePut("value", []byte("blocked")); err == nil {
			t.Fatal("put succeeded through a persistent sharing conflict")
		}
		matches, err := filepath.Glob(filepath.Join(storageDir, ".siyuan-storage-*.tmp"))
		if err != nil || len(matches) != 0 {
			t.Fatalf("temporary files remain: %v, %v", matches, err)
		}
	})
}

func TestStorageWindowsRejectsReservedComponents(t *testing.T) {
	plugin, _ := newStorageTestPlugin(t)
	for _, path := range []string{"CON", "aux.txt", "trailing.", "trailing ", "colon:name"} {
		if err := plugin.storagePut(path, []byte("data")); err == nil {
			t.Errorf("put accepted reserved path %q", path)
		}
	}
}

func TestStorageWindowsQueuedContextCancellation(t *testing.T) {
	plugin, storageDir := newStorageTestPlugin(t)
	ctx, cancel := context.WithCancel(context.Background())
	canceledPlugin := &KernelPlugin{storageDir: storageDir, context: ctx}
	lock, err := plugin.storageTreeLock()
	if err != nil {
		t.Fatal(err)
	}
	lock.Lock()
	done := make(chan error, 1)
	go func() { done <- canceledPlugin.storagePut("value", []byte("data")) }()
	time.Sleep(20 * time.Millisecond)
	cancel()
	lock.Unlock()
	if err = <-done; err != context.Canceled {
		t.Fatalf("queued operation error = %v", err)
	}
}
