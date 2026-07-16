// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"os"

	"github.com/siyuan-note/siyuan/kernel/synccommit"
)

type workspacePathGuard struct {
	core         synccommit.PathGuard
	absPath      string
	resolvedPath string
	mutation     bool
}

func resolveWorkspacePath(requestPath string, mutation bool) (workspacePathGuard, error) {
	guard, err := synccommit.ResolvePath(requestPath, mutation)
	if err != nil {
		return workspacePathGuard{}, err
	}
	return workspacePathGuard{
		core: guard, absPath: guard.AbsPath(), resolvedPath: guard.ResolvedPath(), mutation: guard.Mutation(),
	}, nil
}

func (guard workspacePathGuard) revalidate() error { return guard.core.Revalidate() }
func (guard workspacePathGuard) openWorkspaceRoot() (*os.Root, string, error) {
	return guard.core.OpenWorkspaceRoot()
}
func (guard workspacePathGuard) rejectsEncryptedBox() bool { return guard.core.RejectsEncryptedBox() }

func validWorkspaceRootRelativePath(path string, allowRoot bool) bool {
	return synccommit.ValidRootRelativePath(path, allowRoot)
}

func lockWorkspacePaths(guards ...workspacePathGuard) func() {
	core := make([]synccommit.PathGuard, len(guards))
	for index, guard := range guards {
		core[index] = guard.core
	}
	return synccommit.LockPaths(core...)
}

func sameOrNestedWorkspacePath(root, target string) bool {
	return synccommit.SameOrNestedPath(root, target)
}
func sameWorkspacePath(left, right string) bool     { return synccommit.SamePath(left, right) }
func workspacePathComparisonKey(path string) string { return synccommit.ComparisonKey(path) }
func workspacePathComparisonKeyFor(path string, caseInsensitive bool) string {
	return synccommit.ComparisonKeyFor(path, caseInsensitive)
}
func detectPathCaseInsensitive(path string) bool { return synccommit.DetectPathCaseInsensitive(path) }
