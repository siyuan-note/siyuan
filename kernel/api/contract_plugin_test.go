package api

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/plugin"
)

func TestAPIContractPluginWebSocketAdapter(t *testing.T) {
	engine := gin.New()
	engine.GET("/ws/plugin/rpc", pluginJsonRpcWebSocket)
	engine.GET("/ws/plugin/rpc/:name", pluginJsonRpcWebSocketByName)
	bundle, err := apicontract.BuildBundle()
	if err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{"/ws/plugin/rpc", "/ws/plugin/rpc/missing"} {
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest("GET", path, strings.NewReader("invalid JSON")))
		if recorder.Code != 404 {
			t.Fatalf("unexpected handshake status: %d", recorder.Code)
		}
		if err := bundle.ValidateHTTPResponse("GET", "/ws/plugin/rpc", recorder.Code, recorder.Header().Get("Content-Type"), recorder.Body.Bytes()); err != nil {
			t.Fatal(err)
		}
	}
	called := false
	handler := contractHandler(apicontract.PluginRPCWebSocket, func(c *gin.Context, request apicontract.EmptyRequest) apicontract.Response[apicontract.PluginRPCFailure] {
		return apicontract.UpgradeWebSocket[apicontract.PluginRPCFailure](func(writer http.ResponseWriter, request *http.Request) {
			called = true
			writer.WriteHeader(http.StatusSwitchingProtocols)
		})
	})
	engine.GET("/upgrade", handler)
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, httptest.NewRequest("GET", "/upgrade", nil))
	if !called || recorder.Code != 101 || recorder.Body.Len() != 0 {
		t.Fatalf("adapter did not hand off connection: %v %d %s", called, recorder.Code, recorder.Body.String())
	}
}

func TestAPIContractPluginNameCompatibility(t *testing.T) {
	engine := gin.New()
	engine.POST("/api/plugin/getLoadedPlugin", getLoadedPlugin)
	engine.GET("/api/plugin/rpc", getLoadedPluginRPC)
	engine.GET("/api/plugin/rpc/:name", getLoadedPluginRPCByName)
	for _, entry := range []struct {
		method, route, url, body string
		code                     int
		message                  string
	}{
		{"POST", "/api/plugin/getLoadedPlugin", "/api/plugin/getLoadedPlugin", `{}`, 1, "Request body prop [name] does not exist"},
		{"POST", "/api/plugin/getLoadedPlugin", "/api/plugin/getLoadedPlugin", `{"name":null}`, 1, "Request body prop [name] does not exist"},
		{"POST", "/api/plugin/getLoadedPlugin", "/api/plugin/getLoadedPlugin", `{"name":12}`, 2, "Request body prop [name] is not a string"},
		{"POST", "/api/plugin/getLoadedPlugin", "/api/plugin/getLoadedPlugin", `{"name":""}`, 3, "Plugin name is required"},
		{"POST", "/api/plugin/getLoadedPlugin", "/api/plugin/getLoadedPlugin", `{"name":" missing "}`, 4, "Plugin [ missing ] not loaded"},
		{"POST", "/api/plugin/getLoadedPlugin", "/api/plugin/getLoadedPlugin?name=query", `invalid JSON`, 4, "Plugin [query] not loaded"},
		{"GET", "/api/plugin/rpc", "/api/plugin/rpc?name=query", `invalid JSON`, 4, "Plugin [query] not loaded"},
		{"GET", "/api/plugin/rpc", "/api/plugin/rpc?name=", `{"name":"body"}`, 4, "Plugin [body] not loaded"},
		{"GET", "/api/plugin/rpc/:name", "/api/plugin/rpc/path?name=query", `invalid JSON`, 4, "Plugin [path] not loaded"},
		{"GET", "/api/plugin/rpc", "/api/plugin/rpc", ``, -1, "Parses request [/api/plugin/rpc] failed:"},
	} {
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest(entry.method, entry.url, strings.NewReader(entry.body)))
		requireAPIContract(t, entry.method, entry.route, recorder)
		var response struct {
			Code int             `json:"code"`
			Msg  string          `json:"msg"`
			Data json.RawMessage `json:"data"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code != entry.code || !strings.HasPrefix(response.Msg, entry.message) || string(response.Data) != "null" {
			t.Fatalf("plugin parameter behavior changed: %s: %s, %v", entry.url, recorder.Body.String(), err)
		}
	}
}

func TestAPIContractLoadedPluginList(t *testing.T) {
	engine := gin.New()
	engine.GET("/api/plugin", listLoadedPluginsGET)
	engine.POST("/api/plugin/listLoadedPlugins", listLoadedPlugins)
	expected, err := json.Marshal(plugin.GetManager().GetLoadedPluginsInfo())
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range []struct{ method, path string }{{"GET", "/api/plugin"}, {"POST", "/api/plugin/listLoadedPlugins"}} {
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest(entry.method, entry.path, strings.NewReader("ignored malformed body")))
		requireAPIContract(t, entry.method, entry.path, recorder)
		var response struct {
			Code int             `json:"code"`
			Data json.RawMessage `json:"data"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code != 0 || string(response.Data) != string(expected) {
			t.Fatalf("plugin list changed: %s, %v", recorder.Body.String(), err)
		}
	}
}

