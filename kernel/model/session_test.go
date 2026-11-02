// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"

	ginSessions "github.com/gin-contrib/sessions"
	"github.com/gin-contrib/sessions/cookie"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// TestAuthByAPITokenThrottle 验证 API token 认证路径的限流与授权行为。
func TestAuthByAPITokenThrottle(t *testing.T) {
	originalConf := Conf
	Conf = NewAppConf()
	Conf.Api.Store(conf.NewAPI())
	t.Cleanup(func() { Conf = originalConf })
	Conf.Api.Load().Token = "test-api-token-123"

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
		for i := range 5 {
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
		for i := range 6 {
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

// TestCheckAuthCrossSiteFetchSite 验证未设置锁屏密码时拒绝浏览器标记的跨站请求，
// 防止跨站 GET 导航不带 Origin 绕过校验
// https://github.com/siyuan-note/siyuan/security/advisories/GHSA-2w6q-wgc8-q743
func TestCheckAuthCrossSiteFetchSite(t *testing.T) {
	originalConf := Conf
	Conf = NewAppConf()
	t.Cleanup(func() { Conf = originalConf })

	engine := gin.New()
	engine.GET("/api/test", CheckAuth, func(c *gin.Context) {
		c.Status(http.StatusNoContent)
	})

	newRequest := func(site string) *httptest.ResponseRecorder {
		request := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:6806/api/test", nil)
		request.RemoteAddr = "127.0.0.1:1234"
		if "" != site {
			request.Header.Set("Sec-Fetch-Site", site)
		}
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, request)
		return recorder
	}

	if recorder := newRequest("cross-site"); recorder.Code != http.StatusUnauthorized {
		t.Fatalf("cross-site status = %d, want %d", recorder.Code, http.StatusUnauthorized)
	}
	if recorder := newRequest("same-site"); recorder.Code != http.StatusUnauthorized {
		t.Fatalf("same-site status = %d, want %d", recorder.Code, http.StatusUnauthorized)
	}
	if recorder := newRequest("same-origin"); recorder.Code != http.StatusNoContent {
		t.Fatalf("same-origin status = %d, want %d", recorder.Code, http.StatusNoContent)
	}
	if recorder := newRequest("none"); recorder.Code != http.StatusNoContent {
		t.Fatalf("none status = %d, want %d", recorder.Code, http.StatusNoContent)
	}
	if recorder := newRequest(""); recorder.Code != http.StatusNoContent {
		t.Fatalf("absent header status = %d, want %d", recorder.Code, http.StatusNoContent)
	}
}

// TestCheckAuthSessionCrossSiteFetchSite 验证会话认证下拒绝浏览器标记的跨站 GET 导航请求
// https://github.com/siyuan-note/siyuan/security/advisories/GHSA-2w6q-wgc8-q743
func TestCheckAuthSessionCrossSiteFetchSite(t *testing.T) {
	originalConf := Conf
	originalWorkspaceDir := util.WorkspaceDir
	Conf = NewAppConf()
	Conf.CookieKey = "test-cookie-key"
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
		SetAccessCodeSession(workspaceSession, Conf.AccessAuthCode)
		if err := session.Save(c); err != nil {
			c.Status(http.StatusInternalServerError)
			return
		}
		c.Status(http.StatusNoContent)
	})
	engine.GET("/api/test", CheckAuth, func(c *gin.Context) {
		c.Status(http.StatusNoContent)
	})

	loginRequest := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:6806/login", nil)
	loginRequest.RemoteAddr = "127.0.0.1:1234"
	loginRecorder := httptest.NewRecorder()
	engine.ServeHTTP(loginRecorder, loginRequest)
	if loginRecorder.Code != http.StatusNoContent {
		t.Fatalf("login status = %d, want %d", loginRecorder.Code, http.StatusNoContent)
	}

	request := func(site string) *httptest.ResponseRecorder {
		request := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:6806/api/test", nil)
		request.RemoteAddr = "127.0.0.1:1234"
		if "" != site {
			request.Header.Set("Sec-Fetch-Site", site)
		}
		for _, responseCookie := range loginRecorder.Result().Cookies() {
			request.AddCookie(responseCookie)
		}
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, request)
		return recorder
	}

	if recorder := request("cross-site"); recorder.Code != http.StatusUnauthorized {
		t.Fatalf("cross-site status = %d, want %d", recorder.Code, http.StatusUnauthorized)
	}
	if recorder := request("same-origin"); recorder.Code != http.StatusNoContent {
		t.Fatalf("same-origin status = %d, want %d", recorder.Code, http.StatusNoContent)
	}
	if recorder := request(""); recorder.Code != http.StatusNoContent {
		t.Fatalf("absent header status = %d, want %d", recorder.Code, http.StatusNoContent)
	}
}

