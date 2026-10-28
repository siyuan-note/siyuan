// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package mcp

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	mcpsdk "github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/siyuan-note/siyuan/kernel/mcp/tools"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func newTestHTTPServer(t *testing.T) (*mcpsdk.Server, *httptest.Server) {
	t.Helper()
	server := newServer()
	syncTool(server, "echo", &tools.Tool{
		Name:             "echo",
		Description:      "Echo text",
		BoxLeaseResolver: func(map[string]any) []string { return nil },
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
	httpServer := httptest.NewServer(withEncryptedBoxOperationScope(newHTTPHandler(server)))
	t.Cleanup(httpServer.Close)
	return server, httpServer
}

func TestPrivateCacheMiddleware(t *testing.T) {
	discover := &mcpsdk.DiscoverResult{}
	tools := &mcpsdk.ListToolsResult{}
	prompts := &mcpsdk.ListPromptsResult{}
	resources := &mcpsdk.ListResourcesResult{}
	templates := &mcpsdk.ListResourceTemplatesResult{}
	resource := &mcpsdk.ReadResourceResult{}
	tests := []struct {
		name       string
		result     mcpsdk.Result
		nilResult  mcpsdk.Result
		cacheScope *string
	}{
		{"discover", discover, (*mcpsdk.DiscoverResult)(nil), &discover.CacheScope},
		{"tools", tools, (*mcpsdk.ListToolsResult)(nil), &tools.CacheScope},
		{"prompts", prompts, (*mcpsdk.ListPromptsResult)(nil), &prompts.CacheScope},
		{"resources", resources, (*mcpsdk.ListResourcesResult)(nil), &resources.CacheScope},
		{"templates", templates, (*mcpsdk.ListResourceTemplatesResult)(nil), &templates.CacheScope},
		{"resource", resource, (*mcpsdk.ReadResourceResult)(nil), &resource.CacheScope},
	}
	handlerErr := errors.New("handler failed")
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			for _, outcome := range []struct {
				name   string
				result mcpsdk.Result
				err    error
			}{
				{"success", test.result, nil},
				{"error", test.result, handlerErr},
				{"typed_nil_error", test.nilResult, handlerErr},
				{"typed_nil_success", test.nilResult, nil},
			} {
				t.Run(outcome.name, func(t *testing.T) {
					*test.cacheScope = "public"
					handler := privateCacheMiddleware()(func(context.Context, string, mcpsdk.Request) (mcpsdk.Result, error) {
						return outcome.result, outcome.err
					})
					result, err := handler(t.Context(), "test", nil)
					if result != outcome.result || err != outcome.err {
						t.Fatalf("handler result was not preserved: %v, %v", result, err)
					}
					wantScope := "public"
					if outcome.result == test.result && outcome.err == nil {
						wantScope = "private"
					}
					if *test.cacheScope != wantScope {
						t.Fatalf("unexpected cache scope: got %q, want %q", *test.cacheScope, wantScope)
					}
				})
			}
		})
	}
	for _, result := range []mcpsdk.Result{nil, &mcpsdk.CallToolResult{}} {
		handler := privateCacheMiddleware()(func(context.Context, string, mcpsdk.Request) (mcpsdk.Result, error) {
			return result, nil
		})
		got, err := handler(t.Context(), "test", nil)
		if got != result || err != nil {
			t.Fatalf("uncacheable result was not preserved: %v, %v", got, err)
		}
	}
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