func TestAPIContractLoadedPluginConversion(t *testing.T) {
	for _, value := range []*plugin.PluginInfo{nil, {}, {Name: "plugin", State: "Running", StateCode: 2, Methods: []*plugin.RpcMethodInfo{nil, {}, {Name: "rpc", Descriptions: []string{"first", "second"}}}}, {Methods: []*plugin.RpcMethodInfo{}}} {
		expected, err := json.Marshal(value)
		if err != nil {
			t.Fatal(err)
		}
		actual, err := json.Marshal(loadedPluginContract(value))
		if err != nil || string(actual) != string(expected) {
			t.Fatalf("plugin info changed: %s != %s, %v", actual, expected, err)
		}
	}
}

type pluginRPCUnreadBody struct{ reads int }

func (r *pluginRPCUnreadBody) Read([]byte) (int, error) { r.reads++; return 0, io.ErrUnexpectedEOF }
func (r *pluginRPCUnreadBody) Close() error             { return nil }

func TestAPIContractPluginRPCAdmission(t *testing.T) {
	engine := gin.New()
	engine.POST("/api/plugin/rpc", pluginJsonRpcHttp)
	engine.POST("/api/plugin/rpc/:name", pluginJsonRpcHttpByName)
	for _, entry := range []struct{ path, url string }{{"/api/plugin/rpc", "/api/plugin/rpc?name=missing"}, {"/api/plugin/rpc/:name", "/api/plugin/rpc/missing?name=other"}} {
		body := &pluginRPCUnreadBody{}
		request := httptest.NewRequest("POST", entry.url, nil)
		request.Body = body
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, request)
		requireAPIContract(t, "POST", entry.path, recorder)
		if body.reads != 0 || recorder.Body.String() != `{"jsonrpc":"2.0","error":{"code":-32001,"message":"Plugin not loaded"},"id":null}` {
			t.Fatalf("plugin admission order changed: %d reads, %s", body.reads, recorder.Body)
		}
	}
}

func TestAPIContractPluginRPCDirectAdapter(t *testing.T) {
	endpoint := apicontract.PluginRPCHTTP
	for _, empty := range []bool{false, true} {
		handler := contractHandler(endpoint, func(c *gin.Context, request apicontract.PluginRPCBatchRequest) apicontract.Response[apicontract.PluginRPCResponse] {
			if empty {
				return apicontract.SuccessNoContent[apicontract.PluginRPCResponse]()
			}
			failure := apicontract.RPCErrorResponse(-32601, "Method not found", "")
			return apicontract.SuccessDirectJSON(apicontract.RPCSingleResponse(apicontract.RPCFailureReply(failure)))
		})
		engine := gin.New()
		engine.POST("/api/plugin/rpc", handler)
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest("POST", "/api/plugin/rpc", strings.NewReader(`{"jsonrpc":"2.0","method":"notification"}`)))
		requireAPIContract(t, "POST", "/api/plugin/rpc", recorder)
		if empty {
			if recorder.Code != 204 || recorder.Body.Len() != 0 {
				t.Fatalf("notification was serialized: %d %s", recorder.Code, recorder.Body)
			}
		} else if recorder.Code != 200 || recorder.Body.String() != `{"jsonrpc":"2.0","error":{"code":-32601,"message":"Method not found"},"id":null}` {
			t.Fatalf("RPC response was wrapped: %d %s", recorder.Code, recorder.Body)
		}
	}
}
