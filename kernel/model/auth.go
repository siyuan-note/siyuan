// SiYuan - Refactor your thinking
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
)

type Account struct {
	Username string
	Password string
	Token    string
}
type AccountsMap map[string]*Account // username -> account
type SessionsMap map[string]string   // sessionID -> username
type ClaimsKeyType string

const (
	XAuthTokenKey = "X-Auth-Token"

	SessionIdCookieName = "publish-visitor-session-id"

	ClaimsContextKey = "claims"

	iss = "siyuan-kernel" // token 的发行者

	ClaimsKeyRole string = "role"

	pluginJWTAudience = "siyuan-kernel-plugin"
)

var (
	accountsMap = AccountsMap{}
	sessionsMap = SessionsMap{}
	sessionLock = sync.Mutex{}

	jwtKey = make([]byte, 32)

	activePluginJWTs      sync.Map
	pluginJWTLifetime     = 12 * time.Hour
	pluginJWTRefreshAhead = 30 * time.Minute
)

type pluginJWTRegistration struct {
	name      string
	expiresAt time.Time
}

func InitJwtKey() error {
	if _, err := rand.Read(jwtKey); err != nil {
		logging.LogErrorf("generate JWT signing key failed: %s", err)
		return err
	}
	activePluginJWTs.Clear()
	return nil
}

func GetBasicAuthAccount(username string) *Account {
	return accountsMap[username]
}

func GetBasicAuthUsernameBySessionID(sessionID string) string {
	return sessionsMap[sessionID]
}

func GetNewSessionID() string {
	sessionID := uuid.New().String()
	return sessionID
}

func AddSession(sessionID, username string) {
	sessionLock.Lock()
	defer sessionLock.Unlock()
	sessionsMap[sessionID] = username
}

func DeleteSession(sessionID string) {
	sessionLock.Lock()
	defer sessionLock.Unlock()
	delete(sessionsMap, sessionID)
}

func InitPublishAccounts() {
	accountsMap = AccountsMap{
		"": &Account{}, // 匿名用户
	}
	for _, account := range Conf.Publish.Auth.Accounts {
		accountsMap[account.Username] = &Account{
			Username: account.Username,
			Password: account.Password,
		}
	}

	InitPublishJWT()
}

func InitPublishJWT() {
	if _, err := rand.Read(jwtKey); err != nil {
		logging.LogErrorf("generate JWT signing key failed: %s", err)
		return
	}
	activePluginJWTs.Clear()

	for username, account := range accountsMap {
		// REF: https://golang-jwt.github.io/jwt/usage/create/
		t := jwt.NewWithClaims(
			jwt.SigningMethodHS256,
			jwt.MapClaims{
				"iss": iss,                     // token 的发行者
				"sub": username,                // token 代表的主体
				"aud": "siyuan-publish-server", // token 的受众
				"jti": uuid.New().String(),     // token 的唯一标识

				ClaimsKeyRole: RoleReader, // 角色
			},
		)
		if token, err := t.SignedString(jwtKey); err != nil {
			logging.LogErrorf("JWT signature failed: %s", err)
			return
		} else {
			account.Token = token
		}
	}
}

// CreatePluginJWT 为指定名称的内核插件创建一个短期、可撤销的受限 JWT。
func CreatePluginJWT(name string) (string, error) {
	now := time.Now().UTC()
	expiresAt := now.Add(pluginJWTLifetime)
	t := jwt.NewWithClaims(
		jwt.SigningMethodHS256,
		jwt.MapClaims{
			"iss": iss,
			"sub": name,
			"aud": pluginJWTAudience,
			"jti": uuid.New().String(),
			"iat": now.Unix(),
			"nbf": now.Add(-time.Minute).Unix(),
			"exp": expiresAt.Unix(),

			ClaimsKeyRole: RoleKernelPlugin,
		},
	)
	if token, err := t.SignedString(jwtKey); err != nil {
		logging.LogErrorf("JWT signature failed: %s", err)
		return "", err
	} else {
		activePluginJWTs.Store(token, pluginJWTRegistration{name: name, expiresAt: expiresAt})
		return token, nil
	}
}

// RevokePluginJWT 撤销内核插件令牌。
func RevokePluginJWT(tokenString string) {
	if tokenString != "" {
		activePluginJWTs.Delete(tokenString)
	}
}

// PluginJWTNeedsRefresh 判断内核插件令牌是否需要轮换。
func PluginJWTNeedsRefresh(tokenString string) bool {
	value, ok := activePluginJWTs.Load(tokenString)
	if !ok {
		return true
	}
	registration, ok := value.(pluginJWTRegistration)
	return !ok || time.Until(registration.expiresAt) <= pluginJWTRefreshAhead
}

func ParseJWT(tokenString string) (*jwt.Token, error) {
	// REF: https://golang-jwt.github.io/jwt/usage/parse/
	token, err := jwt.Parse(
		tokenString,
		func(token *jwt.Token) (any, error) {
			return jwtKey, nil
		},
		jwt.WithIssuer(iss),
	)
	if err != nil {
		return nil, err
	}
	claims := GetTokenClaims(token)
	audiences, audienceErr := claims.GetAudience()
	if audienceErr == nil && slices.Contains(audiences, pluginJWTAudience) {
		value, ok := activePluginJWTs.Load(tokenString)
		if !ok {
			return nil, errors.New("kernel plugin JWT is not active")
		}
		registration, ok := value.(pluginJWTRegistration)
		subject, subjectErr := claims.GetSubject()
		if !ok || subjectErr != nil || subject != registration.name || !registration.expiresAt.After(time.Now()) {
			activePluginJWTs.Delete(tokenString)
			return nil, errors.New("kernel plugin JWT registration does not match")
		}
	}
	return token, nil
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

// GetPluginJWTSubject 返回内核插件令牌的稳定主体。
func GetPluginJWTSubject(token *jwt.Token) string {
	if token == nil || !token.Valid {
		return ""
	}
	claims := GetTokenClaims(token)
	audiences, err := claims.GetAudience()
	if err != nil || !slices.Contains(audiences, pluginJWTAudience) {
		return ""
	}
	subject, err := claims.GetSubject()
	if err != nil {
		return ""
	}
	return subject
}

// IsPublishServiceToken 检查 token 是否来自发布服务
func IsPublishServiceToken(token *jwt.Token) bool {
	if token == nil || !token.Valid {
		return false
	}
	claims := GetTokenClaims(token)
	tokenIssuer, issuerOK := claims["iss"].(string)
	audiences, audienceErr := claims.GetAudience()
	return issuerOK && tokenIssuer == iss && audienceErr == nil && slices.Contains(audiences, "siyuan-publish-server")
}
