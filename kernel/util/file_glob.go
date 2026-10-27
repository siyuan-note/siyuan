// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package util

import (
	"path/filepath"
	"strings"
)

// MatchGlob 判断文件名是否匹配 glob 模式，模式支持 {a,b} 形式的展开。
func MatchGlob(filename, pattern string) bool {
	for _, p := range ExpandGlobBrace(pattern) {
		if matched, _ := filepath.Match(p, filename); matched {
			return true
		}
	}
	return false
}

// ExpandGlobBrace 把包含 {a,b} 的 glob 模式展开为多个不含花括号的模式。
// 不含花括号时原样返回单个模式。
func ExpandGlobBrace(pattern string) []string {
	i := strings.Index(pattern, "{")
	if i < 0 {
		return []string{pattern}
	}
	j := strings.Index(pattern[i:], "}")
	if j < 0 {
		return []string{pattern}
	}
	j += i
	prefix := pattern[:i]
	body := pattern[i+1 : j]
	suffix := pattern[j+1:]
	var result []string
	for opt := range strings.SplitSeq(body, ",") {
		result = append(result, ExpandGlobBrace(prefix+strings.TrimSpace(opt)+suffix)...)
	}
	return result
}
