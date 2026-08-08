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
	"runtime"
	"sort"
	"strings"

	"github.com/siyuan-note/filelock"
)

var (
	errWorkspacePathOutside        = errors.New("path escapes workspace")
	errWorkspacePathChanged        = errors.New("workspace path changed during directory read")
	errWorkspaceRootUnavailable    = errors.New("workspace root is unavailable")
	errWorkspaceUnsupportedReparse = errors.New("unsupported reparse point in workspace path")
)

type workspaceLinkKind uint8

const (
	workspaceNotLink workspaceLinkKind = iota
	workspaceSymbolicLink
	workspaceOtherReparse
)

type workspacePathObservation struct {
	path     string
	info     os.FileInfo
	linkKind workspaceLinkKind
}

type workspacePathGuard struct {
	workspacePath      string
	requestedPath      string
	relativePath       string
	resolvedWorkspace  string
	resolvedRequested  string
	workspaceInfo      os.FileInfo
	requestedInfo      os.FileInfo
	observations       []workspacePathObservation
	unsupportedReparse bool
}

func newWorkspacePathGuard(workspacePath, requestedPath string) (*workspacePathGuard, error) {
	workspaceAbs, err := filepath.Abs(workspacePath)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", errWorkspaceRootUnavailable, err)
	}
	workspaceAbs = filepath.Clean(workspaceAbs)
	if filepath.IsAbs(requestedPath) || filepath.VolumeName(requestedPath) != "" {
		return nil, errWorkspacePathOutside
	}

	requestedAbs := filepath.Clean(filepath.Join(workspaceAbs, requestedPath))
	relativePath, contained := workspaceRelativePath(workspaceAbs, requestedAbs)
	if !contained {
		return nil, errWorkspacePathOutside
	}

	resolvedWorkspace, err := resolveExistingWorkspacePath(workspaceAbs)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", errWorkspaceRootUnavailable, err)
	}
	workspaceInfo, err := os.Stat(workspaceAbs)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", errWorkspaceRootUnavailable, err)
	}
	if err = pinWorkspaceFileInfo(workspaceInfo); err != nil {
		return nil, fmt.Errorf("%w: %v", errWorkspaceRootUnavailable, err)
	}
	if !workspaceInfo.IsDir() {
		return nil, fmt.Errorf("%w: workspace root is not a directory", errWorkspaceRootUnavailable)
	}

	resolvedRequested, err := resolveExistingWorkspacePath(requestedAbs)
	if err != nil {
		return nil, err
	}
	if !workspacePathContains(resolvedWorkspace, resolvedRequested) {
		return nil, errWorkspacePathOutside
	}
	requestedInfo, err := os.Stat(requestedAbs)
	if err != nil {
		return nil, err
	}
	if err = pinWorkspaceFileInfo(requestedInfo); err != nil {
		return nil, err
	}

	observations, unsupportedReparse, err := observeWorkspacePath(workspaceAbs, relativePath)
	if err != nil {
		return nil, err
	}
	return &workspacePathGuard{
		workspacePath:      workspaceAbs,
		requestedPath:      requestedAbs,
		relativePath:       relativePath,
		resolvedWorkspace:  resolvedWorkspace,
		resolvedRequested:  resolvedRequested,
		workspaceInfo:      workspaceInfo,
		requestedInfo:      requestedInfo,
		observations:       observations,
		unsupportedReparse: unsupportedReparse,
	}, nil
}

func (guard *workspacePathGuard) lock() func() {
	// filelock coordinates exact path spellings only. Root and identity
	// revalidation below enforce correctness when aliases do not share a lock.
	pathsByName := map[string]struct{}{}
	for _, observation := range guard.observations {
		pathsByName[observation.path] = struct{}{}
	}
	paths := make([]string, 0, len(pathsByName))
	for path := range pathsByName {
		paths = append(paths, path)
	}
	sort.Strings(paths)
	for _, path := range paths {
		filelock.Lock(path)
	}
	return func() {
		for i := len(paths) - 1; i >= 0; i-- {
			filelock.Unlock(paths[i])
		}
	}
}

