// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"context"
	"errors"
	"fmt"
	"path"
	"sync"
	"time"

	"github.com/88250/go-humanize"
	"github.com/olahol/melody"
	"github.com/siyuan-note/dejavu"
	"github.com/siyuan-note/dejavu/entity"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type syncCheckoutTask struct {
	sync.Mutex
	id                   string
	ctx                  context.Context
	phase                string
	revision             int64
	message              string
	canceling            bool
	clients              map[*melody.Session]*syncCheckoutClient
	confirmations        chan bool
	releaseWrites        func()
	indexedPaths         map[string]bool
	refreshedRoots       map[string]bool
	cancel               context.CancelFunc
	done                 chan struct{}
	worker               sync.WaitGroup
	progress             dejavu.CheckoutProgress
	fileStarted, lastLog time.Time
	lastLogPath          string
	lastLogBytes         int64
	lastPush             time.Time
	sentProgress         dejavu.CheckoutProgress
	upserts, removes     map[string]*entity.File
	beforePetals         []*Petal
}

var activeSyncCheckout struct {
	sync.Mutex
	task *syncCheckoutTask
}

var checkoutDiskUsage = util.GetDiskUsage

// startSyncCheckout 将取消和字节进度绑定到这一轮同步，不影响其他仓库操作。
func startSyncCheckout(repo *dejavu.Repo) *syncCheckoutTask {
	activeSyncCheckout.Lock()
	if activeSyncCheckout.task != nil {
		activeSyncCheckout.Unlock()
		return nil
	}
	ctx, cancel := context.WithCancel(context.Background())
	task := &syncCheckoutTask{id: util.RandString(16), ctx: ctx, phase: "background", revision: syncCheckoutRevision.Add(1), cancel: cancel, done: make(chan struct{}), upserts: map[string]*entity.File{}, removes: map[string]*entity.File{}, beforePetals: getPetals()}
	activeSyncCheckout.task = task
	activeSyncCheckout.Unlock()
	repo.SetCheckoutHooks(dejavu.CheckoutHooks{
		Context: ctx, Apply: task.prepareApply, Applied: task.completeApply, Before: checkCheckoutSpace, Cleaned: notifyCheckoutCleanup,
		Preflight: documentAddressingPreflight(repo),
		Progress: func(progress dejavu.CheckoutProgress) {
			task.Lock()
			newFile := task.progress.Path != progress.Path
			if newFile {
				task.fileStarted = time.Now()
			}
			task.progress = progress
			task.Unlock()
			if newFile && progress.Size >= 50*1024*1024 {
				logging.LogInfof("sync checkout file started [file=%q, bytes=%d]", progress.Path, progress.Size)
			}
			if progress.Written == 0 || progress.Written == progress.Size {
				task.push()
			}
		},
		Committed: func(file *entity.File) {
			task.Lock()
			task.upserts[file.Path] = file
			delete(task.removes, file.Path)
			delete(task.indexedPaths, file.Path)
			task.Unlock()
			if file.Size >= 50*1024*1024 {
				task.Lock()
				elapsed := time.Since(task.fileStarted)
				task.Unlock()
				logging.LogInfof("sync checkout file committed [file=%q, bytes=%d, elapsed=%.2fs]", file.Path, file.Size, elapsed.Seconds())
			}
		},
		Removed: func(file *entity.File) {
			task.Lock()
			task.removes[file.Path] = file
			delete(task.upserts, file.Path)
			delete(task.indexedPaths, file.Path)
			task.Unlock()
		},
	})
	task.push()
	task.worker.Add(1)
	go func() {
		defer task.worker.Done()
		ticker := time.NewTicker(200 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-task.done:
				return
			case <-ticker.C:
				task.push()
			}
		}
	}()
	return task
}

// CancelSyncCheckout 只接受当前任务 ID，防止旧窗口取消后续同步；返回值表示已提出取消请求。
func CancelSyncCheckout(taskID string) bool {
	activeSyncCheckout.Lock()
	defer activeSyncCheckout.Unlock()
	if activeSyncCheckout.task == nil || activeSyncCheckout.task.id != taskID {
		return false
	}
	activeSyncCheckout.task.cancel()
	activeSyncCheckout.task.Lock()
	activeSyncCheckout.task.canceling = true
	activeSyncCheckout.task.revision = syncCheckoutRevision.Add(1)
	activeSyncCheckout.task.Unlock()
	return true
}

func (task *syncCheckoutTask) push() {
	task.Lock()
	defer task.Unlock()
	p := task.progress
	if p.Path == "" {
		task.message = Conf.Language(81)
		task.broadcastLocked(0)
		return
	}
	// 首个文件和最终完成数量立即推送，其余变化合并到时间窗口，避免小文件造成消息洪泛。
	final := p.Count >= p.Total && p.Written >= p.Size && p != task.sentProgress
	if task.sentProgress.Path != "" && !final && time.Since(task.lastPush) < 200*time.Millisecond {
		return
	}
	task.lastPush = time.Now()
	task.sentProgress = p
	elapsed := time.Since(task.fileStarted)
	rate := float64(p.Written) / max(elapsed.Seconds(), 0.001)
	remaining := "--:--:--"
	if rate > 0 {
		remaining = formatCheckoutDuration(time.Duration(float64(max(p.Size-p.Written, 0))/rate) * time.Second)
	}
	msg := fmt.Sprintf(Conf.Language(432), path.Base(p.Path), p.Count, p.Total, checkoutBytes(p.Written), checkoutBytes(p.Size), checkoutBytes(int64(rate)), remaining)
	task.message = msg
	util.SetBootDetails(msg)
	pushSyncStatusBar(msg)
	task.broadcastLocked(0)
	if time.Since(task.lastLog) >= 5*time.Second || task.lastLogPath != p.Path || (p.Written == p.Size && task.lastLogBytes != p.Written) {
		logging.LogInfof("sync checkout [file=%q, count=%d/%d, bytes=%d/%d, elapsed=%.2fs]", p.Path, p.Count, p.Total, p.Written, p.Size, elapsed.Seconds())
		task.lastLog = time.Now()
		task.lastLogPath = p.Path
		task.lastLogBytes = p.Written
	}
}

