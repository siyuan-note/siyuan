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

package mcp

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	mcpsdk "github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/siyuan-note/siyuan/kernel/mcp/tools"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// headerRoundTripper 为测试请求附加固定请求头。
type headerRoundTripper struct {
	base   http.RoundTripper
	header string
	value  string
}

func (tripper headerRoundTripper) RoundTrip(request *http.Request) (*http.Response, error) {
	request.Header.Set(tripper.header, tripper.value)
	return tripper.base.RoundTrip(request)
}

// connectTestClient 连接测试服务器，按需为请求附加只读请求头。
func connectTestClient(t *testing.T, endpoint string, readOnly bool) *mcpsdk.ClientSession {
	t.Helper()
	client := mcpsdk.NewClient(&mcpsdk.Implementation{Name: "test-client", Version: "1.0.0"}, nil)
	transport := &mcpsdk.StreamableClientTransport{Endpoint: endpoint}
	if readOnly {
		httpClient := *http.DefaultClient
		httpClient.Transport = headerRoundTripper{base: http.DefaultTransport, header: util.MCPReadOnlyHeader, value: "1"}
		transport.HTTPClient = &httpClient
	}
	session, err := client.Connect(t.Context(), transport, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { session.Close() })
	return session
}

// TestReadOnlyRequestRejectsWrites 覆盖只读请求限制：读取动作放行，写入动作被拒绝且不执行。
func TestReadOnlyRequestRejectsWrites(t *testing.T) {
	server := newServer()
	handlerCalls := 0
	tool := &tools.Tool{
		Name:        "demoReadOnly",
		Description: "Read and write demo",
		InputSchema: tools.ToolSchema{
			Type: "object",
			Properties: map[string]tools.Property{
				"action": {Type: "string"},
			},
		},
		Handler: func(map[string]any) (tools.CallToolResult, error) {
			handlerCalls++
			return tools.CallToolResult{Content: []tools.ContentItem{{Type: "text", Text: "ok"}}}, nil
		},
	}
	syncTool(server, tool.Name, tool)

	httpServer := httptest.NewServer(newHTTPHandler(server))
	t.Cleanup(httpServer.Close)

	readOnlySession := connectTestClient(t, httpServer.URL, true)
	normalSession := connectTestClient(t, httpServer.URL, false)

	call := func(session *mcpsdk.ClientSession, action string) *mcpsdk.CallToolResult {
		t.Helper()
		arguments := map[string]any{}
		if action != "" {
			arguments["action"] = action
		}
		result, err := session.CallTool(t.Context(), &mcpsdk.CallToolParams{Name: tool.Name, Arguments: arguments})
		if err != nil {
			t.Fatal(err)
		}
		return result
	}

	if result := call(readOnlySession, "get"); result.IsError {
		t.Fatalf("read action was rejected in read-only request: %#v", result.Content)
	}
	if handlerCalls != 1 {
		t.Fatalf("read action was not executed: calls=%d", handlerCalls)
	}

	result := call(readOnlySession, "insert")
	if !result.IsError {
		t.Fatal("write action was executed in read-only request")
	}
	if handlerCalls != 1 {
		t.Fatalf("write action reached the handler in read-only request: calls=%d", handlerCalls)
	}
	text, ok := result.Content[0].(*mcpsdk.TextContent)
	if !ok || !strings.Contains(text.Text, "read-only mode") || !strings.Contains(text.Text, "insert") {
		t.Fatalf("unexpected read-only denial: %#v", result.Content)
	}

	if result := call(normalSession, "insert"); result.IsError {
		t.Fatalf("write action was rejected without the read-only header: %#v", result.Content)
	}
	if handlerCalls != 2 {
		t.Fatalf("write action was not executed without the read-only header: calls=%d", handlerCalls)
	}
}

// TestReadOnlyRequestAllowsDeclaredReadActions 只读请求下声明了只读效果的工具正常执行。
func TestReadOnlyRequestAllowsDeclaredReadActions(t *testing.T) {
	server := newServer()
	handlerCalls := 0
	tool := &tools.Tool{
		Name:        "declaredReadOnly",
		Description: "Declared read-only actions",
		InputSchema: tools.ToolSchema{
			Type: "object",
			Properties: map[string]tools.Property{
				"action": {Type: "string"},
			},
		},
		ActionEffects: map[string]tools.ToolEffects{
			"load": {LocalRead: true},
			"save": {LocalWrite: true},
		},
		Handler: func(map[string]any) (tools.CallToolResult, error) {
			handlerCalls++
			return tools.CallToolResult{Content: []tools.ContentItem{{Type: "text", Text: "ok"}}}, nil
		},
	}
	syncTool(server, tool.Name, tool)

	httpServer := httptest.NewServer(newHTTPHandler(server))
	t.Cleanup(httpServer.Close)
	session := connectTestClient(t, httpServer.URL, true)

	result, err := session.CallTool(t.Context(), &mcpsdk.CallToolParams{Name: tool.Name, Arguments: map[string]any{"action": "load"}})
	if err != nil {
		t.Fatal(err)
	}
	if result.IsError || handlerCalls != 1 {
		t.Fatalf("declared read action was not executed: result=%#v calls=%d", result.Content, handlerCalls)
	}

	result, err = session.CallTool(t.Context(), &mcpsdk.CallToolParams{Name: tool.Name, Arguments: map[string]any{"action": "save"}})
	if err != nil {
		t.Fatal(err)
	}
	if !result.IsError || handlerCalls != 1 {
		t.Fatalf("declared write action was executed: result=%#v calls=%d", result.Content, handlerCalls)
	}
}
