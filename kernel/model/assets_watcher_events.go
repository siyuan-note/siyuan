// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"os"
	"path/filepath"
	"strings"

	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// assetWatchBatch 按路径保留事件，并记录是否需要重新安排同步。
type assetWatchBatch map[string]bool

func (batch assetWatchBatch) add(path string, changed bool) {
	if path != "" {
		batch[path] = batch[path] || changed
	}
}

func (batch assetWatchBatch) flush() {
	if len(batch) == 0 {
		return
	}
	needSync := false
	for path, changed := range batch {
		if strings.HasPrefix(filepath.Base(path), ".") || util.IsOfficeTempFile(path) || strings.HasSuffix(path, ".tmp") {
			continue
		}
		info, err := os.Stat(path)
		if info != nil && filelock.IsHidden(path) {
			continue
		}
		needSync = needSync || changed
		if os.IsNotExist(err) {
			HandleAssetsRemoveEvent(path)
		} else if err != nil {
			logging.LogErrorf("stat changed asset [%s] failed: %s", path, err)
		} else {
			// 原路径可能已经被新文件替换，按处理时的最终状态更新索引和缓存。
			HandleAssetsChangeEvent(path)
		}
	}
	if needSync {
		IncSync()
	}
	// 每批只刷新一次资源列表，以便使用 /资源 搜索。
	cache.LoadAssets()
}
