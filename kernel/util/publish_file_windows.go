// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package util

import (
	"io/fs"
	"os"

	"golang.org/x/sys/windows"
)

// checkPublishReaderFile 按已打开句柄的真实长路径检查，拒绝通过短文件名访问敏感文件。
func checkPublishReaderFile(file *os.File) error {
	path, err := resolveHandlePath(windows.Handle(file.Fd()))
	if err != nil {
		return err
	}
	if IsSensitivePath(path) {
		return fs.ErrPermission
	}
	return nil
}
