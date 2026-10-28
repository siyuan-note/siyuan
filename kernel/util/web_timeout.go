// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package util

// NormalizeWebTimeout 统一网页搜索和抓取的超时秒数。
func NormalizeWebTimeout(timeout int) int {
	if timeout < 1 {
		return 30
	}
	return min(timeout, 600)
}
