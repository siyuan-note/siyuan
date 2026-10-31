// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package util

import (
	"crypto/hkdf"
	"crypto/sha256"
	"crypto/subtle"
	"strings"
	"sync"
	"time"

	"github.com/88250/gulu"
	ginSessions "github.com/gin-contrib/sessions"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/logging"
)

var WrongAuthCount int

func NeedCaptcha() bool {
	return 3 < WrongAuthCount
}

// AuthCodeEquals 恒定时间比较认证码，避免通过响应时间差异猜测秘密。
func AuthCodeEquals(a, b string) bool {
	return 1 == subtle.ConstantTimeCompare([]byte(a), []byte(b))
}

var (
	authThrottleLock      = sync.Mutex{}
	authThrottles         = map[string]*authThrottle{} // key: 来源 IP
	authThrottleLastSweep = time.Time{}
)

// authThrottle 记录认证失败次数与锁定状态，用于防止无验证码的认证路径（如 Basic Auth）被暴力破解。
type authThrottle struct {
	FailCount int
	LockUntil time.Time
	LastFail  time.Time
}

const (
	authThrottleMaxFail          = 5       // 连续失败次数达到该值时开始锁定
	authThrottleLockBaseSec      = 30      // 首次锁定秒数
	authThrottleLockMaxSec       = 15 * 60 // 锁定秒数上限
	authThrottleWindowSec        = 15 * 60 // 失败计数滑动窗口，窗口内失败才累计
	authThrottleMaxEntries       = 10000   // 限流记录条数上限，保证 map 内存有界
	authThrottleSweepIntervalSec = 5 * 60  // 定期清扫过期记录的间隔秒数
)

// authThrottleSweepLocked 按固定间隔清扫过期记录，调用方须持有 authThrottleLock。
// 清除窗口期已过且未锁定的条目，避免仅当同一 key 再次被访问时才清理，防止 map 无限增长
// https://github.com/siyuan-note/siyuan/security/advisories/GHSA-2x7j-p79w-7744
func authThrottleSweepLocked(now time.Time) {
	if now.Sub(authThrottleLastSweep) < authThrottleSweepIntervalSec*time.Second {
		return
	}
	authThrottleLastSweep = now
	for key, throttle := range authThrottles {
		if now.Before(throttle.LockUntil) {
			continue // 仍处于锁定中，保留
		}
		if authThrottleWindowSec*time.Second <= now.Sub(throttle.LastFail) {
			delete(authThrottles, key)
		}
	}
}

// AuthThrottleCheck 返回 key 剩余锁定秒数，0 表示未锁定。
func AuthThrottleCheck(key string) (retryAfter int) {
	authThrottleLock.Lock()
	defer authThrottleLock.Unlock()

	authThrottleSweepLocked(time.Now())
	throttle := authThrottles[key]
	if nil == throttle {
		return 0
	}
	if time.Now().Before(throttle.LockUntil) {
		return int(time.Until(throttle.LockUntil)/time.Second) + 1
	}
	if !throttle.LockUntil.IsZero() {
		// 锁定已过期，清除失败计数
		delete(authThrottles, key)
		return 0
	}
	if authThrottleWindowSec*time.Second <= time.Since(throttle.LastFail) {
		// 超过窗口期未再失败，清除计数避免误锁
		delete(authThrottles, key)
	}
	return 0
}

// AuthThrottleFail 记录一次认证失败，达到阈值后按指数退避锁定。
func AuthThrottleFail(key string) {
	authThrottleLock.Lock()
	defer authThrottleLock.Unlock()

	now := time.Now()
	authThrottleSweepLocked(now)
	throttle := authThrottles[key]
	if nil == throttle {
		if authThrottleMaxEntries <= len(authThrottles) {
			// 达到条目上限后不再跟踪新 key，保证内存有界。攻击者可通过伪造来源地址制造大量唯一 key，
			// 跳过跟踪仅影响新增 key 的限流，不影响已有记录的锁定与清理。
			return
		}
		throttle = &authThrottle{}
		authThrottles[key] = throttle
	} else if authThrottleWindowSec*time.Second <= now.Sub(throttle.LastFail) {
		// 超过窗口期，重置失败计数
		throttle.FailCount = 0
	}
	throttle.LastFail = now
	throttle.FailCount++
	if throttle.FailCount <= authThrottleMaxFail {
		return
	}

	lockSec := authThrottleLockBaseSec
	for i := authThrottleMaxFail; i < throttle.FailCount; i++ {
		if lockSec >= (authThrottleLockMaxSec+1)/2 {
			// 达到锁定上限后固定失败计数，持续失败只延长锁定截止时间。
			lockSec = authThrottleLockMaxSec
			throttle.FailCount = i + 1
			break
		}
		lockSec *= 2
	}
	throttle.LockUntil = now.Add(time.Duration(lockSec) * time.Second)
}

