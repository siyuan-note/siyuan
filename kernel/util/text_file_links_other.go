// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build !aix && !darwin && !dragonfly && !freebsd && !linux && !netbsd && !openbsd && !solaris && !windows

package util

import "os"

func openTextFileRead(*os.Root, string) (*os.File, error) {
	return nil, textFileError(TextFileInvalidPath, "safe file handles are unavailable on this platform")
}

func textFileSingleLink(*os.File, os.FileInfo) error {
	return textFileError(TextFileInvalidPath, "file link counts are unavailable on this platform")
}
