// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package util

import (
	"archive/zip"
	"io"
	"os"
	"path/filepath"
)

// ExtractArchiveEntry 把 zip 条目解出到 destination，目录条目只创建目录。
// 文件条目按 0755 建立父目录并把修改时间对齐到条目时间；调用方负责路径越界校验。
func ExtractArchiveEntry(entry *zip.File, destination string) error {
	if entry.FileInfo().IsDir() {
		return os.MkdirAll(destination, 0755)
	}
	if err := os.MkdirAll(filepath.Dir(destination), 0755); err != nil {
		return err
	}
	source, err := entry.Open()
	if err != nil {
		return err
	}
	defer source.Close()
	target, err := os.Create(destination)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(target, source)
	closeErr := target.Close()
	if copyErr != nil {
		return copyErr
	}
	if closeErr != nil {
		return closeErr
	}
	return os.Chtimes(destination, entry.Modified, entry.Modified)
}
