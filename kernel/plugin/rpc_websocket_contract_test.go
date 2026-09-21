package plugin

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/lxzan/gws"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestRPCWebSocketContractMessages(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	p := &KernelPlugin{Petal: &model.Petal{Name: "contract-rpc-ws"}, context: ctx, sockets: map[*gws.Conn]bool{}}
	p.state.Store(int64(PluginStateRunning))
	manager := GetManager()
	manager.plugins.Store(p.Name, p)
	engine := gin.New()
	engine.GET("/ws/plugin/rpc/:name", rpcWebSocketContractTestHandler)
	server := httptest.NewServer(engine)
	t.Cleanup(func() { cancel(); server.Close(); manager.plugins.Delete(p.Name) })
	url := "ws" + strings.TrimPrefix(server.URL, "http") + "/ws/plugin/rpc/" + p.Name
	conn, response, err := websocket.DefaultDialer.Dial(url, nil)
	if err != nil {
		t.Fatalf("WebSocket upgrade failed: %v, %+v", err, response)
	}
	defer conn.Close()
	bundle, err := apicontract.BuildBundle()
	if err != nil {
		t.Fatal(err)
	}
	read := func() []byte {
		t.Helper()
		if err := conn.SetReadDeadline(time.Now().Add(3 * time.Second)); err != nil {
			t.Fatal(err)
		}
		opcode, payload, err := conn.ReadMessage()
		if err != nil || opcode != websocket.TextMessage {
			t.Fatalf("RPC frame read failed: %d, %s, %v", opcode, payload, err)
		}
		return payload
	}
	for _, body := range []string{`invalid`, `{}`, `{"jsonrpc":"2.0","method":"missing","id":1}`, `[false,{"jsonrpc":"2.0","method":"missing","id":"batch"}]`} {
		if err := conn.WriteMessage(websocket.TextMessage, []byte(body)); err != nil {
			t.Fatal(err)
		}
		payload := read()
		if err := bundle.ValidateWebSocketMessage("GET", "/ws/plugin/rpc/:name", false, payload); err != nil {
			t.Fatalf("RPC frame violates reply schema: %s, %v", payload, err)
		}
		request, err := apicontract.DecodePluginRPC(strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		expected, err := p.dispatchRPCContract(ctx, request)
		if err != nil {
			t.Fatal(err)
		}
		compareRPCJSON(t, body, expected, json.RawMessage(payload))
	}
	// 通知后发送普通调用，收到的下一帧必须属于普通调用。
	if err := conn.WriteMessage(websocket.TextMessage, []byte(`{"jsonrpc":"2.0","method":"missing","params":null}`)); err != nil {
		t.Fatal(err)
	}
	if err := conn.WriteMessage(websocket.TextMessage, []byte(`{"jsonrpc":"2.0","method":"missing","id":"after-notification"}`)); err != nil {
		t.Fatal(err)
	}
	var reply struct {
		ID string `json:"id"`
	}
	if payload := read(); json.Unmarshal(payload, &reply) != nil || reply.ID != "after-notification" {
		t.Fatalf("notification unexpectedly produced a reply: %s", payload)
	}
	p.BroadcastNotification("event", util.Optional[any]{Exists: true, Value: []string{"value"}})
	if payload := read(); string(payload) != `{"jsonrpc":"2.0","method":"event","params":["value"]}` {
		t.Fatalf("server notification changed: %s", payload)
	}
	cancel()
	if err := conn.SetReadDeadline(time.Now().Add(3 * time.Second)); err != nil {
		t.Fatal(err)
	}
	if _, _, err := conn.ReadMessage(); err == nil {
		t.Fatal("plugin cancellation did not close the connection")
	}
}

