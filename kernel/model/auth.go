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

package model

import (
	"crypto/rand"
	"errors"
	"net/http"
	"slices"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/conf"
)

type Account struct {
	Username          string
	Password          string
	Token             string
	CredentialVersion string
}
type AccountsMap map[string]*Account // username -> account

// PublishSession 发布服务会话，记录所属用户名、凭据版本与最近活跃时间。
type PublishSession struct {
	Username          string
	CredentialVersion string
	LastActive        time.Time
}

type ClaimsKeyType string

const (
	XAuthTokenKey = "X-Auth-Token"

	SessionIdCookieName = "publish-visitor-session-id"

	ClaimsContextKey = "claims"

	iss                    = "siyuan-kernel"         // token 的发行者
	publishServiceAudience = "siyuan-publish-server" // 发布服务 token 的受众
	kernelPluginAudience   = "siyuan-kernel-plugin"  // 内核插件 token 的受众

	ClaimsKeyRole string = "role"

	// publishSessionTTL 发布服务会话空闲过期时长，超过后需要重新认证
	publishSessionTTL = 7 * 24 * time.Hour
	// publishSessionGlobalCap 发布服务会话全局上限，超出后淘汰最久未活跃的会话
	publishSessionGlobalCap = 4096
	// publishSessionPerAccountCap 单账户会话上限，超出后淘汰该账户最久未活跃的会话
	publishSessionPerAccountCap = 32
)

var (
	accountsMap  = AccountsMap{}
	accountsLock = sync.RWMutex{}
	sessionsMap  = map[string]*PublishSession{}
	sessionLock  = sync.Mutex{}

	jwtKey     = make([]byte, 32)
	jwtKeyOnce sync.Once

	ErrInvalidPublishServiceToken = errors.New("invalid publish service token")
)

func InitJwtKey() {
	jwtKeyOnce.Do(func() {
		err := refreshJwtKey()
		if err != nil {
			logging.LogFatalf(logging.ExitCodeFatal, "initialize JWT signing key failed: %s", err)
		}
	})
}

func refreshJwtKey() error {
	if _, err := rand.Read(jwtKey); err != nil {
		logging.LogErrorf("generate JWT signing key failed: %s", err)
		return err
	}
	return nil
}

func GetBasicAuthAccount(username string) *Account {
	accountsLock.RLock()
	defer accountsLock.RUnlock()
	account := accountsMap[username]
	if account == nil {
		return nil
	}
	accountCopy := *account
	return &accountCopy
}

// GetBasicAuthAccountBySessionID 返回会话对应的账户；会话不存在、已过期或凭据已变更时返回 nil。
func GetBasicAuthAccountBySessionID(sessionID string) *Account {
	accountsLock.RLock()
	defer accountsLock.RUnlock()

	sessionLock.Lock()
	defer sessionLock.Unlock()

	session := sessionsMap[sessionID]
	if nil == session {
		return nil
	}
	if publishSessionTTL < time.Since(session.LastActive) {
		// 会话空闲超时，删除并视为无效
		delete(sessionsMap, sessionID)
		return nil
	}

	account := accountsMap[session.Username]
	if nil == account || account.CredentialVersion != session.CredentialVersion {
		// 账户不存在或凭据已变更，删除并视为无效
		delete(sessionsMap, sessionID)
		return nil
	}

	// 刷新最近活跃时间，用于过期与淘汰判定
	session.LastActive = time.Now()
	accountCopy := *account
	return &accountCopy
}

func GetNewSessionID() string {
	sessionID := uuid.New().String()
	return sessionID
}

