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

package server

import (
	"crypto/tls"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"testing"

	ginSessions "github.com/gin-contrib/sessions"
	"github.com/gin-contrib/sessions/cookie"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// prepareTLSEnforceTest 打开「启用 HTTPS」并标记证书可用，避免依赖真实配置文件。
func prepareTLSEnforceTest(t *testing.T, required, enforced bool) {
	t.Helper()

	previousConf := model.Conf
	previousRequired := util.TLSRequired()
	model.Conf = &model.AppConf{System: &conf.System{NetworkServe: required, NetworkServeTLS: required}}
	util.SetTLSRequired(required)
	if enforced {
		util.MarkTLSEnforced()
	}
	t.Cleanup(func() {
		model.Conf = previousConf
		util.SetTLSRequired(previousRequired)
	})
}

func newTLSEnforceTestEngine() *gin.Engine {
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	// 与 Serve 中的注册顺序一致：TLS 强制中间件在会话中间件之前
	engine.Use(tlsEnforceMiddleware())
	engine.Use(ginSessions.Sessions("siyuan", cookie.NewStore([]byte("test-cookie-key"))))
	engine.Any("/*path", func(c *gin.Context) {
		c.String(http.StatusOK, "ok")
	})
	return engine
}

func TestTLSEnforceRedirectsPlaintextFromOtherHosts(t *testing.T) {
	prepareTLSEnforceTest(t, true, true)
	engine := newTLSEnforceTestEngine()

	request := httptest.NewRequest(http.MethodPost, "/api/system/loginAuth?x=1", nil)
	request.RemoteAddr = "192.0.2.10:54321"
	request.Host = "notes.example.com:6806"
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, request)

	if location := recorder.Header().Get("Location"); location != "https://notes.example.com:6806/api/system/loginAuth?x=1" {
		t.Fatalf("Location = %q", location)
	}
	if vary := recorder.Header().Get("Vary"); vary != "Host" {
		t.Fatalf("Vary = %q, want Host", vary)
	}
	// gin 对 3xx 惰性写头，响应体中不会包含处理器写入的内容，这里以 Location 是否存在作为跳转判据
}

// TestTLSEnforcePassesThroughOverRealConnection 通过真实 HTTP 往返确认放行路径可用。
// httptest 服务监听环回地址，因此这里覆盖的是「本机明文连接不被跳转」，
// 也顺带验证 gin 对 3xx 的惰性写头不会影响放行分支。
func TestTLSEnforcePassesThroughOverRealConnection(t *testing.T) {
	prepareTLSEnforceTest(t, true, true)

	server := httptest.NewServer(newTLSEnforceTestEngine())
	defer server.Close()

	client := &http.Client{
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
	request, err := http.NewRequest(http.MethodPost, server.URL+"/api/system/loginAuth?x=1", nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Host = "notes.example.com:6806"

	response, err := client.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()

	// httptest 服务监听环回地址，本机明文请求按设计放行
	if response.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want %d", response.StatusCode, http.StatusOK)
	}
}

func TestTLSEnforceKeepsPlaintextAllowedForLocalClients(t *testing.T) {
	tests := []struct {
		name       string
		remoteAddr string
		wantStatus int
	}{
		{name: "loopback desktop client", remoteAddr: "127.0.0.1:54321", wantStatus: http.StatusOK},
		{name: "loopback ipv6 client", remoteAddr: "[::1]:54321", wantStatus: http.StatusOK},
		{name: "other host", remoteAddr: "192.0.2.10:54321", wantStatus: http.StatusTemporaryRedirect},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			prepareTLSEnforceTest(t, true, true)
			engine := newTLSEnforceTestEngine()

			request := httptest.NewRequest(http.MethodGet, "/api/system/version", nil)
			request.RemoteAddr = test.remoteAddr
			request.Host = "notes.example.com:6806"
			recorder := httptest.NewRecorder()
			engine.ServeHTTP(recorder, request)

			if status := recorder.Result().StatusCode; status != test.wantStatus {
				t.Fatalf("status = %d, want %d", status, test.wantStatus)
			}
		})
	}
}

