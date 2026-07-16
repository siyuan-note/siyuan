// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package synccommit

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"

	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var (
	ErrPathOutsideWorkspace = errors.New("path resolves outside workspace")
	ErrWorkspaceRoot        = errors.New("workspace root cannot be mutated")
	ErrTerminalRedirect     = errors.New("terminal symlink or junction cannot be mutated")
	ErrPathChanged          = errors.New("workspace path resolution changed")
	workspaceIOMu           sync.RWMutex
	workspaceCaseCache      sync.Map
)

// PathGuard 固定工作区路径的词法位置和物理位置，后续 I/O 必须通过该守卫重新校验。
type PathGuard struct {
	requestPath   string
	workspacePath string
	workspaceInfo os.FileInfo
	absPath       string
	resolvedPath  string
	mutation      bool
}

func ResolvePath(requestPath string, mutation bool) (PathGuard, error) {
	absPath, err := util.GetAbsPathInWorkspace(requestPath)
	if err != nil {
		return PathGuard{}, err
	}
	absPath, err = filepath.Abs(absPath)
	if err != nil {
		return PathGuard{}, err
	}
	absPath = filepath.Clean(absPath)
	workspacePath, err := filepath.Abs(util.WorkspaceDir)
	if err != nil {
		return PathGuard{}, err
	}
	workspacePath = filepath.Clean(workspacePath)
	if mutation && SamePath(absPath, workspacePath) {
		return PathGuard{}, ErrWorkspaceRoot
	}
	resolvedWorkspace, err := resolveExistingPath(workspacePath)
	if err != nil {
		return PathGuard{}, err
	}
	resolvedWorkspace, err = filepath.Abs(resolvedWorkspace)
	if err != nil {
		return PathGuard{}, err
	}
	resolvedWorkspace = filepath.Clean(resolvedWorkspace)
	workspaceInfo, err := os.Stat(workspacePath)
	if err != nil {
		return PathGuard{}, err
	}
	resolvedWorkspaceInfo, err := os.Stat(resolvedWorkspace)
	if err != nil {
		return PathGuard{}, err
	}
	if !os.SameFile(workspaceInfo, resolvedWorkspaceInfo) {
		return PathGuard{}, ErrPathChanged
	}
	resolvedPath, terminalLink, err := resolveNearestExistingWorkspaceAncestor(workspacePath, absPath)
	if err != nil {
		return PathGuard{}, err
	}
	if !SameOrNestedPath(resolvedWorkspace, resolvedPath) {
		return PathGuard{}, ErrPathOutsideWorkspace
	}
	if mutation && terminalLink {
		return PathGuard{}, ErrTerminalRedirect
	}
	return PathGuard{
		requestPath: requestPath, workspacePath: workspacePath, workspaceInfo: workspaceInfo,
		absPath: absPath, resolvedPath: resolvedPath, mutation: mutation,
	}, nil
}

func (guard PathGuard) RequestPath() string  { return guard.requestPath }
func (guard PathGuard) AbsPath() string      { return guard.absPath }
func (guard PathGuard) ResolvedPath() string { return guard.resolvedPath }
func (guard PathGuard) Mutation() bool       { return guard.mutation }

func (guard PathGuard) Revalidate() error {
	current, err := ResolvePath(guard.requestPath, guard.mutation)
	if err != nil {
		return err
	}
	if !SamePath(guard.workspacePath, current.workspacePath) || guard.workspaceInfo == nil || current.workspaceInfo == nil ||
		!os.SameFile(guard.workspaceInfo, current.workspaceInfo) || !SamePath(guard.absPath, current.absPath) ||
		!SamePath(guard.resolvedPath, current.resolvedPath) {
		return ErrPathChanged
	}
	return nil
}

func (guard PathGuard) OpenWorkspaceRoot() (*os.Root, string, error) {
	if guard.workspaceInfo == nil {
		return nil, "", ErrPathChanged
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
		return nil, "", ErrPathChanged
	}
	return root, filepath.Clean(relativePath), nil
}

func (guard PathGuard) RejectsEncryptedBox() bool {
	return model.EncryptedRawPathBoxID(guard.absPath) != "" || model.EncryptedRawPathBoxID(guard.resolvedPath) != ""
}

func (guard PathGuard) workspaceRelativePath() (string, error) {
	relativePath, err := filepath.Rel(guard.workspacePath, guard.absPath)
	if err != nil || !ValidRootRelativePath(relativePath, true) {
		return "", ErrPathOutsideWorkspace
	}
	return filepath.Clean(relativePath), nil
}

