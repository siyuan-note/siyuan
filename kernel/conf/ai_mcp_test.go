// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

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
				"name":                 "stdio",
				"inheritEnv":           []any{"PATH", "HOME"},
				"disableStandaloneSSE": true,
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
	if len(server.InheritEnv) != 2 || server.InheritEnv[0] != "PATH" || server.Env["TOKEN"] != "{{secrets.TOKEN}}" ||
		!server.DisableStandaloneSSE {
		t.Fatalf("unexpected migrated environment: %#v", server)
	}
}