// AuthThrottleReset 认证成功后清除失败计数。
func AuthThrottleReset(key string) {
	authThrottleLock.Lock()
	defer authThrottleLock.Unlock()
	delete(authThrottles, key)
}

// SessionCookieName 是会话 Cookie 的名称。Cookie 不按端口隔离，同一主机上的各工作空间共用该 Cookie。
const SessionCookieName = "siyuan"

// SessionCookieKeys 由 Cookie 密钥派生会话 Cookie 的签名密钥和 AES-256 加密密钥。
// 旧格式 Cookie 直接以 Cookie 密钥签名且不加密，无法通过校验，按未登录处理。
// Cookie 密钥为空时不派生，会话 Cookie 的编解码随之失败，避免以公开的固定密钥签发会话。
func SessionCookieKeys(cookieKey string) (hashKey, blockKey []byte, err error) {
	if "" == cookieKey {
		return
	}
	if hashKey, err = hkdf.Key(sha256.New, []byte(cookieKey), nil, "siyuan-session-cookie-hash-v1", 32); err != nil {
		return
	}
	blockKey, err = hkdf.Key(sha256.New, []byte(cookieKey), nil, "siyuan-session-cookie-block-v1", 32)
	return
}

// SessionData represents the session.
type SessionData struct {
	Workspaces map[string]*WorkspaceSession // <WorkspacePath, WorkspaceSession>
}

type WorkspaceSession struct {
	AccessAuthCodeVersion string // 锁屏密码的 HMAC 摘要，会话不保存密码原文；修改密码后既有会话随之失效
	OIDCSessionVersion    string
	DesktopSessionID      string `json:",omitempty"` // 未记住的本机桌面登录所属内核启动批次
	OIDCBinding           string
	CaptchaID             string // 服务端验证码挑战 ID，验证码答案不写入会话
}

func (sd *SessionData) Clear(c *gin.Context) {
	session := ginSessions.Default(c)
	session.Delete("data")
	if err := session.Save(); err != nil {
		logging.LogErrorf("clear session failed: %v", err)
	}
}

// Save saves the current session of the specified context.
func (sd *SessionData) Save(c *gin.Context) error {
	session := ginSessions.Default(c)
	sessionDataBytes, err := gulu.JSON.MarshalJSON(sd)
	if err != nil {
		return err
	}
	session.Set("data", string(sessionDataBytes))
	return session.Save()
}

// GetSession returns session of the specified context.
func GetSession(c *gin.Context) *SessionData {
	ret := &SessionData{}

	session := ginSessions.Default(c)
	sessionDataStr := session.Get("data")
	if nil == sessionDataStr {
		return ret
	}

	err := gulu.JSON.UnmarshalJSON([]byte(sessionDataStr.(string)), ret)
	if err != nil {
		return ret
	}

	c.Set("session", ret)
	return ret
}

func GetWorkspaceSession(session *SessionData) (ret *WorkspaceSession) {
	ret = &WorkspaceSession{}
	if nil == session.Workspaces {
		session.Workspaces = map[string]*WorkspaceSession{}
	}
	ret = session.Workspaces[WorkspaceDir]
	if nil == ret {
		ret = &WorkspaceSession{}
		session.Workspaces[WorkspaceDir] = ret
	}
	return
}

func RemoveWorkspaceSession(session *SessionData) {
	delete(session.Workspaces, WorkspaceDir)
}

// IsBrowserRequest 判断请求是否来自浏览器（非 SiYuan 原生客户端）。
// 原生客户端（桌面 Electron、Android/iOS/Harmony）的 User-Agent 均以 "SiYuan/" 开头，
// 其余视为浏览器。该口径与前端 getFrontend()、electron/main.js 设置的 UA 前缀、
// 以及 session 鉴权中既有的 HasPrefix(ua, "SiYuan/") 判断保持一致。
func IsBrowserRequest(c *gin.Context) bool {
	return !strings.HasPrefix(c.GetHeader("User-Agent"), "SiYuan/")
}