func TestTLSEnforceKeepsCorsPreflightAvailable(t *testing.T) {
	prepareTLSEnforceTest(t, true, true)
	engine := newTLSEnforceTestEngine()

	// 预检不携带凭据，且浏览器不会跟随跳转，因此必须继续以明文应答
	request := httptest.NewRequest(http.MethodOptions, "/api/system/getConf", nil)
	request.RemoteAddr = "192.0.2.10:54321"
	request.Host = "notes.example.com:6806"
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, request)

	if status := recorder.Result().StatusCode; status != http.StatusOK {
		t.Fatalf("status = %d, want %d", status, http.StatusOK)
	}
}

func TestTLSEnforceInactiveWhenSettingDisabled(t *testing.T) {
	prepareTLSEnforceTest(t, false, true)
	engine := newTLSEnforceTestEngine()

	request := httptest.NewRequest(http.MethodGet, "/api/system/version", nil)
	request.RemoteAddr = "192.0.2.10:54321"
	request.Host = "notes.example.com:6806"
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, request)

	if status := recorder.Result().StatusCode; status != http.StatusOK {
		t.Fatalf("status = %d, want %d", status, http.StatusOK)
	}
	if location := recorder.Header().Get("Location"); "" != location {
		t.Fatalf("Location = %q, want empty", location)
	}
}

func TestTLSEnforceRejectsPlaintextWithInvalidHost(t *testing.T) {
	prepareTLSEnforceTest(t, true, true)
	engine := newTLSEnforceTestEngine()

	// 被污染的 Host 不能被用来拼跳转地址
	request := httptest.NewRequest(http.MethodGet, "/api/system/version", nil)
	request.RemoteAddr = "192.0.2.10:54321"
	request.Host = "notes.example.com/evil"
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, request)

	if status := recorder.Result().StatusCode; status != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", status, http.StatusBadRequest)
	}
}

func TestTLSEnforceAddsHSTSOnlyForTLSRequests(t *testing.T) {
	tests := []struct {
		name     string
		serveTLS bool
		wantHSTS string
	}{
		{name: "https request", serveTLS: true, wantHSTS: util.StrictTransportSecurityValue},
		{name: "plaintext loopback request", serveTLS: false, wantHSTS: ""},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			prepareTLSEnforceTest(t, true, true)
			engine := newTLSEnforceTestEngine()

			request := httptest.NewRequest(http.MethodGet, "/api/system/version", nil)
			request.RemoteAddr = "127.0.0.1:54321"
			request.Host = "127.0.0.1:6806"
			recorder := httptest.NewRecorder()
			if test.serveTLS {
				request.TLS = &tls.ConnectionState{}
			}
			engine.ServeHTTP(recorder, request)

			if hsts := recorder.Header().Get("Strict-Transport-Security"); hsts != test.wantHSTS {
				t.Fatalf("Strict-Transport-Security = %q, want %q", hsts, test.wantHSTS)
			}
		})
	}
}

// newSessionCookieSecureTestEngine 按 Serve 的顺序注册 TLS 强制中间件、会话中间件与登录路由，
// 用于验证会话 Cookie 的 Secure 属性是否跟随实际连接。
func newSessionCookieSecureTestEngine(t *testing.T) *gin.Engine {
	t.Helper()
	previousWrongAuthCount := util.WrongAuthCount
	util.WrongAuthCount = 0
	t.Cleanup(func() { util.WrongAuthCount = previousWrongAuthCount })
	model.Conf.AccessAuthCode = "test-access-code"
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	store := cookie.NewStore([]byte("test-cookie-key"))
	store.Options(ginSessions.Options{Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode})
	engine.Use(tlsEnforceMiddleware())
	engine.Use(ginSessions.Sessions("siyuan", store))
	engine.POST("/api/system/loginAuth", func(c *gin.Context) {
		result := model.LoginAuth(c, apicontract.SystemLoginAuthRequest{AuthCode: "test-access-code", RememberMe: true})
		c.JSON(http.StatusOK, result)
	})
	for _, path := range []string{"/stage/build/mobile/", "/stage/build/desktop/"} {
		engine.GET(path, model.CheckAuth, func(c *gin.Context) {
			c.Status(http.StatusNoContent)
		})
	}
	return engine
}

