// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"context"
	"fmt"
	"sync/atomic"
	"time"

	"github.com/olahol/melody"
	"github.com/siyuan-note/dejavu"
	"github.com/siyuan-note/dejavu/entity"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var syncCheckoutRevision atomic.Int64

type syncCheckoutClient struct {
	token     string
	confirmed bool
}

// GetSyncCheckout 同步任务快照与结束版本，避免重连后继续使用过期的编辑阻断状态。
func GetSyncCheckout(appID, clientID string) apicontract.SyncCheckoutSnapshot {
	activeSyncCheckout.Lock()
	defer activeSyncCheckout.Unlock()
	result := apicontract.SyncCheckoutSnapshot{KernelID: KernelID, Revision: syncCheckoutRevision.Load()}
	if task := activeSyncCheckout.task; task != nil {
		task.Lock()
		defer task.Unlock()
		state := task.snapshotLocked()
		result.Revision = state.Revision
		for session, client := range task.clients {
			app, _ := session.Get("app")
			id, _ := session.Get("id")
			if app == appID && id == clientID {
				state.Token = client.token
				break
			}
		}
		result.Task = &state
	}
	return result
}

func (task *syncCheckoutTask) snapshotLocked() apicontract.SyncCheckoutState {
	state := apicontract.SyncCheckoutState{TaskID: task.id, Revision: task.revision, Phase: task.phase,
		Blocking: task.phase != "background" && task.phase != "done", Canceling: task.canceling,
		Current: task.progress.Written, Total: task.progress.Size, Message: task.message,
		UpsertRootIDs: []string{}, RemoveRootIDs: []string{}}
	roots := map[string]bool{}
	if task.phase == "background" || task.phase == "done" {
		for id, upsert := range task.refreshedRoots {
			roots[id] = upsert
		}
	}
	for path := range task.removes {
		if id := checkoutDocumentID(path); id != "" {
			roots[id] = false
		}
	}
	for path := range task.upserts {
		if id := checkoutDocumentID(path); id != "" {
			roots[id] = true
		}
	}
	for id, upsert := range roots {
		if upsert {
			state.UpsertRootIDs = append(state.UpsertRootIDs, id)
		} else {
			state.RemoveRootIDs = append(state.RemoveRootIDs, id)
		}
	}
	return state
}

func checkoutDocumentID(path string) string {
	if len(path) > 3 && path[len(path)-3:] == ".sy" {
		return util.GetTreeID(path)
	}
	return ""
}

func ConfirmSyncCheckout(taskID, token string, saved bool) bool {
	activeSyncCheckout.Lock()
	defer activeSyncCheckout.Unlock()
	task := activeSyncCheckout.task
	if task == nil || task.id != taskID {
		return false
	}
	task.Lock()
	defer task.Unlock()
	if task.phase != "preparing" {
		return false
	}
	for _, client := range task.clients {
		if client.token != token {
			continue
		}
		if !client.confirmed {
			client.confirmed = true
			task.confirmations <- saved
		}
		return true
	}
	return false
}

func IsSyncCheckoutApplying() bool {
	activeSyncCheckout.Lock()
	defer activeSyncCheckout.Unlock()
	if task := activeSyncCheckout.task; task != nil {
		task.Lock()
		defer task.Unlock()
		return task.phase == "applying"
	}
	return false
}

// prepareApply 先排空各窗口输入，再取得既有写接口和编辑事务的串行区。
func (task *syncCheckoutTask) prepareApply() error {
	if err := task.ctx.Err(); err != nil {
		return err
	}
	task.Lock()
	if task.phase == "applying" {
		task.Unlock()
		return nil
	}
	task.Unlock()
	var sessions []*melody.Session
	for {
		if err := waitForSyncUI(task.ctx, false, false); err != nil {
			return err
		}
		// 就绪检查后仍可能接入新窗口，确认超时只约束这次取得的已就绪会话。
		sessions = util.SessionsByType("main")
		ready := true
		for _, session := range sessions {
			ready = ready && util.IsSessionReady(session)
		}
		if ready {
			break
		}
	}
	task.Lock()
	task.phase, task.revision = "preparing", syncCheckoutRevision.Add(1)
	task.clients = map[*melody.Session]*syncCheckoutClient{}
	task.confirmations = make(chan bool, len(sessions))
	for _, session := range sessions {
		task.clients[session] = &syncCheckoutClient{token: util.RandString(32)}
	}
	task.Unlock()
	task.push()
	ctx, cancel := context.WithTimeout(task.ctx, 15*time.Second)
	defer cancel()
	for range sessions {
		select {
		case saved := <-task.confirmations:
			if !saved {
				return checkoutPrepareRetry()
			}
		case <-ctx.Done():
			if task.ctx.Err() != nil {
				return task.ctx.Err()
			}
			return checkoutPrepareRetry()
		}
	}
	for _, current := range util.SessionsByType("main") {
		if task.clients[current] == nil {
			return checkoutPrepareRetry()
		}
	}
	// 等待同步锁的写请求会持有读租约，不能反向等待；此次应用稍后重试。
	if !dataImportAccess.TryLock() {
		return fmt.Errorf("%w: %s", dejavu.ErrIndexFileChanged, Conf.Language(239))
	}
	task.Lock()
	task.releaseWrites = dataImportAccess.Unlock
	task.phase, task.revision = "applying", syncCheckoutRevision.Add(1)
	task.Unlock()
	if err := lockAssetRelink(ctx, &flushLock); err != nil {
		return err
	}
	task.releaseWrites = func() { flushLock.Unlock(); dataImportAccess.Unlock() }
	for _, tx := range takeQueuedTransactions() {
		flushTx(tx)
	}
	task.push()
	return task.ctx.Err()
}