// TestCheckAuthRemoteSessionOrigin 验证局域网浏览器登录后，同源 POST 请求可通过会话鉴权。
func TestCheckAuthRemoteSessionOrigin(t *testing.T) {
	originalConf := Conf
	originalWorkspaceDir := util.WorkspaceDir
	Conf = NewAppConf()
	Conf.CookieKey = "test-cookie-key"
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
		SetAccessCodeSession(workspaceSession, Conf.AccessAuthCode)
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

// TestCheckAuthLockScreenLocalHostPassThrough 验证设置锁屏密码时跨站请求及无凭据的非本机来源无法访问，
// 无浏览器头的本机客户端及同源请求可通过本机免认证放行。
// https://github.com/siyuan-note/siyuan/security/advisories/GHSA-9gpj-3rm3-x42m
func TestCheckAuthLockScreenLocalHostPassThrough(t *testing.T) {
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
	engine.Use(ginSessions.Sessions("siyuan", cookie.NewStore([]byte("test-session-cookie-key"))))
	engine.GET("/assets/icon.png", CheckAuth, func(c *gin.Context) {
		c.Status(http.StatusNoContent)
	})
	engine.POST("/api/system/exit", CheckAuth, func(c *gin.Context) {
		c.Status(http.StatusNoContent)
	})

	newRequest := func(method, target, host string, headers map[string]string) *httptest.ResponseRecorder {
		request := httptest.NewRequest(method, target, nil)
		request.RemoteAddr = "127.0.0.1:1234"
		request.Host = "127.0.0.1:6806"
		if "" != host {
			request.Host = host
		}
		for key, value := range headers {
			request.Header.Set(key, value)
		}
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, request)
		return recorder
	}

	t.Run("headless local client allowed", func(t *testing.T) {
		if recorder := newRequest(http.MethodGet, "/assets/icon.png", "", nil); recorder.Code != http.StatusNoContent {
			t.Fatalf("assets status = %d, want %d", recorder.Code, http.StatusNoContent)
		}
		if recorder := newRequest(http.MethodPost, "/api/system/exit", "", nil); recorder.Code != http.StatusNoContent {
			t.Fatalf("exit status = %d, want %d", recorder.Code, http.StatusNoContent)
		}
	})

	t.Run("same-origin browser request allowed", func(t *testing.T) {
		headers := map[string]string{
			"Sec-Fetch-Site": "same-origin",
			"Origin":         "http://127.0.0.1:6806",
		}
		if recorder := newRequest(http.MethodPost, "/api/system/exit", "", headers); recorder.Code != http.StatusNoContent {
			t.Fatalf("exit status = %d, want %d", recorder.Code, http.StatusNoContent)
		}
	})

	t.Run("cross-site browser request denied", func(t *testing.T) {
		headers := map[string]string{
			"Sec-Fetch-Site": "cross-site",
		}
		if recorder := newRequest(http.MethodGet, "/assets/icon.png", "", headers); recorder.Code != http.StatusUnauthorized {
			t.Fatalf("assets status = %d, want %d", recorder.Code, http.StatusUnauthorized)
		}
		if recorder := newRequest(http.MethodPost, "/api/system/exit", "", headers); recorder.Code != http.StatusUnauthorized {
			t.Fatalf("exit status = %d, want %d", recorder.Code, http.StatusUnauthorized)
		}
	})

	t.Run("non-local origin denied", func(t *testing.T) {
		headers := map[string]string{
			"Origin": "https://evil.example",
		}
		if recorder := newRequest(http.MethodPost, "/api/system/exit", "", headers); recorder.Code != http.StatusUnauthorized {
			t.Fatalf("exit status = %d, want %d", recorder.Code, http.StatusUnauthorized)
		}
	})

	t.Run("non-local host denied", func(t *testing.T) {
		if recorder := newRequest(http.MethodGet, "/assets/icon.png", "evil.example", nil); recorder.Code != http.StatusUnauthorized {
			t.Fatalf("assets status = %d, want %d", recorder.Code, http.StatusUnauthorized)
		}
	})
}