// TestSessionCookieSecureFollowsConnection 覆盖 GHSA-hpj5-f7cj-vvwr 中「会话 Cookie 缺少 Secure」的要点：
// 登录会话的 Secure 属性必须跟随实际连接，而不是只跟随 --ssl 命令行参数。
func TestSessionCookieSecureFollowsConnection(t *testing.T) {
	previousSSL := util.SSL
	t.Cleanup(func() { util.SSL = previousSSL })
	util.SSL = false

	tests := []struct {
		name         string
		remoteAddr   string
		serveTLS     bool
		host         string
		wantSecure   bool
		wantRedirect bool
	}{
		{name: "https connection", remoteAddr: "192.0.2.10:54321", serveTLS: true, host: "notes.example.com:6806", wantSecure: true},
		{name: "plaintext connection", remoteAddr: "192.0.2.10:54321", host: "notes.example.com:6806", wantRedirect: true},
		// 本机 HTTP 会话必须能被不接受明文 Secure Cookie 的客户端回传。
		{name: "plaintext loopback connection", remoteAddr: "127.0.0.1:54321", host: "127.0.0.1:6806", wantSecure: false},
		{name: "plaintext ipv6 loopback connection", remoteAddr: "[::1]:54321", host: "[::1]:6806", wantSecure: false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			prepareTLSEnforceTest(t, true, true)

			request := httptest.NewRequest(http.MethodPost, "/api/system/loginAuth", nil)
			request.RemoteAddr = test.remoteAddr
			request.Host = test.host
			if test.serveTLS {
				request.TLS = &tls.ConnectionState{}
			}

			recorder := httptest.NewRecorder()
			newSessionCookieSecureTestEngine(t).ServeHTTP(recorder, request)

			if test.wantRedirect {
				if location := recorder.Header().Get("Location"); "" == location {
					t.Fatal("plaintext request from another host was not redirected to HTTPS")
				}
				// gin 的会话中间件在响应写头时保存会话，因此跳转响应也可能带上会话 Cookie；
				// 这条明文连接上不能有任何可被回传的 Cookie，必须全部标记 Secure。
				for _, cookie := range recorder.Result().Cookies() {
					if !cookie.Secure {
						t.Fatalf("cookie %q over plaintext from another host is missing Secure", cookie.Name)
					}
				}
				return
			}

			cookies := recorder.Result().Cookies()
			if 1 != len(cookies) {
				t.Fatalf("Set-Cookie count = %d, want 1", len(cookies))
			}
			if cookies[0].Secure != test.wantSecure {
				t.Fatalf("cookie Secure = %v, want %v", cookies[0].Secure, test.wantSecure)
			}
			if !cookies[0].HttpOnly {
				t.Fatal("cookie HttpOnly = false, want true")
			}
		})
	}
}

// 验证客户端按 Cookie 的传输限制保存登录会话后，移动端和桌面端均可完成认证。
func TestLoopbackLoginSessionRoundTrip(t *testing.T) {
	prepareTLSEnforceTest(t, true, true)
	previousSSL := util.SSL
	util.SSL = false
	t.Cleanup(func() { util.SSL = previousSSL })
	server := httptest.NewServer(newSessionCookieSecureTestEngine(t))
	defer server.Close()
	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatal(err)
	}
	client := &http.Client{Jar: jar, CheckRedirect: func(*http.Request, []*http.Request) error {
		return http.ErrUseLastResponse
	}}
	response, err := client.Post(server.URL+"/api/system/loginAuth", "application/json", nil)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("login status = %d", response.StatusCode)
	}
	for _, path := range []string{"/stage/build/mobile/", "/stage/build/desktop/"} {
		response, err = client.Get(server.URL + path)
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		if response.StatusCode != http.StatusNoContent {
			t.Fatalf("authenticated %s status = %d, want %d", path, response.StatusCode, http.StatusNoContent)
		}
	}
}
