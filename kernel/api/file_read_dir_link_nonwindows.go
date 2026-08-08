//go:build !windows

// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org

package api

import "os"

func classifyWorkspaceLink(_ string, info os.FileInfo) (workspaceLinkKind, error) {
	if info.Mode()&os.ModeSymlink != 0 {
		return workspaceSymbolicLink, nil
	}
	return workspaceNotLink, nil
}
