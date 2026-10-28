// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package plugin

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/dop251/goja"
	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestRPCWriteLeaseEndsAfterRuntimeStops(t *testing.T) {
	p := newRPCCancellationTestPlugin(t)
	started := make(chan struct{})
	rpcCancellationTestRun(t, p, func(rt *goja.Runtime) (any, error) {
		p.rpcMethods.Store("pending", &RpcMethod{Method: func(goja.Value, ...goja.Value) (goja.Value, error) {
			promise, _, _ := rt.NewPromise()
			close(started)
			return rt.ToValue(promise), nil
		}})
		return nil, nil
	})
	done := make(chan struct{})
	go func() { defer close(done); p.callRpcMethod(context.Background(), "pending", nil) }()
	rpcCancellationTestWait(t, started, "RPC Promise")
	p.cancel()
	rpcCancellationTestWait(t, done, "canceled RPC waiter")
	count := func() int {
		leases := 0
		p.rpcWriteLeases.Range(func(_, _ any) bool { leases++; return true })
		return leases
	}
	if count() != 1 {
		t.Fatal("plugin cancellation released the lease before the runtime stopped")
	}
	if err := p.close(); err != nil {
		t.Fatal(err)
	}
	if count() != 0 {
		t.Fatal("stopped runtime retained an unfinished RPC lease")
	}
}

func TestRPCWebSocketContractWriteAdmission(t *testing.T) {
	for _, path := range []string{"/ws/plugin/rpc?name=rpc-cancellation", "/ws/plugin/rpc/rpc-cancellation"} {
		t.Run(path, func(t *testing.T) {
			p := newRPCCancellationTestPlugin(t)
			previousConf, previousLangs, previousReadonly := model.Conf, util.Langs, util.ReadOnly
			model.Conf = model.NewAppConf()
			model.Conf.Lang = "en"
			util.Langs = map[string]map[int]string{"en": {34: "Read only"}}
			util.ReadOnly = false
			t.Cleanup(func() { model.Conf, util.Langs, util.ReadOnly = previousConf, previousLangs, previousReadonly })
			started := make(chan struct{}, 1)
			var resolve func(any) error
			rpcCancellationTestRun(t, p, func(rt *goja.Runtime) (any, error) {
				p.rpcMethods.Store("pending", &RpcMethod{Method: func(goja.Value, ...goja.Value) (goja.Value, error) {
					promise, resolvePromise, _ := rt.NewPromise()
					resolve = resolvePromise
					started <- struct{}{}
					return rt.ToValue(promise), nil
				}})
				return nil, nil
			})
			engine := gin.New()
			engine.Use(func(c *gin.Context) { c.Set(model.RoleContextKey, model.RoleAdministrator) }, model.CheckReadonly)
			engine.GET("/ws/plugin/rpc", rpcWebSocketContractTestHandler)
			engine.GET("/ws/plugin/rpc/:name", rpcWebSocketContractTestHandler)
			server := httptest.NewServer(engine)
			defer server.Close()
			conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http")+path, nil)
			if err != nil {
				t.Fatal(err)
			}
			defer conn.Close()
			// 同一连接按顺序分发消息；用第二个空闲连接验证已有连接的逐方法准入。
			deniedConn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http")+path, nil)
			if err != nil {
				t.Fatal(err)
			}
			defer deniedConn.Close()
			setReadOnly := func(value bool) {
				rpcCancellationTestRun(t, p, func(*goja.Runtime) (any, error) { util.ReadOnly = value; return nil, nil })
			}
			countLeases := func() int {
				count := 0
				p.rpcWriteLeases.Range(func(_, _ any) bool { count++; return true })
				return count
			}
			if countLeases() != 0 {
				t.Fatal("idle socket acquired an RPC write lease")
			}
			for _, notification := range []bool{false, true} {
				body := `{"jsonrpc":"2.0","method":"pending"}`
				if !notification {
					body = `{"jsonrpc":"2.0","method":"pending","id":"active"}`
				}
				if err := conn.WriteMessage(websocket.TextMessage, []byte(body)); err != nil {
					t.Fatal(err)
				}
				rpcCancellationTestWait(t, started, "active RPC")
				if countLeases() != 1 {
					t.Fatal("active RPC/notification has no write lease")
				}
				setReadOnly(true)
				if err := deniedConn.WriteMessage(websocket.TextMessage, []byte(`{"jsonrpc":"2.0","method":"pending","id":"denied"}`)); err != nil {
					t.Fatal(err)
				}
				deniedConn.SetReadDeadline(time.Now().Add(3 * time.Second))
				_, data, err := deniedConn.ReadMessage()
				var failure JsonRpcErrorResponse
				if err != nil || json.Unmarshal(data, &failure) != nil || failure.ID != "denied" || failure.Error == nil || failure.Error.Code != JsonRpcErrorCodeInternalError {
					t.Fatalf("open connection bypassed read-only admission: %s, %v", data, err)
				}
				setReadOnly(false)
				rpcCancellationTestRun(t, p, func(*goja.Runtime) (any, error) { return nil, resolve("done") })
				if countLeases() != 0 {
					t.Fatal("completed RPC retained its lease")
				}
				if !notification {
					conn.SetReadDeadline(time.Now().Add(3 * time.Second))
					_, data, err := conn.ReadMessage()
					var reply JsonRpcRequestResponse
					if err != nil || json.Unmarshal(data, &reply) != nil || reply.ID != "active" {
						t.Fatalf("RPC reply changed: %s, %v", data, err)
					}
				}
			}
			// 通知完成后下一帧仍属于后续调用，通知本身不能产生回复。
			if err := conn.WriteMessage(websocket.TextMessage, []byte(`{"jsonrpc":"2.0","method":"missing","id":"after-notification"}`)); err != nil {
				t.Fatal(err)
			}
			conn.SetReadDeadline(time.Now().Add(3 * time.Second))
			_, data, err := conn.ReadMessage()
			var barrier JsonRpcErrorResponse
			if err != nil || json.Unmarshal(data, &barrier) != nil || barrier.ID != "after-notification" {
				t.Fatalf("notification produced a reply: %s, %v", data, err)
			}
			setReadOnly(true)
			recorder := httptest.NewRecorder()
			engine.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, path, nil))
			if !strings.Contains(recorder.Body.String(), "Read only") {
				t.Fatalf("read-only handshake passed: %s", recorder.Body)
			}
		})
	}
}
