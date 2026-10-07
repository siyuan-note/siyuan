//go:build !aix && !darwin && !dragonfly && !freebsd && !linux && !netbsd && !openbsd && !solaris && !windows

// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// Licensed under the GNU Affero General Public License, version 3 or later.

package util

import "os"

func openTextFileRead(*os.Root, string) (*os.File, error) {
	return nil, textFileError("invalid_path", "safe file handles are unavailable on this platform")
}

func textFileSingleLink(*os.File, os.FileInfo) error {
	return textFileError("invalid_path", "file link counts are unavailable on this platform")
}
