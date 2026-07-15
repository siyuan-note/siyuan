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
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"

	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var (
	errWorkspacePathOutside    = errors.New("path resolves outside workspace")
	errWorkspaceRootMutation   = errors.New("workspace root cannot be mutated")
	errWorkspaceTerminalLink   = errors.New("terminal symlink or junction cannot be mutated")
	errWorkspacePathResolution = errors.New("workspace path resolution changed")
	workspaceFileAPIMu         sync.RWMutex
)

// workspacePathGuard keeps both the API-visible lexical path and the physical
// target obtained by resolving the nearest existing ancestor. The latter is
// required for create operations whose final path does not exist yet.
type workspacePathGuard struct {
	requestPath   string
	workspacePath string
	workspaceInfo os.FileInfo
	absPath       string
	resolvedPath  string
	mutation      bool
}

func resolveWorkspacePath(requestPath string, mutation bool) (workspacePathGuard, error) {
	absPath, err := util.GetAbsPathInWorkspace(requestPath)
	if err != nil {
		return workspacePathGuard{}, err
	}
	absPath, err = filepath.Abs(absPath)
	if err != nil {
		return workspacePathGuard{}, err
	}
	absPath = filepath.Clean(absPath)

	workspacePath, err := filepath.Abs(util.WorkspaceDir)
	if err != nil {
		return workspacePathGuard{}, err
	}
	workspacePath = filepath.Clean(workspacePath)
	if mutation && sameWorkspacePath(absPath, workspacePath) {
		return workspacePathGuard{}, errWorkspaceRootMutation
	}

	resolvedWorkspace, err := resolveExistingPath(workspacePath)
	if err != nil {
		return workspacePathGuard{}, err
	}
	resolvedWorkspace, err = filepath.Abs(resolvedWorkspace)
	if err != nil {
		return workspacePathGuard{}, err
	}
	resolvedWorkspace = filepath.Clean(resolvedWorkspace)
	workspaceInfo, err := os.Stat(workspacePath)
	if err != nil {
		return workspacePathGuard{}, err
	}
	resolvedWorkspaceInfo, err := os.Stat(resolvedWorkspace)
	if err != nil {
		return workspacePathGuard{}, err
	}
	if !os.SameFile(workspaceInfo, resolvedWorkspaceInfo) {
		return workspacePathGuard{}, errWorkspacePathResolution
	}

	resolvedPath, terminalLink, err := resolveNearestExistingWorkspaceAncestor(workspacePath, absPath)
	if err != nil {
		return workspacePathGuard{}, err
	}
	if !sameOrNestedWorkspacePath(resolvedWorkspace, resolvedPath) {
		return workspacePathGuard{}, errWorkspacePathOutside
	}
	if mutation && terminalLink {
		return workspacePathGuard{}, errWorkspaceTerminalLink
	}

	return workspacePathGuard{
		requestPath:   requestPath,
		workspacePath: workspacePath,
		workspaceInfo: workspaceInfo,
		absPath:       absPath,
		resolvedPath:  resolvedPath,
		mutation:      mutation,
	}, nil
}

func resolveNearestExistingWorkspaceAncestor(workspacePath, absPath string) (resolvedPath string, terminalLink bool, err error) {
	ancestor := absPath
	for {
		if !sameOrNestedWorkspacePath(workspacePath, ancestor) {
			return "", false, errWorkspacePathOutside
		}

		info, lstatErr := os.Lstat(ancestor)
		if lstatErr == nil {
			resolvedAncestor, evalErr := resolveExistingPath(ancestor)
			if evalErr != nil {
				return "", false, evalErr
			}
			resolvedAncestor, evalErr = filepath.Abs(resolvedAncestor)
			if evalErr != nil {
				return "", false, evalErr
			}
			resolvedAncestor = filepath.Clean(resolvedAncestor)

			remainder, relErr := filepath.Rel(ancestor, absPath)
			if relErr != nil {
				return "", false, relErr
			}
			resolvedPath = resolvedAncestor
			if remainder != "." {
				resolvedPath = filepath.Join(resolvedAncestor, remainder)
			}
			resolvedPath = filepath.Clean(resolvedPath)

			if sameWorkspacePath(ancestor, absPath) {
				terminalLink, err = terminalWorkspacePathRedirected(absPath, resolvedAncestor, info)
				if err != nil {
					return "", false, err
				}
			}
			return resolvedPath, terminalLink, nil
		}
		if !os.IsNotExist(lstatErr) {
			return "", false, lstatErr
		}
		if sameWorkspacePath(ancestor, workspacePath) {
			return "", false, lstatErr
		}
		parent := filepath.Dir(ancestor)
		if sameWorkspacePath(parent, ancestor) {
			return "", false, errWorkspacePathOutside
		}
		ancestor = parent
	}
}

