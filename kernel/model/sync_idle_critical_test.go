// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
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
