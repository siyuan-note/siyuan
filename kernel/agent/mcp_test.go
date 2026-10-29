// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/sashabaranov/go-openai"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/mcp/tools"
	kernelModel "github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func setupMCPDiscoveryTest(t *testing.T) *mcpToolState {
	t.Helper()
	original := kernelModel.Conf
	kernelModel.Conf = kernelModel.NewAppConf()
	kernelModel.Conf.AI.Store(conf.NewAI())
	t.Cleanup(func() { kernelModel.Conf = original })
	for _, server := range []string{"browser", "cloud"} {
		kernelModel.Conf.AI.Load().MCP.Servers = append(kernelModel.Conf.AI.Load().MCP.Servers, conf.MCPServer{ID: server, Name: server, Enabled: true})
		for _, action := range []string{"read", "write"} {
			name := "test_mcp_" + server + "_" + action
			tool := &tools.Tool{
				Name: name, Description: "private schema description " + name,
				CapabilityID: tools.BuildCapabilityID("mcp", "backend", server, action),
				Source:       "mcp", Runtime: "mcp", OwnerID: server, OwnerName: server,
				InputSchema:  tools.ToolSchema{Type: "object", Properties: map[string]tools.Property{"secretSchema": {Type: "string"}}},
				ReadOnlyHint: action == "read",
				Handler:      func(map[string]any) (tools.CallToolResult, error) { return mcpDiscoveryResult("executed"), nil },
			}
			if err := tools.SetTool(name, tool); err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { tools.RemoveTool(name) })
		}
	}
	return newMCPToolState(capabilityAccessContext{SessionID: "discovery-test"})
}

func TestMCPProgressiveLoading(t *testing.T) {
	state := setupMCPDiscoveryTest(t)
	build := func(state *mcpToolState) *capabilitySet {
		t.Helper()
		set, err := state.build(nil)
		if err != nil {
			t.Fatal(err)
		}
		return set
	}
	call := func(action, server string) tools.CallToolResult {
		t.Helper()
		result, err := state.discover(context.Background(), map[string]any{"action": action, "server": server})
		if err != nil || result.IsError {
			t.Fatalf("%s(%s): %#v, %v", action, server, result, err)
		}
		return result
	}
	initial := build(state)
	encoded, _ := json.Marshal(initial.definitions)
	prompt := availableMCPSegment(initial)
	if initial.registration("test_mcp_browser_read") != nil || strings.Contains(string(encoded), "secretSchema") ||
		strings.Contains(prompt, "secretSchema") || !strings.Contains(prompt, `"id":"browser"`) {
		t.Fatalf("initial request must contain only MCP service metadata: %s", prompt)
	}
	listed := call("list", "browser")
	if text := resultToString(listed); !strings.Contains(text, "test_mcp_browser_read") || strings.Contains(text, "secretSchema") {
		t.Fatalf("discovery must return tool metadata without schemas: %s", text)
	}
	if build(state).registration("test_mcp_browser_read") != nil {
		t.Fatal("list activated tools")
	}
	call("load", "browser")
	loaded := build(state)
	if loaded.registration("test_mcp_browser_read") == nil || loaded.registration("test_mcp_cloud_read") != nil {
		t.Fatal("load must expose only the selected service")
	}
	// 加载所在轮次尚未向模型提供工具定义，不能执行模型提前生成的调用。
	if err := validateCapabilityCall(context.Background(), initial.registration("test_mcp_browser_read"), nil); err == nil {
		t.Fatal("tool became callable in the round before its schema was exposed")
	}
	ctx := tools.ContextWithMCPDiscovery(context.Background(), state.discover)
	result := executeCapability(ctx, openai.ToolCall{Function: openai.FunctionCall{Name: "mcp", Arguments: `{"action":"load","server":"cloud"}`}}, "", loaded.registration("mcp"))
	if result.IsError || build(state).registration("test_mcp_cloud_read") == nil {
		t.Fatalf("registered discovery execution failed: %#v", result)
	}
	if required, _ := capabilityConfirmRequirement(loaded.registration("test_mcp_browser_write"), "", nil, false, nil); !required {
		t.Fatal("loading bypassed external write confirmation")
	}
	call("unload", "browser")
	if build(state).registration("test_mcp_browser_read") != nil || build(state).registration("test_mcp_cloud_read") == nil {
		t.Fatal("unload affected the wrong service")
	}
	if build(newMCPToolState(state.accessContext)).registration("test_mcp_cloud_read") != nil {
		t.Fatal("loaded state leaked into a new user request")
	}
}

