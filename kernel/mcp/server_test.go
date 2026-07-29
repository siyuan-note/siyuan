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

package mcp

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	mcpsdk "github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/siyuan-note/siyuan/kernel/mcp/tools"
)

func newTestHTTPServer(t *testing.T) (*mcpsdk.Server, *httptest.Server) {
	t.Helper()
	server := newServer()
	syncTool(server, "echo", &tools.Tool{
		Name:        "echo",
		Description: "Echo text",
		InputSchema: tools.ToolSchema{
			Type: "object",
			Properties: map[string]tools.Property{
				"text": {Type: "string"},
			},
		},
		Handler: func(arguments map[string]any) (tools.CallToolResult, error) {
			text, _ := arguments["text"].(string)
			return tools.CallToolResult{Content: []tools.ContentItem{{Type: "text", Text: text}}}, nil
		},
	})
	httpServer := httptest.NewServer(newHTTPHandler(server))
	t.Cleanup(httpServer.Close)
	return server, httpServer
}

func TestModernProtocolClient(t *testing.T) {
	server, httpServer := newTestHTTPServer(t)
	client := mcpsdk.NewClient(&mcpsdk.Implementation{Name: "test-client", Version: "1.0.0"}, nil)
	session, err := client.Connect(t.Context(), &mcpsdk.StreamableClientTransport{Endpoint: httpServer.URL}, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		session.Close()
	})

	if result := session.InitializeResult(); result == nil || result.ProtocolVersion != protocolVersion20260728 {
		t.Fatalf("unexpected protocol version: %#v", result)
	}
	if session.ID() != "" {
		t.Fatalf("modern protocol must not create a session ID: %q", session.ID())
	}

	callResult, err := session.CallTool(t.Context(), &mcpsdk.CallToolParams{
		Name:      "echo",
		Arguments: map[string]any{"text": "hello"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(callResult.Content) != 1 {
		t.Fatalf("unexpected tool content: %#v", callResult.Content)
	}
	text, ok := callResult.Content[0].(*mcpsdk.TextContent)
	if !ok || text.Text != "hello" {
		t.Fatalf("unexpected tool result: %#v", callResult.Content[0])
	}

	syncTool(server, "structured", &tools.Tool{
		Name:         "structured",
		Description:  "Return structured content",
		InputSchema:  tools.ToolSchema{Type: "object"},
		OutputSchema: &tools.ToolSchema{Type: "object"},
		Handler: func(map[string]any) (tools.CallToolResult, error) {
			return tools.CallToolResult{
				Content:           []tools.ContentItem{{Type: "text", Text: `{"status":"ok"}`}},
				StructuredContent: map[string]any{"status": "ok"},
			}, nil
		},
	})
	structuredResult, err := session.CallTool(t.Context(), &mcpsdk.CallToolParams{Name: "structured"})
	if err != nil {
		t.Fatal(err)
	}
	structured, ok := structuredResult.StructuredContent.(map[string]any)
	if !ok || structured["status"] != "ok" {
		t.Fatalf("unexpected structured content: %#v", structuredResult.StructuredContent)
	}

	syncTool(server, "dynamic", &tools.Tool{
		Name:        "dynamic",
		Description: "Dynamically registered tool",
		InputSchema: tools.ToolSchema{Type: "object"},
		Handler: func(map[string]any) (tools.CallToolResult, error) {
			return tools.CallToolResult{}, nil
		},
	})
	listResult, err := session.ListTools(t.Context(), nil)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, tool := range listResult.Tools {
		if tool.Name == "dynamic" {
			found = true
			break
		}
	}
	if !found {
		t.Fatal("dynamically registered tool was not listed")
	}
}

func TestInvalidDynamicToolDoesNotCrashServer(t *testing.T) {
	server, httpServer := newTestHTTPServer(t)
	syncTool(server, "invalid", &tools.Tool{
		Name:        "invalid",
		Description: "Invalid schema",
		InputSchema: tools.ToolSchema{Raw: map[string]any{}},
	})

	client := mcpsdk.NewClient(&mcpsdk.Implementation{Name: "test-client", Version: "1.0.0"}, nil)
	session, err := client.Connect(t.Context(), &mcpsdk.StreamableClientTransport{Endpoint: httpServer.URL}, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		session.Close()
	})
	result, err := session.ListTools(t.Context(), nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, tool := range result.Tools {
		if tool.Name == "invalid" {
			t.Fatal("invalid dynamic tool was exposed")
		}
	}
}

func TestInvalidDynamicToolRemovesExistingServerTool(t *testing.T) {
	server, httpServer := newTestHTTPServer(t)
	syncTool(server, "echo", &tools.Tool{
		Name:        "echo",
		Description: "Invalid replacement",
		InputSchema: tools.ToolSchema{Raw: map[string]any{}},
	})

	client := mcpsdk.NewClient(&mcpsdk.Implementation{Name: "test-client", Version: "1.0.0"}, nil)
	session, err := client.Connect(t.Context(), &mcpsdk.StreamableClientTransport{Endpoint: httpServer.URL}, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		session.Close()
	})
	result, err := session.ListTools(t.Context(), nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, tool := range result.Tools {
		if tool.Name == "echo" {
			t.Fatal("invalid replacement left the previous server tool exposed")
		}
	}
}

func TestToolInputAndOutputValidation(t *testing.T) {
	server, httpServer := newTestHTTPServer(t)
	inputHandlerCalled := false
	syncTool(server, "validated_input", &tools.Tool{
		Name: "validated_input",
		InputSchema: tools.ToolSchema{Raw: map[string]any{
			"type":     "object",
			"required": []any{"text"},
			"properties": map[string]any{
				"text": map[string]any{"type": "string"},
			},
		}},
		Handler: func(map[string]any) (tools.CallToolResult, error) {
			inputHandlerCalled = true
			return tools.CallToolResult{}, nil
		},
	})
	syncTool(server, "validated_output", &tools.Tool{
		Name:         "validated_output",
		InputSchema:  tools.ToolSchema{Type: "object"},
		OutputSchema: &tools.ToolSchema{Raw: map[string]any{"type": "array"}},
		Handler: func(map[string]any) (tools.CallToolResult, error) {
			return tools.CallToolResult{
				StructuredContent:    map[string]any{"wrong": true},
				StructuredContentSet: true,
			}, nil
		},
	})

	client := mcpsdk.NewClient(&mcpsdk.Implementation{Name: "test-client", Version: "1.0.0"}, nil)
	session, err := client.Connect(t.Context(), &mcpsdk.StreamableClientTransport{Endpoint: httpServer.URL}, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		session.Close()
	})

	inputResult, err := session.CallTool(t.Context(), &mcpsdk.CallToolParams{Name: "validated_input"})
	if err != nil {
		t.Fatal(err)
	}
	if !inputResult.IsError || inputHandlerCalled {
		t.Fatalf("invalid input reached handler: result=%#v called=%v", inputResult, inputHandlerCalled)
	}

	outputResult, err := session.CallTool(t.Context(), &mcpsdk.CallToolParams{Name: "validated_output"})
	if err != nil {
		t.Fatal(err)
	}
	if !outputResult.IsError || outputResult.StructuredContent != nil {
		t.Fatalf("invalid output was returned: %#v", outputResult)
	}
}

func TestExplicitNullStructuredContent(t *testing.T) {
	server, httpServer := newTestHTTPServer(t)
	syncTool(server, "null_output", &tools.Tool{
		Name:         "null_output",
		InputSchema:  tools.ToolSchema{Type: "object"},
		OutputSchema: &tools.ToolSchema{Type: "null"},
		Handler: func(map[string]any) (tools.CallToolResult, error) {
			return tools.CallToolResult{
				Content:              []tools.ContentItem{{Type: "text", Text: "null"}},
				StructuredContentSet: true,
			}, nil
		},
	})

	body := `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"null_output","arguments":{},"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{}}}}`
	response := postMCP(t, httpServer.URL, body, map[string]string{
		"MCP-Protocol-Version": protocolVersion20260728,
		"Mcp-Method":           "tools/call",
		"Mcp-Name":             "null_output",
	})
	if response.StatusCode != http.StatusOK {
		t.Fatalf("unexpected status: %d", response.StatusCode)
	}
	var callResponse struct {
		Result map[string]json.RawMessage `json:"result"`
	}
	decodeResponse(t, response, &callResponse)
	structured, ok := callResponse.Result["structuredContent"]
	if !ok || string(structured) != "null" {
		t.Fatalf("explicit null was not returned: %#v", callResponse.Result)
	}
}

func TestModernProtocolHeadersAndResult(t *testing.T) {
	_, httpServer := newTestHTTPServer(t)
	body := `{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{}}}}`

	response := postMCP(t, httpServer.URL, body, map[string]string{
		"MCP-Protocol-Version": protocolVersion20260728,
	})
	if response.StatusCode != http.StatusBadRequest {
		t.Fatalf("unexpected status for missing Mcp-Method: %d", response.StatusCode)
	}
	var errorResponse struct {
		Error struct {
			Code int `json:"code"`
		} `json:"error"`
	}
	decodeResponse(t, response, &errorResponse)
	if errorResponse.Error.Code != mcpsdk.CodeHeaderMismatch {
		t.Fatalf("unexpected error code: %d", errorResponse.Error.Code)
	}

	response = postMCP(t, httpServer.URL, body, map[string]string{
		"MCP-Protocol-Version": protocolVersion20260728,
		"Mcp-Method":           "tools/list",
	})
	if response.StatusCode != http.StatusOK {
		t.Fatalf("unexpected status: %d", response.StatusCode)
	}
	var listResponse struct {
		Result struct {
			ResultType string `json:"resultType"`
			CacheScope string `json:"cacheScope"`
		} `json:"result"`
	}
	decodeResponse(t, response, &listResponse)
	if listResponse.Result.ResultType != "complete" || listResponse.Result.CacheScope != "private" {
		t.Fatalf("unexpected modern result: %#v", listResponse.Result)
	}
}

func TestLegacyProtocolSession(t *testing.T) {
	_, httpServer := newTestHTTPServer(t)
	initialize := `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"legacy","version":"1.0.0"}}}`
	response := postMCP(t, httpServer.URL, initialize, nil)
	if response.StatusCode != http.StatusOK {
		t.Fatalf("unexpected initialize status: %d", response.StatusCode)
	}
	sessionID := response.Header.Get("Mcp-Session-Id")
	if sessionID == "" {
		t.Fatal("legacy initialize did not create a session ID")
	}
	var initializeResponse struct {
		Result struct {
			ProtocolVersion string `json:"protocolVersion"`
		} `json:"result"`
	}
	decodeResponse(t, response, &initializeResponse)
	if initializeResponse.Result.ProtocolVersion != "2025-11-25" {
		t.Fatalf("unexpected legacy protocol version: %q", initializeResponse.Result.ProtocolVersion)
	}

	response = postMCP(t, httpServer.URL,
		`{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}`,
		map[string]string{
			"MCP-Protocol-Version": "2025-11-25",
			"Mcp-Session-Id":       sessionID,
		})
	if response.StatusCode != http.StatusAccepted {
		t.Fatalf("unexpected initialized status: %d", response.StatusCode)
	}
	response.Body.Close()

	response = postMCP(t, httpServer.URL,
		`{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}`,
		map[string]string{
			"MCP-Protocol-Version": "2025-11-25",
			"Mcp-Session-Id":       sessionID,
		})
	if response.StatusCode != http.StatusOK {
		t.Fatalf("unexpected tools/list status: %d", response.StatusCode)
	}
	var listResponse struct {
		Result struct {
			Tools []struct {
				Name string `json:"name"`
			} `json:"tools"`
		} `json:"result"`
	}
	decodeResponse(t, response, &listResponse)
	if len(listResponse.Result.Tools) != 1 || listResponse.Result.Tools[0].Name != "echo" {
		t.Fatalf("unexpected legacy tool list: %#v", listResponse.Result.Tools)
	}
}

func TestLegacyInitializeDoesNotNegotiateModernProtocol(t *testing.T) {
	_, httpServer := newTestHTTPServer(t)
	initialize := `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2026-07-28","capabilities":{},"clientInfo":{"name":"legacy","version":"1.0.0"}}}`
	response := postMCP(t, httpServer.URL, initialize, nil)
	if response.StatusCode != http.StatusOK {
		t.Fatalf("unexpected initialize status: %d", response.StatusCode)
	}
	var initializeResponse struct {
		Result struct {
			ProtocolVersion string `json:"protocolVersion"`
		} `json:"result"`
	}
	decodeResponse(t, response, &initializeResponse)
	if initializeResponse.Result.ProtocolVersion != "2025-11-25" {
		t.Fatalf("legacy initialize negotiated modern protocol: %q", initializeResponse.Result.ProtocolVersion)
	}
}

func TestModernProtocolRejectsCrossOriginAndDelete(t *testing.T) {
	_, httpServer := newTestHTTPServer(t)
	body := `{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{}}}}`
	response := postMCP(t, httpServer.URL, body, map[string]string{
		"MCP-Protocol-Version": protocolVersion20260728,
		"Mcp-Method":           "tools/list",
		"Origin":               "https://example.com",
	})
	if response.StatusCode != http.StatusForbidden {
		t.Fatalf("unexpected cross-origin status: %d", response.StatusCode)
	}
	response.Body.Close()

	request, err := http.NewRequestWithContext(context.Background(), http.MethodDelete, httpServer.URL, nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("MCP-Protocol-Version", protocolVersion20260728)
	response, err = http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusMethodNotAllowed || response.Header.Get("Allow") != "POST" {
		t.Fatalf("unexpected modern DELETE response: %d %q", response.StatusCode, response.Header.Get("Allow"))
	}
}

func postMCP(t *testing.T, endpoint, body string, headers map[string]string) *http.Response {
	t.Helper()
	request, err := http.NewRequestWithContext(t.Context(), http.MethodPost, endpoint, strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json, text/event-stream")
	for name, value := range headers {
		request.Header.Set(name, value)
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	return response
}

func decodeResponse(t *testing.T, response *http.Response, target any) {
	t.Helper()
	defer response.Body.Close()
	data, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	if err = json.Unmarshal(data, target); err != nil {
		t.Fatalf("decode response %q: %v", data, err)
	}
}
