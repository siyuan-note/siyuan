// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build !windows

package model

import (
	"os"
	"path/filepath"
)

func resolveAppearanceDirectoryLink(link string) (string, error) {
	resolved, err := filepath.EvalSymlinks(link)
	if err != nil {
		return "", err
	}
	return filepath.Abs(resolved)
}

func createAppearanceDirectoryLink(target, link string) error {
	return os.Symlink(target, link)
}
