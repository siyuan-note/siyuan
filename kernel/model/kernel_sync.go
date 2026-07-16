// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"sync"
	"sync/atomic"
	"time"
)

const maxSyncIdleLockHold = 30 * time.Minute

var (
	officialSyncWaiters atomic.Int32
	workspaceGeneration atomic.Uint64
)

func init() {
	workspaceGeneration.Store(1)
}

// IsSyncing 返回官方同步或存储同步是否正在运行。
func IsSyncing() bool {
	return isSyncing.Load() || isSyncingStorages()
}

// WorkspaceGeneration 返回当前进程观察到的工作区代次。
func WorkspaceGeneration() uint64 {
	return workspaceGeneration.Load()
}

// AdvanceWorkspaceGeneration 推进工作区代次并返回新值。
func AdvanceWorkspaceGeneration() uint64 {
	return workspaceGeneration.Add(1)
}

// SyncIdleLock 在官方同步空闲时独占 syncLock，并以租约约束最长持有时间。
type SyncIdleLock struct {
	mu            sync.Mutex
	timer         *time.Timer
	expiresAt     time.Time
	hardExpiresAt time.Time
	done          chan struct{}
	released      bool
	critical      bool
}

// TryLockSyncIdle 仅在官方同步空闲且没有等待者时创建租约。
func TryLockSyncIdle(ttl time.Duration) (*SyncIdleLock, bool) {
	ttl = normalizeSyncIdleLockTTL(ttl)
	if IsSyncing() || officialSyncWaiters.Load() > 0 || !syncLock.TryLock() {
		return nil, false
	}
	if IsSyncing() || officialSyncWaiters.Load() > 0 {
		syncLock.Unlock()
		return nil, false
	}
	now := time.Now()
	lock := &SyncIdleLock{
		expiresAt: now.Add(ttl), hardExpiresAt: now.Add(maxSyncIdleLockHold), done: make(chan struct{}),
	}
	lock.timer = time.AfterFunc(ttl, lock.expire)
	return lock, true
}

func normalizeSyncIdleLockTTL(ttl time.Duration) time.Duration {
	if ttl <= 0 || ttl > 10*time.Minute {
		return 3 * time.Minute
	}
	return ttl
}

// Renew 延长租约；官方同步已等待时主动让出非关键租约。
func (lock *SyncIdleLock) Renew(ttl time.Duration) bool {
	if lock == nil {
		return false
	}
	ttl = normalizeSyncIdleLockTTL(ttl)
	lock.mu.Lock()
	if lock.released {
		lock.mu.Unlock()
		return false
	}
	if lock.critical {
		lock.mu.Unlock()
		return true
	}
	now := time.Now()
	if !lock.hardExpiresAt.After(now) || officialSyncWaiters.Load() > 0 {
		lock.releaseLocked()
		lock.mu.Unlock()
		syncLock.Unlock()
		return false
	}
	lock.expiresAt = now.Add(ttl)
	if lock.expiresAt.After(lock.hardExpiresAt) {
		lock.expiresAt = lock.hardExpiresAt
	}
	lock.timer.Reset(time.Until(lock.expiresAt))
	lock.mu.Unlock()
	return true
}

// EnterCritical 把租约转换为必须显式释放的提交锁。
func (lock *SyncIdleLock) EnterCritical() bool {
	if lock == nil {
		return false
	}
	lock.mu.Lock()
	if lock.released {
		lock.mu.Unlock()
		return false
	}
	if lock.critical {
		lock.mu.Unlock()
		return true
	}
	now := time.Now()
	if !lock.expiresAt.After(now) || !lock.hardExpiresAt.After(now) || officialSyncWaiters.Load() > 0 {
		lock.releaseLocked()
		lock.mu.Unlock()
		syncLock.Unlock()
		return false
	}
	lock.critical = true
	lock.timer.Stop()
	lock.mu.Unlock()
	return true
}

// Unlock 释放租约；重复调用是安全的。
func (lock *SyncIdleLock) Unlock() {
	if lock == nil {
		return
	}
	lock.mu.Lock()
	if lock.released {
		lock.mu.Unlock()
		return
	}
	lock.releaseLocked()
	lock.mu.Unlock()
	syncLock.Unlock()
}

func (lock *SyncIdleLock) releaseLocked() {
	lock.released = true
	if lock.timer != nil {
		lock.timer.Stop()
	}
	if lock.done != nil {
		close(lock.done)
		lock.done = nil
	}
}

func (lock *SyncIdleLock) expire() {
	lock.mu.Lock()
	if lock.released {
		lock.mu.Unlock()
		return
	}
	if lock.critical {
		lock.mu.Unlock()
		return
	}
	if remaining := time.Until(lock.expiresAt); remaining > 0 {
		lock.timer.Reset(remaining)
		lock.mu.Unlock()
		return
	}
	lock.releaseLocked()
	lock.mu.Unlock()
	syncLock.Unlock()
}

// Done 在租约释放、过期或让出时关闭。
func (lock *SyncIdleLock) Done() <-chan struct{} {
	if lock == nil {
		closed := make(chan struct{})
		close(closed)
		return closed
	}
	lock.mu.Lock()
	defer lock.mu.Unlock()
	if lock.done == nil {
		closed := make(chan struct{})
		close(closed)
		return closed
	}
	return lock.done
}
