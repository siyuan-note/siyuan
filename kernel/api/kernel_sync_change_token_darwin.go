//go:build darwin

// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package api

import (
	"fmt"
	"os"
	"syscall"
)

func fileChangeToken(_ *os.File, info os.FileInfo) (string, error) {
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		return "", fmt.Errorf("unsupported Darwin file metadata")
	}
	return fmt.Sprintf("v2:%d:%d:%d:%d:%d:%d", info.Size(), info.ModTime().UnixNano(), stat.Dev, stat.Ino, stat.Ctimespec.Sec, stat.Ctimespec.Nsec), nil
}
