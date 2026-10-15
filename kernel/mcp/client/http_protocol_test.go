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
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program. If not, see <https://www.gnu.org/licenses/>.

package client

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
)

// 使用独立的协议服务验证真实出站请求，避免客户端和服务端共享实现掩盖兼容问题。
func TestMCPHTTPModernProtocol(t *testing.T) {
	oldConf := model.Conf
	model.Conf = model.NewAppConf()
	t.Cleanup(func() { model.Conf = oldConf })
	for _, test := range []struct {
		name         string
		capabilities any
		sse          bool
	}{
		{name: "JSON without list notifications", capabilities: map[string]any{"tools": map[string]any{}}},
		{name: "SSE without list notifications", capabilities: map[string]any{"tools": map[string]any{}}, sse: true},
		{name: "null capabilities"},
	} {
		t.Run(test.name, func(t *testing.T) {
			const version = "2026-07-28"
			const toolName = "semantic_search"
			const text = "案例\n查询"
			var mu sync.Mutex
			var methods []string
			httpServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != http.MethodPost {
					t.Errorf("unexpected HTTP method: %s", r.Method)
					w.WriteHeader(http.StatusMethodNotAllowed)
					return
				}
				var request struct {
					ID     json.RawMessage `json:"id"`
					Method string          `json:"method"`
					Params struct {
						Meta      map[string]any `json:"_meta"`
						Cursor    string         `json:"cursor"`
						Name      string         `json:"name"`
						Arguments map[string]any `json:"arguments"`
					} `json:"params"`
				}
				if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
					t.Error(err)
					w.WriteHeader(http.StatusBadRequest)
					return
				}
				mu.Lock()
				methods = append(methods, request.Method)
				mu.Unlock()
				if r.Header.Get("MCP-Protocol-Version") != version || r.Header.Get("Mcp-Method") != request.Method {
					t.Errorf("protocol headers do not match request: %v", r.Header)
				}
				if r.Header.Get("Mcp-Session-Id") != "" || r.Header.Get("Last-Event-ID") != "" {
					t.Error("modern request depends on transport session state")
				}
				if r.Header.Get("Authorization") != "Bearer test-token" || r.Header.Get("X-Tenant") != "test" {
					t.Error("configured headers were not preserved")
				}
				if !strings.Contains(strings.ToLower(r.Header.Get("User-Agent")), "siyuan") {
					t.Errorf("unexpected user agent: %q", r.Header.Get("User-Agent"))
				}
				if r.Header.Get("Content-Type") != "application/json" ||
					!strings.Contains(r.Header.Get("Accept"), "application/json") ||
					!strings.Contains(r.Header.Get("Accept"), "text/event-stream") {
					t.Error("missing Streamable HTTP content negotiation")
				}
				meta := request.Params.Meta
				if meta[mcp.MetaKeyProtocolVersion] != version || meta[mcp.MetaKeyClientCapabilities] == nil {
					t.Errorf("missing per-request protocol metadata: %#v", meta)
				}
				if info, ok := meta[mcp.MetaKeyClientInfo].(map[string]any); !ok || info["name"] != "siyuan" {
					t.Errorf("missing client identity: %#v", meta)
				}
				var result any
				switch request.Method {
				case "server/discover":
					result = map[string]any{"supportedVersions": []string{version}, "capabilities": test.capabilities}
				case "tools/list":
					if request.Params.Cursor == "" {
						result = map[string]any{"tools": []any{}, "nextCursor": "page-2"}
					} else if request.Params.Cursor == "page-2" {
						result = map[string]any{"tools": []any{map[string]any{
							"name": toolName,
							"inputSchema": map[string]any{"type": "object", "properties": map[string]any{
								"query": map[string]any{"type": "string", "x-mcp-header": "Query"},
							}},
						}}}
					} else {
						t.Errorf("unexpected cursor: %q", request.Params.Cursor)
					}
				case "tools/call":
					if request.Params.Name != toolName || r.Header.Get("Mcp-Name") != toolName ||
						request.Params.Arguments["query"] != text ||
						r.Header.Get("Mcp-Param-Query") != "=?base64?"+base64.StdEncoding.EncodeToString([]byte(text))+"?=" {
						t.Error("tool routing or encoded parameter headers do not match request")
					}
					result = map[string]any{"content": []any{map[string]any{"type": "text", "text": "found"}}}
				default:
					// 未提供列表变更通知的服务仍可正常发现和调用工具。
					w.Header().Set("Content-Type", "application/json")
					w.WriteHeader(http.StatusBadRequest)
					json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": request.ID,
						"error": map[string]any{"code": -32601, "message": "Method not found"}})
					return
				}
				response, err := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": request.ID, "result": result})
				if err != nil {
					t.Error(err)
					return
				}
				if test.sse {
					w.Header().Set("Content-Type", "text/event-stream")
					fmt.Fprintf(w, "event: message\ndata: %s\n\n", response)
				} else {
					w.Header().Set("Content-Type", "application/json")
					w.Write(response)
				}
			}))
			defer httpServer.Close()
			configured := conf.MCPServer{ID: "modern-protocol", Name: "modern-protocol", Type: "http", URL: httpServer.URL,
				Timeout: 5, Headers: map[string]string{"Authorization": "Bearer test-token", "X-Tenant": "test"}}
			session, _, _, err := connectServer(t.Context(), configured, false)
			if err != nil {
				t.Fatal(err)
			}
			defer session.Close()
			if session.ID() != "" || session.InitializeResult().ProtocolVersion != version {
				t.Fatalf("unexpected modern protocol state: %q, %#v", session.ID(), session.InitializeResult())
			}
			toolList, err := listAllMCPTools(t.Context(), session.ListTools)
			if err != nil || len(toolList) != 1 || toolList[0].Name != toolName {
				t.Fatalf("tool discovery failed: %#v, %v", toolList, err)
			}
			connection := &Connection{Session: session, Config: configured}
			for range 2 {
				result, rejected, err := callMCPTool(context.Background(), connection, toolName, 5*time.Second, map[string]any{"query": text})
				if err != nil || rejected || len(result.Content) != 1 {
					t.Fatalf("tool call failed: %#v, %v, %v", result, rejected, err)
				}
				if content, ok := result.Content[0].(*mcp.TextContent); !ok || content.Text != "found" {
					t.Fatalf("unexpected result: %#v", result.Content)
				}
			}
			if err := session.Close(); err != nil {
				t.Fatal(err)
			}
			mu.Lock()
			defer mu.Unlock()
			if want := []string{"server/discover", "tools/list", "tools/list", "tools/call", "tools/call"}; !reflect.DeepEqual(methods, want) {
				t.Fatalf("unexpected protocol exchanges: %v", methods)
			}
		})
	}
}
