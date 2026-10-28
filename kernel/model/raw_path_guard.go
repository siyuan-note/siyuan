// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"path/filepath"

	"github.com/siyuan-note/siyuan/kernel/util"
)

// EncryptedRawPathBoxID 返回原始文件路径所属的加密笔记本 ID。
// 同时检查最长已存在父目录解析后的路径，防止通过符号链接绕过加密边界。
func EncryptedRawPathBoxID(absPath string) string {
	if normalized, err := filepath.Abs(absPath); err == nil {
		absPath = normalized
	}
	if boxID := util.BoxIDFromDataPath(absPath); boxID != "" && IsEncryptedBox(boxID) {
		return boxID
	}
	resolved := util.ResolveLongestExistingParent(absPath)
	if resolved != absPath {
		if boxID := util.BoxIDFromDataPath(resolved); boxID != "" && IsEncryptedBox(boxID) {
			return boxID
		}
	}
	return ""
}
