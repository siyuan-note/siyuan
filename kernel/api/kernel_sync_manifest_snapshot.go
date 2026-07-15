// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package api

import (
	"errors"
	"fmt"
	"io"
	"os"
	"sort"
)

var (
	errReadDirEntryChanged        = errors.New("directory entry changed while being inspected")
	errKernelSyncManifestTooLarge = errors.New("kernel sync manifest directory entry limit exceeded")
)

type readDirEntrySnapshot struct {
	info        os.FileInfo
	isLink      bool
	changeToken string
}

// snapshotReadDirEntry obtains the metadata and change token for a directory
// entry from one stable object. Directory enumeration is intentionally used
// only to obtain the entry name: DirEntry.Info can describe an older object if
// the name is replaced after ReadDir returns.
//
// Links are never opened. On Windows, readDirPathInfoIsLink also recognizes
// junctions and every other reparse point, including those whose mode does not
// contain os.ModeSymlink. For regular files and directories, the Lstat calls
// on both sides of the open bind the opened handle to the enumerated name and
// reject a concurrent replacement or a transient link substitution.
func snapshotReadDirEntry(root *os.Root, name string) (readDirEntrySnapshot, error) {
	before, err := root.Lstat(name)
	if err != nil {
		return readDirEntrySnapshot{}, err
	}
	if readDirPathInfoIsLink(before) {
		return readDirLinkSnapshot(before), nil
	}
	if !before.IsDir() && !before.Mode().IsRegular() {
		return readDirMetadataSnapshot(before), nil
	}

	opened, err := root.Open(name)
	if err != nil {
		return readDirEntrySnapshot{}, err
	}
	openedInfo, statErr := opened.Stat()
	var changeToken string
	if statErr == nil {
		changeToken, statErr = fileChangeToken(opened, openedInfo)
	}
	closeErr := opened.Close()
	if statErr != nil {
		return readDirEntrySnapshot{}, statErr
	}
	if closeErr != nil {
		return readDirEntrySnapshot{}, closeErr
	}

	after, err := root.Lstat(name)
	if err != nil {
		return readDirEntrySnapshot{}, fmt.Errorf("%w: %v", errReadDirEntryChanged, err)
	}
	if readDirPathInfoIsLink(after) ||
		!os.SameFile(before, openedInfo) ||
		!os.SameFile(openedInfo, after) {
		return readDirEntrySnapshot{}, errReadDirEntryChanged
	}
	return readDirEntrySnapshot{info: openedInfo, changeToken: changeToken}, nil
}

func readDirLinkSnapshot(info os.FileInfo) readDirEntrySnapshot {
	snapshot := readDirMetadataSnapshot(info)
	snapshot.isLink = true
	return snapshot
}

func readDirMetadataSnapshot(info os.FileInfo) readDirEntrySnapshot {
	return readDirEntrySnapshot{
		info:        info,
		changeToken: fmt.Sprintf("v1:%d:%d", info.Size(), info.ModTime().UnixNano()),
	}
}

// readRootDirLimited 只在内核插件请求中限制目录项数量，避免在计算文件变更令牌前分配无界切片。
func readRootDirLimited(root *os.Root, maxEntries int) ([]os.DirEntry, error) {
	directory, err := root.Open(".")
	if err != nil {
		return nil, err
	}
	defer directory.Close()

	var entries []os.DirEntry
	if maxEntries <= 0 {
		entries, err = directory.ReadDir(-1)
		if err != nil {
			return nil, err
		}
	} else {
		for len(entries) <= maxEntries {
			batch, readErr := directory.ReadDir(maxEntries + 1 - len(entries))
			entries = append(entries, batch...)
			if len(entries) > maxEntries {
				return nil, errKernelSyncManifestTooLarge
			}
			if errors.Is(readErr, io.EOF) {
				break
			}
			if readErr != nil {
				return nil, readErr
			}
			if len(batch) == 0 {
				return nil, io.ErrNoProgress
			}
		}
	}
	sort.Slice(entries, func(left, right int) bool { return entries[left].Name() < entries[right].Name() })
	return entries, nil
}
