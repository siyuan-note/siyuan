//go:build !windows

// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package plugin

import (
	"errors"
	"path/filepath"
	"strings"
)

func validStoragePathComponent(component string) bool {
	return component != "" && component != "." && component != ".." && !strings.ContainsRune(component, 0)
}

func normalizeStorageRootLockKey(storageDir string) (string, error) {
	if storageDir == "" {
		return "", errors.New("siyuan.storage: storage root is unavailable")
	}
	return filepath.Abs(filepath.Clean(storageDir))
}
