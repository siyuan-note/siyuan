// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build windows

package model

import (
	"crypto/sha256"
	"fmt"
	"os"
	"syscall"
)

// templateHTTPFileProof 将卷及文件索引纳入身份，复制后保留时间戳也不能继承许可。
func templateHTTPFileProof(file *os.File) (string, bool, error) {
	if file == nil {
		return "", false, os.ErrInvalid
	}
	var info syscall.ByHandleFileInformation
	if err := syscall.GetFileInformationByHandle(syscall.Handle(file.Fd()), &info); err != nil {
		return "", false, err
	}
	identity := fmt.Sprintf("windows:%d:%d:%d:%d:%d:%d:%d:%d:%d", info.VolumeSerialNumber,
		info.FileIndexHigh, info.FileIndexLow, info.CreationTime.HighDateTime, info.CreationTime.LowDateTime,
		info.LastWriteTime.HighDateTime, info.LastWriteTime.LowDateTime, info.FileSizeHigh, info.FileSizeLow)
	return fmt.Sprintf("%x", sha256.Sum256([]byte(identity))), true, nil
}
