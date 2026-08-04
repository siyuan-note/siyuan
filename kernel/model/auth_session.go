// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package model

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"net/http"

	"github.com/88250/gulu"
	ginSessions "github.com/gin-contrib/sessions"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func IsAccessAuthRequired() bool {
	return Conf.AccessAuthCode != "" || Conf.GetOIDC().Enabled
}

func IsWorkspaceSessionAuthenticated(workspaceSession *util.WorkspaceSession) bool {
	if workspaceSession == nil {
		return false
	}
	if Conf.AccessAuthCode != "" && util.AuthCodeEquals(Conf.AccessAuthCode, workspaceSession.AccessAuthCode) {
		return true
	}
	return Conf.GetOIDC().Enabled && workspaceSession.OIDCSessionVersion != "" &&
		hmac.Equal([]byte(workspaceSession.OIDCSessionVersion), []byte(oidcSessionVersion()))
}

func applyAuthenticatedSession(c *gin.Context, workspaceSession *util.WorkspaceSession, rememberMe bool) {
	workspaceSession.OIDCSessionVersion = oidcSessionVersion()
	maxAge := 0
	if rememberMe {
		maxAge = 60 * 60 * 24 * 30
	}
	ginSessions.Default(c).Options(ginSessions.Options{
		Path:     "/",
		Secure:   util.SSL,
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
	data, err := gulu.JSON.MarshalJSON(config)
	if err != nil {
		return ""
	}
	mac := hmac.New(sha256.New, []byte(Conf.CookieKey))
	_, _ = mac.Write(data)
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}
