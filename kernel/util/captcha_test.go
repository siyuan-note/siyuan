// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package util

import (
	"strconv"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// TestCaptchaChallengeSingleUse 验证同一验证码挑战只能消费一次。
func TestCaptchaChallengeSingleUse(t *testing.T) {
	resetCaptchaChallengesForTest(t)

	id := NewCaptchaChallenge("ABCD", "192.0.2.1", "")
	if "" == id {
		t.Fatal("challenge ID is empty")
	}
	if !ConsumeCaptchaChallenge(id, "abcd") {
		t.Fatal("case-insensitive answer should be accepted")
	}
	if ConsumeCaptchaChallenge(id, "ABCD") {
		t.Fatal("consumed challenge was accepted again")
	}
}

// TestCaptchaChallengeWrongAnswer 验证答案错误时挑战同样被删除，不能在原挑战上重试。
func TestCaptchaChallengeWrongAnswer(t *testing.T) {
	resetCaptchaChallengesForTest(t)

	id := NewCaptchaChallenge("ABCD", "192.0.2.1", "")
	if ConsumeCaptchaChallenge(id, "WXYZ") {
		t.Fatal("wrong answer was accepted")
	}
	if ConsumeCaptchaChallenge(id, "ABCD") {
		t.Fatal("challenge survived a wrong answer")
	}
}

// TestCaptchaChallengeExpiry 验证过期挑战被拒绝并清理。
func TestCaptchaChallengeExpiry(t *testing.T) {
	resetCaptchaChallengesForTest(t)

	id := NewCaptchaChallenge("ABCD", "192.0.2.1", "")
	captchaChallengeLock.Lock()
	captchaChallenges[id].expires = time.Now().Add(-time.Second)
	captchaChallengeLock.Unlock()

	if ConsumeCaptchaChallenge(id, "ABCD") {
		t.Fatal("expired challenge was accepted")
	}
	captchaChallengeLock.Lock()
	_, exists := captchaChallenges[id]
	captchaChallengeLock.Unlock()
	if exists {
		t.Fatal("expired challenge was not removed")
	}
}

// TestCaptchaChallengeUnknownID 验证未知或空挑战 ID 一律拒绝。
func TestCaptchaChallengeUnknownID(t *testing.T) {
	resetCaptchaChallengesForTest(t)

	if ConsumeCaptchaChallenge("", "ABCD") {
		t.Fatal("empty challenge ID was accepted")
	}
	if ConsumeCaptchaChallenge("unknown-challenge-id", "ABCD") {
		t.Fatal("unknown challenge ID was accepted")
	}
}

func TestCaptchaChallengeCapacityPreservesActiveSessions(t *testing.T) {
	resetCaptchaChallengesForTest(t)

	const firstIP = "192.0.2.1"
	first := NewCaptchaChallenge("ABCD", firstIP, "")
	for range captchaChallengeMaxPerIP - 1 {
		if id := NewCaptchaChallenge("EFGH", firstIP, ""); id == "" {
			t.Fatal("challenge rejected below the per-IP limit")
		}
	}
	if id := NewCaptchaChallenge("IJKL", firstIP, ""); id != "" {
		t.Fatal("source exceeded its quota")
	}
	const secondIP = "192.0.2.2"
	second := NewCaptchaChallenge("MNOP", secondIP, "")
	if second == "" {
		t.Fatal("the first source used the capacity of another source")
	}

	captchaChallengeLock.Lock()
	for i := len(captchaChallenges); i < captchaChallengeMaxEntries; i++ {
		captchaChallenges[strconv.Itoa(i)] = &captchaChallenge{expires: time.Now().Add(captchaChallengeTTL)}
		captchaChallengesByIP[""]++
	}
	captchaChallengeLock.Unlock()
	if id := NewCaptchaChallenge("QRST", "192.0.2.3", ""); id != "" {
		t.Fatal("global capacity was exceeded")
	}
	refreshed := NewCaptchaChallenge("UVWX", firstIP, first)
	if refreshed == "" || ConsumeCaptchaChallenge(first, "ABCD") {
		t.Fatal("refresh at capacity must replace only the current challenge")
	}
	if !ConsumeCaptchaChallenge(refreshed, "UVWX") || !ConsumeCaptchaChallenge(second, "MNOP") {
		t.Fatal("active challenges must remain usable at capacity")
	}
	if id := NewCaptchaChallenge("YZAB", firstIP, ""); id == "" {
		t.Fatal("consumption did not free capacity")
	}
}

// TestCaptchaChallengeSweep 验证定期清理会删除过期挑战。
func TestCaptchaChallengeSweep(t *testing.T) {
	resetCaptchaChallengesForTest(t)

	id := NewCaptchaChallenge("ABCD", "192.0.2.1", "")
	captchaChallengeLock.Lock()
	captchaChallenges[id].expires = time.Now().Add(-time.Second)
	captchaChallengeLastSweep = time.Now().Add(-2 * captchaChallengeSweepPeriod)
	captchaChallengeLock.Unlock()

	NewCaptchaChallenge("EFGH", "192.0.2.1", "")
	captchaChallengeLock.Lock()
	_, exists := captchaChallenges[id]
	captchaChallengeLock.Unlock()
	if exists {
		t.Fatal("expired challenge was not swept")
	}
}

// TestCaptchaChallengeConcurrentConsume 验证并发提交同一挑战时只有一个请求成功。
func TestCaptchaChallengeConcurrentConsume(t *testing.T) {
	resetCaptchaChallengesForTest(t)

	id := NewCaptchaChallenge("ABCD", "192.0.2.1", "")
	const consumers = 8
	success := atomic.Int32{}
	wg := sync.WaitGroup{}
	for range consumers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if ConsumeCaptchaChallenge(id, "ABCD") {
				success.Add(1)
			}
		}()
	}
	wg.Wait()
	if 1 != success.Load() {
		t.Fatalf("concurrent consumers succeeded %d times, want 1", success.Load())
	}
}

func resetCaptchaChallengesForTest(t *testing.T) {
	t.Helper()
	captchaChallengeLock.Lock()
	captchaChallenges = map[string]*captchaChallenge{}
	captchaChallengesByIP = map[string]int{}
	captchaChallengeLastSweep = time.Time{}
	captchaChallengeLock.Unlock()
}
