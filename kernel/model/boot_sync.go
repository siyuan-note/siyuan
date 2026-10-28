// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"context"
	"sync/atomic"
	"time"

	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var bootSyncScheduled atomic.Bool

func syncUIReady(requireMain bool) bool {
	sessions := util.SessionsByType("main")
	if requireMain && len(sessions) == 0 {
		return false
	}
	for _, session := range sessions {
		if !util.IsSessionReady(session) {
			return false
		}
	}
	return true
}

// waitForSyncUI 界面加载不计入编辑保存确认的超时，取消或退出时终止等待。
func waitForSyncUI(ctx context.Context, requireMain, waitBoot bool) error {
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		if util.IsExiting.Load() {
			return context.Canceled
		}
		if (!waitBoot || util.IsBooted()) && syncUIReady(requireMain) {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
		}
	}
}

// scheduleBootSync 原生界面先从本地数据启动，再执行完整同步；重复启动请求合并为一个任务。
func scheduleBootSync() bool {
	if bootSyncScheduled.Load() {
		return true
	}
	if !(util.AttachUI || util.IsMobileContainer()) || (util.IsBooted() && syncUIReady(true)) {
		return false
	}
	if bootSyncScheduled.CompareAndSwap(false, true) {
		go func() {
			defer logging.Recover()
			defer bootSyncScheduled.Store(false)
			if waitForSyncUI(context.Background(), true, true) == nil {
				bootSyncData()
			}
		}()
	}
	return true
}
