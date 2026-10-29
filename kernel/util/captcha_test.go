// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package util

import (
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// TestCaptchaChallengeSingleUse 验证同一验证码挑战只能消费一次。
func TestCaptchaChallengeSingleUse(t *testing.T) {
	resetCaptchaChallengesForTest(t)

	id := NewCaptchaChallenge("ABCD")
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

	id := NewCaptchaChallenge("ABCD")
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

	id := NewCaptchaChallenge("ABCD")
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

// TestCaptchaChallengeBounded 验证挑战条数不超过上限，达到上限后仍能签发新挑战。
func TestCaptchaChallengeBounded(t *testing.T) {
	resetCaptchaChallengesForTest(t)

	for range captchaChallengeMaxEntries {
		NewCaptchaChallenge("ABCD")
	}
	id := NewCaptchaChallenge("ABCD")
	if "" == id {
		t.Fatal("challenge was not issued at the entry limit")
	}
	captchaChallengeLock.Lock()
	count := len(captchaChallenges)
	captchaChallengeLock.Unlock()
	if captchaChallengeMaxEntries < count {
		t.Fatalf("challenge entries exceeded the cap: %d", count)
	}
	if !ConsumeCaptchaChallenge(id, "ABCD") {
		t.Fatal("challenge issued at the entry limit is unusable")
	}
}

// TestCaptchaChallengeSweep 验证定期清理会删除过期挑战。
func TestCaptchaChallengeSweep(t *testing.T) {
	resetCaptchaChallengesForTest(t)

	id := NewCaptchaChallenge("ABCD")
	captchaChallengeLock.Lock()
	captchaChallenges[id].expires = time.Now().Add(-time.Second)
	captchaChallengeLastSweep = time.Now().Add(-2 * captchaChallengeSweepPeriod)
	captchaChallengeLock.Unlock()

	NewCaptchaChallenge("EFGH")
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

	id := NewCaptchaChallenge("ABCD")
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
	captchaChallengeLastSweep = time.Time{}
	captchaChallengeLock.Unlock()
}
