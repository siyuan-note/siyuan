// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"context"

	"github.com/siyuan-note/dejavu"
	"github.com/siyuan-note/dejavu/entity"
	"golang.org/x/sync/semaphore"
)

var syncIndexPutFile = semaphore.NewWeighted(1)

// HoldPutFileForSync 让参与同步的文件等待索引重试结束。调用者在接收完表单后取得租约，并在更新时间后释放。
func HoldPutFileForSync(ctx context.Context, absPath string) (release func(), err error) {
	if !PathsAffectSync(absPath) {
		return nil, ctx.Err()
	}
	if err = syncIndexPutFile.Acquire(ctx, 1); err != nil {
		return
	}
	return func() { syncIndexPutFile.Release(1) }, nil
}

func retrySyncIndex(ctx context.Context, repo *dejavu.Repo, checkChunks bool) (*entity.Index, error) {
	if err := syncIndexPutFile.Acquire(ctx, 1); err != nil {
		return nil, err
	}
	defer syncIndexPutFile.Release(1)
	return repo.Index("[Sync] Cloud sync", checkChunks, newSyncContext())
}
