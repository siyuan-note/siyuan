//go:build windows

// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package api

import (
	"os"
	"syscall"
)

// Windows junctions, mount points, and other reparse points are not all
// surfaced as ModeSymlink. None of them may be opened through readDir, because
// doing so could inspect the reparse target instead of the directory entry.
func readDirPathInfoIsLink(info os.FileInfo) bool {
	if info == nil || info.Mode()&os.ModeSymlink != 0 {
		return info != nil
	}
	data, ok := info.Sys().(*syscall.Win32FileAttributeData)
	return ok && data.FileAttributes&syscall.FILE_ATTRIBUTE_REPARSE_POINT != 0
}
