package model

import (
	"fmt"
	"sync"
	"time"

	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var autoSyncPauseNotice struct {
	sync.Mutex
	messageID string
	retryAt   time.Time
}

// notifyAutoSyncPaused 记录自动同步的拦截原因，每轮连续失败只提示一次。
func notifyAutoSyncPaused() bool {
	autoSyncPauseNotice.Lock()
	defer autoSyncPauseNotice.Unlock()
	if autoSyncErrCount.Load() <= 7 {
		return false
	}
	now := time.Now()
	if !autoSyncPauseNotice.retryAt.IsZero() && !now.Before(autoSyncPauseNotice.retryAt) {
		// 到期只放行一次重试；再次失败后进入下一轮退避。
		autoSyncErrCount.Store(7)
		autoSyncPauseNotice.retryAt = time.Time{}
		if autoSyncPauseNotice.messageID != "" {
			util.PushClearMsg(autoSyncPauseNotice.messageID)
			autoSyncPauseNotice.messageID = ""
		}
		return false
	}
	if autoSyncPauseNotice.retryAt.IsZero() {
		autoSyncPauseNotice.retryAt = now.Add(64 * time.Minute)
		planSyncAfter(64 * time.Minute)
	}
	msg := Conf.Language(125) + " " + fmt.Sprintf(Conf.Language(431), autoSyncPauseNotice.retryAt.Format("15:04:05"))
	if Conf.Sync.Load().Stat != msg {
		UpdateSyncConf(func(s *conf.Sync) { s.Stat = msg })
		pushSyncStatusBar(msg)
	}
	if autoSyncPauseNotice.messageID == "" {
		logging.LogErrorf("failed to auto-sync too many times, delay auto-sync 64 minutes")
		autoSyncPauseNotice.messageID = util.PushErrMsg(msg, 1000*60*60)
	}
	return true
}

// resetAutoSyncErrors 在同步成功后清除失败计数和该轮暂停提示。
func resetAutoSyncErrors() {
	autoSyncPauseNotice.Lock()
	defer autoSyncPauseNotice.Unlock()
	autoSyncErrCount.Store(0)
	autoSyncPauseNotice.retryAt = time.Time{}
	if autoSyncPauseNotice.messageID != "" {
		util.PushClearMsg(autoSyncPauseNotice.messageID)
		autoSyncPauseNotice.messageID = ""
	}
}
