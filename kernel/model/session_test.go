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
	"net/http"
	"net/http/httptest"
	"testing"

	ginSessions "github.com/gin-contrib/sessions"
	"github.com/gin-contrib/sessions/cookie"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// TestAuthByAPITokenThrottle 验证 API token 认证路径的限流与授权行为。
func TestAuthByAPITokenThrottle(t *testing.T) {
	originalConf := Conf
	Conf = NewAppConf()
	Conf.Api = conf.NewAPI()
	t.Cleanup(func() { Conf = originalConf })
	Conf.Api.Token = "test-api-token-123"

	engine := gin.New()
	engine.GET("/api/test", CheckAuth, func(c *gin.Context) {
		c.Status(http.StatusNoContent)
	})

	newRequest := func(ip, token string) *httptest.ResponseRecorder {
		request := httptest.NewRequest(http.MethodGet, "/api/test?token="+token, nil)
		request.RemoteAddr = ip
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, request)
		return recorder
	}

	t.Run("correct token grants admin", func(t *testing.T) {
		ip := "192.0.2.10:1234"
		defer util.AuthThrottleReset(ip)
		if recorder := newRequest(ip, "test-api-token-123"); recorder.Code != http.StatusNoContent {
			t.Fatalf("status = %d, want %d", recorder.Code, http.StatusNoContent)
		}
	})

	t.Run("wrong tokens trigger lockout", func(t *testing.T) {
		ip := "192.0.2.11:1234"
		defer util.AuthThrottleReset(ip)
		for i := 0; i < 5; i++ {
			if recorder := newRequest(ip, "wrong-token"); recorder.Code != http.StatusUnauthorized {
				t.Fatalf("guess %d status = %d, want %d", i+1, recorder.Code, http.StatusUnauthorized)
			}
		}
		// 第 6 次失败触发锁定，本次仍返回普通失败
		if recorder := newRequest(ip, "wrong-token"); recorder.Code != http.StatusUnauthorized {
			t.Fatalf("guess 6 status = %d, want %d", recorder.Code, http.StatusUnauthorized)
		}
		// 锁定期间即使提交正确 token 也返回 429
		if recorder := newRequest(ip, "test-api-token-123"); recorder.Code != http.StatusTooManyRequests {
			t.Fatalf("locked status = %d, want %d", recorder.Code, http.StatusTooManyRequests)
		}
	})

	t.Run("lockout is per IP", func(t *testing.T) {
		attackerIP := "192.0.2.12:1234"
		defer util.AuthThrottleReset(attackerIP)
		for i := 0; i < 6; i++ {
			if recorder := newRequest(attackerIP, "wrong-token"); recorder.Code != http.StatusUnauthorized {
				t.Fatalf("guess %d status = %d, want %d", i+1, recorder.Code, http.StatusUnauthorized)
			}
		}
		// 其他 IP 不受影响，仍可用正确 token 通过
		if recorder := newRequest("192.0.2.13:1234", "test-api-token-123"); recorder.Code != http.StatusNoContent {
			t.Fatalf("other ip status = %d, want %d", recorder.Code, http.StatusNoContent)
		}
	})
}