func (task *syncCheckoutTask) broadcastLocked(code int) {
	for _, session := range util.SessionsByType("main") {
		state := task.snapshotLocked()
		if client := task.clients[session]; client != nil {
			state.Token = client.token
		}
		event := util.NewResult()
		event.Cmd, event.Code, event.Msg, event.Data = "syncProgress", code, task.message, state
		session.Write(event.Bytes())
	}
}

func checkoutBytes(size int64) string { return humanize.BytesCustomFloor(uint64(max(size, 0)), 2) }

func formatCheckoutDuration(duration time.Duration) string {
	seconds := int64(duration.Seconds())
	return fmt.Sprintf("%02d:%02d:%02d", seconds/3600, (seconds/60)%60, seconds%60)
}

func checkCheckoutSpace(files []*entity.File) error {
	// 一次只替换一个文件；所需额外空间为完整临时文件，旧文件在替换前仍保留。
	total, _, free := checkoutDiskUsage(util.DataDir)
	if total == 0 {
		return nil
	}
	var required int64
	for _, file := range files {
		required = max(required, file.Size)
	}
	if uint64(max(required, 0)) > free {
		return fmt.Errorf(Conf.Language(434), checkoutBytes(required), humanize.BytesCustomFloor(free, 2))
	}
	return nil
}

func notifyCheckoutCleanup(released int64) {
	if released > 0 {
		util.PushMsg(fmt.Sprintf(Conf.Language(435), checkoutBytes(released)), 10000)
	}
}

func (task *syncCheckoutTask) finish(repo *dejavu.Repo, syncErr *error) {
	if task == nil {
		return
	}
	// 恢复索引期间继续保留任务遮罩，防止部分落盘后立即编辑旧的内存状态。
	if *syncErr != nil && (len(task.upserts) > 0 || len(task.removes) > 0) {
		changes := &dejavu.MergeResult{Time: time.Now()}
		for _, file := range task.upserts {
			changes.Upserts = append(changes.Upserts, file)
		}
		for _, file := range task.removes {
			changes.Removes = append(changes.Removes, file)
		}
		calcPetalDiff(task.beforePetals, changes)
		processSyncMergeResult(false, true, changes, &dejavu.TrafficStat{}, "c", 0, true)
	}
	if errors.Is(*syncErr, context.Canceled) {
		msg := Conf.Language(433)
		UpdateSyncConf(func(s *conf.Sync) { s.Stat = msg })
		pushSyncStatusBar(msg)
		util.PushMsg(msg, 10000)
	}
	close(task.done)
	task.worker.Wait()
	task.cancel()
	repo.SetCheckoutHooks(documentAddressingCheckoutHooks(repo))
	if task.releaseWrites != nil {
		task.releaseWrites()
		task.releaseWrites = nil
	}
	task.Lock()
	task.phase, task.revision = "done", syncCheckoutRevision.Add(1)
	task.broadcastLocked(2)
	task.Unlock()
	activeSyncCheckout.Lock()
	if activeSyncCheckout.task == task {
		activeSyncCheckout.task = nil
	}
	activeSyncCheckout.Unlock()
}

// cleanupInterruptedCheckout 在加载笔记本索引前回收有明确归属的临时文件。
func cleanupInterruptedCheckout() {
	if Conf == nil || len(Conf.Repo.Load().Key) == 0 {
		return
	}
	repo, err := newRepository()
	if err != nil {
		logging.LogWarnf("open repo to clean interrupted checkout failed: %s", err)
		return
	}
	released, err := repo.CleanupCheckoutTemps()
	if err != nil {
		logging.LogWarnf("clean interrupted checkout failed: %s", err)
	}
	if released > 0 {
		logging.LogInfof("cleaned interrupted sync checkout [bytes=%d]", released)
		go func() { util.WaitForUILoaded(); notifyCheckoutCleanup(released) }()
	}
}

// repoBootIncrement 将每个阶段的十分进度分配到累计完成数，避免大于十项时始终为零。
func repoBootIncrement(count, total int) int32 {
	if total <= 0 || count <= 0 || count > total {
		return 0
	}
	return int32(10*int64(count)/int64(total) - 10*int64(count-1)/int64(total))
}

var repoProgressThrottle struct {
	sync.Mutex
	last map[string]time.Time
}

func repoProgressDue(stage string, final bool) bool {
	repoProgressThrottle.Lock()
	defer repoProgressThrottle.Unlock()
	if repoProgressThrottle.last == nil {
		repoProgressThrottle.last = map[string]time.Time{}
	}
	now := time.Now()
	if final || now.Sub(repoProgressThrottle.last[stage]) >= 200*time.Millisecond {
		repoProgressThrottle.last[stage] = now
		return true
	}
	return false
}