// TestCheckAuthLoopbackProxy 验证经环回地址转发的远程访问使用正常认证，且不能借此获取本机免认证权限。
func TestCheckAuthLoopbackProxy(t *testing.T) {
	originalConf := Conf
	originalWorkspaceDir := util.WorkspaceDir
	Conf = NewAppConf()
	Conf.CookieKey = "test-cookie-key"
	Conf.AccessAuthCode = "test-access-auth-code"
	util.WorkspaceDir = "test-workspace"
	t.Cleanup(func() {
		Conf = originalConf
		util.WorkspaceDir = originalWorkspaceDir
	})

	engine := gin.New()
	engine.Use(ginSessions.Sessions("siyuan", cookie.NewStore([]byte("test-session-cookie-key"))))
	engine.GET("/login", func(c *gin.Context) {
		session := util.GetSession(c)
		SetAccessCodeSession(util.GetWorkspaceSession(session), Conf.AccessAuthCode)
		if err := session.Save(c); err != nil {
			t.Fatal(err)
		}
		c.Status(http.StatusNoContent)
	})
	for _, path := range []string{"/", "/stage/build/mobile/", "/stage/build/desktop/", "/check-auth", "/assets/icon.png", "/api/system/exit", "/api/test"} {
		engine.Any(path, CheckAuth, func(c *gin.Context) {
			if c.Request.URL.Path != "/check-auth" && !IsAdminRoleContext(c) {
				t.Error("authenticated request has no administrator role")
			}
			c.Status(http.StatusNoContent)
		})
	}
	loginRecorder := httptest.NewRecorder()
	engine.ServeHTTP(loginRecorder, httptest.NewRequest(http.MethodGet, "/login", nil))
	if loginRecorder.Code != http.StatusNoContent {
		t.Fatalf("login status = %d", loginRecorder.Code)
	}

	for _, test := range []struct {
		name, method, path, origin, site, mode, dest string
		authenticated                                bool
		want                                         int
	}{
		{name: "page redirects to login", method: http.MethodGet, path: "/stage/build/desktop/", site: "none", want: http.StatusFound},
		{name: "same-site app navigation still requires login", method: http.MethodGet, path: "/stage/build/desktop/", site: "same-site", mode: "navigate", dest: "document", want: http.StatusFound},
		{name: "login page accessible", method: http.MethodGet, path: "/check-auth", site: "same-origin", want: http.StatusNoContent},
		{name: "assets require login", method: http.MethodGet, path: "/assets/icon.png", want: http.StatusFound},
		{name: "local API requires credentials", method: http.MethodPost, path: "/api/system/exit", want: http.StatusUnauthorized},
		{name: "DNS rebinding cannot bypass authentication", method: http.MethodPost, path: "/api/system/exit", origin: "http://evil.example:6806", site: "same-origin", want: http.StatusUnauthorized},
		{name: "authenticated page", method: http.MethodGet, path: "/stage/build/desktop/", authenticated: true, want: http.StatusNoContent},
		{name: "authenticated assets", method: http.MethodGet, path: "/assets/icon.png", authenticated: true, want: http.StatusNoContent},
		{name: "authenticated same-origin API", method: http.MethodPost, path: "/api/test", origin: "http://192.0.2.1:6806", site: "same-origin", authenticated: true, want: http.StatusNoContent},
		{name: "authenticated cross-origin API denied", method: http.MethodPost, path: "/api/test", origin: "https://evil.example", authenticated: true, want: http.StatusUnauthorized},
		{name: "authenticated cross-site navigation denied", method: http.MethodGet, path: "/assets/icon.png", site: "cross-site", authenticated: true, want: http.StatusUnauthorized},
		{name: "authenticated same-site request denied", method: http.MethodPost, path: "/api/system/exit", site: "same-site", authenticated: true, want: http.StatusUnauthorized},
		{name: "authenticated same-site app navigation", method: http.MethodGet, path: "/stage/build/desktop/", site: "same-site", mode: "navigate", dest: "document", authenticated: true, want: http.StatusNoContent},
		{name: "authenticated same-site API navigation denied", method: http.MethodGet, path: "/api/test", site: "same-site", mode: "navigate", dest: "document", authenticated: true, want: http.StatusUnauthorized},
		{name: "PWA navigation still requires login", method: http.MethodGet, path: "/", site: "cross-site", mode: "navigate", dest: "document", want: http.StatusFound},
		{name: "authenticated PWA root navigation", method: http.MethodGet, path: "/", site: "cross-site", mode: "navigate", dest: "document", authenticated: true, want: http.StatusNoContent},
		{name: "authenticated PWA mobile navigation", method: http.MethodGet, path: "/stage/build/mobile/", site: "cross-site", mode: "navigate", dest: "document", authenticated: true, want: http.StatusNoContent},
		{name: "authenticated cross-site app navigation", method: http.MethodGet, path: "/stage/build/desktop/", site: "cross-site", mode: "navigate", dest: "document", authenticated: true, want: http.StatusNoContent},
		{name: "authenticated cross-site API navigation denied", method: http.MethodGet, path: "/api/test", site: "cross-site", mode: "navigate", dest: "document", authenticated: true, want: http.StatusUnauthorized},
	} {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(test.method, test.path, nil)
			request.Host = "192.0.2.1:6806"
			request.RemoteAddr = "127.0.0.1:1234"
			request.Header.Set("User-Agent", "Mozilla/5.0")
			request.Header.Set("X-Forwarded-Host", request.Host)
			request.Header.Set("Origin", test.origin)
			request.Header.Set("Sec-Fetch-Site", test.site)
			request.Header.Set("Sec-Fetch-Mode", test.mode)
			request.Header.Set("Sec-Fetch-Dest", test.dest)
			if test.authenticated {
				for _, responseCookie := range loginRecorder.Result().Cookies() {
					request.AddCookie(responseCookie)
				}
			}
			recorder := httptest.NewRecorder()
			engine.ServeHTTP(recorder, request)
			if recorder.Code != test.want {
				t.Fatalf("status = %d, want %d, body = %s", recorder.Code, test.want, recorder.Body.String())
			}
			if test.want == http.StatusFound && recorder.Header().Get("Location") != "/check-auth?to="+url.QueryEscape(test.path) {
				t.Fatalf("unexpected login redirect: %s", recorder.Header().Get("Location"))
			}
		})
	}
}

