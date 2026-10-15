// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package util

// SQLitePageCacheDSN 设置每个连接的页缓存预算，负值的单位为 KiB。
// 移动端采用 16 MiB，减少多连接和多个已解锁笔记本的内存压力。
func SQLitePageCacheDSN() string {
	if IsMobileContainer() {
		return "&_cache_size=-16384"
	}
	return "&_cache_size=-128000"
}
