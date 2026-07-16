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

package client

import (
	"context"
	"errors"
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

func TestCallMCPToolOnceMarksTimeoutUnknownWithoutReconnect(t *testing.T) {
	calls := 0
	reconnects := 0
	result := callMCPToolOnce(func() (*mcp.CallToolResult, error) {
		calls++
		return nil, context.DeadlineExceeded
	}, func(error) {
		reconnects++
	})
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
	})
	if calls != 1 || reconnects != 1 {
		t.Fatalf("unexpected call counts: calls=%d, reconnects=%d", calls, reconnects)
	}
	if !result.IsError || !result.ExecutionUnknown {
		t.Fatalf("disconnected call was not marked unknown: %#v", result)
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
