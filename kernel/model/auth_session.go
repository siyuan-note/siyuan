// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"net/http"
	"strings"

	"github.com/88250/gulu"
	ginSessions "github.com/gin-contrib/sessions"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var desktopSessionID = rand.Text()

// BindDesktopSession 将未记住的本机桌面登录绑定到本次内核启动；窗口隐藏及退出取消不改变绑定。
func BindDesktopSession(c *gin.Context, workspaceSession *util.WorkspaceSession, rememberMe bool) {
	workspaceSession.DesktopSessionID = ""
	if !rememberMe && util.Container == util.ContainerStd && IsLocalRequest(c) &&
		!util.IsBrowserRequest(c) && strings.Contains(c.GetHeader("User-Agent"), " Electron ") {
		workspaceSession.DesktopSessionID = desktopSessionID
	}
}

func isWorkspaceSessionCurrent(workspaceSession *util.WorkspaceSession) bool {
	// 记住登录及非本机桌面的会话没有启动批次，跨内核重启保持有效；重新登录时按所选的记住策略建立绑定。
	return workspaceSession != nil && (workspaceSession.DesktopSessionID == "" ||
		hmac.Equal([]byte(workspaceSession.DesktopSessionID), []byte(desktopSessionID)))
}

func IsAccessAuthRequired() bool {
	return Conf.AccessAuthCode != "" || Conf.GetOIDC().Enabled
}

func IsWorkspaceSessionAuthenticated(workspaceSession *util.WorkspaceSession) bool {
	return IsAccessCodeSessionAuthenticated(workspaceSession) || IsOIDCSessionAuthenticated(workspaceSession)
}

func IsAccessCodeSessionAuthenticated(workspaceSession *util.WorkspaceSession) bool {
	version := accessAuthCodeVersion(Conf.AccessAuthCode)
	return isWorkspaceSessionCurrent(workspaceSession) && version != "" &&
		hmac.Equal([]byte(workspaceSession.AccessAuthCodeVersion), []byte(version))
}

// SetAccessCodeSession 将会话绑定到指定的锁屏密码，会话只保存密码的 HMAC 摘要。
func SetAccessCodeSession(workspaceSession *util.WorkspaceSession, accessAuthCode string) {
	workspaceSession.AccessAuthCodeVersion = accessAuthCodeVersion(accessAuthCode)
}

func accessAuthCodeVersion(accessAuthCode string) string {
	if Conf == nil || Conf.CookieKey == "" || accessAuthCode == "" {
		return ""
	}
	mac := hmac.New(sha256.New, []byte(Conf.CookieKey))
	mac.Write([]byte("siyuan-access-auth-code-v1\x00"))
	mac.Write([]byte(accessAuthCode))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func IsOIDCSessionAuthenticated(workspaceSession *util.WorkspaceSession) bool {
	return isWorkspaceSessionCurrent(workspaceSession) && IsOIDCSessionVersionCurrent(workspaceSession.OIDCSessionVersion)
}

func IsOIDCSessionVersionCurrent(version string) bool {
	return version != "" && Conf.GetOIDC().Enabled && hmac.Equal([]byte(version), []byte(oidcSessionVersion()))
}

func applyAuthenticatedSession(c *gin.Context, workspaceSession *util.WorkspaceSession, rememberMe bool) {
	workspaceSession.OIDCSessionVersion = oidcSessionVersion()
	BindDesktopSession(c, workspaceSession, rememberMe)
	maxAge := 0
	if rememberMe {
		maxAge = 60 * 60 * 24 * 30
	}
	ginSessions.Default(c).Options(ginSessions.Options{
		Path: "/",
		// 与登录会话保持一致：只有客户端连接确实使用 TLS 时才标记 Secure
		// https://github.com/siyuan-note/siyuan/security/advisories/GHSA-hpj5-f7cj-vvwr
		Secure:   util.SSL || util.IsTLSRequest(c.Request),
		MaxAge:   maxAge,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})
}

func oidcSessionVersion() string {
	if Conf == nil || Conf.CookieKey == "" {
		return ""
	}
	config := Conf.GetOIDC()
	if !config.Enabled {
		return ""
	}
	return oidcConfigurationVersion(config)
}

func oidcConfigurationVersion(config *conf.OIDC) string {
	if Conf == nil || Conf.CookieKey == "" || config == nil {
		return ""
	}
	return oidcConfigurationVersionWithKey(Conf.CookieKey, config)
}

func oidcConfigurationVersionWithKey(cookieKey string, config *conf.OIDC) string {
	if cookieKey == "" || config == nil {
		return ""
	}
	data, err := gulu.JSON.MarshalJSON(config)
	if err != nil {
		return ""
	}
	mac := hmac.New(sha256.New, []byte(cookieKey))
	_, _ = mac.Write(data)
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}
