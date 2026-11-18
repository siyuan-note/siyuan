// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	ginSessions "github.com/gin-contrib/sessions"
	"github.com/gin-contrib/sessions/cookie"
	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/olahol/melody"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// TestLogoutAuthBroadcastRequiresAuthenticatedSession 验证未认证请求不会触发全局登出广播
// https://github.com/siyuan-note/siyuan/security/advisories/GHSA-4w2q-xjc2-gwvv
func TestLogoutAuthBroadcastRequiresAuthenticatedSession(t *testing.T) {
	gin.SetMode(gin.TestMode)

	oldConf, oldWorkspaceDir, oldLangs := model.Conf, util.WorkspaceDir, util.Langs
	util.WorkspaceDir = "logout-auth-broadcast-test"
	model.Conf = model.NewAppConf()
	model.Conf.Lang = "test"
	model.Conf.CookieKey = "logout-auth-broadcast-cookie-key"
	model.Conf.AccessAuthCode = "logout-auth-broadcast-code"
	util.Langs = map[string]map[int]string{
		"test": {86: "Access authentication is not enabled"},
		"en":   {86: "Access authentication is not enabled"},
	}
	t.Cleanup(func() {
		model.Conf, util.WorkspaceDir, util.Langs = oldConf, oldWorkspaceDir, oldLangs
	})

	push := melody.New()
	connected := make(chan *melody.Session, 1)
	push.HandleConnect(func(session *melody.Session) {
		util.AddPushChan(session)
		connected <- session
	})
	push.HandleDisconnect(util.RemovePushChan)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = push.HandleRequest(w, r)
	}))
	t.Cleanup(func() {
		_ = push.Close()
		server.Close()
	})

	connection, _, err := websocket.DefaultDialer.Dial(
		"ws"+strings.TrimPrefix(server.URL, "http")+"/?app=logout-auth-broadcast-test&id=main&type=main", nil)
	if err != nil {
		t.Fatalf("connect main client: %v", err)
	}
	select {
	case session := <-connected:
		t.Cleanup(func() {
			_ = connection.Close()
			util.RemovePushChan(session)
		})
	case <-time.After(5 * time.Second):
		_ = connection.Close()
		t.Fatal("websocket registration timed out")
	}

	engine := gin.New()
	store := cookie.NewStore([]byte("logout-auth-broadcast-session-key"))
	engine.Use(ginSessions.Sessions(util.SessionCookieName, store))
	engine.GET("/fixture", func(c *gin.Context) {
		session := util.GetSession(c)
		model.SetAccessCodeSession(util.GetWorkspaceSession(session), model.Conf.AccessAuthCode)
		if err := session.Save(c); err != nil {
			t.Errorf("save fixture session failed: %v", err)
		}
		c.Status(http.StatusNoContent)
	})
	engine.POST("/api/system/logoutAuth", logoutAuth)

	post := func(cookies []*http.Cookie) map[string]any {
		t.Helper()
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodPost, "/api/system/logoutAuth", nil)
		for _, cookie := range cookies {
			request.AddCookie(cookie)
		}
		engine.ServeHTTP(recorder, request)
		var response map[string]any
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
			t.Fatalf("invalid logout response %q: %v", recorder.Body.String(), err)
		}
		return response
	}
	// 广播屏障：先触发一次屏障消息，再读到屏障为止，避免依赖读超时判断没有广播
	readUntilBarrier := func(stage string) []string {
		t.Helper()
		if err := push.Broadcast([]byte(`{"cmd":"barrier"}`)); err != nil {
			t.Fatalf("%s: broadcast barrier: %v", stage, err)
		}
		if err := connection.SetReadDeadline(time.Now().Add(3 * time.Second)); err != nil {
			t.Fatalf("%s: set read deadline: %v", stage, err)
		}
		var commands []string
		for {
			var event struct {
				Cmd string `json:"cmd"`
			}
			if err := connection.ReadJSON(&event); err != nil {
				t.Fatalf("%s: read websocket event: %v", stage, err)
			}
			if event.Cmd == "barrier" {
				return commands
			}
			commands = append(commands, event.Cmd)
		}
	}
	contains := func(commands []string, want string) bool {
		for _, command := range commands {
			if command == want {
				return true
			}
		}
		return false
	}
	logoutResponseCode := func(response map[string]any) int {
		code, _ := response["code"].(float64)
		return int(code)
	}

	// 未认证请求不得广播登出
	if code := logoutResponseCode(post(nil)); code != 0 {
		t.Fatalf("unauthenticated logout response code = %d, want 0", code)
	}
	if commands := readUntilBarrier("unauthenticated logout"); contains(commands, "logoutAuth") {
		t.Fatalf("unauthenticated logout broadcast %v", commands)
	}

	// 已认证会话退出时仍然广播，保留多窗口登出行为
	fixture := httptest.NewRecorder()
	engine.ServeHTTP(fixture, httptest.NewRequest(http.MethodGet, "/fixture", nil))
	cookies := fixture.Result().Cookies()
	if len(cookies) == 0 {
		t.Fatal("fixture did not issue a session cookie")
	}
	if code := logoutResponseCode(post(cookies)); code != 0 {
		t.Fatalf("authenticated logout response code = %d, want 0", code)
	}
	if commands := readUntilBarrier("authenticated logout"); !contains(commands, "logoutAuth") {
		t.Fatalf("authenticated logout did not broadcast: %v", commands)
	}

	// 未启用访问认证时保持原有早退分支且不广播
	model.Conf.AccessAuthCode = ""
	if code := logoutResponseCode(post(nil)); code != -1 {
		t.Fatalf("logout without access authentication code = %d, want -1", code)
	}
	if commands := readUntilBarrier("disabled access authentication"); contains(commands, "logoutAuth") {
		t.Fatalf("disabled access authentication broadcast %v", commands)
	}
}