const loginAuthTestAccessCode = "test-access-auth-code"

// newLoginAuthTestEngine 初始化登录接口测试环境，返回带会话中间件的引擎和来源 IP。
func newLoginAuthTestEngine(t *testing.T) (engine *gin.Engine, store ginSessions.Store, clientIP string) {
	t.Helper()

	originalConf, originalWorkspaceDir, originalWrongAuthCount, originalLangs := Conf, util.WorkspaceDir, util.WrongAuthCount, util.Langs
	Conf = NewAppConf()
	Conf.CookieKey = "test-cookie-key"
	Conf.AccessAuthCode = loginAuthTestAccessCode
	Conf.Lang = "en"
	util.WorkspaceDir = "test-login-auth-workspace"
	util.WrongAuthCount = 0
	util.Langs = map[string]map[int]string{"en": {
		21:  "captcha required",
		22:  "invalid captcha",
		83:  "invalid auth code",
		156: "unauthorized",
		258: "save failed",
		354: "too many attempts",
	}}
	clientIP = "192.0.2.70"
	t.Cleanup(func() {
		Conf, util.WorkspaceDir, util.WrongAuthCount, util.Langs = originalConf, originalWorkspaceDir, originalWrongAuthCount, originalLangs
	})

	gin.SetMode(gin.TestMode)
	engine = gin.New()
	store = cookie.NewStore([]byte("test-session-cookie-key"))
	engine.Use(ginSessions.Sessions("siyuan", store))
	engine.POST("/api/system/loginAuth", func(c *gin.Context) {
		body := struct {
			AuthCode string `json:"authCode"`
			Captcha  string `json:"captcha"`
		}{}
		if err := json.NewDecoder(c.Request.Body).Decode(&body); err != nil {
			c.Status(http.StatusBadRequest)
			return
		}
		c.JSON(http.StatusOK, LoginAuth(c, apicontract.SystemLoginAuthRequest{AuthCode: body.AuthCode, Captcha: body.Captcha}))
	})
	engine.POST("/api/system/probeAdmin", CheckAuth, func(c *gin.Context) {
		c.Status(http.StatusNoContent)
	})
	return
}