func resolveNearestExistingWorkspaceAncestor(workspacePath, absPath string) (string, bool, error) {
	ancestor := absPath
	for {
		if !SameOrNestedPath(workspacePath, ancestor) {
			return "", false, ErrPathOutsideWorkspace
		}
		info, lstatErr := os.Lstat(ancestor)
		if lstatErr == nil {
			resolvedAncestor, err := resolveExistingPath(ancestor)
			if err != nil {
				return "", false, err
			}
			resolvedAncestor, err = filepath.Abs(resolvedAncestor)
			if err != nil {
				return "", false, err
			}
			resolvedAncestor = filepath.Clean(resolvedAncestor)
			remainder, err := filepath.Rel(ancestor, absPath)
			if err != nil {
				return "", false, err
			}
			resolvedPath := resolvedAncestor
			if remainder != "." {
				resolvedPath = filepath.Join(resolvedAncestor, remainder)
			}
			terminalLink := false
			if SamePath(ancestor, absPath) {
				terminalLink, err = terminalPathRedirected(absPath, resolvedAncestor, info)
				if err != nil {
					return "", false, err
				}
			}
			return filepath.Clean(resolvedPath), terminalLink, nil
		}
		if !os.IsNotExist(lstatErr) {
			return "", false, lstatErr
		}
		if SamePath(ancestor, workspacePath) {
			return "", false, lstatErr
		}
		parent := filepath.Dir(ancestor)
		if SamePath(parent, ancestor) {
			return "", false, ErrPathOutsideWorkspace
		}
		ancestor = parent
	}
}

func terminalPathRedirected(absPath, resolvedPath string, info os.FileInfo) (bool, error) {
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
	return !SamePath(expectedPath, resolvedPath), nil
}

func ValidRootRelativePath(path string, allowRoot bool) bool {
	path = filepath.Clean(path)
	if filepath.IsAbs(path) || filepath.VolumeName(path) != "" || path == ".." || strings.HasPrefix(path, ".."+string(filepath.Separator)) {
		return false
	}
	return allowRoot || path != "."
}

func LockPaths(guards ...PathGuard) func() { return LockPathsAndAbsolute(guards, nil) }

func LockPathsAndAbsolute(guards []PathGuard, additionalPaths []string) func() {
	mutation := false
	for _, guard := range guards {
		mutation = mutation || guard.mutation
	}
	if mutation {
		workspaceIOMu.Lock()
	} else {
		workspaceIOMu.RLock()
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
			workspaceIOMu.Unlock()
		} else {
			workspaceIOMu.RUnlock()
		}
	}
}

func workspaceFileLockPaths(guards []PathGuard, additionalPaths []string) []string {
	paths := make([]string, 0, len(guards)*2+len(additionalPaths))
	seen := map[string]struct{}{}
	addPath := func(path string) {
		path = filepath.Clean(path)
		if path == "." || !filepath.IsAbs(path) {
			return
		}
		if _, exists := seen[path]; exists {
			return
		}
		seen[path] = struct{}{}
		paths = append(paths, path)
	}
	addPathAndAlias := func(path string) {
		addPath(path)
		addPath(canonicalFileLockPath(path))
	}
	for _, guard := range guards {
		addPathAndAlias(guard.absPath)
		addPathAndAlias(guard.resolvedPath)
		if !SamePath(guard.absPath, guard.resolvedPath) {
			addPath(canonicalLexicalFileLockPath(guard.absPath))
		}
	}
	for _, path := range additionalPaths {
		addPathAndAlias(path)
	}
	sort.Strings(paths)
	return paths
}

func SameOrNestedPath(root, target string) bool {
	root = ComparisonKey(root)
	target = ComparisonKey(target)
	if root == target {
		return true
	}
	relative, err := filepath.Rel(root, target)
	if err != nil || filepath.IsAbs(relative) || relative == ".." {
		return false
	}
	return !strings.HasPrefix(relative, ".."+string(filepath.Separator))
}

func SamePath(left, right string) bool { return ComparisonKey(left) == ComparisonKey(right) }

func ComparisonKey(path string) string { return ComparisonKeyFor(path, pathCaseInsensitive(path)) }

func ComparisonKeyFor(path string, caseInsensitive bool) string {
	path = filepath.Clean(path)
	if caseInsensitive {
		path = strings.ToLower(path)
	}
	return path
}

func pathCaseInsensitive(candidate string) bool {
	if runtime.GOOS == "windows" {
		return true
	}
	cacheKey := filepath.Clean(util.WorkspaceDir)
	if cacheKey == "" || cacheKey == "." {
		cacheKey = filepath.VolumeName(filepath.Clean(candidate))
	}
	if cached, exists := workspaceCaseCache.Load(cacheKey); exists {
		return cached.(bool)
	}
	caseInsensitive := DetectPathCaseInsensitive(candidate)
	workspaceCaseCache.Store(cacheKey, caseInsensitive)
	return caseInsensitive
}

func DetectPathCaseInsensitive(candidate string) bool {
	current := filepath.Clean(candidate)
	for {
		info, err := os.Lstat(current)
		if err == nil {
			name := filepath.Base(current)
			alternate := alternateASCIIPathCase(name)
			if alternate != name {
				alternateInfo, alternateErr := os.Lstat(filepath.Join(filepath.Dir(current), alternate))
				return alternateErr == nil && os.SameFile(info, alternateInfo)
			}
		}
		parent := filepath.Dir(current)
		if parent == current {
			return false
		}
		current = parent
	}
}

func ResolveExistingPath(path string) (string, error) { return resolveExistingPath(path) }

func alternateASCIIPathCase(name string) string {
	value := []byte(name)
	for index, char := range value {
		switch {
		case char >= 'a' && char <= 'z':
			value[index] = char - ('a' - 'A')
			return string(value)
		case char >= 'A' && char <= 'Z':
			value[index] = char + ('a' - 'A')
			return string(value)
		}
	}
	return name
}
