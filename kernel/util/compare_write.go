// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package util

import (
	"bytes"
	"fmt"
	"os"

	"github.com/88250/gulu"
	"github.com/siyuan-note/filelock"
)

// WriteFileIfUnchanged 在同一文件锁内比对扫描源并原子写入；original 为 nil 时要求目标不存在。
func WriteFileIfUnchanged(path string, original, data []byte) error {
	filelock.Lock(path)
	defer filelock.Unlock(path)
	current, err := os.ReadFile(path)
	if original == nil {
		if !os.IsNotExist(err) {
			return fmt.Errorf("target already exists or is unreadable: %s", path)
		}
	} else if err != nil {
		return err
	} else if !bytes.Equal(current, original) {
		return fmt.Errorf("source changed during asset relink: %s", path)
	}
	return gulu.File.WriteFileSafer(path, data, 0644)
}
