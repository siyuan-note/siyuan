// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package plugin

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/google/uuid"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func (p *KernelPlugin) storageContext() context.Context {
	if p != nil && p.context != nil {
		return p.context
	}
	return context.Background()
}

func (p *KernelPlugin) cleanStoragePath(relPath string, allowRoot bool) (relative, absolute string, err error) {
	if p == nil || p.storageDir == "" {
		return "", "", errors.New("siyuan.storage: storage root is unavailable")
	}
	if relPath == "" {
		relPath = "."
	}
	if filepath.IsAbs(relPath) || filepath.VolumeName(relPath) != "" {
		return "", "", errors.New("siyuan.storage: invalid path")
	}
	if relPath != "." {
		for _, component := range strings.Split(filepath.ToSlash(relPath), "/") {
			if !validStoragePathComponent(component) {
				return "", "", errors.New("siyuan.storage: invalid path component")
			}
		}
	}
	relative = filepath.Clean(relPath)
	if relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return "", "", errors.New("siyuan.storage: path traversal not allowed")
	}
	if !allowRoot && relative == "." {
		return "", "", errors.New("siyuan.storage: storage root is not a valid file target")
	}
	absolute = filepath.Join(p.storageDir, relative)
	return relative, absolute, nil
}

func relativePathInside(root, target string) (string, bool) {
	relative, err := filepath.Rel(root, target)
	if err != nil || filepath.IsAbs(relative) || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return "", false
	}
	return relative, true
}

func (p *KernelPlugin) openStorageRoot(create bool) (*os.Root, error) {
	if p == nil || p.storageDir == "" {
		return nil, errors.New("siyuan.storage: storage root is unavailable")
	}
	workspaceDir, err := filepath.Abs(util.WorkspaceDir)
	if err != nil {
		return nil, err
	}
	storageDir, err := filepath.Abs(p.storageDir)
	if err != nil {
		return nil, err
	}
	relative, inside := relativePathInside(workspaceDir, storageDir)
	if !inside || relative == "." {
		return nil, errors.New("siyuan.storage: storage root is outside workspace")
	}
	workspaceRoot, err := os.OpenRoot(workspaceDir)
	if err != nil {
		return nil, err
	}
	defer workspaceRoot.Close()
	storageRoot, err := openStorageDescendantNoLinks(p.storageContext(), workspaceRoot, relative, create)
	if err != nil {
		return nil, fmt.Errorf("siyuan.storage: open storage root: %w", err)
	}
	return storageRoot, nil
}

func (p *KernelPlugin) ensureStorageRoot() error {
	ctx := p.storageContext()
	if err := ctx.Err(); err != nil {
		return err
	}
	treeLock, err := p.storageTreeLock()
	if err != nil {
		return err
	}
	treeLock.Lock()
	defer treeLock.Unlock()
	if err = ctx.Err(); err != nil {
		return err
	}
	root, err := p.openStorageRoot(true)
	if err != nil {
		return fmt.Errorf("siyuan.storage: create storage root: %w", err)
	}
	defer root.Close()
	rootIdentity, err := root.Stat(".")
	if err != nil {
		return err
	}
	if err = ctx.Err(); err != nil {
		return err
	}
	return p.validateStorageRootIdentity(rootIdentity)
}