// loginTestRequest 发送一次带会话 Cookie 的请求，返回响应和响应中签发的会话 Cookie。
func loginTestRequest(t *testing.T, engine *gin.Engine, clientIP, method, path string, body any, sessionCookie *http.Cookie) (*httptest.ResponseRecorder, *http.Cookie) {
	t.Helper()

	var reader io.Reader
	if nil != body {
		data, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		reader = bytes.NewReader(data)
	}
	request := httptest.NewRequest(method, "http://127.0.0.1:6806"+path, reader)
	request.RemoteAddr = clientIP + ":1234"
	if nil != body {
		request.Header.Set("Content-Type", "application/json")
	}
	if nil != sessionCookie {
		request.AddCookie(sessionCookie)
	}
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, request)

	var next *http.Cookie
	for _, responseCookie := range recorder.Result().Cookies() {
		if "siyuan" == responseCookie.Name {
			next = responseCookie
		}
	}
	return recorder, next
}

// loginTestLogin 提交一次登录请求。
func loginTestLogin(t *testing.T, engine *gin.Engine, clientIP, authCode, captcha string, sessionCookie *http.Cookie) (int, string, *http.Cookie) {
	t.Helper()

	recorder, next := loginTestRequest(t, engine, clientIP, http.MethodPost, "/api/system/loginAuth", map[string]string{
		"authCode": authCode,
		"captcha":  captcha,
	}, sessionCookie)
	result := struct {
		Code int    `json:"code"`
		Msg  string `json:"msg"`
	}{}
	if err := json.Unmarshal(recorder.Body.Bytes(), &result); err != nil {
		t.Fatalf("decode login response %q: %v", recorder.Body.String(), err)
	}
	return result.Code, result.Msg, next
}

