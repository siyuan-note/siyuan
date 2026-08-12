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

package client

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/siyuan-note/siyuan/kernel/conf"
)

func TestIsReconnectableError(t *testing.T) {
	sseErr := errors.New(`connection closed: standalone SSE stream: exceeded 5 retries without progress`)
	if !isReconnectableError(sseErr) {
		t.Fatal("expected SSE disconnect to be reconnectable")
	}

	authErr := errors.New("401 Unauthorized: invalid_token")
	if isReconnectableError(authErr) {
		t.Fatal("expected auth error not to trigger reconnect")
	}
}

func TestBuildStdioEnvironment(t *testing.T) {
	server := conf.MCPServer{
		InheritEnv: []string{"PATH", "MISSING"},
		Env: map[string]string{
			"Path":  "{{vars.PATH}}",
			"TOKEN": "{{secrets.TOKEN}}",
		},
	}
	lookup := func(name string) (string, bool) {
		if name == "PATH" {
			return "inherited", true
		}
		return "", false
	}
	resolve := func(value string) string {
		return strings.NewReplacer("{{vars.PATH}}", "explicit", "{{secrets.TOKEN}}", "secret").Replace(value)
	}

	env, err := buildStdioEnvironment(server, lookup, resolve, "windows")
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"Path=explicit", "TOKEN=secret"}
	if !reflect.DeepEqual(env, want) {
		t.Fatalf("unexpected environment: got %#v, want %#v", env, want)
	}
}

func TestBuildStdioEnvironmentDoesNotInheritUnselectedVariables(t *testing.T) {
	lookupCalls := 0
	env, err := buildStdioEnvironment(conf.MCPServer{}, func(string) (string, bool) {
		lookupCalls++
		return "unexpected", true
	}, func(value string) string { return value }, "linux")
	if err != nil {
		t.Fatal(err)
	}
	if lookupCalls != 0 || len(env) != 0 {
		t.Fatalf("unexpected inherited environment: calls=%d, env=%#v", lookupCalls, env)
	}
}

func TestBuildStdioEnvironmentReadsCurrentValueOnEveryStart(t *testing.T) {
	current := ""
	available := false
	lookup := func(string) (string, bool) {
		return current, available
	}
	server := conf.MCPServer{InheritEnv: []string{"JAVA_HOME"}}

	env, err := buildStdioEnvironment(server, lookup, func(value string) string { return value }, "linux")
	if err != nil {
		t.Fatal(err)
	}
	if len(env) != 0 {
		t.Fatalf("unavailable variable was inherited: %#v", env)
	}

	current, available = "/opt/jdk", true
	env, err = buildStdioEnvironment(server, lookup, func(value string) string { return value }, "linux")
	if err != nil {
		t.Fatal(err)
	}
	if want := []string{"JAVA_HOME=/opt/jdk"}; !reflect.DeepEqual(env, want) {
		t.Fatalf("current variable value was not inherited: got %#v, want %#v", env, want)
	}
}

func TestValidateMCPServerEnvironment(t *testing.T) {
	tests := []struct {
		name   string
		server conf.MCPServer
		goos   string
	}{
		{name: "empty inherited name", server: conf.MCPServer{InheritEnv: []string{""}}, goos: "linux"},
		{name: "invalid explicit name", server: conf.MCPServer{Env: map[string]string{"A=B": "value"}}, goos: "linux"},
		{name: "NUL value", server: conf.MCPServer{Env: map[string]string{"KEY": "bad\x00value"}}, goos: "linux"},
		{name: "Windows duplicate", server: conf.MCPServer{InheritEnv: []string{"PATH", "Path"}}, goos: "windows"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if err := validateMCPServerEnvironment(test.server, test.goos); err == nil {
				t.Fatal("expected validation error")
			}
		})
	}
}