func openStorageDescendantNoLinks(ctx context.Context, base *os.Root, relative string, create bool) (*os.Root, error) {
	relative = filepath.Clean(relative)
	if relative == "." || filepath.IsAbs(relative) || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return nil, errors.New("storage directory is outside its root")
	}
	current := base
	currentOwned := false
	closeCurrent := func() {
		if currentOwned {
			_ = current.Close()
		}
	}
	for _, component := range strings.Split(relative, string(filepath.Separator)) {
		if err := ctx.Err(); err != nil {
			closeCurrent()
			return nil, err
		}
		if !validStoragePathComponent(component) {
			closeCurrent()
			return nil, errors.New("invalid storage directory component")
		}
		before, statErr := current.Lstat(component)
		if os.IsNotExist(statErr) && create {
			if mkdirErr := current.Mkdir(component, 0755); mkdirErr != nil && !os.IsExist(mkdirErr) {
				closeCurrent()
				return nil, mkdirErr
			}
			before, statErr = current.Lstat(component)
		}
		if statErr != nil {
			closeCurrent()
			return nil, statErr
		}
		if storagePathInfoIsLink(before) || !before.IsDir() {
			closeCurrent()
			return nil, errors.New("storage directory contains a link or non-directory component")
		}
		next, openErr := current.OpenRoot(component)
		if openErr != nil {
			closeCurrent()
			return nil, openErr
		}
		after, afterErr := current.Lstat(component)
		opened, openedErr := next.Stat(".")
		if afterErr != nil || openedErr != nil || storagePathInfoIsLink(after) || !after.IsDir() || !os.SameFile(before, after) || !os.SameFile(after, opened) {
			_ = next.Close()
			closeCurrent()
			if afterErr != nil {
				return nil, afterErr
			}
			if openedErr != nil {
				return nil, openedErr
			}
			return nil, errors.New("storage directory changed or resolved through a link")
		}
		closeCurrent()
		current = next
		currentOwned = true
	}
	if !currentOwned {
		return nil, errors.New("storage directory path is empty")
	}
	return current, nil
}

func openStorageParentNoLinks(ctx context.Context, root *os.Root, relative string, create bool) (parent *os.Root, parentRelative, base string, err error) {
	parentRelative, base = filepath.Dir(relative), filepath.Base(relative)
	if parentRelative == "." {
		parent, err = root.OpenRoot(".")
		return
	}
	parent, err = openStorageDescendantNoLinks(ctx, root, parentRelative, create)
	return
}

func openStorageEntry(parent *os.Root, name string) (*os.File, os.FileInfo, error) {
	before, err := parent.Lstat(name)
	if err != nil {
		return nil, nil, err
	}
	if storagePathInfoIsLink(before) || !before.Mode().IsRegular() {
		return nil, nil, errors.New("storage target is not a regular file")
	}
	file, err := openStorageFileForRead(parent, name)
	if err != nil {
		return nil, nil, err
	}
	opened, openedErr := file.Stat()
	after, afterErr := parent.Lstat(name)
	if openedErr != nil || afterErr != nil || storagePathInfoIsLink(after) || !opened.Mode().IsRegular() || !after.Mode().IsRegular() || !os.SameFile(before, opened) || !os.SameFile(before, after) {
		_ = file.Close()
		if openedErr != nil {
			return nil, nil, openedErr
		}
		if afterErr != nil {
			return nil, nil, afterErr
		}
		return nil, nil, errors.New("storage target changed or resolved through a link")
	}
	return file, opened, nil
}

func openStorageDirectory(parent *os.Root, name string) (*os.Root, os.FileInfo, error) {
	before, err := parent.Lstat(name)
	if err != nil {
		return nil, nil, err
	}
	if storagePathInfoIsLink(before) || !before.IsDir() {
		return nil, nil, errors.New("storage target is not a real directory")
	}
	directory, err := parent.OpenRoot(name)
	if err != nil {
		return nil, nil, err
	}
	opened, openedErr := directory.Stat(".")
	after, afterErr := parent.Lstat(name)
	if openedErr != nil || afterErr != nil || storagePathInfoIsLink(after) || !after.IsDir() || !os.SameFile(before, opened) || !os.SameFile(before, after) {
		_ = directory.Close()
		if openedErr != nil {
			return nil, nil, openedErr
		}
		if afterErr != nil {
			return nil, nil, afterErr
		}
		return nil, nil, errors.New("storage directory changed or resolved through a link")
	}
	return directory, opened, nil
}

func validateStorageEntryIdentity(parent *os.Root, name string, expected os.FileInfo, requireRegular bool) error {
	current, err := parent.Lstat(name)
	if err != nil {
		return err
	}
	if storagePathInfoIsLink(current) || !os.SameFile(expected, current) {
		return errors.New("storage target identity changed")
	}
	if requireRegular && !current.Mode().IsRegular() {
		return errors.New("storage target is not a regular file")
	}
	return nil
}

