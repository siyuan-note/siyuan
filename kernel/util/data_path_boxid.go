// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package util

import (
	"path/filepath"
	"strings"

	"github.com/88250/lute/ast"
)

// BoxIDFromDataPath 从 data 目录下的绝对路径反推 boxID。
// 路径形如 <DataDir>/<boxID>/...，切出紧跟在 DataDir 后的一段；供文件系统层判断是否需整体解密、
// 以及 API 层判断资源是否属于加密笔记本。若不在 DataDir 下或 boxID 非合法 ID 模式，返回空串。
func BoxIDFromDataPath(absPath string) string {
	absPath = filepath.ToSlash(absPath)
	dataDir := filepath.ToSlash(DataDir)
	rel, err := filepath.Rel(dataDir, absPath)
	if err != nil {
		return ""
	}
	rel = filepath.ToSlash(rel)
	if strings.HasPrefix(rel, "..") || rel == "." || rel == "" {
		return ""
	}
	parts := strings.SplitN(rel, "/", 2)
	boxID := parts[0]
	if !ast.IsNodeIDPattern(boxID) {
		return ""
	}
	return boxID
}
