// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package util

import (
	"bytes"
	"os"

	"github.com/88250/gulu"
	"github.com/siyuan-note/dejavu"
	"github.com/siyuan-note/filelock"
)

// WriteFileWithPreflight 在同一文件锁内检查当前源文件后写入；源不存在时向检查函数传入 nil。
// 检查失败不创建或截断文件；普通数据沿用按页写入和原子回退，加密数据仅原子替换。
func WriteFileWithPreflight(path string, data []byte, useMmap bool, check func([]byte) error) error {
	filelock.Lock(path)
	defer filelock.Unlock(path)
	current, err := os.ReadFile(path)
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	if err = check(current); err != nil {
		return err
	}
	if current != nil && bytes.Equal(current, data) {
		return nil
	}
	if useMmap {
		file, openErr := os.OpenFile(path, os.O_RDWR|os.O_CREATE, 0644)
		if openErr == nil {
			writeErr := writeFileByMmap(file, data)
			closeErr := file.Close()
			if writeErr == nil && closeErr == nil {
				dejavu.MarkFileChanged(path)
				return nil
			}
		}
	}
	if err = gulu.File.WriteFileSafer(path, data, 0644); err == nil {
		dejavu.MarkFileChanged(path)
	}
	return err
}