func validateStorageDirectoryBinding(ctx context.Context, root, parent *os.Root, parentRelative string) error {
	opened, err := parent.Stat(".")
	if err != nil {
		return err
	}
	if parentRelative == "." {
		current, statErr := root.Stat(".")
		if statErr != nil {
			return statErr
		}
		if !os.SameFile(opened, current) {
			return errors.New("storage parent directory identity changed")
		}
		return nil
	}
	current, err := openStorageDescendantNoLinks(ctx, root, parentRelative, false)
	if err != nil {
		return err
	}
	defer current.Close()
	currentInfo, err := current.Stat(".")
	if err != nil {
		return err
	}
	if !os.SameFile(opened, currentInfo) {
		return errors.New("storage parent directory identity changed")
	}
	return nil
}

func (p *KernelPlugin) validateStorageRootIdentity(expected os.FileInfo) error {
	current, err := p.openStorageRoot(false)
	if err != nil {
		return err
	}
	defer current.Close()
	currentInfo, err := current.Stat(".")
	if err != nil {
		return err
	}
	if !os.SameFile(expected, currentInfo) {
		return errors.New("siyuan.storage: storage root identity changed")
	}
	return nil
}

type storageContextReader struct {
	ctx    context.Context
	reader io.Reader
}

func (r *storageContextReader) Read(buffer []byte) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	return r.reader.Read(buffer)
}

func readStorageFileWithContext(ctx context.Context, file *os.File) ([]byte, error) {
	return io.ReadAll(&storageContextReader{ctx: ctx, reader: file})
}

func createStorageTemp(ctx context.Context, parent *os.Root, data []byte) (name string, info os.FileInfo, err error) {
	if err = ctx.Err(); err != nil {
		return
	}
	name = ".siyuan-storage-" + uuid.NewString() + ".tmp"
	temp, err := parent.OpenFile(name, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return "", nil, err
	}
	closed := false
	defer func() {
		if !closed {
			_ = temp.Close()
		}
		if err != nil {
			_ = parent.Remove(name)
		}
	}()
	if _, err = io.Copy(temp, &storageContextReader{ctx: ctx, reader: bytes.NewReader(data)}); err != nil {
		return
	}
	if err = ctx.Err(); err != nil {
		return
	}
	if err = temp.Sync(); err != nil {
		return
	}
	if err = temp.Chmod(0644); err != nil {
		return
	}
	if info, err = temp.Stat(); err != nil {
		return
	}
	err = temp.Close()
	closed = true
	return
}

func (p *KernelPlugin) storageGet(relPath string) ([]byte, error) {
	ctx := p.storageContext()
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	relative, absolute, err := p.cleanStoragePath(relPath, false)
	if err != nil {
		return nil, err
	}
	treeLock, err := p.storageTreeLock()
	if err != nil {
		return nil, err
	}
	treeLock.RLock()
	defer treeLock.RUnlock()
	if err = ctx.Err(); err != nil {
		return nil, err
	}
	filelock.Lock(absolute)
	defer filelock.Unlock(absolute)
	if err = ctx.Err(); err != nil {
		return nil, err
	}
	root, err := p.openStorageRoot(false)
	if err != nil {
		return nil, err
	}
	defer root.Close()
	rootIdentity, err := root.Stat(".")
	if err != nil {
		return nil, err
	}
	parent, parentRelative, base, err := openStorageParentNoLinks(ctx, root, relative, false)
	if err != nil {
		return nil, err
	}
	defer parent.Close()
	file, info, err := openStorageEntry(parent, base)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	if !info.Mode().IsRegular() {
		return nil, errors.New("storage target is not a regular file")
	}
	data, err := readStorageFileWithContext(ctx, file)
	if err != nil {
		return nil, err
	}
	if err = validateStorageEntryIdentity(parent, base, info, true); err != nil {
		return nil, err
	}
	if err = validateStorageDirectoryBinding(ctx, root, parent, parentRelative); err != nil {
		return nil, err
	}
	if err = p.validateStorageRootIdentity(rootIdentity); err != nil {
		return nil, err
	}
	return data, nil
}