func TestMCPDiscoveryRespectsAvailabilityAndPolicy(t *testing.T) {
	state := setupMCPDiscoveryTest(t)
	policy := kernelModel.Conf.AI.Load().Agent.CapabilityPolicy
	policy.Overrides[tools.BuildCapabilityID("mcp", "backend", "browser", "write")] = "deny"
	if result, err := state.discover(context.Background(), map[string]any{"action": "load", "server": "browser"}); err != nil || result.IsError {
		t.Fatalf("load failed: %#v, %v", result, err)
	}
	set, err := state.build(nil)
	if err != nil {
		t.Fatal(err)
	}
	if set.registration("test_mcp_browser_write") != nil || set.registration("test_mcp_browser_read") == nil {
		t.Fatal("disabled tool was loaded")
	}
	registration := set.registration("test_mcp_browser_read")
	kernelModel.Conf.AI.Load().MCP.Servers[0].Enabled = false
	if capabilityStillExecutable(registration, nil) {
		t.Fatal("disabled service remained executable")
	}
	for _, server := range []string{"browser", "missing", ""} {
		result, err := state.discover(context.Background(), map[string]any{"action": "load", "server": server})
		if err != nil || !result.IsError {
			t.Fatalf("unavailable server %q loaded: %#v, %v", server, result, err)
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := state.discover(ctx, map[string]any{"action": "load", "server": "cloud"}); err == nil || state.loaded["cloud"] {
		t.Fatal("cancelled request changed loaded state")
	}
	policy.Overrides["native/backend/mcp"] = "deny"
	set, err = state.build(nil)
	if err != nil {
		t.Fatal(err)
	}
	if set.registration("mcp") != nil || set.registration("test_mcp_cloud_read") == nil || availableMCPSegment(set) != "" {
		t.Fatal("disabling discovery must preserve direct access to enabled MCP tools")
	}
}

func TestAgentChatMCPProgressiveLoading(t *testing.T) {
	setupToolRoundLimitAgentTest(t, 0)
	const serverID, toolName = "browser", "test_mcp_chat_read"
	// 连接初始化后再配置提供方，验证服务出现后的发现过程，不启动真实外部连接。
	var executed atomic.Int32
	if err := tools.SetTool(toolName, &tools.Tool{
		Name: toolName, Description: "Read browser state", Source: "mcp", Runtime: "mcp", OwnerID: serverID, OwnerName: "Browser",
		InputSchema: tools.ToolSchema{Type: "object"}, ReadOnlyHint: true,
		Handler: func(map[string]any) (tools.CallToolResult, error) {
			executed.Add(1)
			return mcpDiscoveryResult("browser read completed"), nil
		},
	}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { tools.RemoveTool(toolName) })
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request openai.ChatCompletionRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Error(err)
			return
		}
		attempt := requests.Add(1)
		if attempt > 3 {
			t.Error("unexpected extra request")
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		hasExternal := false
		for _, definition := range request.Tools {
			if definition.Function.Name == toolName {
				hasExternal = true
			}
		}
		if hasExternal != (attempt == 3) {
			t.Errorf("request %d: external tool exposure=%v", attempt, hasExternal)
		}
		flusher := prepareTestStream(t, w)
		name, arguments := "mcp", `{"action":"load","server":"browser"}`
		if attempt == 1 {
			// 服务在模型首次请求后、发现调用前变为可用。
			kernelModel.Conf.AI.Load().MCP = &conf.MCP{Servers: []conf.MCPServer{{ID: serverID, Name: "Browser", Enabled: true}}}
			name, arguments = "mcp", `{"action":"list"}`
		}
		if attempt == 3 {
			writeTestStreamChunk(t, w, flusher, "Tools are now loaded.")
		} else {
			_, _ = fmt.Fprintf(w, "data: {\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call-%d\",\"type\":\"function\",\"function\":{\"name\":%q,\"arguments\":%q}}]},\"finish_reason\":\"tool_calls\"}]}\n\n", attempt, name, arguments)
			flusher.Flush()
		}
		writeTestStreamDone(t, w, flusher)
	}))
	defer server.Close()
	done := false
	for event := range AgentChat(context.Background(), util.NewAIClientWithModel("key", server.URL+"/v1", "test-model"), "openai", "test-model", "", 0,
		testSessionID, "user-1", 1, "read and edit", nil, "English", nil, EditorContext{}, nil, false, time.Second, 0, "", time.Second, time.Second) {
		if event.Type == "error" {
			t.Errorf("agent failed: %s", event.Error)
		}
		if event.Type == "done" {
			done = true
		}
	}
	if !done || requests.Load() != 3 || executed.Load() != 0 {
		t.Fatalf("done=%v requests=%d external executions=%d", done, requests.Load(), executed.Load())
	}
}
