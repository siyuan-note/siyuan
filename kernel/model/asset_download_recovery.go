// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"errors"
	"time"

	"github.com/siyuan-note/dejavu"
)

// processAssetDownloadRecovery 仅在同步流程中恢复，并在确认变更前更新内核状态
func processAssetDownloadRecovery(repo *dejavu.Repo, recoverFiles bool) error {
	var id string
	var changes *dejavu.MergeResult
	var err error
	if recoverFiles {
		id, changes, err = repo.RecoverAssetDownloads(newSyncContext())
	} else {
		id, changes, err = repo.AssetDownloadChanges()
	}
	if changes != nil && changes.DataChanged() {
		changes = syncCheckoutUnindexed(changes)
		if handled, prepareErr := reconcileSyncCheckoutChanges(changes); prepareErr != nil {
			return errors.Join(err, prepareErr)
		} else if !handled {
			mode := "a"
			if !recoverFiles {
				mode = "c"
			}
			processSyncMergeResult(false, false, changes, &dejavu.TrafficStat{}, mode, 0, true)
		}
	}
	if id != "" && err == nil {
		err = repo.AcknowledgeAssetDownloadChanges(id)
	}
	return err
}

func processAssetSyncMergeResult(repo *dejavu.Repo, exit, byHand bool, changes *dejavu.MergeResult,
	traffic *dejavu.TrafficStat, mode string, elapsed time.Duration) error {
	id, _, err := repo.AssetDownloadChanges()
	if err != nil {
		return err
	}
	processSyncMergeResult(exit, byHand, syncCheckoutUnindexed(changes), traffic, mode, elapsed, id != "" || IsSyncCheckoutApplying())
	if exit || id == "" {
		return nil
	}
	return repo.AcknowledgeAssetDownloadChanges(id)
}

// finishAssetDownloadRecovery 处理同步失败前已经落盘的变更，未完成的恢复记录继续保留
func finishAssetDownloadRecovery(repo *dejavu.Repo, syncErr *error) {
	*syncErr = errors.Join(*syncErr, processAssetDownloadRecovery(repo, false))
}