func (p *KernelPlugin) storagePut(relPath string, data []byte) error {
	ctx := p.storageContext()
	if err := ctx.Err(); err != nil {
		return err
	}
	relative, absolute, err := p.cleanStoragePath(relPath, false)
	if err != nil {
		return err
	}
	treeLock, err := p.storageTreeLock()
	if err != nil {
		return err
	}
	treeLock.Lock()
	defer treeLock.Unlock()
	if err = ctx.Err(); err != nil {
		return err
	}
	filelock.Lock(absolute)
	defer filelock.Unlock(absolute)
	if err = ctx.Err(); err != nil {
		return err
	}
	root, err := p.openStorageRoot(false)
	if err != nil {
		return err
	}
	defer root.Close()
	rootIdentity, err := root.Stat(".")
	if err != nil {
		return err
	}
	parent, parentRelative, base, err := openStorageParentNoLinks(ctx, root, relative, true)
	if err != nil {
		return err
	}
	defer parent.Close()
	var existing os.FileInfo
	existed := false
	if existing, err = parent.Lstat(base); err == nil {
		existed = true
		if storagePathInfoIsLink(existing) || !existing.Mode().IsRegular() {
			return errors.New("storage target is not a regular file")
		}
	} else if !os.IsNotExist(err) {
		return err
	}
	tempName, tempIdentity, err := createStorageTemp(ctx, parent, data)
	if err != nil {
		return err
	}
	committed := false
	defer func() {
		if !committed {
			_ = parent.Remove(tempName)
		}
	}()
	current, statErr := parent.Lstat(base)
	if existed {
		if statErr != nil || storagePathInfoIsLink(current) || !current.Mode().IsRegular() || !os.SameFile(existing, current) {
			return errors.New("storage target identity changed before commit")
		}
	} else if !os.IsNotExist(statErr) {
		if statErr != nil {
			return statErr
		}
		return errors.New("storage target appeared before commit")
	}
	if err = validateStorageDirectoryBinding(ctx, root, parent, parentRelative); err != nil {
		return err
	}
	if err = p.validateStorageRootIdentity(rootIdentity); err != nil {
		return err
	}
	if err = ctx.Err(); err != nil {
		return err
	}
	tempRelative := filepath.Join(parentRelative, tempName)
	if err = commitStorageRename(ctx, root, tempRelative, relative); err != nil {
		return err
	}
	committed = true
	committedInfo, err := root.Lstat(relative)
	if err != nil || storagePathInfoIsLink(committedInfo) || !committedInfo.Mode().IsRegular() || !os.SameFile(tempIdentity, committedInfo) {
		return errors.New("storage target identity changed during commit")
	}
	if err = validateStorageDirectoryBinding(ctx, root, parent, parentRelative); err != nil {
		return err
	}
	if err = p.validateStorageRootIdentity(rootIdentity); err != nil {
		return err
	}
	return nil
}

func (p *KernelPlugin) storageRemove(relPath string) error {
	ctx := p.storageContext()
	if err := ctx.Err(); err != nil {
		return err
	}
	relative, absolute, err := p.cleanStoragePath(relPath, false)
	if err != nil {
		return err
	}
	treeLock, err := p.storageTreeLock()
	if err != nil {
		return err
	}
	treeLock.Lock()
	defer treeLock.Unlock()
	if err = ctx.Err(); err != nil {
		return err
	}
	filelock.Lock(absolute)
	defer filelock.Unlock(absolute)
	if err = ctx.Err(); err != nil {
		return err
	}
	root, err := p.openStorageRoot(false)
	if err != nil {
		return err
	}
	defer root.Close()
	rootIdentity, err := root.Stat(".")
	if err != nil {
		return err
	}
	parent, parentRelative, base, err := openStorageParentNoLinks(ctx, root, relative, false)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	defer parent.Close()
	if err = validateStorageDirectoryBinding(ctx, root, parent, parentRelative); err != nil {
		return err
	}
	if err = p.validateStorageRootIdentity(rootIdentity); err != nil {
		return err
	}
	target, err := parent.Lstat(base)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	if storagePathInfoIsLink(target) {
		return errors.New("storage remove target is a link or reparse point")
	}
	if err = ctx.Err(); err != nil {
		return err
	}
	// The tree write lock linearizes whole-tree operations in-process;
	// Root.RemoveAll removes only a static internal link itself.
	// Physical path isolation from an external process concurrently moving an open
	// directory is out of scope.
	if err = root.RemoveAll(relative); err != nil {
		return err
	}
	if err = validateStorageDirectoryBinding(ctx, root, parent, parentRelative); err != nil {
		return err
	}
	return p.validateStorageRootIdentity(rootIdentity)
}

