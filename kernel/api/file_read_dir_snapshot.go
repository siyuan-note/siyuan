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
	"os"
	"path/filepath"
	"sort"
)

var (
	errReadDirEntryChanged                 = errors.New("directory entry changed during read")
	errReadDirMetadataReferenceUnsupported = errors.New("safe directory entry metadata references are unsupported on this platform")
)

type readDirMetadataReference struct {
	info       os.FileInfo
	sameFile   func(os.FileInfo) bool
	revalidate func() error
	close      func() error
}

func (reference *readDirMetadataReference) matches(info os.FileInfo) bool {
	return reference != nil && reference.info != nil && reference.sameFile != nil && reference.sameFile(info)
}

func (reference *readDirMetadataReference) revalidateEntry() error {
	if reference == nil || reference.revalidate == nil {
		return nil
	}
	return reference.revalidate()
}

func (reference *readDirMetadataReference) closeReference() error {
	if reference == nil || reference.close == nil {
		return nil
	}
	return reference.close()
}

type readDirSnapshotEntry struct {
	name      string
	isDir     bool
	isSymlink bool
	updated   int64
}

type readDirSnapshotter struct {
	root              *os.Root
	directory         *os.File
	directoryRelative string
	resolvedWorkspace string
	afterInitialStat  func(string)
}

func openReadDirDirectory(root *os.Root, relativePath string) (*os.File, error) {
	return root.Open(relativePath + string(filepath.Separator))
}

func readDirSnapshot(root *os.Root, directory *os.File, directoryRelative, resolvedWorkspace string) ([]readDirSnapshotEntry, error) {
	return (&readDirSnapshotter{
		root:              root,
		directory:         directory,
		directoryRelative: directoryRelative,
		resolvedWorkspace: resolvedWorkspace,
	}).read()
}

func (snapshotter *readDirSnapshotter) read() ([]readDirSnapshotEntry, error) {
	entries, err := snapshotter.directory.ReadDir(-1)
	if err != nil {
		return nil, err
	}
	sort.Slice(entries, func(i, j int) bool {
		return entries[i].Name() < entries[j].Name()
	})

	result := make([]readDirSnapshotEntry, 0, len(entries))
	for _, entry := range entries {
		snapshot, snapshotErr := snapshotter.readEntry(entry.Name())
		if snapshotErr != nil {
			return nil, snapshotErr
		}
		result = append(result, snapshot)
	}
	return result, nil
}

func (snapshotter *readDirSnapshotter) readEntry(name string) (readDirSnapshotEntry, error) {
	relativePath := filepath.Join(snapshotter.directoryRelative, name)
	absolutePath := filepath.Join(snapshotter.resolvedWorkspace, relativePath)
	before, err := snapshotter.root.Lstat(relativePath)
	if err != nil {
		return readDirSnapshotEntry{}, changedReadDirEntryError(name, err)
	}
	if err = pinWorkspaceFileInfo(before); err != nil {
		return readDirSnapshotEntry{}, changedReadDirEntryError(name, err)
	}
	linkKind, err := classifyWorkspaceLink(absolutePath, before)
	if err != nil {
		return readDirSnapshotEntry{}, changedReadDirEntryError(name, err)
	}
	if snapshotter.afterInitialStat != nil {
		snapshotter.afterInitialStat(name)
	}

	switch linkKind {
	case workspaceSymbolicLink:
		return snapshotter.readLinkEntry(name, absolutePath, before)
	case workspaceOtherReparse:
		return readDirSnapshotEntry{}, fmt.Errorf("%w: %s", errWorkspaceUnsupportedReparse, name)
	}
	if before.Mode().IsRegular() || before.IsDir() {
		return snapshotter.readMetadataEntry(name, relativePath, absolutePath, before)
	}

	after, err := snapshotter.root.Lstat(relativePath)
	if err != nil || pinWorkspaceFileInfo(after) != nil || !sameReadDirEntryType(before, after) || !os.SameFile(before, after) {
		return readDirSnapshotEntry{}, changedReadDirEntryError(name, err)
	}
	afterLinkKind, err := classifyWorkspaceLink(absolutePath, after)
	if err != nil || afterLinkKind != workspaceNotLink {
		return readDirSnapshotEntry{}, changedReadDirEntryError(name, err)
	}
	return readDirSnapshotEntry{name: name, updated: before.ModTime().Unix()}, nil
}