// TestLoginAuthCaptchaChallengeSingleUse 验证验证码挑战在服务端一次性消费，旧签名 Cookie 重放不能再次通过验证码校验。
// https://github.com/siyuan-note/siyuan/security/advisories/GHSA-23g4-vqq8-5764
func TestLoginAuthCaptchaChallengeSingleUse(t *testing.T) {
	engine, _, clientIP := newLoginAuthTestEngine(t)
	engine.GET("/test/challenge", func(c *gin.Context) {
		session := util.GetSession(c)
		util.GetWorkspaceSession(session).CaptchaID = util.NewCaptchaChallenge("ABCD")
		if err := session.Save(c); err != nil {
			c.Status(http.StatusInternalServerError)
			return
		}
		c.Status(http.StatusNoContent)
	})

	var sessionCookie *http.Cookie
	for i := 1; i <= 4; i++ {
		if _, _, sessionCookie = loginTestLogin(t, engine, clientIP, "wrong-"+strconv.Itoa(i), "", sessionCookie); nil == sessionCookie {
			t.Fatal("login did not issue the session cookie")
		}
	}
	if util.WrongAuthCount <= 3 {
		t.Fatalf("captcha threshold not reached: %d", util.WrongAuthCount)
	}

	_, challengeCookie := loginTestRequest(t, engine, clientIP, http.MethodGet, "/test/challenge", nil, sessionCookie)
	if nil == challengeCookie {
		t.Fatal("challenge request did not issue the session cookie")
	}

	if code, msg, _ := loginTestLogin(t, engine, clientIP, "wrong-5", "ABCD", challengeCookie); 1 != code || "invalid auth code" != msg {
		t.Fatalf("first captcha use = %d %q, want code 1 and invalid auth code", code, msg)
	}
	if code, msg, _ := loginTestLogin(t, engine, clientIP, "wrong-6", "ABCD", challengeCookie); 1 != code || "invalid captcha" != msg {
		t.Fatalf("replayed captcha = %d %q, want code 1 and invalid captcha", code, msg)
	}

	_, challengeCookie = loginTestRequest(t, engine, clientIP, http.MethodGet, "/test/challenge", nil, sessionCookie)
	code, msg, authCookie := loginTestLogin(t, engine, clientIP, loginAuthTestAccessCode, "abcd", challengeCookie)
	if 0 != code {
		t.Fatalf("login with a new challenge = %d %q", code, msg)
	}
	if nil == authCookie {
		t.Fatal("login did not issue the authenticated cookie")
	}
	if recorder, _ := loginTestRequest(t, engine, clientIP, http.MethodPost, "/api/system/probeAdmin", nil, authCookie); http.StatusNoContent != recorder.Code {
		t.Fatalf("authenticated request = %d, want %d", recorder.Code, http.StatusNoContent)
	}
	if recorder, _ := loginTestRequest(t, engine, clientIP, http.MethodPost, "/api/system/probeAdmin", nil, challengeCookie); http.StatusUnauthorized != recorder.Code {
		t.Fatalf("request with the stale cookie = %d, want %d", recorder.Code, http.StatusUnauthorized)
	}
}

// TestGetCaptchaStoresChallengeID 验证验证码答案只保存在服务端，会话中仅保存挑战 ID。
// https://github.com/siyuan-note/siyuan/security/advisories/GHSA-23g4-vqq8-5764
func TestGetCaptchaStoresChallengeID(t *testing.T) {
	engine, store, clientIP := newLoginAuthTestEngine(t)
	engine.GET("/api/system/getCaptcha", func(c *gin.Context) {
		if content := GetCaptcha(c, apicontract.EmptyRequest{}).Binary(); nil != content {
			c.Data(content.Status, content.ContentType, content.Bytes)
			return
		}
		c.Status(http.StatusInternalServerError)
	})

	recorder, sessionCookie := loginTestRequest(t, engine, clientIP, http.MethodGet, "/api/system/getCaptcha", nil, nil)
	if http.StatusOK != recorder.Code {
		t.Fatalf("getCaptcha = %d, want %d", recorder.Code, http.StatusOK)
	}
	if nil == sessionCookie {
		t.Fatal("getCaptcha did not issue the session cookie")
	}

	request := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:6806/", nil)
	request.AddCookie(sessionCookie)
	session, err := store.Get(request, "siyuan")
	if err != nil {
		t.Fatal(err)
	}
	raw, ok := session.Values["data"].(string)
	if !ok {
		t.Fatal("session data is missing from the cookie")
	}
	data := &util.SessionData{}
	if err = json.Unmarshal([]byte(raw), data); err != nil {
		t.Fatal(err)
	}
	workspaceSession := data.Workspaces[util.WorkspaceDir]
	if nil == workspaceSession || "" == workspaceSession.CaptchaID {
		t.Fatal("captcha challenge ID is missing from the session")
	}
	if strings.Contains(raw, `"Captcha":`) {
		t.Fatalf("captcha answer is still stored in the session: %s", raw)
	}
}
