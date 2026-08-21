// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package util

import (
	"fmt"
	"testing"
	"time"
)

// TestAuthCodeEquals 验证恒定时间比较的相等与不等判定。
func TestAuthCodeEquals(t *testing.T) {
	if !AuthCodeEquals("secret123", "secret123") {
		t.Fatal("equal codes should match")
	}
	if AuthCodeEquals("secret123", "secret124") {
		t.Fatal("different codes should not match")
	}
	if AuthCodeEquals("secret123", "secret") {
		t.Fatal("codes of different length should not match")
	}
	if AuthCodeEquals("", "secret123") || AuthCodeEquals("secret123", "") {
		t.Fatal("empty code should not match a non-empty one")
	}
	if !AuthCodeEquals("", "") {
		t.Fatal("both empty codes should match")
	}
}

// TestAuthThrottleThreshold 验证未达阈值不锁定、超过阈值后锁定。
func TestAuthThrottleThreshold(t *testing.T) {
	key := "TestAuthThrottleThreshold"
	resetAuthThrottleForTest(key)
	for i := 0; i < authThrottleMaxFail; i++ {
		if retryAfter := AuthThrottleCheck(key); 0 < retryAfter {
			t.Fatalf("locked before reaching threshold at attempt %d", i+1)
		}
		AuthThrottleFail(key)
	}
	AuthThrottleFail(key)
	if retryAfter := AuthThrottleCheck(key); 0 >= retryAfter {
		t.Fatal("expected lock after exceeding threshold")
	}
}

// TestAuthThrottleBackoff 验证锁定期随持续失败指数增长且不超过上限。
func TestAuthThrottleBackoff(t *testing.T) {
	key := "TestAuthThrottleBackoff"
	resetAuthThrottleForTest(key)
	for i := 0; i < authThrottleMaxFail+1; i++ {
		AuthThrottleFail(key)
	}
	firstLock := time.Until(authThrottles[key].LockUntil)
	for i := 0; i < authThrottleMaxFail; i++ {
		AuthThrottleFail(key)
	}
	extendedLock := time.Until(authThrottles[key].LockUntil)
	if !(extendedLock > firstLock) {
		t.Fatal("expected lock to extend while failures keep coming")
	}
	if authThrottleLockMaxSec*time.Second < extendedLock {
		t.Fatalf("lock exceeded the cap: %v", extendedLock)
	}
}

// TestAuthThrottleWindowReset 验证窗口期外的陈旧失败计数被清零，避免误锁。
func TestAuthThrottleWindowReset(t *testing.T) {
	key := "TestAuthThrottleWindowReset"
	resetAuthThrottleForTest(key)
	AuthThrottleFail(key)
	authThrottleLock.Lock()
	authThrottles[key].LastFail = time.Now().Add(-authThrottleWindowSec * time.Second)
	authThrottleLock.Unlock()
	AuthThrottleFail(key)
	authThrottleLock.Lock()
	count := authThrottles[key].FailCount
	authThrottleLock.Unlock()
	if count != 1 {
		t.Fatalf("expected stale failure count to reset, got %d", count)
	}
}

// TestAuthThrottleReset 验证认证成功后清除失败计数。
func TestAuthThrottleReset(t *testing.T) {
	key := "TestAuthThrottleReset"
	resetAuthThrottleForTest(key)
	for i := 0; i < authThrottleMaxFail+1; i++ {
		AuthThrottleFail(key)
	}
	if retryAfter := AuthThrottleCheck(key); 0 >= retryAfter {
		t.Fatal("expected lock before reset")
	}
	AuthThrottleReset(key)
	if retryAfter := AuthThrottleCheck(key); 0 < retryAfter {
		t.Fatal("expected no lock after reset")
	}
}

// TestAuthThrottleExpiry 验证锁定期过期后解除锁定并清理记录。
func TestAuthThrottleExpiry(t *testing.T) {
	key := "TestAuthThrottleExpiry"
	resetAuthThrottleForTest(key)
	for i := 0; i < authThrottleMaxFail+1; i++ {
		AuthThrottleFail(key)
	}
	authThrottleLock.Lock()
	authThrottles[key].LockUntil = time.Now().Add(-time.Second)
	authThrottleLock.Unlock()
	if retryAfter := AuthThrottleCheck(key); 0 < retryAfter {
		t.Fatal("expected lock to be expired")
	}
	authThrottleLock.Lock()
	_, exists := authThrottles[key]
	authThrottleLock.Unlock()
	if exists {
		t.Fatal("expected expired throttle entry to be cleaned up")
	}
}

// TestAuthThrottleSweep 验证定期清扫会删除窗口期已过的失败记录，即使 key 不再被访问。
func TestAuthThrottleSweep(t *testing.T) {
	staleKeys := make([]string, 0, 64)
	for i := 0; i < 64; i++ {
		key := fmt.Sprintf("TestAuthThrottleSweep-stale-%d", i)
		AuthThrottleFail(key)
		defer resetAuthThrottleForTest(key)
		staleKeys = append(staleKeys, key)
	}
	authThrottleLock.Lock()
	for _, key := range staleKeys {
		authThrottles[key].LastFail = time.Now().Add(-authThrottleWindowSec * time.Second)
	}
	authThrottleLastSweep = time.Time{}
	authThrottleLock.Unlock()

	triggerKey := "TestAuthThrottleSweep-trigger"
	defer resetAuthThrottleForTest(triggerKey)
	AuthThrottleFail(triggerKey)

	authThrottleLock.Lock()
	defer authThrottleLock.Unlock()
	for _, key := range staleKeys {
		if _, exists := authThrottles[key]; exists {
			t.Fatalf("expected stale throttle entry to be swept: %s", key)
		}
	}
}

// TestAuthThrottleSweepKeepsLocked 验证清扫不会删除仍在锁定中的条目。
func TestAuthThrottleSweepKeepsLocked(t *testing.T) {
	key := "TestAuthThrottleSweepKeepsLocked"
	resetAuthThrottleForTest(key)
	defer resetAuthThrottleForTest(key)
	for i := 0; i < authThrottleMaxFail+1; i++ {
		AuthThrottleFail(key)
	}
	authThrottleLock.Lock()
	authThrottleLastSweep = time.Time{}
	authThrottleLock.Unlock()

	triggerKey := "TestAuthThrottleSweepKeepsLocked-trigger"
	defer resetAuthThrottleForTest(triggerKey)
	AuthThrottleFail(triggerKey)

	authThrottleLock.Lock()
	defer authThrottleLock.Unlock()
	if _, exists := authThrottles[key]; !exists {
		t.Fatal("expected locked throttle entry to survive sweep")
	}
}

// TestAuthThrottleMaxEntries 验证限流记录条数不超过上限，防止唯一 key 无限增长内存。
func TestAuthThrottleMaxEntries(t *testing.T) {
	authThrottleLock.Lock()
	authThrottleLastSweep = time.Now()
	for key := range authThrottles {
		delete(authThrottles, key)
	}
	authThrottleLock.Unlock()

	for i := 0; i < authThrottleMaxEntries+50; i++ {
		AuthThrottleFail(fmt.Sprintf("TestAuthThrottleMaxEntries-%d", i))
	}
	authThrottleLock.Lock()
	count := len(authThrottles)
	for key := range authThrottles {
		delete(authThrottles, key)
	}
	authThrottleLock.Unlock()
	if authThrottleMaxEntries < count {
		t.Fatalf("throttle entries exceeded the cap: %d", count)
	}
}

func resetAuthThrottleForTest(key string) {
	authThrottleLock.Lock()
	delete(authThrottles, key)
	authThrottleLock.Unlock()
}