func TestEnvironmentVariableNames(t *testing.T) {
	names := environmentVariableNames([]string{"Path=one", "PATH=two", "TOKEN=value", "invalid", "=hidden"}, "windows")
	if want := []string{"PATH", "TOKEN"}; !reflect.DeepEqual(names, want) {
		t.Fatalf("unexpected names: got %#v, want %#v", names, want)
	}
	if defaults := defaultMCPEnvironmentNames("windows"); !slices.Contains(defaults, "PATH") ||
		!slices.Contains(defaults, "PATHEXT") {
		t.Fatalf("missing Windows defaults: %#v", defaults)
	}
}

func TestCallMCPToolOnceMarksTimeoutUnknownWithoutReconnect(t *testing.T) {
	calls := 0
	reconnects := 0
	result := callMCPToolOnce(func() (*mcp.CallToolResult, error) {
		calls++
		return nil, context.DeadlineExceeded
	}, func(error) {
		reconnects++
	}, false)
	if calls != 1 || reconnects != 0 {
		t.Fatalf("unexpected call counts: calls=%d, reconnects=%d", calls, reconnects)
	}
	if !result.IsError || !result.ExecutionUnknown {
		t.Fatalf("timed out call was not marked unknown: %#v", result)
	}
}

func TestCallMCPToolOnceDoesNotReplayDisconnectedCall(t *testing.T) {
	calls := 0
	reconnects := 0
	result := callMCPToolOnce(func() (*mcp.CallToolResult, error) {
		calls++
		return nil, errors.New("connection closed after request")
	}, func(error) {
		reconnects++
	}, false)
	if calls != 1 || reconnects != 1 {
		t.Fatalf("unexpected call counts: calls=%d, reconnects=%d", calls, reconnects)
	}
	if !result.IsError || !result.ExecutionUnknown {
		t.Fatalf("disconnected call was not marked unknown: %#v", result)
	}
}

func TestCallMCPToolOncePreservesExpectedNullStructuredContent(t *testing.T) {
	result := callMCPToolOnce(func() (*mcp.CallToolResult, error) {
		return &mcp.CallToolResult{
			Content: []mcp.Content{&mcp.TextContent{Text: "null"}},
		}, nil
	}, func(error) {}, true)
	if !result.HasStructuredContent() || result.StructuredContent != nil {
		t.Fatalf("expected explicit null structured content: %#v", result)
	}
}

func TestCallMCPToolOnceDoesNotInventMissingStructuredContent(t *testing.T) {
	result := callMCPToolOnce(func() (*mcp.CallToolResult, error) {
		return &mcp.CallToolResult{
			Content: []mcp.Content{&mcp.TextContent{Text: "completed without structured output"}},
		}, nil
	}, func(error) {}, true)
	if result.HasStructuredContent() {
		t.Fatalf("missing structured content was treated as explicit null: %#v", result)
	}
}

