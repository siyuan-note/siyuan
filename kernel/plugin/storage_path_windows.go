//go:build windows

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
	if component == "" || component == "." || component == ".." || strings.HasSuffix(component, ".") || strings.HasSuffix(component, " ") {
		return false
	}
	for _, char := range component {
		if char < 0x20 || strings.ContainsRune(`<>:"/\|?*`, char) {
			return false
		}
	}
	base := component
	if index := strings.IndexByte(base, '.'); index >= 0 {
		base = base[:index]
	}
	switch strings.ToUpper(base) {
	case "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9":
		return false
	}
	return true
}

func normalizeStorageRootLockKey(storageDir string) (string, error) {
	if storageDir == "" {
		return "", errors.New("siyuan.storage: storage root is unavailable")
	}
	absolute, err := filepath.Abs(filepath.Clean(storageDir))
	if err != nil {
		return "", err
	}
	return strings.ToLower(absolute), nil
}
