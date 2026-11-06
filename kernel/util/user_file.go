// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package util

import (
	"os"
	"path/filepath"

	"github.com/88250/gulu"
	"github.com/siyuan-note/filelock"
)

func isManagedWorkspaceFile(p string) bool {
	if WorkspaceDir == "" {
		return false
	}
	root := ResolveLongestExistingParent(WorkspaceDir)
	resolved := ResolveLongestExistingParent(p)
	return filepath.Clean(root) == filepath.Clean(resolved) || gulu.File.IsSubPath(root, resolved)
}

// ReadUserFile 对工作空间外的用户文件返回读取错误，工作空间数据沿用文件锁的错误保护。
func ReadUserFile(p string) ([]byte, error) {
	if isManagedWorkspaceFile(p) {
		return filelock.ReadFile(p)
	}
	filelock.Lock(p)
	defer filelock.Unlock(p)
	return os.ReadFile(p)
}

// WriteUserFile 将外部目标的权限与占用错误返回给调用方。
func WriteUserFile(p string, data []byte) error {
	if isManagedWorkspaceFile(p) {
		return filelock.WriteFile(p, data)
	}
	filelock.Lock(p)
	defer filelock.Unlock(p)
	return gulu.File.WriteFileSafer(p, data, 0644)
}

// CopyUserFile 的外部来源或目标可能被其他程序占用，错误交由导入、导出调用方处理。
func CopyUserFile(source, destination string) error {
	if isManagedWorkspaceFile(source) && isManagedWorkspaceFile(destination) {
		return filelock.Copy(source, destination)
	}
	filelock.Lock(source)
	defer filelock.Unlock(source)
	return gulu.File.Copy(source, destination)
}
