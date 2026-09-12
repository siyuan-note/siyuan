// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package util

import (
	"strings"

	"github.com/88250/lute/ast"
)

// SplitFileAnnotationRef 分离资源地址和标注 ID，保留资源地址的查询参数及片段，不改变已有引用的编码。
func SplitFileAnnotationRef(reference string) (assetLink, annotationID string) {
	reference = strings.TrimSpace(reference)
	pathEnd := strings.IndexAny(reference, "?#")
	if pathEnd < 0 {
		pathEnd = len(reference)
	}
	path := reference[:pathEnd]
	separator := strings.LastIndexByte(path, '/')
	if separator < 0 || !strings.HasSuffix(strings.ToLower(path[:separator]), ".pdf") ||
		!ast.IsNodeIDPattern(path[separator+1:]) {
		return "", ""
	}
	return path[:separator] + reference[pathEnd:], path[separator+1:]
}
