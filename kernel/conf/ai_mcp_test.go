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

package conf

import "testing"

func TestNormalizeMCPServerIDs(t *testing.T) {
	ai := NewAI()
	ai.MCP.Servers = []MCPServer{
		{Name: "missing"},
		{ID: "duplicate", Name: "first"},
		{ID: "duplicate", Name: "second"},
	}
	ai.Normalize()
	seen := map[string]bool{}
	for _, server := range ai.MCP.Servers {
		if server.ID == "" || seen[server.ID] {
			t.Fatalf("unexpected MCP server ID: %#v", ai.MCP.Servers)
		}
		seen[server.ID] = true
	}
}

func TestMigrateMCPEnvironment(t *testing.T) {
	mcp := migrateMCP(map[string]any{
		"servers": []any{
			map[string]any{
				"name":       "stdio",
				"inheritEnv": []any{"PATH", "HOME"},
				"env": map[string]any{
					"TOKEN": "{{secrets.TOKEN}}",
				},
			},
		},
	})
	if len(mcp.Servers) != 1 {
		t.Fatalf("unexpected MCP servers: %#v", mcp.Servers)
	}
	server := mcp.Servers[0]
	if len(server.InheritEnv) != 2 || server.InheritEnv[0] != "PATH" || server.Env["TOKEN"] != "{{secrets.TOKEN}}" {
		t.Fatalf("unexpected migrated environment: %#v", server)
	}
}
