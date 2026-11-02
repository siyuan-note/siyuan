// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package server

import (
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	ginSessions "github.com/gin-contrib/sessions"
	"github.com/gin-contrib/sessions/cookie"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// readSessionCookieWithoutKey 按 securecookie 的编码格式解开 Cookie 值，模拟未持有密钥的读取者。
func readSessionCookieWithoutKey(t *testing.T, value string) string {
	t.Helper()
	outer, err := base64.URLEncoding.DecodeString(value)
	if err != nil {
		t.Fatal(err)
	}
	parts := strings.SplitN(string(outer), "|", 3)
	if len(parts) != 3 {
		t.Fatalf("unexpected session cookie layout: %q", outer)
	}
	inner, err := base64.URLEncoding.DecodeString(parts[1])
	if err != nil {
		t.Fatal(err)
	}
	return string(inner)
}

func TestSessionCookieEncryptsPayloadAndRejectsLegacyFormat(t *testing.T) {
	gin.SetMode(gin.TestMode)
	previousConf, previousDir, previousWrongAuthCount := model.Conf, util.WorkspaceDir, util.WrongAuthCount
	t.Cleanup(func() {
		model.Conf, util.WorkspaceDir, util.WrongAuthCount = previousConf, previousDir, previousWrongAuthCount
	})
	const cookieKey, password, workspaceDir = "session-cookie-test-key-0123456789abcdef", "lock-screen-password", "/Users/alice/SiYuan"
	model.Conf = model.NewAppConf()
	model.Conf.CookieKey, model.Conf.AccessAuthCode = cookieKey, password
	util.WorkspaceDir, util.WrongAuthCount = workspaceDir, 0

	newEngine := func(store cookie.Store) *gin.Engine {
		engine := gin.New()
		engine.Use(ginSessions.Sessions(util.SessionCookieName, store))
		engine.POST("/api/system/loginAuth", func(c *gin.Context) {
			c.JSON(http.StatusOK, model.LoginAuth(c, apicontract.SystemLoginAuthRequest{AuthCode: password, RememberMe: true}))
		})
		engine.GET("/legacy-login", func(c *gin.Context) {
			// 旧格式载荷以工作空间路径为键保存锁屏密码原文
			session := ginSessions.Default(c)
			session.Set("data", `{"Workspaces":{"`+workspaceDir+`":{"AccessAuthCode":"`+password+`"}}}`)
			if err := session.Save(); err != nil {
				t.Fatal(err)
			}
		})
		engine.GET("/stage/build/desktop/", model.CheckAuth, func(c *gin.Context) { c.Status(http.StatusNoContent) })
		return engine
	}
	request := func(engine *gin.Engine, method, path string, cookies []*http.Cookie) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, "http://127.0.0.1:6806"+path, nil)
		r.RemoteAddr = "127.0.0.1:1234"
		r.Header.Set("User-Agent", "Mozilla/5.0")
		for _, value := range cookies {
			r.AddCookie(value)
		}
		w := httptest.NewRecorder()
		engine.ServeHTTP(w, r)
		return w
	}

	store, err := newSessionStore(cookieKey)
	if err != nil {
		t.Fatal(err)
	}
	engine := newEngine(store)
	cookies := request(engine, http.MethodPost, "/api/system/loginAuth", nil).Result().Cookies()
	if len(cookies) != 1 || cookies[0].Name != util.SessionCookieName || !cookies[0].HttpOnly {
		t.Fatalf("unexpected login cookies: %+v", cookies)
	}
	if payload := readSessionCookieWithoutKey(t, cookies[0].Value); strings.Contains(payload, password) ||
		strings.Contains(payload, workspaceDir) || strings.Contains(payload, "Workspaces") {
		t.Fatalf("session cookie payload is readable without the key: %q", payload)
	}
	if got := request(engine, http.MethodGet, "/stage/build/desktop/", cookies); got.Code != http.StatusNoContent {
		t.Fatalf("encrypted session was rejected: %d", got.Code)
	}

	legacyCookies := request(newEngine(cookie.NewStore([]byte(cookieKey))), http.MethodGet, "/legacy-login", nil).Result().Cookies()
	if len(legacyCookies) != 1 || !strings.Contains(readSessionCookieWithoutKey(t, legacyCookies[0].Value), password) {
		t.Fatalf("legacy session cookie fixture is not in the signed plaintext format: %+v", legacyCookies)
	}
	got := request(engine, http.MethodGet, "/stage/build/desktop/", legacyCookies)
	if got.Code != http.StatusFound || !strings.HasPrefix(got.Header().Get("Location"), "/check-auth") {
		t.Fatalf("legacy session cookie was accepted: %d %s", got.Code, got.Header().Get("Location"))
	}
}

// Cookie 密钥为空时不得以公开的固定密钥签发会话。
func TestSessionStoreRequiresCookieKey(t *testing.T) {
	hashKey, blockKey, err := util.SessionCookieKeys("")
	if err != nil || hashKey != nil || blockKey != nil {
		t.Fatalf("empty cookie key derived session keys: %v", err)
	}
	gin.SetMode(gin.TestMode)
	store, err := newSessionStore("")
	if err != nil {
		t.Fatal(err)
	}
	engine := gin.New()
	engine.Use(ginSessions.Sessions(util.SessionCookieName, store))
	engine.GET("/save", func(c *gin.Context) {
		session := ginSessions.Default(c)
		session.Set("data", "value")
		if session.Save() == nil {
			t.Error("session was saved without a cookie key")
		}
	})
	w := httptest.NewRecorder()
	engine.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/save", nil))
	if len(w.Result().Cookies()) != 0 {
		t.Fatal("session cookie was issued without a cookie key")
	}
}
