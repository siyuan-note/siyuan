package client

import (
	"context"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func TestMCPToolHandlerRoutesSameNameServersByID(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	var connections []Connection
	for _, id := range []string{"first-server", "second-server"} {
		server := mcp.NewServer(&mcp.Implementation{Name: "same-name", Version: "1"}, nil)
		mcp.AddTool(server, &mcp.Tool{Name: "identify"},
			func(context.Context, *mcp.CallToolRequest, struct{}) (*mcp.CallToolResult, struct{}, error) {
				return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: id}}}, struct{}{}, nil
			})
		serverTransport, clientTransport := mcp.NewInMemoryTransports()
		serverSession, err := server.Connect(ctx, serverTransport, nil)
		if err != nil {
			t.Fatal(err)
		}
		defer serverSession.Close()
		client := mcp.NewClient(&mcp.Implementation{Name: "test", Version: "1"}, nil)
		session, err := client.Connect(ctx, clientTransport, nil)
		if err != nil {
			t.Fatal(err)
		}
		defer session.Close()
		connections = append(connections, Connection{ServerID: id, ServerName: "same-name", Session: session})
	}
	mcpMu.Lock()
	oldConns, oldRuntime := mcpConns, mcpRuntime
	mcpConns = connections
	mcpRuntime = map[string]mcpRuntimeState{}
	mcpMu.Unlock()
	t.Cleanup(func() {
		mcpMu.Lock()
		mcpConns, mcpRuntime = oldConns, oldRuntime
		mcpMu.Unlock()
	})
	for _, connection := range connections {
		result, err := mcpToolContextHandler(connection.ServerID, "identify", time.Second, false)(ctx, nil)
		if err != nil || result.IsError || len(result.Content) != 1 || result.Content[0].Text != connection.ServerID {
			t.Fatalf("same-name tool was routed to another server: id=%s result=%#v err=%v", connection.ServerID, result, err)
		}
	}
	if getMCPConnection("same-name") != nil {
		t.Fatal("display name was accepted as a connection ID")
	}
}
