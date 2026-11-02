// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	ginSessions "github.com/gin-contrib/sessions"
	"github.com/gin-contrib/sessions/cookie"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestDesktopSessionLifecycle(t *testing.T) {
	setupOIDCTest(t)
	oldID, oldDir, oldContainer, oldWrong := desktopSessionID, util.WorkspaceDir, util.Container, util.WrongAuthCount
	t.Cleanup(func() {
		desktopSessionID, util.WorkspaceDir, util.Container, util.WrongAuthCount = oldID, oldDir, oldContainer, oldWrong
	})
	Conf.AccessAuthCode = "desktop-password"
	util.WrongAuthCount = 0
	const desktopUA = "SiYuan/3.8.9 https://b3log.org/siyuan Electron Chrome/140"
	for _, method := range []string{"password", "oidc"} {
		for _, tc := range []struct {
			name, ua, address, container string
			remember, bound              bool
		}{
			{"desktop session", desktopUA, "127.0.0.1:1234", util.ContainerStd, false, true},
			{"remembered desktop", desktopUA, "127.0.0.1:1234", util.ContainerStd, true, false},
			{"browser", "Mozilla/5.0", "127.0.0.1:1234", util.ContainerStd, false, false},
			{"remote desktop", desktopUA, "192.0.2.1:1234", util.ContainerStd, false, false},
			{"mobile", "SiYuan/3.8.9 Android", "127.0.0.1:1234", util.ContainerAndroid, false, false},
			{"server", desktopUA, "127.0.0.1:1234", util.ContainerDocker, false, false},
		} {
			t.Run(method+"/"+tc.name, func(t *testing.T) {
				util.Container, util.WorkspaceDir, desktopSessionID = tc.container, "Note1", "boot-one"
				engine := gin.New()
				engine.Use(ginSessions.Sessions("siyuan", cookie.NewStore([]byte("desktop-session-test-key"))))
				engine.POST("/login", func(c *gin.Context) {
					if method == "password" {
						result := LoginAuth(c, apicontract.SystemLoginAuthRequest{AuthCode: Conf.AccessAuthCode, RememberMe: tc.remember})
						if result.Code() != 0 {
							t.Fatalf("login failed: %+v", result)
						}
					} else if err := authenticateOIDCSession(c, tc.remember); err != nil {
						t.Fatal(err)
					}
				})
				engine.GET("/session", func(c *gin.Context) { c.JSON(200, util.GetWorkspaceSession(util.GetSession(c))) })
				engine.GET("/stage/build/app/", CheckAuth, func(c *gin.Context) { c.Status(http.StatusNoContent) })
				request := func(path string, cookies []*http.Cookie) *httptest.ResponseRecorder {
					verb := http.MethodGet
					if path == "/login" {
						verb = http.MethodPost
					}
					r := httptest.NewRequest(verb, "http://127.0.0.1:6806"+path, nil)
					r.RemoteAddr = tc.address
					r.Header.Set("User-Agent", tc.ua)
					for _, value := range cookies {
						r.AddCookie(value)
					}
					w := httptest.NewRecorder()
					engine.ServeHTTP(w, r)
					return w
				}
				login := request("/login", nil)
				cookies := login.Result().Cookies()
				if len(cookies) != 1 {
					t.Fatalf("expected a login cookie, got %d", len(cookies))
				}
				if (cookies[0].MaxAge == 2592000) != tc.remember {
					t.Fatal("remembered lifetime changed")
				}
				var session util.WorkspaceSession
				if err := json.Unmarshal(request("/session", cookies).Body.Bytes(), &session); err != nil {
					t.Fatal(err)
				}
				if (session.DesktopSessionID != "") != tc.bound {
					t.Fatalf("unexpected binding: %+v", session)
				}
				for range 2 {
					if got := request("/stage/build/app/", cookies); got.Code != http.StatusNoContent {
						t.Fatalf("same kernel (including hide/canceled exit) rejected session: %d", got.Code)
					}
				}
				desktopSessionID = "boot-two"
				got := request("/stage/build/app/", cookies)
				if tc.bound {
					if got.Code != http.StatusFound || !strings.HasPrefix(got.Header().Get("Location"), "/check-auth") {
						t.Fatalf("reopened workspace did not require authentication: %d %s", got.Code, got.Header().Get("Location"))
					}
					if IsAccessCodeSessionAuthenticated(&session) || IsOIDCSessionAuthenticated(&session) {
						t.Fatal("WebSocket authentication helpers accepted an expired session")
					}
				} else if got.Code != http.StatusNoContent {
					t.Fatalf("unbound session expired: %d", got.Code)
				}
				// 重新登录必须替换旧绑定；选择记住时也必须移除已有绑定。
				fresh := request("/login", cookies).Result().Cookies()
				if got := request("/stage/build/app/", fresh); got.Code != http.StatusNoContent {
					t.Fatal("relogin failed")
				}
				if tc.bound {
					tc.remember = true
					remembered := request("/login", fresh).Result().Cookies()
					desktopSessionID = "boot-three"
					if got := request("/stage/build/app/", remembered); got.Code != http.StatusNoContent {
						t.Fatal("remembered relogin retained the old desktop binding")
					}
					tc.remember = false
					unremembered := request("/login", remembered).Result().Cookies()
					desktopSessionID = "boot-four"
					if got := request("/stage/build/app/", unremembered); got.Code != http.StatusFound {
						t.Fatal("unremembered relogin did not restore the desktop binding")
					}
				}
			})
		}
	}
}

