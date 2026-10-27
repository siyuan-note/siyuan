// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package util

import (
	"io"
	"os"
	"path/filepath"
)

// CopyPath 把源路径复制到目标路径，目录递归复制。
// 与 gulu.File.Copy 不同，这里按 0755 建立目录、不保留源文件权限，用于 CLI 与 MCP 的 file copy 工具。
func CopyPath(src, dst string) error {
	srcInfo, err := os.Stat(src)
	if err != nil {
		return err
	}
	if srcInfo.IsDir() {
		return CopyDir(src, dst)
	}
	return CopyFile(src, dst)
}

// CopyDir 递归复制目录内容到目标目录。
func CopyDir(src, dst string) error {
	if err := os.MkdirAll(dst, 0755); err != nil {
		return err
	}
	entries, err := os.ReadDir(src)
	if err != nil {
		return err
	}
	for _, e := range entries {
		if err := CopyPath(filepath.Join(src, e.Name()), filepath.Join(dst, e.Name())); err != nil {
			return err
		}
	}
	return nil
}

// CopyFile 按字节复制单个文件内容，不保留源文件的权限与修改时间。
func CopyFile(src, dst string) error {
	if err := os.MkdirAll(filepath.Dir(dst), 0755); err != nil {
		return err
	}
	srcF, err := os.Open(src)
	if err != nil {
		return err
	}
	defer srcF.Close()
	dstF, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer dstF.Close()
	_, err = io.Copy(dstF, srcF)
	return err
}
