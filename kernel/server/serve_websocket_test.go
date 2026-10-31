// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package server

import (
	"errors"
	"net"
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
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestWebSocketDesktopSessionAuthentication(t *testing.T) {
	oldStore, oldDir, oldContainer := sessionStore, util.WorkspaceDir, util.Container
	t.Cleanup(func() { sessionStore, util.WorkspaceDir, util.Container = oldStore, oldDir, oldContainer })
	sessionStore = cookie.NewStore([]byte("desktop-websocket-session-test-key"))
	util.WorkspaceDir, util.Container = "Note1", util.ContainerStd
	srv := newWebSocketTestServer(t)
	model.Conf.CookieKey = "desktop-websocket-cookie-key"
	model.Conf.AccessAuthCode = "desktop-password"
	for _, state := range []string{"current", "remembered", "expired"} {
		t.Run(state, func(t *testing.T) {
			engine := gin.New()
			engine.Use(ginSessions.Sessions("siyuan", sessionStore))
			engine.GET("/login", func(c *gin.Context) {
				session := util.GetSession(c)
				ws := util.GetWorkspaceSession(session)
				model.SetAccessCodeSession(ws, model.Conf.AccessAuthCode)
				model.BindDesktopSession(c, ws, state == "remembered")
				if state == "expired" {
					ws.DesktopSessionID = "previous-kernel-boot"
				}
				if err := session.Save(c); err != nil {
					t.Fatal(err)
				}
			})
			r := httptest.NewRequest("GET", "http://127.0.0.1/login", nil)
			r.RemoteAddr = "127.0.0.1:1234"
			r.Header.Set("User-Agent", "SiYuan/3.8.9 https://b3log.org/siyuan Electron Chrome/140")
			w := httptest.NewRecorder()
			engine.ServeHTTP(w, r)
			cookies := w.Result().Cookies()
			if len(cookies) != 1 {
				t.Fatal("missing fixture cookie")
			}
			header := http.Header{"Cookie": []string{cookies[0].Name + "=" + cookies[0].Value}}
			connection := dialWebSocket(t, srv, state, header)
			if state != "expired" {
				waitWebSocketSession(t, connection, state)
				return
			}
			if err := connection.SetReadDeadline(time.Now().Add(5 * time.Second)); err != nil {
				t.Fatal(err)
			}
			_, _, err := connection.ReadMessage()
			var networkErr net.Error
			if err == nil || (errors.As(err, &networkErr) && networkErr.Timeout()) {
				t.Fatalf("expired session was not closed by authentication: %v", err)
			}
		})
	}
}

func TestWebSocketRejectsMalformedMessages(t *testing.T) {
	server := melody.New()
	defer server.Close()
	server.HandleConnect(func(s *melody.Session) {
		s.Set("app", "test")
		s.Set("id", "test")
	})
	server.HandleMessage(handleWebSocketMessage)
	httpServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := server.HandleRequest(w, r); err != nil {
			t.Error(err)
		}
	}))
	defer httpServer.Close()
	connection, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(httpServer.URL, "http"), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Close()
	for _, message := range []string{
		`{`, `{}`, `null`, `[]`,
		`{"reqId":1,"param":{}}`, `{"cmd":"ping","param":{}}`, `{"cmd":"ping","reqId":1}`,
		`{"cmd":1,"reqId":1,"param":{}}`, `{"cmd":"ping","reqId":"1","param":{}}`,
		`{"cmd":"ping","reqId":1,"param":null}`, `{"cmd":"ping","reqId":1,"param":[]}`,
		`{"cmd":"ping","reqId":1,"param":{"pushMode":"invalid"}}`,
	} {
		if err = connection.WriteMessage(websocket.TextMessage, []byte(message)); err != nil {
			t.Fatal(err)
		}
		connection.SetReadDeadline(time.Now().Add(5 * time.Second))
		var result util.Result
		if err = connection.ReadJSON(&result); err != nil {
			t.Fatalf("read response to %s: %v", message, err)
		}
		if result.Code != -1 || result.Msg != "Bad Request" {
			t.Fatalf("unexpected response to %s: %#v", message, result)
		}
	}
	if err = connection.WriteMessage(websocket.TextMessage, []byte(`{"cmd":"unknown","reqId":1,"param":{}}`)); err != nil {
		t.Fatal(err)
	}
	var result util.Result
	if err = connection.ReadJSON(&result); err != nil {
		t.Fatal(err)
	}
	if result.Msg != "can not find command [unknown]" {
		t.Fatalf("valid message handling changed: %#v", result)
	}
}

// newWebSocketTestServer 启动真实的 /ws 接入处理器，用于认证与来源放行策略测试。
func newWebSocketTestServer(t *testing.T) *httptest.Server {
	t.Helper()

	originalConf := model.Conf
	t.Cleanup(func() {
		model.Conf = originalConf
	})
	model.Conf = model.NewAppConf()
	model.InitJwtKey()

	gin.SetMode(gin.ReleaseMode)
	engine := gin.New()
	serveWebSocket(engine)
	srv := httptest.NewServer(engine)
	t.Cleanup(srv.Close)
	return srv
}

func dialWebSocket(t *testing.T, srv *httptest.Server, name string, header http.Header) *websocket.Conn {
	t.Helper()

	url := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws?app=" + name + "&id=" + name + "&type=main"
	conn, resp, err := websocket.DefaultDialer.Dial(url, header)
	if err != nil {
		status := 0
		if nil != resp {
			status = resp.StatusCode
		}
		t.Fatalf("dial %s: %v (status=%d)", name, err, status)
	}
	t.Cleanup(func() { conn.Close() })
	return conn
}

