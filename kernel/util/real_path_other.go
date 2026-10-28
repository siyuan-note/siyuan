// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build !windows

package util

import (
	"io/fs"
	"os"
	"path/filepath"
)

func isLinkFileInfo(info fs.FileInfo) bool {
	return info.Mode()&os.ModeSymlink != 0
}

func ResolveRealPath(path string) (string, error) {
	return filepath.EvalSymlinks(path)
}