func terminalWorkspacePathRedirected(absPath, resolvedPath string, info os.FileInfo) (bool, error) {
	if info.Mode()&os.ModeSymlink != 0 {
		return true, nil
	}
	resolvedParent, err := resolveExistingPath(filepath.Dir(absPath))
	if err != nil {
		return false, err
	}
	resolvedParent, err = filepath.Abs(resolvedParent)
	if err != nil {
		return false, err
	}
	expectedPath := filepath.Join(resolvedParent, filepath.Base(absPath))
	return !sameWorkspacePath(expectedPath, resolvedPath), nil
}

func (guard workspacePathGuard) revalidate() error {
	current, err := resolveWorkspacePath(guard.requestPath, guard.mutation)
	if err != nil {
		return err
	}
	if !sameWorkspacePath(guard.workspacePath, current.workspacePath) ||
		guard.workspaceInfo == nil || current.workspaceInfo == nil || !os.SameFile(guard.workspaceInfo, current.workspaceInfo) ||
		!sameWorkspacePath(guard.absPath, current.absPath) || !sameWorkspacePath(guard.resolvedPath, current.resolvedPath) {
		return errWorkspacePathResolution
	}
	return nil
}

// openWorkspaceRoot anchors subsequent I/O to the exact workspace directory
// that was inspected by resolveWorkspacePath. Paths returned by this function
// are relative to that root and therefore cannot be redirected outside it by
// replacing a parent directory with a symlink or junction after validation.
func (guard workspacePathGuard) openWorkspaceRoot() (*os.Root, string, error) {
	if guard.workspaceInfo == nil {
		return nil, "", errWorkspacePathResolution
	}
	relativePath, err := guard.workspaceRelativePath()
	if err != nil {
		return nil, "", err
	}

	root, err := os.OpenRoot(guard.workspacePath)
	if err != nil {
		return nil, "", err
	}
	openedInfo, err := root.Stat(".")
	if err != nil {
		_ = root.Close()
		return nil, "", err
	}
	currentInfo, err := os.Stat(guard.workspacePath)
	if err != nil {
		_ = root.Close()
		return nil, "", err
	}
	if !os.SameFile(guard.workspaceInfo, openedInfo) || !os.SameFile(openedInfo, currentInfo) {
		_ = root.Close()
		return nil, "", errWorkspacePathResolution
	}
	return root, filepath.Clean(relativePath), nil
}

func (guard workspacePathGuard) workspaceRelativePath() (string, error) {
	relativePath, err := filepath.Rel(guard.workspacePath, guard.absPath)
	if err != nil || !validWorkspaceRootRelativePath(relativePath, true) {
		return "", errWorkspacePathOutside
	}
	return filepath.Clean(relativePath), nil
}

// validateOpenedInfo binds authorization decisions made from resolvedPath to
// the object actually opened through os.Root. Once this check succeeds, the
// caller keeps the handle open so a later rename cannot change what is read.
func (guard workspacePathGuard) validateOpenedInfo(opened os.FileInfo) error {
	current, err := os.Stat(guard.resolvedPath)
	if err != nil {
		return err
	}
	if !os.SameFile(opened, current) {
		return errWorkspacePathResolution
	}
	return nil
}

