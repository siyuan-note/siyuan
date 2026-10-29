// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package util

import (
	"crypto/rand"
	"errors"
	"fmt"
	"os"
)

func newFileSysStatusCheckData() ([]byte, error) {
	// 每批使用独立的随机标识，其余内容填充为普通文本，保持探测文件大小不变。
	var id [16]byte
	if _, err := rand.Read(id[:]); err != nil {
		return nil, err
	}
	data := make([]byte, 4096)
	offset := copy(data, fmt.Sprintf("SiYuan file system consistency check\nCheck ID: %x\n", id))
	const line = "SiYuan uses this temporary file to check file system consistency.\n"
	for offset < len(data) {
		offset += copy(data[offset:], line)
	}
	return data, nil
}

func fileSysStatusCheckError(err error) error {
	if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	// 保留原始操作和完整路径；不存在错误也可能来自父目录，不能据此断定文件被隔离。
	return fmt.Errorf("file system check file or parent directory is missing; it may have been removed by another program or quarantined by security software; check the paths and quarantine records: %w", err)
}