type storageListSnapshotEntry struct {
	name string
	info os.FileInfo
}

func sameStorageMetadata(left, right os.FileInfo) bool {
	return os.SameFile(left, right) && left.Mode() == right.Mode() && left.Size() == right.Size() && left.ModTime().Equal(right.ModTime())
}

func snapshotStorageListEntry(entry os.DirEntry, lstat func(string) (os.FileInfo, error)) (storageListSnapshotEntry, bool) {
	info, err := entry.Info()
	if err != nil {
		return storageListSnapshotEntry{}, false
	}
	current, err := lstat(entry.Name())
	if err != nil || !sameStorageMetadata(info, current) {
		return storageListSnapshotEntry{}, false
	}
	return storageListSnapshotEntry{name: entry.Name(), info: current}, true
}

func storageListSnapshotResult(entry storageListSnapshotEntry) R {
	// Public fields follow Go ModeSymlink; storagePathInfoIsLink still rejects all
	// Windows reparse points during traversal.
	return R{
		"name":      entry.name,
		"isDir":     entry.info.IsDir(),
		"isSymlink": entry.info.Mode()&os.ModeSymlink != 0,
		"updated":   entry.info.ModTime().Unix(),
	}
}

func filterStorageListSnapshot(ctx context.Context, snapshot []storageListSnapshotEntry,
	lstat func(string) (os.FileInfo, error)) ([]R, error) {
	results := make([]R, 0, len(snapshot))
	for _, entry := range snapshot {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		current, err := lstat(entry.name)
		if err != nil || !sameStorageMetadata(entry.info, current) {
			continue
		}
		results = append(results, storageListSnapshotResult(entry))
	}
	return results, nil
}

func readStorageDirectoryEntries(directory *os.Root) ([]os.DirEntry, error) {
	file, err := directory.Open(".")
	if err != nil {
		return nil, err
	}
	entries, readErr := file.ReadDir(-1)
	closeErr := file.Close()
	if readErr != nil {
		return nil, readErr
	}
	if closeErr != nil {
		return nil, closeErr
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].Name() < entries[j].Name() })
	return entries, nil
}

func (p *KernelPlugin) storageList(relPath string) ([]R, error) {
	ctx := p.storageContext()
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	relative, absolute, err := p.cleanStoragePath(relPath, true)
	if err != nil {
		return nil, err
	}
	treeLock, err := p.storageTreeLock()
	if err != nil {
		return nil, err
	}
	treeLock.RLock()
	defer treeLock.RUnlock()
	if err = ctx.Err(); err != nil {
		return nil, err
	}
	filelock.Lock(absolute)
	defer filelock.Unlock(absolute)
	if err = ctx.Err(); err != nil {
		return nil, err
	}
	root, err := p.openStorageRoot(false)
	if err != nil {
		return nil, err
	}
	defer root.Close()
	rootIdentity, err := root.Stat(".")
	if err != nil {
		return nil, err
	}
	parent, parentRelative, base, err := openStorageParentNoLinks(ctx, root, relative, false)
	if err != nil {
		return nil, err
	}
	defer parent.Close()
	directory, directoryIdentity, err := openStorageDirectory(parent, base)
	if err != nil {
		return nil, err
	}
	defer directory.Close()
	entries, err := readStorageDirectoryEntries(directory)
	if err != nil {
		return nil, err
	}
	snapshot := make([]storageListSnapshotEntry, 0, len(entries))
	for _, entry := range entries {
		if err = ctx.Err(); err != nil {
			return nil, err
		}
		if candidate, ok := snapshotStorageListEntry(entry, directory.Lstat); ok {
			snapshot = append(snapshot, candidate)
		}
	}
	results, err := filterStorageListSnapshot(ctx, snapshot, directory.Lstat)
	if err != nil {
		return nil, err
	}
	if err = validateStorageEntryIdentity(parent, base, directoryIdentity, false); err != nil {
		return nil, err
	}
	if err = validateStorageDirectoryBinding(ctx, root, parent, parentRelative); err != nil {
		return nil, err
	}
	if err = p.validateStorageRootIdentity(rootIdentity); err != nil {
		return nil, err
	}
	return results, nil
}