func (guard *workspacePathGuard) revalidate() error {
	resolvedWorkspace, err := resolveExistingWorkspacePath(guard.workspacePath)
	if err != nil || !sameCanonicalWorkspacePath(resolvedWorkspace, guard.resolvedWorkspace) {
		return errWorkspacePathChanged
	}
	workspaceInfo, err := os.Stat(guard.workspacePath)
	if err != nil || pinWorkspaceFileInfo(workspaceInfo) != nil || !os.SameFile(workspaceInfo, guard.workspaceInfo) {
		return errWorkspacePathChanged
	}

	for _, observation := range guard.observations {
		info, statErr := os.Lstat(observation.path)
		if statErr != nil || pinWorkspaceFileInfo(info) != nil || !os.SameFile(info, observation.info) {
			return errWorkspacePathChanged
		}
		linkKind, linkErr := classifyWorkspaceLink(observation.path, info)
		if linkErr != nil || linkKind != observation.linkKind {
			return errWorkspacePathChanged
		}
	}

	resolvedRequested, err := resolveExistingWorkspacePath(guard.requestedPath)
	if err != nil || !sameCanonicalWorkspacePath(resolvedRequested, guard.resolvedRequested) {
		return errWorkspacePathChanged
	}
	if !workspacePathContains(resolvedWorkspace, resolvedRequested) {
		return errWorkspacePathChanged
	}
	requestedInfo, err := os.Stat(guard.requestedPath)
	if err != nil || pinWorkspaceFileInfo(requestedInfo) != nil || !os.SameFile(requestedInfo, guard.requestedInfo) {
		return errWorkspacePathChanged
	}
	return nil
}

func (guard *workspacePathGuard) openRoot() (*os.Root, error) {
	root, err := os.OpenRoot(guard.workspacePath)
	if err != nil {
		return nil, err
	}
	rootInfo, err := root.Stat(".")
	if err != nil || pinWorkspaceFileInfo(rootInfo) != nil || !os.SameFile(rootInfo, guard.workspaceInfo) {
		root.Close()
		return nil, errWorkspacePathChanged
	}
	return root, nil
}

func (guard *workspacePathGuard) verifyRequestedInfo(info os.FileInfo) error {
	if pinWorkspaceFileInfo(info) != nil || !os.SameFile(info, guard.requestedInfo) {
		return errWorkspacePathChanged
	}
	return nil
}

func observeWorkspacePath(workspacePath, relativePath string) ([]workspacePathObservation, bool, error) {
	paths := []string{workspacePath}
	if relativePath != "." {
		current := workspacePath
		for _, component := range strings.Split(relativePath, string(filepath.Separator)) {
			current = filepath.Join(current, component)
			paths = append(paths, current)
		}
	}

	observations := make([]workspacePathObservation, 0, len(paths))
	unsupportedReparse := false
	for i, path := range paths {
		info, err := os.Lstat(path)
		if err != nil {
			return nil, false, err
		}
		if err = pinWorkspaceFileInfo(info); err != nil {
			return nil, false, err
		}
		linkKind, err := classifyWorkspaceLink(path, info)
		if err != nil {
			return nil, false, err
		}
		if i > 0 && linkKind == workspaceOtherReparse {
			unsupportedReparse = true
		}
		observations = append(observations, workspacePathObservation{path: path, info: info, linkKind: linkKind})
	}
	return observations, unsupportedReparse, nil
}

func pinWorkspaceFileInfo(info os.FileInfo) error {
	if info == nil || !os.SameFile(info, info) {
		return errors.New("failed to capture filesystem identity")
	}
	return nil
}

func workspaceRelativePath(workspacePath, requestedPath string) (string, bool) {
	return workspaceRelativePathForOS(workspacePath, requestedPath, runtime.GOOS)
}

func workspaceRelativePathForOS(workspacePath, requestedPath, goos string) (string, bool) {
	workspaceCanonical := canonicalWorkspacePathForOS(workspacePath, goos)
	requestedCanonical := canonicalWorkspacePathForOS(requestedPath, goos)
	canonicalRelative, err := filepath.Rel(workspaceCanonical, requestedCanonical)
	if err != nil || workspaceRelativePathEscapes(canonicalRelative) {
		return "", false
	}
	if canonicalRelative == "." || canonicalRelative == "" {
		return ".", true
	}

	requestedPath = filepath.Clean(requestedPath)
	volume := filepath.VolumeName(requestedPath)
	components := strings.Split(strings.TrimPrefix(requestedPath[len(volume):], string(filepath.Separator)), string(filepath.Separator))
	relativeComponents := strings.Split(canonicalRelative, string(filepath.Separator))
	if len(components) < len(relativeComponents) {
		return "", false
	}
	return filepath.Join(components[len(components)-len(relativeComponents):]...), true
}

func workspaceRelativePathEscapes(relativePath string) bool {
	return filepath.IsAbs(relativePath) || relativePath == ".." || strings.HasPrefix(relativePath, ".."+string(filepath.Separator))
}

func workspacePathContains(workspacePath, requestedPath string) bool {
	_, contained := workspaceRelativePath(workspacePath, requestedPath)
	return contained
}

func sameCanonicalWorkspacePath(left, right string) bool {
	return canonicalWorkspacePath(left) == canonicalWorkspacePath(right)
}

func canonicalWorkspacePath(path string) string {
	return canonicalWorkspacePathForOS(path, runtime.GOOS)
}

func canonicalWorkspacePathForOS(path, goos string) string {
	path = filepath.Clean(path)
	if goos == "windows" {
		path = strings.ToLower(path)
	}
	return path
}
