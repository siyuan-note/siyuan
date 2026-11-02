// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package memory

import "path/filepath"

// StorageDir 是相对于工作空间 data 目录的长期记忆存储路径。
const StorageDir = "storage/ai/memory"

// SyncPrefix 是同步与快照使用的规范路径前缀。
const SyncPrefix = "/" + StorageDir + "/"

func Path(dataDir string) string {
	return filepath.Join(dataDir, filepath.FromSlash(StorageDir))
}
