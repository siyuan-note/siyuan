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
