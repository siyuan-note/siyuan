//go:build windows

// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package synccommit

import (
	"errors"
	"path/filepath"
	"strings"

	"golang.org/x/sys/windows"
)

func canonicalFileLockPath(path string) string {
	return canonicalNearestWindowsPath(path, finalWindowsPath)
}
func canonicalLexicalFileLockPath(path string) string {
	return canonicalNearestWindowsPath(path, canonicalExistingWindowsPath)
}
func resolveExistingPath(path string) (string, error) {
	resolved, err := finalWindowsPath(path)
	if err != nil {
		return "", err
	}
	return preserveWindowsVolumeSpelling(path, filepath.Clean(resolved)), nil
}
func canonicalNearestWindowsPath(path string, canonicalize func(string) (string, error)) string {
	path = filepath.Clean(path)
	if !filepath.IsAbs(path) {
		return path
	}
	ancestor := path
	for {
		canonicalAncestor, err := canonicalize(ancestor)
		if err == nil {
			remainder, relErr := filepath.Rel(ancestor, path)
			if relErr != nil {
				return path
			}
			if remainder != "." {
				canonicalAncestor = filepath.Join(canonicalAncestor, remainder)
			}
			return preserveWindowsVolumeSpelling(path, filepath.Clean(canonicalAncestor))
		}
		parent := filepath.Dir(ancestor)
		if parent == ancestor {
			return path
		}
		ancestor = parent
	}
}
func finalWindowsPath(path string) (string, error) {
	pathUTF16, err := windows.UTF16PtrFromString(windowsSyscallPath(path))
	if err != nil {
		return "", err
	}
	handle, err := windows.CreateFile(pathUTF16, windows.FILE_READ_ATTRIBUTES,
		windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|windows.FILE_SHARE_DELETE, nil,
		windows.OPEN_EXISTING, windows.FILE_FLAG_BACKUP_SEMANTICS, 0)
	if err != nil {
		return "", err
	}
	defer windows.CloseHandle(handle)
	buffer := make([]uint16, 512)
	for {
		length, pathErr := windows.GetFinalPathNameByHandle(handle, &buffer[0], uint32(len(buffer)), 0)
		if pathErr != nil {
			return "", pathErr
		}
		if length == 0 {
			return "", errors.New("empty final Windows path")
		}
		if length < uint32(len(buffer)) {
			return stripWindowsExtendedPathPrefix(windows.UTF16ToString(buffer[:length])), nil
		}
		buffer = make([]uint16, length+1)
	}
}
func canonicalExistingWindowsPath(path string) (string, error) {
	path = filepath.Clean(path)
	volume := filepath.VolumeName(path)
	if volume == "" {
		return "", errors.New("Windows path has no volume")
	}
	remainder := strings.TrimLeft(strings.TrimPrefix(path, volume), `\/`)
	canonical := volume + string(filepath.Separator)
	for _, component := range strings.FieldsFunc(remainder, func(r rune) bool { return r == '\\' || r == '/' }) {
		entryName, err := actualWindowsDirectoryEntryName(canonical, component)
		if err != nil {
			return "", err
		}
		canonical = filepath.Join(canonical, entryName)
	}
	return canonical, nil
}
func actualWindowsDirectoryEntryName(parent, requested string) (string, error) {
	pattern, err := windows.UTF16PtrFromString(windowsSyscallPath(filepath.Join(parent, "*")))
	if err != nil {
		return "", err
	}
	var data windows.Win32finddata
	handle, err := windows.FindFirstFile(pattern, &data)
	if err != nil {
		return "", err
	}
	defer windows.FindClose(handle)
	for {
		entryName := windows.UTF16ToString(data.FileName[:])
		if strings.EqualFold(entryName, requested) {
			return entryName, nil
		}
		if err = windows.FindNextFile(handle, &data); err != nil {
			return "", err
		}
	}
}
func windowsSyscallPath(path string) string {
	if len(path) < 248 || strings.HasPrefix(path, `\\?\`) || strings.HasPrefix(path, `\??\`) || strings.HasPrefix(path, `\\.\`) {
		return path
	}
	if strings.HasPrefix(path, `\\`) {
		return `\\?\UNC\` + strings.TrimPrefix(path, `\\`)
	}
	return `\\?\` + path
}
func stripWindowsExtendedPathPrefix(path string) string {
	if strings.HasPrefix(path, `\\?\UNC\`) {
		return `\\` + path[len(`\\?\UNC\`):]
	}
	return strings.TrimPrefix(path, `\\?\`)
}
func preserveWindowsVolumeSpelling(original, canonical string) string {
	originalVolume := filepath.VolumeName(original)
	canonicalVolume := filepath.VolumeName(canonical)
	if originalVolume != "" && strings.EqualFold(originalVolume, canonicalVolume) {
		return originalVolume + canonical[len(canonicalVolume):]
	}
	return canonical
}
