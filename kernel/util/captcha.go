// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package util

import (
	"crypto/subtle"
	"encoding/hex"
	"strings"
	"sync"
	"time"
)

const (
	captchaChallengeTTL         = 5 * time.Minute
	captchaChallengeMaxEntries  = 10000
	captchaChallengeSweepPeriod = time.Minute
)

// captchaChallenge 保存验证码答案和过期时间，答案只保留在服务端内存中。
type captchaChallenge struct {
	answer  string
	expires time.Time
}

var (
	captchaChallengeLock      = sync.Mutex{}
	captchaChallenges         = map[string]*captchaChallenge{} // key: 挑战 ID
	captchaChallengeLastSweep = time.Time{}
)

// NewCaptchaChallenge 保存验证码答案并返回随机挑战 ID，调用方只应把 ID 写入会话；生成失败时返回空字符串。
func NewCaptchaChallenge(answer string) string {
	idBytes, err := randomBytes(16)
	if err != nil {
		return ""
	}
	id := hex.EncodeToString(idBytes)
	now := time.Now()

	captchaChallengeLock.Lock()
	defer captchaChallengeLock.Unlock()

	sweepCaptchaChallengesLocked(now)
	if captchaChallengeMaxEntries <= len(captchaChallenges) {
		// 达到条数上限后淘汰一个旧挑战，避免公开接口被用于无限占用内存
		for key := range captchaChallenges {
			delete(captchaChallenges, key)
			break
		}
	}
	captchaChallenges[id] = &captchaChallenge{answer: normalizeCaptchaAnswer(answer), expires: now.Add(captchaChallengeTTL)}
	return id
}

// ConsumeCaptchaChallenge 校验验证码并立即删除挑战，同一挑战只能使用一次；
// ID 未知、挑战已过期或答案错误时返回 false。
func ConsumeCaptchaChallenge(id, answer string) bool {
	if "" == id {
		return false
	}

	now := time.Now()
	captchaChallengeLock.Lock()
	sweepCaptchaChallengesLocked(now)
	challenge := captchaChallenges[id]
	delete(captchaChallenges, id)
	captchaChallengeLock.Unlock()

	if nil == challenge || now.After(challenge.expires) {
		return false
	}
	return 1 == subtle.ConstantTimeCompare([]byte(challenge.answer), []byte(normalizeCaptchaAnswer(answer)))
}

// normalizeCaptchaAnswer 统一验证码大小写和首尾空白，保持与大小写不敏感的输入兼容。
func normalizeCaptchaAnswer(answer string) string {
	return strings.ToUpper(strings.TrimSpace(answer))
}

// sweepCaptchaChallengesLocked 按固定间隔清理过期挑战，调用方须持有 captchaChallengeLock。
func sweepCaptchaChallengesLocked(now time.Time) {
	if now.Sub(captchaChallengeLastSweep) < captchaChallengeSweepPeriod {
		return
	}
	captchaChallengeLastSweep = now
	for id, challenge := range captchaChallenges {
		if now.After(challenge.expires) {
			delete(captchaChallenges, id)
		}
	}
}
