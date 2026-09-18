package client

import (
	"testing"

	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAIDisabledMCPConnections(t *testing.T) {
	previous := util.DisabledFeatures
	t.Cleanup(func() { util.DisabledFeatures = previous })
	util.DisabledFeatures = []string{"ai"}
	servers := []conf.MCPServer{{ID: "disabled-test", Enabled: true, URL: "http://127.0.0.1:1/mcp"}}
	EnsureMCPConnected(servers)
	ReconnectMCPAsync(servers, nil, nil)
	mcpMu.Lock()
	defer mcpMu.Unlock()
	for _, server := range mcpServers {
		if server.ID == "disabled-test" {
			t.Fatal("disabled AI scheduled an MCP connection")
		}
	}
}
