// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"sync"
	"testing"
	"time"
)

func TestSyncIdleLockCriticalSectionRequiresExplicitRelease(t *testing.T) {
	lock, ok := TryLockSyncIdle(20 * time.Millisecond)
	if !ok {
		t.Fatal("failed to acquire sync idle lock")
	}
	done := lock.Done()
	if !lock.EnterCritical() {
		lock.Unlock()
		t.Fatal("failed to enter sync idle critical section")
	}
	time.Sleep(60 * time.Millisecond)
	select {
	case <-done:
		t.Fatal("critical sync idle lock expired before explicit release")
	default:
	}
	lock.Unlock()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("critical sync idle lock did not close after release")
	}
}

func TestSyncIdleLockQueuedExpiryDoesNotReleaseCriticalSection(t *testing.T) {
	lock, ok := TryLockSyncIdle(time.Second)
	if !ok {
		t.Fatal("failed to acquire sync idle lock")
	}
	done := lock.Done()

	lock.mu.Lock()
	var expiryStarted sync.WaitGroup
	expiryStarted.Add(1)
	expiryFinished := make(chan struct{})
	go func() {
		expiryStarted.Done()
		lock.expire()
		close(expiryFinished)
	}()
	expiryStarted.Wait()
	lock.critical = true
	lock.timer.Stop()
	lock.mu.Unlock()

	select {
	case <-expiryFinished:
	case <-time.After(time.Second):
		lock.Unlock()
		t.Fatal("queued expiry callback did not finish")
	}
	select {
	case <-done:
		t.Fatal("queued expiry callback released a critical sync idle lock")
	default:
	}
	lock.Unlock()
}

func TestSyncIdleLockCannotEnterCriticalAfterSoftExpiry(t *testing.T) {
	lock, ok := TryLockSyncIdle(time.Second)
	if !ok {
		t.Fatal("failed to acquire sync idle lock")
	}
	lock.mu.Lock()
	lock.expiresAt = time.Now().Add(-time.Second)
	lock.timer.Stop()
	lock.mu.Unlock()
	if lock.EnterCritical() {
		lock.Unlock()
		t.Fatal("expired lease entered the critical section")
	}
	select {
	case <-lock.Done():
	default:
		t.Fatal("expired lease was not released")
	}
}
