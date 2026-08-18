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

func TestNormalizePrunesOrphanedMCPCapabilityPolicies(t *testing.T) {
	const retainedID = "mcp/backend/retained-server/read"
	const similarID = "mcp/backend/retained-server-similar/read"
	const orphanedID = "mcp/backend/removed-server/read"
	const nativeID = "native/backend/search"

	ai := NewAI()
	ai.MCP.Servers = []MCPServer{{ID: "retained-server", Name: "retained", Enabled: false}}
	ai.Agent.CapabilityPolicy.Overrides = map[string]string{
		retainedID: "deny",
		similarID:  "deny",
		orphanedID: "deny",
		nativeID:   "deny",
	}
	ai.Agent.ApprovalPolicy.Overrides = map[string]*CapabilityApproval{
		retainedID: {Default: ApprovalDecisionAllow},
		similarID:  {Default: ApprovalDecisionAllow},
		orphanedID: {Actions: map[string]string{"read": ApprovalDecisionConfirm}},
		nativeID:   {Default: ApprovalDecisionAllow},
	}

	ai.Normalize()

	if _, exists := ai.Agent.CapabilityPolicy.Overrides[orphanedID]; exists {
		t.Fatal("orphaned MCP capability policy was not pruned")
	}
	if _, exists := ai.Agent.ApprovalPolicy.Overrides[orphanedID]; exists {
		t.Fatal("orphaned MCP approval policy was not pruned")
	}
	for _, id := range []string{retainedID, nativeID} {
		if _, exists := ai.Agent.CapabilityPolicy.Overrides[id]; !exists {
			t.Fatalf("configured capability policy was pruned: %s", id)
		}
		if _, exists := ai.Agent.ApprovalPolicy.Overrides[id]; !exists {
			t.Fatalf("configured approval policy was pruned: %s", id)
		}
	}
	if _, exists := ai.Agent.CapabilityPolicy.Overrides[similarID]; exists {
		t.Fatal("capability policy for a similarly named orphaned server was not pruned")
	}
	if _, exists := ai.Agent.ApprovalPolicy.Overrides[similarID]; exists {
		t.Fatal("approval policy for a similarly named orphaned server was not pruned")
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