func (snapshotter *readDirSnapshotter) readMetadataEntry(name, relativePath, absolutePath string, before os.FileInfo) (snapshot readDirSnapshotEntry, err error) {
	reference, err := captureReadDirMetadataReference(snapshotter.directory, name)
	if err != nil {
		return readDirSnapshotEntry{}, changedReadDirEntryError(name, err)
	}
	defer func() {
		if closeErr := reference.closeReference(); err == nil && closeErr != nil {
			err = closeErr
		}
	}()

	if !sameReadDirEntryType(before, reference.info) || !reference.matches(before) {
		return readDirSnapshotEntry{}, changedReadDirEntryError(name, nil)
	}

	after, err := snapshotter.root.Lstat(relativePath)
	if err != nil || pinWorkspaceFileInfo(after) != nil ||
		!sameReadDirEntryType(reference.info, after) || !reference.matches(after) {
		return readDirSnapshotEntry{}, changedReadDirEntryError(name, err)
	}
	afterLinkKind, err := classifyWorkspaceLink(absolutePath, after)
	if err != nil || afterLinkKind != workspaceNotLink {
		return readDirSnapshotEntry{}, changedReadDirEntryError(name, err)
	}
	if err = reference.revalidateEntry(); err != nil {
		return readDirSnapshotEntry{}, changedReadDirEntryError(name, err)
	}
	return readDirSnapshotEntry{
		name:    name,
		isDir:   reference.info.IsDir(),
		updated: reference.info.ModTime().Unix(),
	}, nil
}

func sameReadDirEntryType(left, right os.FileInfo) bool {
	return left != nil && right != nil && left.Mode().Type() == right.Mode().Type()
}

func (snapshotter *readDirSnapshotter) readLinkEntry(name, absolutePath string, before os.FileInfo) (readDirSnapshotEntry, error) {
	resolved, err := resolveExistingWorkspacePath(absolutePath)
	if err != nil {
		return readDirSnapshotEntry{}, changedReadDirEntryError(name, err)
	}
	targetRelative, contained := workspaceRelativePath(snapshotter.resolvedWorkspace, resolved)
	if !contained {
		return readDirSnapshotEntry{}, errWorkspacePathOutside
	}
	targetInfo, err := snapshotter.root.Stat(targetRelative)
	if err != nil {
		return readDirSnapshotEntry{}, changedReadDirEntryError(name, err)
	}
	if err = pinWorkspaceFileInfo(targetInfo); err != nil {
		return readDirSnapshotEntry{}, changedReadDirEntryError(name, err)
	}

	after, err := os.Lstat(absolutePath)
	if err != nil || pinWorkspaceFileInfo(after) != nil || !sameReadDirEntryType(before, after) || !os.SameFile(before, after) {
		return readDirSnapshotEntry{}, changedReadDirEntryError(name, err)
	}
	afterLinkKind, err := classifyWorkspaceLink(absolutePath, after)
	if err != nil || afterLinkKind != workspaceSymbolicLink {
		return readDirSnapshotEntry{}, changedReadDirEntryError(name, err)
	}
	resolvedAfter, err := resolveExistingWorkspacePath(absolutePath)
	if err != nil || !sameCanonicalWorkspacePath(resolved, resolvedAfter) {
		return readDirSnapshotEntry{}, changedReadDirEntryError(name, err)
	}
	targetInfoAfter, err := snapshotter.root.Stat(targetRelative)
	if err != nil || pinWorkspaceFileInfo(targetInfoAfter) != nil || !sameReadDirEntryType(targetInfo, targetInfoAfter) || !os.SameFile(targetInfo, targetInfoAfter) {
		return readDirSnapshotEntry{}, changedReadDirEntryError(name, err)
	}
	return readDirSnapshotEntry{
		name:      name,
		isDir:     targetInfo.IsDir(),
		isSymlink: true,
		updated:   targetInfo.ModTime().Unix(),
	}, nil
}

func changedReadDirEntryError(name string, err error) error {
	if err == nil {
		return fmt.Errorf("%w: %s", errReadDirEntryChanged, name)
	}
	return fmt.Errorf("%w: %s: %v", errReadDirEntryChanged, name, err)
}