func TestRPCWebSocketOriginCheck(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	p := &KernelPlugin{Petal: &model.Petal{Name: "contract-rpc-origin"}, context: ctx, sockets: map[*gws.Conn]bool{}}
	p.state.Store(int64(PluginStateRunning))
	manager := GetManager()
	manager.plugins.Store(p.Name, p)
	engine := gin.New()
	engine.GET("/ws/plugin/rpc/:name", rpcWebSocketContractTestHandler)
	server := httptest.NewServer(engine)
	t.Cleanup(func() { cancel(); server.Close(); manager.plugins.Delete(p.Name) })
	url := "ws" + strings.TrimPrefix(server.URL, "http") + "/ws/plugin/rpc/" + p.Name
	conn, response, err := websocket.DefaultDialer.Dial(url, http.Header{"Origin": []string{"https://untrusted.invalid"}, "Sec-Fetch-Site": []string{"cross-site"}})
	if conn != nil {
		conn.Close()
	}
	if response != nil {
		defer response.Body.Close()
	}
	if err == nil || response == nil || response.StatusCode != http.StatusBadRequest {
		t.Fatalf("cross-site RPC WebSocket was not rejected: %+v, %v", response, err)
	}
}

func TestRPCNotificationContractCompatibility(t *testing.T) {
	for _, params := range []util.Optional[any]{{}, {Exists: true, IsNull: true}, {Exists: true, Value: false}, {Exists: true, Value: int64(9223372036854775807)}, {Exists: true, Value: []any{}}, {Exists: true, Value: map[string]any{"key": nil}}} {
		notification, err := pluginRPCNotification("event", params)
		if err != nil {
			t.Fatal(err)
		}
		expected, err := json.Marshal(JsonRpcRequest{JsonRpc: "2.0", Method: "event", Params: params})
		if err != nil {
			t.Fatal(err)
		}
		actual, err := json.Marshal(notification)
		if err != nil || string(actual) != string(expected) {
			t.Fatalf("notification changed: %s != %s, %v", actual, expected, err)
		}
	}
}

func rpcWebSocketContractTestHandler(c *gin.Context) {
	response := OpenRPCWebSocket(c, apicontract.EmptyRequest{})
	status := apicontract.PluginRPCWebSocketByName.Status(response)
	if upgrade := response.Upgrade(); upgrade != nil {
		upgrade(c.Writer, c.Request)
		return
	}
	c.JSON(status, response)
}

func TestRPCWebSocketContractAdmission(t *testing.T) {
	p := &KernelPlugin{Petal: &model.Petal{Name: "contract-rpc-stopped"}}
	GetManager().plugins.Store(p.Name, p)
	t.Cleanup(func() { GetManager().plugins.Delete(p.Name) })
	engine := gin.New()
	engine.GET("/ws/plugin/rpc", rpcWebSocketContractTestHandler)
	engine.GET("/ws/plugin/rpc/:name", rpcWebSocketContractTestHandler)
	bundle, err := apicontract.BuildBundle()
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range []struct {
		url  string
		code int
	}{
		{"/ws/plugin/rpc?name=contract-rpc-stopped", -32002},
		{"/ws/plugin/rpc/missing?name=contract-rpc-stopped", -32001},
		{"/ws/plugin/rpc", -32001},
	} {
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest("GET", entry.url, strings.NewReader("invalid body")))
		if err := bundle.ValidateHTTPResponse("GET", "/ws/plugin/rpc", recorder.Code, recorder.Header().Get("Content-Type"), recorder.Body.Bytes()); err != nil {
			t.Fatal(err)
		}
		var reply struct {
			Error struct {
				Code int `json:"code"`
			} `json:"error"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &reply); err != nil || recorder.Code != 404 || reply.Error.Code != entry.code {
			t.Fatalf("admission changed: %s: %d %s, %v", entry.url, recorder.Code, recorder.Body.String(), err)
		}
	}
	p.state.Store(int64(PluginStateRunning))
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, httptest.NewRequest("GET", "/ws/plugin/rpc/"+p.Name, nil))
	if recorder.Code != 400 || recorder.Body.String() != "This endpoint only accepts WebSocket connections" {
		t.Fatalf("non-WebSocket request changed: %d %s", recorder.Code, recorder.Body.String())
	}
}
