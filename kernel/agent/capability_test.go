// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package agent

import (
	"testing"

	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/mcp/tools"
	kernelModel "github.com/siyuan-note/siyuan/kernel/model"
)

func TestFrontendCapabilityModelNamesAreStableAndDistinct(t *testing.T) {
	first := frontendCapabilityModelName("plugin/frontend/example/a/b")
	second := frontendCapabilityModelName("plugin/frontend/example/a_b")
	if first == second {
		t.Fatalf("different capability IDs produced the same model name: %s", first)
	}
	if first != frontendCapabilityModelName("plugin/frontend/example/a/b") {
		t.Fatal("capability model name is not stable")
	}
	if len(first) > maxCapabilityModelNameLen || len(second) > maxCapabilityModelNameLen {
		t.Fatal("capability model name exceeds the provider limit")
	}
}

func TestCapabilityPolicyControlsExposureAndExecution(t *testing.T) {
	const toolName = "test_capability_policy_tool"
	const backendID = "native/backend/test_capability_policy_tool"
	const frontendID = "native/frontend/test_capability_policy"

	originalConf := kernelModel.Conf
	kernelModel.Conf = kernelModel.NewAppConf()
	kernelModel.Conf.AI = conf.NewAI()
	kernelModel.Conf.AI.Agent.CapabilityPolicy = &conf.CapabilityPolicy{
		Default: "deny",
		Overrides: map[string]string{
			backendID:  "allow",
			frontendID: "allow",
		},
	}
	t.Cleanup(func() { kernelModel.Conf = originalConf })

	tool := &tools.Tool{
		Name:         toolName,
		CapabilityID: backendID,
		Description:  "Test capability policy",
		InputSchema:  tools.ToolSchema{Type: "object"},
		Handler: func(args map[string]any) (tools.CallToolResult, error) {
			return tools.CallToolResult{}, nil
		},
	}
	if err := tools.SetTool(toolName, tool); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { tools.RemoveTool(toolName) })

	set, err := buildCapabilitySet([]FrontendCapability{{
		ID:          frontendID,
		Description: "Test browser capability",
		InputSchema: tools.ToolSchema{Type: "object"},
		Source:      "native",
		Generation:  1,
	}}, capabilityAccessContext{SessionID: "test-session", NotebookID: "test-notebook"})
	if err != nil {
		t.Fatal(err)
	}
	backendRegistration := set.registration(toolName)
	if backendRegistration == nil {
		t.Fatal("allowed backend capability was not exposed")
	}
	frontendRegistration := set.registration(frontendCapabilityModelName(frontendID))
	if frontendRegistration == nil {
		t.Fatal("allowed browser capability was not exposed")
	}
	kernelModel.Conf.AI.Agent.ApprovalPolicy.Overrides[backendID] = &conf.CapabilityApproval{
		Default: "allow",
		Actions: map[string]string{"write": "confirm"},
	}
	if needsCapabilityConfirm(backendRegistration, "delete", nil, false, nil) {
		t.Fatal("capability auto approval was not applied")
	}
	if !needsCapabilityConfirm(backendRegistration, "write", nil, false, nil) {
		t.Fatal("action confirmation override was not applied")
	}
	if !needsCapabilityConfirm(backendRegistration, "write", nil, true, nil) {
		t.Fatal("explicit confirmation was bypassed by the session approval mode")
	}

	kernelModel.Conf.AI.Agent.CapabilityPolicy.Overrides[backendID] = "deny"
	kernelModel.Conf.AI.Agent.CapabilityPolicy.Overrides[frontendID] = "deny"
	if capabilityStillExecutable(backendRegistration, nil) || capabilityStillExecutable(frontendRegistration, nil) {
		t.Fatal("disabled capability remained executable from an earlier model round")
	}

	set, err = buildCapabilitySet(nil, capabilityAccessContext{})
	if err != nil {
		t.Fatal(err)
	}
	if set.registration(toolName) != nil {
		t.Fatal("disabled backend capability remained exposed")
	}
}