// AddSession 为指定账户注册发布服务会话并返回实际生效的会话 ID；账户凭据已变更时返回空字符串。
// 同一用户已有有效会话时复用其 ID，避免重复认证导致会话无限增长
// https://github.com/siyuan-note/siyuan/security/advisories/GHSA-f4vj-ppp2-5hg4；
// 同时按空闲时长清理过期会话，并在超出全局或单账户上限时淘汰最久未活跃的会话。
func AddSession(username, credentialVersion string) string {
	accountsLock.RLock()
	defer accountsLock.RUnlock()

	account := accountsMap[username]
	if nil == account || account.CredentialVersion != credentialVersion {
		return ""
	}

	sessionLock.Lock()
	defer sessionLock.Unlock()

	now := time.Now()
	purgeExpiredPublishSessions(now)

	// 复用该用户已有的有效会话
	for id, session := range sessionsMap {
		if session.Username == username && session.CredentialVersion == credentialVersion {
			session.LastActive = now
			return id
		}
	}

	// 单账户会话数达到上限时，淘汰该账户最久未活跃的会话
	if publishSessionPerAccountCap <= countPublishSessionsByUsername(username) {
		evictOldestPublishSessionByUsername(username)
	}

	// 全局会话数达到上限时，淘汰最久未活跃的会话
	if publishSessionGlobalCap <= len(sessionsMap) {
		evictOldestPublishSession()
	}

	sessionID := GetNewSessionID()
	sessionsMap[sessionID] = &PublishSession{
		Username:          username,
		CredentialVersion: credentialVersion,
		LastActive:        now,
	}
	return sessionID
}

func DeleteSession(sessionID string) {
	sessionLock.Lock()
	defer sessionLock.Unlock()
	delete(sessionsMap, sessionID)
}

// purgeExpiredPublishSessions 删除空闲超过 publishSessionTTL 的会话，调用方需持有 sessionLock。
func purgeExpiredPublishSessions(now time.Time) {
	for id, session := range sessionsMap {
		if publishSessionTTL < now.Sub(session.LastActive) {
			delete(sessionsMap, id)
		}
	}
}

// evictOldestPublishSession 淘汰最久未活跃的会话，调用方需持有 sessionLock。
func evictOldestPublishSession() {
	oldestID := ""
	oldestTime := time.Time{}
	for id, session := range sessionsMap {
		if "" == oldestID || session.LastActive.Before(oldestTime) {
			oldestID, oldestTime = id, session.LastActive
		}
	}
	delete(sessionsMap, oldestID)
}

// evictOldestPublishSessionByUsername 淘汰指定账户最久未活跃的会话，调用方需持有 sessionLock。
func evictOldestPublishSessionByUsername(username string) {
	oldestID := ""
	oldestTime := time.Time{}
	for id, session := range sessionsMap {
		if session.Username != username {
			continue
		}
		if "" == oldestID || session.LastActive.Before(oldestTime) {
			oldestID, oldestTime = id, session.LastActive
		}
	}
	delete(sessionsMap, oldestID)
}

// countPublishSessionsByUsername 统计指定账户的会话数，调用方需持有 sessionLock。
func countPublishSessionsByUsername(username string) int {
	count := 0
	for _, session := range sessionsMap {
		if session.Username == username {
			count++
		}
	}
	return count
}

func InitPublishAccounts() {
	if nil == Conf.Publish {
		Conf.Publish = conf.NewPublish()
	}
	if nil == Conf.Publish.Auth {
		// 防御 conf.json 中 auth 为 null 的历史坏配置，避免启动时解引用空指针崩溃
		// https://github.com/siyuan-note/siyuan/security/advisories/GHSA-rp9f-c2fj-h648
		Conf.Publish.Auth = conf.NewPublish().Auth
	}
	accounts := AccountsMap{
		"": &Account{}, // 匿名用户
	}
	for _, account := range Conf.Publish.Auth.Accounts {
		accounts[account.Username] = &Account{
			Username: account.Username,
			Password: account.Password,
		}
	}

	if err := refreshPublishJWT(accounts); err != nil {
		logging.LogErrorf("JWT signature failed: %s", err)
		return
	}

	// 账户及其 token 发布后保持不可变，更新时整体替换完整快照，避免请求读取到构建中的状态。
	accountsLock.Lock()
	for username, account := range accounts {
		previous := accountsMap[username]
		if nil != previous && previous.Password == account.Password {
			account.CredentialVersion = previous.CredentialVersion
		}
		if "" == account.CredentialVersion {
			account.CredentialVersion = uuid.New().String()
		}
	}
	accountsMap = accounts

	// 立即撤销账户已删除或密码已变更的会话。
	sessionLock.Lock()
	for id, session := range sessionsMap {
		account := accounts[session.Username]
		if nil == account || account.CredentialVersion != session.CredentialVersion {
			delete(sessionsMap, id)
		}
	}
	sessionLock.Unlock()
	accountsLock.Unlock()
}

