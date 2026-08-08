//go:build !windows

// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org

package api

import "path/filepath"

func resolveExistingWorkspacePath(path string) (string, error) {
	resolved, err := filepath.EvalSymlinks(path)
	if err != nil {
		return "", err
	}
	resolved, err = filepath.Abs(resolved)
	if err != nil {
		return "", err
	}
	return filepath.Clean(resolved), nil
}