func validWorkspaceRootRelativePath(path string, allowRoot bool) bool {
	path = filepath.Clean(path)
	if filepath.IsAbs(path) || filepath.VolumeName(path) != "" || path == ".." || strings.HasPrefix(path, ".."+string(filepath.Separator)) {
		return false
	}
	return allowRoot || path != "."
}

func (guard workspacePathGuard) rejectsEncryptedBox() bool {
	return rejectEncryptedBoxPath(guard.absPath) || rejectEncryptedBoxPath(guard.resolvedPath)
}

func lockWorkspacePaths(guards ...workspacePathGuard) func() {
	return lockWorkspacePathsAndAbsolute(guards, nil)
}

// lockWorkspacePathsAndAbsolute serializes workspace API I/O with model-side
// filelock operations. filelock keys are exact path strings and the mutexes are
// not reentrant, so normalize and de-duplicate exact absolute paths before
// taking every lock in one stable order. On Windows, also lock the on-disk
// canonical spelling: filelock treats case variants as distinct keys even
// though the filesystem does not, while model code normally uses paths built
// from the workspace root and the casing stored in directory entries.
//
// additionalPaths is used by copy APIs for external sources/destinations which
// do not have a workspacePathGuard but still need to coordinate with callers
// using filelock.Copy/WriteFile on those exact paths.
func lockWorkspacePathsAndAbsolute(guards []workspacePathGuard, additionalPaths []string) func() {
	mutation := false
	for _, guard := range guards {
		mutation = mutation || guard.mutation
	}
	if mutation {
		workspaceFileAPIMu.Lock()
	} else {
		workspaceFileAPIMu.RLock()
	}

	paths := workspaceFileLockPaths(guards, additionalPaths)
	for _, path := range paths {
		filelock.Lock(path)
	}
	return func() {
		for index := len(paths) - 1; index >= 0; index-- {
			filelock.Unlock(paths[index])
		}
		if mutation {
			workspaceFileAPIMu.Unlock()
		} else {
			workspaceFileAPIMu.RUnlock()
		}
	}
}

func workspaceFileLockPaths(guards []workspacePathGuard, additionalPaths []string) []string {
	paths := make([]string, 0, len(guards)*2+len(additionalPaths))
	seen := map[string]struct{}{}
	addPath := func(path string) {
		if path == "" {
			return
		}
		path = filepath.Clean(path)
		if !filepath.IsAbs(path) {
			return
		}
		if _, exists := seen[path]; exists {
			return
		}
		seen[path] = struct{}{}
		paths = append(paths, path)
	}
	addPathAndCanonicalAlias := func(path string) {
		addPath(path)
		addPath(canonicalFileLockPath(path))
	}
	for _, guard := range guards {
		for _, path := range []string{guard.absPath, guard.resolvedPath} {
			addPathAndCanonicalAlias(path)
		}
		if !sameWorkspacePath(guard.absPath, guard.resolvedPath) {
			addPath(canonicalLexicalFileLockPath(guard.absPath))
		}
	}
	for _, path := range additionalPaths {
		addPathAndCanonicalAlias(path)
	}
	sort.Strings(paths)
	return paths
}

func sameOrNestedWorkspacePath(root, target string) bool {
	root = workspacePathComparisonKey(root)
	target = workspacePathComparisonKey(target)
	if root == target {
		return true
	}
	rel, err := filepath.Rel(root, target)
	if err != nil || filepath.IsAbs(rel) || rel == ".." {
		return false
	}
	return !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}

func sameWorkspacePath(left, right string) bool {
	return workspacePathComparisonKey(left) == workspacePathComparisonKey(right)
}

func workspacePathComparisonKey(path string) string {
	path = filepath.Clean(path)
	if runtime.GOOS == "windows" {
		path = strings.ToLower(path)
	}
	return path
}