func refreshPublishJWT(accounts AccountsMap) error {
	for username, account := range accounts {
		// REF: https://golang-jwt.github.io/jwt/usage/create/
		t := jwt.NewWithClaims(
			jwt.SigningMethodHS256,
			jwt.MapClaims{
				"iss": iss,                    // token 的发行者
				"sub": username,               // token 代表的主体
				"aud": publishServiceAudience, // token 的受众
				"jti": uuid.New().String(),    // token 的唯一标识

				ClaimsKeyRole: RoleReader, // 角色
			},
		)
		if token, err := t.SignedString(jwtKey); err != nil {
			return err
		} else {
			account.Token = token
		}
	}
	return nil
}

// CreatePluginJWT 为指定名称的内核插件创建一个 JWT，包含管理员权限。插件使用这个 JWT 调用内核 API。
func CreatePluginJWT(name string) (string, error) {
	t := jwt.NewWithClaims(
		jwt.SigningMethodHS256,
		jwt.MapClaims{
			"iss": iss,
			"sub": name,
			"aud": kernelPluginAudience,
			"jti": uuid.New().String(),

			ClaimsKeyRole: RoleAdministrator,
		},
	)
	if token, err := t.SignedString(jwtKey); err != nil {
		logging.LogErrorf("JWT signature failed: %s", err)
		return "", err
	} else {
		return token, nil
	}
}

func ParseJWT(tokenString string) (token *jwt.Token, err error) {
	// REF: https://golang-jwt.github.io/jwt/usage/parse/
	token, err = jwt.Parse(
		tokenString,
		func(token *jwt.Token) (any, error) {
			return jwtKey, nil
		},
		jwt.WithIssuer(iss),
	)
	if err != nil {
		return
	}

	if IsPublishServiceToken(token) {
		if !IsValidPublishServiceToken(token) {
			err = ErrInvalidPublishServiceToken
			return
		}
	}
	return
}

func ParseXAuthToken(r *http.Request) *jwt.Token {
	tokenString := r.Header.Get(XAuthTokenKey)
	if tokenString != "" {
		if token, err := ParseJWT(tokenString); err != nil {
			logging.LogErrorf("JWT parse failed: %s", err)
		} else {
			return token
		}
	}
	return nil
}

func GetTokenClaims(token *jwt.Token) jwt.MapClaims {
	return token.Claims.(jwt.MapClaims)
}

func GetClaimRole(claims jwt.MapClaims) Role {
	if role := claims[ClaimsKeyRole]; role != nil {
		return Role(role.(float64))
	}
	return RoleVisitor
}

// IsPublishServiceToken 检查 token 是否来自发布服务
func IsPublishServiceToken(token *jwt.Token) bool {
	if token == nil || !token.Valid {
		return false
	}
	claims := GetTokenClaims(token)
	tokenIssuer, ok := claims["iss"].(string)
	if !ok || tokenIssuer != iss {
		return false
	}
	audience, err := claims.GetAudience()
	return err == nil && slices.Contains(audience, publishServiceAudience)
}

// IsValidPublishServiceToken 检查 token 是否来自发布服务且有效
func IsValidPublishServiceToken(token *jwt.Token) bool {
	if !IsPublishServiceToken(token) {
		return false
	}

	claims := GetTokenClaims(token)
	username, ok := claims["sub"].(string)
	if !ok {
		return false
	}

	account := GetBasicAuthAccount(username)
	if account == nil || account.Token != token.Raw {
		return false
	}

	return true
}
