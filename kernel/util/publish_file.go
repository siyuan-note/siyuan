// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package util

import (
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

// IsPublishRelativePath 限定发布资源使用无歧义的相对路径，各平台采用相同的分段规则。
func IsPublishRelativePath(name string) bool {
	if name == "" || strings.ContainsAny(name, "\\:%\x00") {
		return false
	}
	for part := range strings.SplitSeq(name, "/") {
		if part == "" || part == "." || part == ".." || strings.TrimSpace(part) != part || strings.HasSuffix(part, ".") {
			return false
		}
	}
	return true
}

// OpenPublishFile 在已打开的目录句柄内逐级读取，拒绝链接和非普通文件，并校验打开前后的文件身份。
// 即使路径在检查后被替换，读取也不会转向链接目标或授权目录之外。
func OpenPublishFile(rootPath, name string) (*os.File, error) {
	if !IsPublishRelativePath(name) {
		return nil, fs.ErrPermission
	}
	root, err := os.OpenRoot(rootPath)
	if err != nil {
		return nil, err
	}
	defer func() { root.Close() }()
	parts := strings.Split(name, "/")
	for _, part := range parts[:len(parts)-1] {
		info, statErr := root.Lstat(part)
		if statErr != nil {
			return nil, statErr
		}
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return nil, fs.ErrPermission
		}
		next, openErr := root.OpenRoot(part)
		if openErr != nil {
			return nil, openErr
		}
		actual, actualErr := next.Stat(".")
		if actualErr != nil || !os.SameFile(info, actual) {
			next.Close()
			return nil, fs.ErrPermission
		}
		root.Close()
		root = next
	}
	leaf := parts[len(parts)-1]
	info, err := root.Lstat(leaf)
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() {
		return nil, fs.ErrPermission
	}
	file, err := root.Open(leaf)
	if err != nil {
		return nil, err
	}
	actual, err := file.Stat()
	if err != nil || !actual.Mode().IsRegular() || !os.SameFile(info, actual) {
		file.Close()
		return nil, fs.ErrPermission
	}
	return file, nil
}

// OpenPublishReaderFile 打开读者可见的包资源，并在读取前检查请求路径和已打开文件的敏感性。
// data/public 按设计公开，仍直接使用 OpenPublishFile，不经过本函数。
func OpenPublishReaderFile(rootPath, name string) (*os.File, error) {
	if !IsPublishRelativePath(name) {
		return nil, fs.ErrPermission
	}
	if IsSensitivePath(filepath.Join(rootPath, filepath.FromSlash(name))) {
		return nil, fs.ErrPermission
	}
	file, err := OpenPublishFile(rootPath, name)
	if err != nil {
		return nil, err
	}
	if err = checkPublishReaderFile(file); err != nil {
		file.Close()
		return nil, err
	}
	return file, nil
}