func waitWebSocketSession(t *testing.T, connection *websocket.Conn, id string) {
	t.Helper()

	// 消息处理在连接回调返回后启动，往返响应保证认证及推送通道注册均已完成。
	if err := connection.SetReadDeadline(time.Now().Add(5 * time.Second)); err != nil {
		t.Fatal(err)
	}
	if err := connection.WriteMessage(websocket.TextMessage, []byte(`{"cmd":"unknown","reqId":1,"param":{}}`)); err != nil {
		t.Fatal(err)
	}
	var result util.Result
	if err := connection.ReadJSON(&result); err != nil {
		t.Fatalf("wait for websocket session %q: %v", id, err)
	}
	if result.Code != -1 || result.Msg != "can not find command [unknown]" {
		t.Fatalf("unexpected registration response: %#v", result)
	}
	sessions, _ := util.WebSocketServer.Sessions()
	for _, session := range sessions {
		if value, _ := session.Get("id"); value == id {
			return
		}
	}
	t.Fatalf("websocket session %q is not registered", id)
}

// TestIsLocalWebSocketRequest 覆盖未设置锁屏密码时的来源判定矩阵。
func TestIsLocalWebSocketRequest(t *testing.T) {
	newRequest := func(remoteAddr, host string, header map[string]string) *http.Request {
		request := httptest.NewRequest(http.MethodGet, "http://"+host+"/ws", nil)
		request.RemoteAddr = remoteAddr
		for key, value := range header {
			request.Header.Set(key, value)
		}
		return request
	}

	tests := []struct {
		name     string
		request  *http.Request
		expected bool
	}{
		{"loopback", newRequest("127.0.0.1:5000", "127.0.0.1:6806", nil), true},
		{"ipv6 loopback", newRequest("[::1]:5000", "[::1]:6806", nil), true},
		{"localhost without port", newRequest("127.0.0.1:5000", "localhost", nil), true},
		{"remote peer", newRequest("192.168.1.9:5000", "192.168.1.9:6806", nil), false},
		{"forwarded remote client", newRequest("127.0.0.1:5000", "127.0.0.1:6806", map[string]string{"X-Forwarded-For": "203.0.113.9"}), false},
		{"lan host header", newRequest("127.0.0.1:5000", "192.168.1.9:6806", nil), false},
		{"remote forwarded host", newRequest("127.0.0.1:5000", "127.0.0.1:6806", map[string]string{"X-Forwarded-Host": "evil.example"}), false},
		{"remote origin", newRequest("127.0.0.1:5000", "127.0.0.1:6806", map[string]string{"Origin": "https://evil.example"}), false},
		{"local origin", newRequest("127.0.0.1:5000", "127.0.0.1:6806", map[string]string{"Origin": "http://127.0.0.1:6806"}), true},
	}
	for _, test := range tests {
		if actual := isLocalWebSocketRequest(test.request); actual != test.expected {
			t.Errorf("%s: isLocalWebSocketRequest() = %v, want %v", test.name, actual, test.expected)
		}
	}
}

// TestWebSocketAdmitsOnlyLocalClientWithoutAccessAuth 校验未设置锁屏密码时远程连接无法接入推送通道。
func TestWebSocketAdmitsOnlyLocalClientWithoutAccessAuth(t *testing.T) {
	srv := newWebSocketTestServer(t)

	local := dialWebSocket(t, srv, "local", nil)
	waitWebSocketSession(t, local, "local")
	util.BroadcastByType("main", "admission", 0, "", nil)
	if err := local.SetReadDeadline(time.Now().Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	var result util.Result
	if err := local.ReadJSON(&result); err != nil {
		t.Fatalf("local session received no broadcast: %v", err)
	}
	if "admission" != result.Cmd {
		t.Fatalf("unexpected broadcast cmd [%s]", result.Cmd)
	}

	remote := dialWebSocket(t, srv, "forwarded", http.Header{"X-Forwarded-For": []string{"203.0.113.9"}})
	if err := remote.SetReadDeadline(time.Now().Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	if _, msg, err := remote.ReadMessage(); err == nil {
		t.Fatalf("forwarded session was admitted and received [%s]", msg)
	}
}

// TestWebSocketAdmitsPublishReaderWithForwardedAddress 确保发布服务反代注入的读者会话不受本机限制影响。
func TestWebSocketAdmitsPublishReaderWithForwardedAddress(t *testing.T) {
	srv := newWebSocketTestServer(t)

	model.InitPublishAccounts()
	model.Conf.Publish.Load().Auth.Accounts = []*conf.BasicAuthAccount{{Username: "reader", Password: "reader-pass"}}
	model.InitPublishAccounts()
	token := model.GetBasicAuthAccount("reader").Token
	if "" == token {
		t.Fatal("reader token is not issued")
	}

	reader := dialWebSocket(t, srv, "reader", http.Header{
		model.XAuthTokenKey: []string{token},
		"X-Forwarded-For":   []string{"203.0.113.9"},
	})
	waitWebSocketSession(t, reader, "reader")

	sessions, _ := util.WebSocketServer.Sessions()
	for _, session := range sessions {
		if value, _ := session.Get("id"); value != "reader" {
			continue
		}
		if isPublish, _ := session.Get("isPublish"); true != isPublish {
			t.Fatal("publish reader session is not quarantined")
		}
	}
	util.BroadcastByType("main", "admission", 0, "", nil)
	if err := reader.SetReadDeadline(time.Now().Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	if _, msg, err := reader.ReadMessage(); err == nil {
		t.Fatalf("publish reader received [%s]", msg)
	}
}