func TestCallMCPToolOncePreservesNonTextContent(t *testing.T) {
	result := callMCPToolOnce(func() (*mcp.CallToolResult, error) {
		return &mcp.CallToolResult{
			Content: []mcp.Content{&mcp.ImageContent{
				Data:     []byte("image-data"),
				MIMEType: "image/png",
			}},
		}, nil
	}, func(error) {}, false)
	if len(result.Content) != 1 || result.Content[0].Type != "image" {
		t.Fatalf("image content was not preserved: %#v", result.Content)
	}
	data, err := json.Marshal(result.Content[0])
	if err != nil {
		t.Fatal(err)
	}
	var decoded struct {
		Type     string `json:"type"`
		Data     []byte `json:"data"`
		MIMEType string `json:"mimeType"`
	}
	if err = json.Unmarshal(data, &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded.Type != "image" || string(decoded.Data) != "image-data" || decoded.MIMEType != "image/png" {
		t.Fatalf("unexpected image content: %#v", decoded)
	}
}

func TestListAllMCPToolsFollowsPagination(t *testing.T) {
	var cursors []string
	result, err := listAllMCPTools(t.Context(),
		func(_ context.Context, params *mcp.ListToolsParams) (*mcp.ListToolsResult, error) {
			cursor := ""
			if params != nil {
				cursor = params.Cursor
			}
			cursors = append(cursors, cursor)
			switch cursor {
			case "":
				return &mcp.ListToolsResult{
					Tools:      []*mcp.Tool{{Name: "first"}},
					NextCursor: "page-2",
				}, nil
			case "page-2":
				return &mcp.ListToolsResult{
					Tools: []*mcp.Tool{{Name: "second"}},
				}, nil
			default:
				t.Fatalf("unexpected cursor: %q", cursor)
				return nil, nil
			}
		})
	if err != nil {
		t.Fatal(err)
	}
	if len(result) != 2 || result[0].Name != "first" || result[1].Name != "second" {
		t.Fatalf("unexpected tools: %#v", result)
	}
	if len(cursors) != 2 || cursors[0] != "" || cursors[1] != "page-2" {
		t.Fatalf("unexpected cursors: %#v", cursors)
	}
}

func TestListAllMCPToolsRejectsRepeatedCursor(t *testing.T) {
	_, err := listAllMCPTools(t.Context(),
		func(context.Context, *mcp.ListToolsParams) (*mcp.ListToolsResult, error) {
			return &mcp.ListToolsResult{NextCursor: "same"}, nil
		})
	if err == nil {
		t.Fatal("expected repeated cursor to fail")
	}
}

func TestTrustedReadOnlyHint(t *testing.T) {
	tool := &mcp.Tool{Annotations: &mcp.ToolAnnotations{ReadOnlyHint: true}}
	if trustedReadOnlyHint(conf.MCPServer{}, tool) {
		t.Fatal("untrusted server annotation bypassed confirmation")
	}
	if !trustedReadOnlyHint(conf.MCPServer{TrustToolAnnotations: true}, tool) {
		t.Fatal("trusted read-only annotation was ignored")
	}
}

func TestMCPToolNameDisambiguatesSanitizedCollisions(t *testing.T) {
	serverA := conf.MCPServer{ID: "server-a", Name: "name with space"}
	serverB := conf.MCPServer{ID: "server-b", Name: "name_with_space"}
	nameA := mcpToolName(serverA, "read item", true)
	nameB := mcpToolName(serverB, "read item", true)
	if nameA == nameB {
		t.Fatalf("colliding MCP tool names: %q", nameA)
	}
	if name := mcpToolName(serverA, "read_item", false); name != "mcp_name_with_space_read_item" {
		t.Fatalf("unexpected ordinary MCP tool name: %q", name)
	}
	longName := mcpToolName(serverA, strings.Repeat("long tool name ", 10), false)
	if len(longName) > maxMCPToolNameLen {
		t.Fatalf("MCP tool name exceeds provider limit: %d", len(longName))
	}
}

func TestOAuthRetryFailureRequiresAuthenticationError(t *testing.T) {
	serverID := "oauth-retry-server"
	mcpMu.Lock()
	oldState, existed := mcpRuntime[serverID]
	mcpRuntime[serverID] = mcpRuntimeState{Status: "oauth_retrying"}
	mcpMu.Unlock()
	t.Cleanup(func() {
		mcpMu.Lock()
		if existed {
			mcpRuntime[serverID] = oldState
		} else {
			delete(mcpRuntime, serverID)
		}
		mcpMu.Unlock()
	})

	if setOAuthRetryStateForError(context.Background(), serverID, "500 Internal Server Error") {
		t.Fatal("non-authentication failure was treated as an authorization failure")
	}
	if !setOAuthRetryStateForError(context.Background(), serverID, "401 Unauthorized") {
		t.Fatal("rejected refreshed token did not return to the authorization-required state")
	}
}

func TestOAuthToolFailureRemovesUnauthorizedConnection(t *testing.T) {
	serverID := "oauth-tool-server"
	mcpMu.Lock()
	oldConns := mcpConns
	oldRuntime := mcpRuntime
	mcpConns = []Connection{{ServerID: serverID, ServerName: "oauth-tool", Tools: 1}}
	mcpRuntime = map[string]mcpRuntimeState{serverID: {Status: "oauth_retrying", Tools: 1}}
	mcpMu.Unlock()
	t.Cleanup(func() {
		mcpMu.Lock()
		mcpConns = oldConns
		mcpRuntime = oldRuntime
		mcpMu.Unlock()
	})

	updateMCPRuntimeAfterToolCall("oauth-tool", errors.New("401 Unauthorized"))
	mcpMu.Lock()
	connections := len(mcpConns)
	state := mcpRuntime[serverID]
	mcpMu.Unlock()
	if connections != 0 || state.Status != "authorization_required" {
		t.Fatalf("unexpected unauthorized connection state: connections=%d state=%#v", connections, state)
	}
}

func TestReconnectMCPDoesNotInterruptPendingConnection(t *testing.T) {
	mcpMu.Lock()
	oldConnecting := mcpConnecting
	oldServers := mcpServers
	oldGeneration := mcpGeneration
	mcpConnecting = true
	mcpServers = []conf.MCPServer{{ID: "server-id", Name: "server"}}
	mcpGeneration = 42
	mcpMu.Unlock()
	t.Cleanup(func() {
		mcpMu.Lock()
		mcpConnecting = oldConnecting
		mcpServers = oldServers
		mcpGeneration = oldGeneration
		mcpMu.Unlock()
	})

	if reconnectMCP("server") {
		t.Fatal("pending connection was interrupted")
	}
	mcpMu.Lock()
	generation := mcpGeneration
	mcpMu.Unlock()
	if generation != 42 {
		t.Fatalf("unexpected MCP generation: %d", generation)
	}
}

func TestReconnectMCPAsyncKeepsOtherConnections(t *testing.T) {
	serverA := conf.MCPServer{ID: "server-a", Name: "server-a", Enabled: true, Type: "stdio"}
	serverB := conf.MCPServer{ID: "server-b", Name: "server-b", Enabled: true, Type: "stdio"}
	mcpMu.Lock()
	oldConns := mcpConns
	oldServers := mcpServers
	oldRuntime := mcpRuntime
	oldConnecting := mcpConnecting
	oldCancel := mcpConnectCancel
	oldGeneration := mcpGeneration
	mcpConns = []Connection{
		{ServerID: serverA.ID, ServerName: serverA.Name, Config: serverA},
		{ServerID: serverB.ID, ServerName: serverB.Name, Config: serverB},
	}
	mcpServers = []conf.MCPServer{serverA, serverB}
	mcpRuntime = map[string]mcpRuntimeState{}
	mcpConnecting = false
	mcpConnectCancel = nil
	mcpMu.Unlock()
	t.Cleanup(func() {
		mcpMu.Lock()
		if mcpConnectCancel != nil {
			mcpConnectCancel()
		}
		mcpConns = oldConns
		mcpServers = oldServers
		mcpRuntime = oldRuntime
		mcpConnecting = oldConnecting
		mcpConnectCancel = oldCancel
		mcpGeneration = oldGeneration
		mcpMu.Unlock()
	})

	ReconnectMCPAsync([]conf.MCPServer{serverA, serverB}, []string{serverA.ID}, nil)
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		mcpMu.Lock()
		connecting := mcpConnecting
		connections := append([]Connection(nil), mcpConns...)
		mcpMu.Unlock()
		if !connecting {
			if len(connections) != 1 || connections[0].ServerID != serverB.ID {
				t.Fatalf("unrelated connection was changed: %#v", connections)
			}
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("target MCP reconnect did not finish")
}