func TestIsLocalRequest(t *testing.T) {
	tests := []struct {
		name         string
		remoteAddr   string
		forwardedFor string
		wantLocal    bool
	}{
		{name: "direct loopback", remoteAddr: "127.0.0.1:1234", wantLocal: true},
		{name: "direct remote", remoteAddr: "192.0.2.10:1234", wantLocal: false},
		{name: "direct remote with spoofed forwarding", remoteAddr: "192.0.2.10:1234", forwardedFor: "127.0.0.1", wantLocal: false},
		{name: "local proxy for local client", remoteAddr: "127.0.0.1:1234", forwardedFor: "127.0.0.1", wantLocal: true},
		{name: "local proxy for remote client", remoteAddr: "127.0.0.1:1234", forwardedFor: "192.0.2.10", wantLocal: false},
		{name: "local proxy with spoofed chain", remoteAddr: "127.0.0.1:1234", forwardedFor: "127.0.0.1, 192.0.2.10", wantLocal: false},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			engine := gin.New()
			if err := engine.SetTrustedProxies([]string{"127.0.0.1", "::1"}); err != nil {
				t.Fatal(err)
			}
			engine.RemoteIPHeaders = []string{"X-Forwarded-For"}
			engine.GET("/", func(c *gin.Context) {
				if IsLocalRequest(c) {
					c.Status(http.StatusNoContent)
					return
				}
				c.Status(http.StatusUnauthorized)
			})

			request := httptest.NewRequest(http.MethodGet, "/", nil)
			request.RemoteAddr = test.remoteAddr
			if test.forwardedFor != "" {
				request.Header.Set("X-Forwarded-For", test.forwardedFor)
			}
			recorder := httptest.NewRecorder()
			engine.ServeHTTP(recorder, request)

			wantStatus := http.StatusUnauthorized
			if test.wantLocal {
				wantStatus = http.StatusNoContent
			}
			if recorder.Code != wantStatus {
				t.Fatalf("status = %d, want %d", recorder.Code, wantStatus)
			}
		})
	}
}

// TestCheckAuthRemoteSessionOrigin 验证局域网浏览器登录后，同源 POST 请求可通过会话鉴权。
func TestCheckAuthRemoteSessionOrigin(t *testing.T) {
	originalConf := Conf
	originalWorkspaceDir := util.WorkspaceDir
	Conf = NewAppConf()
	Conf.AccessAuthCode = "test-access-auth-code"
	util.WorkspaceDir = "test-workspace"
	t.Cleanup(func() {
		Conf = originalConf
		util.WorkspaceDir = originalWorkspaceDir
	})

	engine := gin.New()
	store := cookie.NewStore([]byte("test-session-cookie-key"))
	engine.Use(ginSessions.Sessions("siyuan", store))
	engine.GET("/login", func(c *gin.Context) {
		session := util.GetSession(c)
		workspaceSession := util.GetWorkspaceSession(session)
		workspaceSession.AccessAuthCode = Conf.AccessAuthCode
		if err := session.Save(c); err != nil {
			c.Status(http.StatusInternalServerError)
			return
		}
		c.Status(http.StatusNoContent)
	})
	engine.POST("/api/notebook/lsNotebooks", CheckAuth, func(c *gin.Context) {
		c.Status(http.StatusNoContent)
	})

	loginRequest := httptest.NewRequest(http.MethodGet, "http://192.0.2.1:6806/login", nil)
	loginRequest.RemoteAddr = "192.0.2.2:1234"
	loginRecorder := httptest.NewRecorder()
	engine.ServeHTTP(loginRecorder, loginRequest)
	if loginRecorder.Code != http.StatusNoContent {
		t.Fatalf("login status = %d, want %d", loginRecorder.Code, http.StatusNoContent)
	}

	request := func(origin string) *httptest.ResponseRecorder {
		request := httptest.NewRequest(http.MethodPost, "http://192.0.2.1:6806/api/notebook/lsNotebooks", nil)
		request.RemoteAddr = "192.0.2.2:1234"
		request.Header.Set("Origin", origin)
		for _, responseCookie := range loginRecorder.Result().Cookies() {
			request.AddCookie(responseCookie)
		}
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, request)
		return recorder
	}

	if recorder := request("http://192.0.2.1:6806"); recorder.Code != http.StatusNoContent {
		t.Fatalf("same-origin status = %d, want %d, body = %s", recorder.Code, http.StatusNoContent, recorder.Body.String())
	}
	if recorder := request("https://evil.example"); recorder.Code != http.StatusUnauthorized {
		t.Fatalf("cross-origin status = %d, want %d", recorder.Code, http.StatusUnauthorized)
	}
}
