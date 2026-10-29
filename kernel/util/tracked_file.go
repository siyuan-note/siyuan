// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package util

import (
	"github.com/88250/gulu"
	"github.com/siyuan-note/dejavu"
	"github.com/siyuan-note/filelock"
)

// WriteFileWithChangeTracking 在释放文件锁前标记写入，保留修改时间的后续操作也不会隐藏内容变化。
func WriteFileWithChangeTracking(path string, data []byte) error {
	filelock.Lock(path)
	defer filelock.Unlock(path)
	if err := gulu.File.WriteFileSafer(path, data, 0644); err != nil {
		return err
	}
	dejavu.MarkFileChanged(path)
	return nil
}

// CopyFileWithChangeTracking 复制单个文件并保留权限和时间，在目标文件锁内标记内容变化。
func CopyFileWithChangeTracking(source, destination string) error {
	first, second := source, destination
	if first > second {
		first, second = second, first
	}
	filelock.Lock(first)
	defer filelock.Unlock(first)
	if second != first {
		filelock.Lock(second)
		defer filelock.Unlock(second)
	}
	if err := gulu.File.CopyFile(source, destination); err != nil {
		return err
	}
	dejavu.MarkFileChanged(destination)
	return nil
}