func TestDesktopSessionWorkspaceIsolationAndRememberedSessions(t *testing.T) {
	setupOIDCTest(t)
	oldDir, oldID := util.WorkspaceDir, desktopSessionID
	t.Cleanup(func() { util.WorkspaceDir, desktopSessionID = oldDir, oldID })
	Conf.AccessAuthCode = "password"
	version := accessAuthCodeVersion("password")
	sessions := util.SessionData{Workspaces: map[string]*util.WorkspaceSession{
		"Note1":      {AccessAuthCodeVersion: version, DesktopSessionID: "boot-one"},
		"Note2":      {AccessAuthCodeVersion: version, DesktopSessionID: "boot-two"},
		"remembered": {AccessAuthCodeVersion: version},
	}}
	for _, tc := range []struct {
		workspace, boot string
		valid           bool
	}{
		{"Note1", "boot-one", true}, {"Note1", "reopened-one", false},
		{"Note2", "boot-two", true}, {"remembered", "reopened-one", true},
	} {
		util.WorkspaceDir, desktopSessionID = tc.workspace, tc.boot
		if IsWorkspaceSessionAuthenticated(util.GetWorkspaceSession(&sessions)) != tc.valid {
			t.Fatalf("unexpected authentication for %s at %s", tc.workspace, tc.boot)
		}
	}
	if len(sessions.Workspaces) != 3 || sessions.Workspaces["Note1"].DesktopSessionID != "boot-one" {
		t.Fatal("checking an expired workspace mutated the shared cookie")
	}
	if IsWorkspaceSessionAuthenticated(nil) {
		t.Fatal("nil session was authenticated")
	}
}

func TestAccessCodeSessionStoresOnlyDigest(t *testing.T) {
	setupOIDCTest(t)
	Conf.OIDC.Enabled = false
	Conf.AccessAuthCode = "lock-screen-password"
	workspaceSession := &util.WorkspaceSession{}
	SetAccessCodeSession(workspaceSession, Conf.AccessAuthCode)
	data, err := json.Marshal(workspaceSession)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(data), Conf.AccessAuthCode) || workspaceSession.AccessAuthCodeVersion == "" {
		t.Fatalf("session does not store only the access authorization code digest: %s", data)
	}
	if !IsAccessCodeSessionAuthenticated(workspaceSession) {
		t.Fatal("current access authorization code session was rejected")
	}

	Conf.AccessAuthCode = "changed-password"
	if IsAccessCodeSessionAuthenticated(workspaceSession) {
		t.Fatal("session survived an access authorization code change")
	}
	Conf.AccessAuthCode = "lock-screen-password"
	Conf.CookieKey = "rotated-cookie-key"
	if IsAccessCodeSessionAuthenticated(workspaceSession) {
		t.Fatal("session survived a cookie key change")
	}
	Conf.CookieKey = ""
	SetAccessCodeSession(workspaceSession, Conf.AccessAuthCode)
	if workspaceSession.AccessAuthCodeVersion != "" || IsAccessCodeSessionAuthenticated(workspaceSession) {
		t.Fatal("session was authenticated without a cookie key")
	}
}
