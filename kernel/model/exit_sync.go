// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"context"
	"sync"
	"time"

	"github.com/siyuan-note/dejavu"
	"github.com/siyuan-note/dejavu/entity"
)

// lockSyncForExit 等待仓库操作收尾；跳过同步时先取消活动任务，再取得清理所需的同步锁。
// 请求取消只结束等待，不允许仍在运行的仓库操作与数据库关闭并发执行。
func lockSyncForExit(ctx context.Context, force bool) error {
	ticker := time.NewTicker(50 * time.Millisecond)
	defer ticker.Stop()
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		if syncLock.TryLock() {
			isSyncing.Store(true)
			return nil
		}
		if force {
			activeSyncCheckout.Lock()
			if task := activeSyncCheckout.task; task != nil {
				task.cancel()
			}
			activeSyncCheckout.Unlock()
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
		}
	}
}

// exitSyncHooks 保留退出同步已落盘的变更，取消或失败后先恢复索引，再允许退出重试。
func exitSyncHooks(repo *dejavu.Repo, ctx context.Context) (dejavu.CheckoutHooks, func(*error)) {
	beforePetals := getPetals()
	var mu sync.Mutex
	upserts, removes := map[string]*entity.File{}, map[string]*entity.File{}
	hooks := documentAddressingCheckoutHooks(repo)
	hooks.Context = ctx
	hooks.Committed = func(file *entity.File) {
		mu.Lock()
		defer mu.Unlock()
		upserts[file.Path] = file
		delete(removes, file.Path)
	}
	hooks.Removed = func(file *entity.File) {
		mu.Lock()
		defer mu.Unlock()
		removes[file.Path] = file
		delete(upserts, file.Path)
	}
	return hooks, func(syncErr *error) {
		if *syncErr == nil {
			return
		}
		changes := &dejavu.MergeResult{Time: time.Now()}
		for _, file := range upserts {
			changes.Upserts = append(changes.Upserts, file)
		}
		for _, file := range removes {
			changes.Removes = append(changes.Removes, file)
		}
		if len(changes.Upserts)+len(changes.Removes) > 0 {
			calcPetalDiff(beforePetals, changes)
			processSyncMergeResult(false, true, changes, &dejavu.TrafficStat{}, "c", 0, true)
		}
		finishAssetDownloadRecovery(repo, syncErr)
	}
}
