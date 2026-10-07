// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// Licensed under the GNU Affero General Public License, version 3 or later.

package bazaar

// Windows 不支持目录 FlushFileBuffers，普通文件已在发布恢复点前逐个 Sync。
func syncInstallDirectory(_ string) error { return nil }