func TestMCPCapabilityRequiresEnabledConfiguredServer(t *testing.T) {
	const toolName = "test_mcp_owner_availability"
	const serverID = "test-mcp-server"

	originalConf := kernelModel.Conf
	kernelModel.Conf = kernelModel.NewAppConf()
	kernelModel.Conf.AI = conf.NewAI()
	t.Cleanup(func() { kernelModel.Conf = originalConf })

	tool := &tools.Tool{
		Name:         toolName,
		CapabilityID: tools.BuildCapabilityID("mcp", "backend", serverID, "read"),
		Description:  "Test MCP owner availability",
		InputSchema:  tools.ToolSchema{Type: "object"},
		Source:       "mcp",
		OwnerID:      serverID,
		Runtime:      "mcp",
		Handler: func(args map[string]any) (tools.CallToolResult, error) {
			return tools.CallToolResult{}, nil
		},
	}
	if err := tools.SetTool(toolName, tool); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { tools.RemoveTool(toolName) })

	set, err := buildCapabilitySet(nil, capabilityAccessContext{})
	if err != nil {
		t.Fatal(err)
	}
	if set.registration(toolName) != nil {
		t.Fatal("MCP capability without a configured server was exposed")
	}

	kernelModel.Conf.AI.MCP.Servers = []conf.MCPServer{{ID: serverID, Enabled: true}}
	set, err = buildCapabilitySet(nil, capabilityAccessContext{})
	if err != nil {
		t.Fatal(err)
	}
	registration := set.registration(toolName)
	if registration == nil || !capabilityStillExecutable(registration, nil) {
		t.Fatal("MCP capability for an enabled configured server was unavailable")
	}

	kernelModel.Conf.AI.MCP.Servers[0].Enabled = false
	if capabilityStillExecutable(registration, nil) {
		t.Fatal("MCP capability remained executable after its server was disabled")
	}
	set, err = buildCapabilitySet(nil, capabilityAccessContext{})
	if err != nil {
		t.Fatal(err)
	}
	if set.registration(toolName) != nil {
		t.Fatal("MCP capability for a disabled server was exposed")
	}
}

func TestExplicitCapabilityConfirmationOverridesRiskAndSessionApproval(t *testing.T) {
	originalConf := kernelModel.Conf
	kernelModel.Conf = kernelModel.NewAppConf()
	kernelModel.Conf.AI = conf.NewAI()
	t.Cleanup(func() { kernelModel.Conf = originalConf })

	registration := &capabilityRegistration{
		ID:        "native/backend/search",
		ModelName: "search",
		Source:    "native",
		Runtime:   "kernel",
		Tool:      tools.SearchTool,
	}
	if needsCapabilityConfirm(registration, "fulltext", nil, false, nil) {
		t.Fatal("risk-based local search unexpectedly required confirmation")
	}
	required, forced := capabilityConfirmRequirement(registration, "semantic", nil, false, nil)
	if !required || forced {
		t.Fatal("risk-based semantic search did not require confirmation")
	}
	if needsCapabilityConfirm(registration, "semantic", nil, true, nil) {
		t.Fatal("session approval did not bypass risk-based confirmation")
	}

	kernelModel.Conf.AI.Agent.ApprovalPolicy.Overrides[registration.ID] = &conf.CapabilityApproval{
		Default: conf.ApprovalDecisionConfirm,
		Actions: map[string]string{"semantic": conf.ApprovalDecisionAllow},
	}
	required, forced = capabilityConfirmRequirement(registration, "fulltext", nil, false, nil)
	if !required || !forced {
		t.Fatal("explicit confirmation did not protect local search")
	}
	required, forced = capabilityConfirmRequirement(registration, "fulltext", nil, true, nil)
	if !required || !forced {
		t.Fatal("session approval bypassed explicit capability confirmation")
	}
	if needsCapabilityConfirm(registration, "semantic", nil, false, nil) {
		t.Fatal("action auto approval did not override capability confirmation")
	}
}
