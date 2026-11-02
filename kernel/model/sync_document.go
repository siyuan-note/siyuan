// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"errors"

	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/documentaddressing"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

// unindexUnsupportedSyncDocument 清除旧版本索引和缓存，磁盘中的同步源保持原始字节。
func unindexUnsupportedSyncDocument(boxID, path, rootID string, err error) {
	if !errors.Is(err, treenode.ErrSpecTooNew) && !errors.Is(err, documentaddressing.ErrInvalidTitle) {
		return
	}
	cache.RemoveTreeDataInBox(rootID, boxID)
	cache.RemoveDocIALInBox(path, boxID)
	for _, block := range treenode.GetBlockTreesByRootIDInBox(rootID, boxID) {
		cache.RemoveBlockIAL(block.ID)
	}
	sql.RemoveTreeQueue(boxID, rootID)
	treenode.RemoveBlockTreesByRootID(boxID, rootID)
}
