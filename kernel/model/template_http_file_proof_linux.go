// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build linux

package model

import (
	"crypto/sha256"
	"fmt"
	"os"
	"syscall"
)

// templateHTTPFileProof 读取已打开文件的身份及变更时间，不重新按路径查找。
func templateHTTPFileProof(file *os.File) (string, bool, error) {
	if file == nil {
		return "", false, os.ErrInvalid
	}
	info, err := file.Stat()
	if err != nil {
		return "", false, err
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		return "", false, nil
	}
	identity := fmt.Sprintf("linux:%d:%d:%d:%d:%d:%d:%d", stat.Dev, stat.Ino,
		stat.Ctim.Sec, stat.Ctim.Nsec, stat.Mtim.Sec, stat.Mtim.Nsec, stat.Size)
	return fmt.Sprintf("%x", sha256.Sum256([]byte(identity))), true, nil
}