func TestContentToolDescriptionsReachMCPClients(t *testing.T) {
	server, httpServer := newTestHTTPServer(t)
	contentTools := map[string]struct {
		tool     *tools.Tool
		property string
	}{
		"block": {tools.BlockTool, "data"}, "document": {tools.DocumentTool, "markdown"},
		"dailynote": {tools.DailynoteTool, "data"}, "template": {tools.TemplateTool, "content"},
	}
	for name, tc := range contentTools {
		syncTool(server, name, tc.tool)
	}
	client := mcpsdk.NewClient(&mcpsdk.Implementation{Name: "content-description-test", Version: "1.0.0"}, nil)
	session, err := client.Connect(t.Context(), &mcpsdk.StreamableClientTransport{Endpoint: httpServer.URL}, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { session.Close() })
	result, err := session.ListTools(t.Context(), nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, tool := range result.Tools {
		tc, ok := contentTools[tool.Name]
		if !ok {
			continue
		}
		if tool.Description != tc.tool.Description {
			t.Fatalf("MCP client did not receive the shared %s rules", tool.Name)
		}
		data, err := json.Marshal(tool.InputSchema)
		if err != nil {
			t.Fatal(err)
		}
		var schema tools.ToolSchema
		if err = json.Unmarshal(data, &schema); err != nil {
			t.Fatal(err)
		}
		if schema.Properties[tc.property].Description != tc.tool.InputSchema.Properties[tc.property].Description {
			t.Fatalf("MCP client did not receive the %s content syntax", tool.Name)
		}
		delete(contentTools, tool.Name)
	}
	if len(contentTools) != 0 {
		t.Fatalf("content tools were not listed: %v", contentTools)
	}
}

func TestToolProjectionPolicyAndExecutionRecheck(t *testing.T) {
	server := newServer()
	allowed := true
	projection := newToolProjection(server, func(tool *tools.Tool) bool {
		return allowed && tool.Source != "mcp"
	})
	handlerCalls := 0
	tool := &tools.Tool{
		Name:         "projected",
		Description:  "Projected tool",
		InputSchema:  tools.ToolSchema{Type: "object"},
		CapabilityID: "native/backend/projected",
		Handler: func(map[string]any) (tools.CallToolResult, error) {
			handlerCalls++
			return tools.CallToolResult{}, nil
		},
	}
	projection.sync(tool.Name, tool)

	httpServer := httptest.NewServer(newHTTPHandler(server))
	t.Cleanup(httpServer.Close)
	client := mcpsdk.NewClient(&mcpsdk.Implementation{Name: "test-client", Version: "1.0.0"}, nil)
	session, err := client.Connect(t.Context(), &mcpsdk.StreamableClientTransport{Endpoint: httpServer.URL}, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { session.Close() })

	listResult, err := session.ListTools(t.Context(), nil)
	if err != nil {
		t.Fatal(err)
	}
	if !toolListContains(listResult.Tools, tool.Name) {
		t.Fatal("allowed capability was not exposed")
	}

	allowed = false
	callResult, err := session.CallTool(t.Context(), &mcpsdk.CallToolParams{Name: tool.Name})
	if err != nil {
		t.Fatal(err)
	}
	if !callResult.IsError || handlerCalls != 0 {
		t.Fatalf("disabled capability was executed: result=%#v calls=%d", callResult, handlerCalls)
	}

	projection.sync(tool.Name, tool)
	listResult, err = session.ListTools(t.Context(), nil)
	if err != nil {
		t.Fatal(err)
	}
	if toolListContains(listResult.Tools, tool.Name) {
		t.Fatal("disabled capability remained exposed")
	}

	allowed = true
	projection.sync(tool.Name, tool)
	callResult, err = session.CallTool(t.Context(), &mcpsdk.CallToolParams{Name: tool.Name})
	if err != nil {
		t.Fatal(err)
	}
	if callResult.IsError || handlerCalls != 1 {
		t.Fatalf("re-enabled capability was not executed: result=%#v calls=%d", callResult, handlerCalls)
	}
}

func TestExternalMCPToolsAreNotReexposed(t *testing.T) {
	if externalMCPToolAllowed(&tools.Tool{Name: "remote", Source: "mcp", Runtime: "mcp"}) {
		t.Fatal("external MCP capability was exposed through the SiYuan MCP server")
	}
}

func TestAgentOnlyToolsAreNotExposed(t *testing.T) {
	for _, tool := range []*tools.Tool{tools.QuestionTool, tools.TodoWriteTool, tools.AgentLogTool} {
		if !tool.AgentOnly {
			t.Fatalf("Agent session tool was not marked as Agent-only: %s", tool.Name)
		}
		if externalMCPToolAllowed(tool) {
			t.Fatalf("Agent session tool was exposed through the SiYuan MCP server: %s", tool.Name)
		}
	}
}

func toolListContains(toolList []*mcpsdk.Tool, name string) bool {
	for _, tool := range toolList {
		if tool.Name == name {
			return true
		}
	}
	return false
}

func TestToolOutputSchemaSerialization(t *testing.T) {
	server, httpServer := newTestHTTPServer(t)
	syncTool(server, "structured", &tools.Tool{
		Name:         "structured",
		Description:  "Return structured content",
		InputSchema:  tools.ToolSchema{Type: "object"},
		OutputSchema: &tools.ToolSchema{Type: "object"},
		Handler: func(map[string]any) (tools.CallToolResult, error) {
			return tools.CallToolResult{}, nil
		},
	})

	body := `{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{}}}}`
	response := postMCP(t, httpServer.URL, body, map[string]string{
		"MCP-Protocol-Version": protocolVersion20260728,
		"Mcp-Method":           "tools/list",
	})
	if response.StatusCode != http.StatusOK {
		t.Fatalf("unexpected status: %d", response.StatusCode)
	}
	var listResponse struct {
		Result struct {
			Tools []map[string]json.RawMessage `json:"tools"`
		} `json:"result"`
	}
	decodeResponse(t, response, &listResponse)

	found := map[string]bool{}
	for _, listedTool := range listResponse.Result.Tools {
		var name string
		if err := json.Unmarshal(listedTool["name"], &name); err != nil {
			t.Fatal(err)
		}
		found[name] = true
		outputSchema, hasOutputSchema := listedTool["outputSchema"]
		switch name {
		case "echo":
			if hasOutputSchema {
				t.Fatalf("tool without output schema exposed outputSchema: %s", outputSchema)
			}
		case "structured":
			if !hasOutputSchema || string(outputSchema) == "null" {
				t.Fatalf("tool output schema was not exposed: %s", outputSchema)
			}
			var schema map[string]any
			if err := json.Unmarshal(outputSchema, &schema); err != nil {
				t.Fatal(err)
			}
			if schema["type"] != "object" {
				t.Fatalf("unexpected output schema: %#v", schema)
			}
		}
	}
	if !found["echo"] || !found["structured"] {
		t.Fatalf("expected tools were not listed: %#v", found)
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
	outputText, ok := outputResult.Content[0].(*mcpsdk.TextContent)
	if !ok || !strings.Contains(outputText.Text, "must not be retried automatically") {
		t.Fatalf("invalid output did not warn against retrying: %#v", outputResult.Content)
	}
}

func TestSkillResourceContentSurvivesMCPConversion(t *testing.T) {
	originalDataDir, originalHomeDir := util.DataDir, util.HomeDir
	root := t.TempDir()
	util.DataDir = filepath.Join(root, "workspace", "data")
	util.HomeDir = filepath.Join(root, "home")
	t.Cleanup(func() {
		util.DataDir, util.HomeDir = originalDataDir, originalHomeDir
	})

	skillDir := filepath.Join(util.SkillsDir(), "transport-skill")
	if err := os.MkdirAll(filepath.Join(skillDir, "references"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(skillDir, "SKILL.md"),
		[]byte("---\nname: transport-skill\ndescription: transport test\n---\nbody"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(skillDir, "references", "valid.txt"), []byte("中文内容"), 0644); err != nil {
		t.Fatal(err)
	}

	result, err := tools.SkillTool.Handler(map[string]any{
		"action": "load",
		"name":   "transport-skill/references/valid.txt",
	})
	if err != nil || result.IsError || len(result.Content) != 1 {
		t.Fatalf("unexpected Skill resource result: %#v, %v", result, err)
	}
	converted, err := convertContentItem(result.Content[0])
	if err != nil {
		t.Fatal(err)
	}
	text, ok := converted.(*mcpsdk.TextContent)
	if !ok || text.Text != "<skill_resource skill=\"transport-skill\" path=\"references/valid.txt\">\n\n中文内容\n\n</skill_resource>" {
		t.Fatalf("Skill resource changed during MCP conversion: %#v", converted)
	}
}

func TestNonTextToolContentIsPreserved(t *testing.T) {
	server, httpServer := newTestHTTPServer(t)
	var imageContent tools.ContentItem
	if err := json.Unmarshal(
		[]byte(`{"type":"image","data":"aW1hZ2UtZGF0YQ==","mimeType":"image/png"}`), &imageContent); err != nil {
		t.Fatal(err)
	}
	syncTool(server, "image_output", &tools.Tool{
		Name:        "image_output",
		InputSchema: tools.ToolSchema{Type: "object"},
		Handler: func(map[string]any) (tools.CallToolResult, error) {
			return tools.CallToolResult{
				Content: []tools.ContentItem{imageContent},
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

	result, err := session.CallTool(t.Context(), &mcpsdk.CallToolParams{Name: "image_output"})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Content) != 1 {
		t.Fatalf("unexpected content: %#v", result.Content)
	}
	image, ok := result.Content[0].(*mcpsdk.ImageContent)
	if !ok || string(image.Data) != "image-data" || image.MIMEType != "image/png" {
		t.Fatalf("unexpected image content: %#v", result.Content[0])
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

func TestReadMissingResourceDoesNotCrashServer(t *testing.T) {
	for _, protocolVersion := range []string{protocolVersion20260728, "2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"} {
		t.Run(protocolVersion, func(t *testing.T) {
			_, httpServer := newTestHTTPServer(t)
			headers := map[string]string{"MCP-Protocol-Version": protocolVersion}
			modern := protocolVersion == protocolVersion20260728
			if !modern {
				initialize := `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"` + protocolVersion + `","capabilities":{},"clientInfo":{"name":"missing-resource","version":"1.0.0"}}}`
				response := postMCP(t, httpServer.URL, initialize, nil)
				sessionID := response.Header.Get("Mcp-Session-Id")
				response.Body.Close()
				if response.StatusCode != http.StatusOK || sessionID == "" {
					t.Fatalf("unexpected initialize response: %d, session %q", response.StatusCode, sessionID)
				}
				headers["Mcp-Session-Id"] = sessionID
				response = postMCP(t, httpServer.URL, `{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}`, headers)
				response.Body.Close()
				if response.StatusCode != http.StatusAccepted {
					t.Fatalf("unexpected initialized status: %d", response.StatusCode)
				}
			}

			send := func(id int, method string, params map[string]any) *http.Response {
				t.Helper()
				if modern {
					params["_meta"] = map[string]any{
						"io.modelcontextprotocol/protocolVersion":    protocolVersion,
						"io.modelcontextprotocol/clientCapabilities": map[string]any{},
					}
					headers["Mcp-Method"] = method
					delete(headers, "Mcp-Name")
					if uri, ok := params["uri"].(string); ok {
						headers["Mcp-Name"] = uri
					}
				}
				body, err := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": id, "method": method, "params": params})
				if err != nil {
					t.Fatal(err)
				}
				return postMCP(t, httpServer.URL, string(body), headers)
			}
			// Modern requests are stateless and must also be safe without initialize.
			response := send(2, "resources/read", map[string]any{"uri": "siyuan://doc/missing"})
			wantStatus := http.StatusOK
			if modern {
				wantStatus = http.StatusBadRequest
			}
			if response.StatusCode != wantStatus {
				response.Body.Close()
				t.Fatalf("unexpected resources/read status: %d", response.StatusCode)
			}
			var errorResponse struct {
				Error struct {
					Code    int64  `json:"code"`
					Message string `json:"message"`
				} `json:"error"`
			}
			decodeResponse(t, response, &errorResponse)
			if errorResponse.Error.Code != mcpsdk.CodeResourceNotFound || errorResponse.Error.Message != "Resource not found" {
				t.Fatalf("unexpected resources/read error: %#v", errorResponse.Error)
			}

			response = send(3, "tools/list", map[string]any{})
			if response.StatusCode != http.StatusOK {
				response.Body.Close()
				t.Fatalf("unexpected subsequent tools/list status: %d", response.StatusCode)
			}
			var listResponse struct {
				Result struct {
					Tools      []*mcpsdk.Tool `json:"tools"`
					CacheScope string         `json:"cacheScope"`
				} `json:"result"`
			}
			decodeResponse(t, response, &listResponse)
			if !toolListContains(listResponse.Result.Tools, "echo") || listResponse.Result.CacheScope != "private" {
				t.Fatalf("unexpected subsequent tools/list result: %#v", listResponse.Result)
			}
		})
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
	for _, protocolVersion := range []string{"2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"} {
		t.Run(protocolVersion, func(t *testing.T) {
			_, httpServer := newTestHTTPServer(t)
			initialize := `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"` + protocolVersion + `","capabilities":{},"clientInfo":{"name":"legacy","version":"1.0.0"}}}`
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
			if initializeResponse.Result.ProtocolVersion != protocolVersion {
				t.Fatalf("unexpected legacy protocol version: %q", initializeResponse.Result.ProtocolVersion)
			}

			response = postMCP(t, httpServer.URL,
				`{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}`,
				map[string]string{
					"MCP-Protocol-Version": protocolVersion,
					"Mcp-Session-Id":       sessionID,
				})
			if response.StatusCode != http.StatusAccepted {
				t.Fatalf("unexpected initialized status: %d", response.StatusCode)
			}
			response.Body.Close()

			response = postMCP(t, httpServer.URL,
				`{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}`,
				map[string]string{
					"MCP-Protocol-Version": protocolVersion,
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

			response = postMCP(t, httpServer.URL,
				`{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"echo","arguments":{"text":"hello"}}}`,
				map[string]string{
					"MCP-Protocol-Version": protocolVersion,
					"Mcp-Session-Id":       sessionID,
				})
			if response.StatusCode != http.StatusOK {
				t.Fatalf("unexpected tools/call status: %d", response.StatusCode)
			}
			var callResponse struct {
				Result struct {
					Content []struct {
						Text string `json:"text"`
					} `json:"content"`
					IsError bool `json:"isError"`
				} `json:"result"`
			}
			decodeResponse(t, response, &callResponse)
			if callResponse.Result.IsError || len(callResponse.Result.Content) != 1 || callResponse.Result.Content[0].Text != "hello" {
				t.Fatalf("unexpected legacy tool result: %#v", callResponse.Result)
			}
		})
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

func TestMCPAllowsNonLoopbackHostThroughLoopbackProxy(t *testing.T) {
	_, httpServer := newTestHTTPServer(t)
	tests := []struct {
		name    string
		body    string
		headers map[string]string
	}{
		{
			name: "modern",
			body: `{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{}}}}`,
			headers: map[string]string{
				"Host":                 "192.168.5.77:8300",
				"MCP-Protocol-Version": protocolVersion20260728,
				"Mcp-Method":           "tools/list",
			},
		},
		{
			name: "legacy",
			body: `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"legacy","version":"1.0.0"}}}`,
			headers: map[string]string{
				"Host": "192.168.5.77:8300",
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			response := postMCP(t, httpServer.URL, test.body, test.headers)
			defer response.Body.Close()
			if response.StatusCode != http.StatusOK {
				data, _ := io.ReadAll(response.Body)
				t.Fatalf("unexpected proxy response: %d %q", response.StatusCode, data)
			}
		})
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
		if strings.EqualFold(name, "Host") {
			request.Host = value
		} else {
			request.Header.Set(name, value)
		}
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