func checkoutPrepareRetry() error {
	return fmt.Errorf("%w: %s", dejavu.ErrIndexFileChanged, util.I18nTerm(Conf.Lang, "settingsPendingSaveError"))
}

// completeApply 在后续上传开始前完成本批索引恢复，并允许前端刷新后继续编辑。
func (task *syncCheckoutTask) completeApply() {
	task.Lock()
	if task.phase != "applying" {
		task.Unlock()
		return
	}
	changes := &dejavu.MergeResult{Time: time.Now()}
	for _, file := range task.upserts {
		changes.Upserts = append(changes.Upserts, file)
	}
	for _, file := range task.removes {
		changes.Removes = append(changes.Removes, file)
	}
	task.Unlock()
	if changes.DataChanged() {
		calcPetalDiff(task.beforePetals, changes)
		processSyncMergeResult(false, false, changes, &dejavu.TrafficStat{}, "c", 0, true)
	}
	task.Lock()
	if task.indexedPaths == nil {
		task.indexedPaths = map[string]bool{}
	}
	if task.refreshedRoots == nil {
		task.refreshedRoots = map[string]bool{}
	}
	// 文档移动会同时删除旧路径、写入新路径，最终仍存在的根文档按更新处理。
	for _, file := range changes.Removes {
		task.indexedPaths[file.Path] = true
		if id := checkoutDocumentID(file.Path); id != "" {
			task.refreshedRoots[id] = false
		}
	}
	for _, file := range changes.Upserts {
		task.indexedPaths[file.Path] = true
		if id := checkoutDocumentID(file.Path); id != "" {
			task.refreshedRoots[id] = true
		}
	}
	task.upserts, task.removes = map[string]*entity.File{}, map[string]*entity.File{}
	if task.releaseWrites != nil {
		task.releaseWrites()
		task.releaseWrites = nil
	}
	task.phase, task.revision = "background", syncCheckoutRevision.Add(1)
	task.broadcastLocked(0)
	task.Unlock()
}

func syncCheckoutUnindexed(changes *dejavu.MergeResult) *dejavu.MergeResult {
	activeSyncCheckout.Lock()
	defer activeSyncCheckout.Unlock()
	task := activeSyncCheckout.task
	if task == nil {
		return changes
	}
	task.Lock()
	defer task.Unlock()
	filtered := *changes
	filtered.Upserts, filtered.Removes = nil, nil
	for _, file := range changes.Upserts {
		if !task.indexedPaths[file.Path] {
			filtered.Upserts = append(filtered.Upserts, file)
		}
	}
	for _, file := range changes.Removes {
		if !task.indexedPaths[file.Path] {
			filtered.Removes = append(filtered.Removes, file)
		}
	}
	return &filtered
}

// reconcileSyncCheckoutChanges 历史恢复记录也必须在保存输入及写保护下更新索引。
func reconcileSyncCheckoutChanges(changes *dejavu.MergeResult) (bool, error) {
	activeSyncCheckout.Lock()
	task := activeSyncCheckout.task
	activeSyncCheckout.Unlock()
	if task == nil || !changes.DataChanged() {
		return task != nil, nil
	}
	if !IsSyncCheckoutApplying() {
		if err := task.prepareApply(); err != nil {
			return true, err
		}
	}
	task.Lock()
	for _, file := range changes.Upserts {
		task.upserts[file.Path] = file
		delete(task.removes, file.Path)
	}
	for _, file := range changes.Removes {
		task.removes[file.Path] = file
		delete(task.upserts, file.Path)
	}
	task.Unlock()
	task.completeApply()
	return true, nil
}
