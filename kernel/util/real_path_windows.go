// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build windows

package util

import (
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"syscall"

	"golang.org/x/sys/windows"
)

// isLinkFileInfo 识别符号链接和 Windows 的目录名称替代重解析点。
func isLinkFileInfo(info fs.FileInfo) bool {
	if info.Mode()&os.ModeSymlink != 0 {
		return true
	}
	if info.Mode()&os.ModeIrregular == 0 || info.IsDir() {
		return false
	}
	attributes, ok := info.Sys().(*syscall.Win32FileAttributeData)
	const directoryLink = syscall.FILE_ATTRIBUTE_DIRECTORY | syscall.FILE_ATTRIBUTE_REPARSE_POINT
	return ok && attributes.FileAttributes&directoryLink == directoryLink
}

// ResolveRealPath 使用文件句柄解析符号链接和目录联接，返回现有文件的最终绝对路径。
func ResolveRealPath(path string) (string, error) {
	absPath, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	pathUTF16, err := windows.UTF16PtrFromString(absPath)
	if err != nil {
		return "", err
	}
	handle, err := windows.CreateFile(
		pathUTF16,
		0,
		windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|windows.FILE_SHARE_DELETE,
		nil,
		windows.OPEN_EXISTING,
		windows.FILE_FLAG_BACKUP_SEMANTICS,
		0,
	)
	if err != nil {
		return "", err
	}
	defer func() {
		_ = windows.CloseHandle(handle)
	}()
	return resolveHandlePath(handle)
}

// resolveHandlePath 从现有句柄获取规范化长路径，避免重新按请求路径打开文件。
func resolveHandlePath(handle windows.Handle) (string, error) {
	buffer := make([]uint16, 512)
	for {
		length, callErr := windows.GetFinalPathNameByHandle(handle, &buffer[0], uint32(len(buffer)), 0)
		if callErr != nil {
			return "", callErr
		}
		if length < uint32(len(buffer)) {
			resolved := windows.UTF16ToString(buffer[:length])
			switch {
			case strings.HasPrefix(resolved, `\\?\UNC\`):
				resolved = `\\` + strings.TrimPrefix(resolved, `\\?\UNC\`)
			case len(resolved) > 5 && strings.HasPrefix(resolved, `\\?\`) && resolved[5] == ':':
				resolved = strings.TrimPrefix(resolved, `\\?\`)
			}
			return filepath.Clean(resolved), nil
		}
		buffer = make([]uint16, length+1)
	}
}
