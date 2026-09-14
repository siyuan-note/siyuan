package plugin

import (
	"bytes"
	"encoding/json"
	"io"
	"math"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/model"
)

func TestRPCContractParserCompatibility(t *testing.T) {
	for _, body := range []string{
		``, `{`, `null`, `[]`, `true`, `1`, `"text"`, `{}`, `{"method":"m"}`,
		`{"jsonrpc":"1.0","method":"m"}`, `{"jsonrpc":null,"method":"m"}`, `{"jsonrpc":2,"method":"m"}`,
		`{"jsonrpc":"2.0"}`, `{"jsonrpc":"2.0","method":null}`, `{"jsonrpc":"2.0","method":true}`,
		`{"jsonrpc":"2.0","method":""}`, `{"jsonrpc":"2.0","method":" m ","id":null}`,
		`{"jsonrpc":"2.0","method":"m","id":1.5}`, `{"jsonrpc":"2.0","method":"m","id":" id "}`,
		`{"jsonrpc":"2.0","method":"m","id":false}`, `{"jsonrpc":"2.0","method":"m","id":[]}`,
		`{"jsonrpc":"2.0","method":"m","params":null}`, `{"jsonrpc":"2.0","method":"m","params":false}`,
		`{"jsonrpc":"2.0","method":"m","params":[1,{"key":false},null],"id":1}`,
		`{"JSONRPC":"2.0","METHOD":"m","PARAMS":{"key":[1]},"ID":2}`,
		`[{"jsonrpc":"2.0","method":"m"},false,{},null,[],{"jsonrpc":"2.0","method":"m","id":2}]`,
		`{"jsonrpc":"2.0","method":"m","params":1e999}`, `{"jsonrpc":"2.0","method":"m","id":1e999}`,
		`{"jsonrpc":"2.0","method":"m","params":[1],"params":null,"id":1}`,
	} {
		legacy := parseRpcRequests([]byte(body))
		request, err := apicontract.DecodePluginRPC(strings.NewReader(body))
		if err != nil {
			t.Fatalf("decode failed: %s, %v", body, err)
		}
		compareRPCJSON(t, body, legacy.GlobalError, request.Error)
		if legacy.Batch != request.Batch {
			t.Fatalf("batch flag changed: %s", body)
		}
		calls, err := pluginRPCRequests(request.Calls)
		if err != nil {
			t.Fatal(err)
		}
		if len(calls) != len(legacy.Requests) {
			t.Fatalf("request count changed: %s", body)
		}
		for i, call := range calls {
			compareRPCJSON(t, body, legacy.Requests[i].Error, call.Error)
			compareRPCJSON(t, body, legacy.Requests[i].Request, call.Request)
			if call.Request != nil && (!reflect.DeepEqual(call.Request.ID, legacy.Requests[i].Request.ID) || !reflect.DeepEqual(call.Request.Params, legacy.Requests[i].Request.Params)) {
				t.Fatalf("optional parameter states changed: %s: %+v != %+v", body, call.Request, legacy.Requests[i].Request)
			}
		}
	}
}

func compareRPCJSON(t *testing.T, label string, expected, actual interface{}) {
	t.Helper()
	left, err := json.Marshal(expected)
	if err != nil {
		t.Fatal(err)
	}
	right, err := json.Marshal(actual)
	if err != nil {
		t.Fatal(err)
	}
	var leftValue, rightValue interface{}
	if err := json.Unmarshal(left, &leftValue); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(right, &rightValue); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(leftValue, rightValue) {
		t.Fatalf("RPC JSON changed for %s:\n%s\n%s", label, left, right)
	}
}

func TestRPCContractHTTPCompatibility(t *testing.T) {
	p := &KernelPlugin{Petal: &model.Petal{Name: "contract-rpc"}}
	p.state.Store(int64(PluginStateRunning))
	manager := GetManager()
	manager.plugins.Store(p.Name, p)
	t.Cleanup(func() { manager.plugins.Delete(p.Name) })
	endpoint := apicontract.PluginRPCHTTPByName
	bundle, err := apicontract.BuildBundle()
	if err != nil {
		t.Fatal(err)
	}
	for _, body := range []string{
		`invalid`, `null`, `[]`, `{}`,
		`{"jsonrpc":"2.0","method":"missing","id":1}`,
		`{"jsonrpc":"2.0","method":"missing","params":null}`,
		`{"jsonrpc":"2.0","method":"missing","params":null,"id":null}`,
		`[{"jsonrpc":"2.0","method":"missing","params":null}]`,
		`[false,{"jsonrpc":"2.0","method":"missing","params":null},{"jsonrpc":"2.0","method":"missing","id":"id"}]`,
	} {
		call := func(handler gin.HandlerFunc) *httptest.ResponseRecorder {
			engine := gin.New()
			engine.POST("/api/plugin/rpc/:name", handler)
			recorder := httptest.NewRecorder()
			engine.ServeHTTP(recorder, httptest.NewRequest("POST", "/api/plugin/rpc/contract-rpc", strings.NewReader(body)))
			return recorder
		}
		legacy := call(HandleRpcHttp)
		actual := call(func(c *gin.Context) {
			var response apicontract.Response[apicontract.PluginRPCResponse]
			if early := PrepareRPCContract(c); early != nil {
				response = *early
			} else {
				request, err := endpoint.Decode(c.Request.Body)
				if err != nil {
					response = endpoint.DecodeFailure(err)
				} else {
					response = DispatchRPCContract(c, request)
				}
			}
			if status := endpoint.Status(response); status == 204 {
				c.Status(status)
			} else {
				c.JSON(status, response)
			}
		})
		if legacy.Code != actual.Code || !bytes.Equal(legacy.Body.Bytes(), actual.Body.Bytes()) {
			t.Fatalf("RPC HTTP changed for %s:\n%d %s\n%d %s", body, legacy.Code, legacy.Body, actual.Code, actual.Body)
		}
		if err := bundle.ValidateHTTPResponse("POST", "/api/plugin/rpc/:name", actual.Code, actual.Header().Get("Content-Type"), actual.Body.Bytes()); err != nil {
			t.Fatalf("RPC response violates contract: %s, %v", actual.Body, err)
		}
	}
}

func TestRPCContractResultPrecision(t *testing.T) {
	response := &JsonRpcProcessingResponse{Response: &JsonRpcRequestResponse{JsonRpc: "2.0", ID: "id", Result: int64(math.MaxInt64)}}
	reply, err := pluginRPCReply(response)
	if err != nil {
		t.Fatal(err)
	}
	expected, _ := json.Marshal(response.Response)
	actual, err := json.Marshal(reply)
	if err != nil || !bytes.Equal(expected, actual) {
		t.Fatalf("RPC result precision changed: %s != %s, %v", actual, expected, err)
	}
}

type rpcFailingReader struct{}

func (rpcFailingReader) Read([]byte) (int, error) { return 0, io.ErrUnexpectedEOF }

func TestRPCContractReadFailure(t *testing.T) {
	_, err := apicontract.PluginRPCHTTP.Decode(rpcFailingReader{})
	if err == nil {
		t.Fatal("read failure was ignored")
	}
	response := apicontract.PluginRPCHTTP.DecodeFailure(err)
	actual, err := json.Marshal(response)
	if err != nil || !strings.Contains(string(actual), `"code":-32603`) || !strings.Contains(string(actual), "Failed to read request body: unexpected EOF") {
		t.Fatalf("RPC read error changed: %s, %v", actual, err)
	}
}
