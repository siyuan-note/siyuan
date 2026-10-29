// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package tools

import "context"

// MCPDiscovery 仅作用于一次智能体请求，不修改持久化能力策略或思源 MCP 服务端导出的工具。
type MCPDiscovery func(context.Context, map[string]any) (CallToolResult, error)

type mcpDiscoveryContextKey struct{}

func ContextWithMCPDiscovery(ctx context.Context, discovery MCPDiscovery) context.Context {
	return context.WithValue(ctx, mcpDiscoveryContextKey{}, discovery)
}

var MCPTool = &Tool{
	Name:        "mcp",
	Description: "Discover external MCP services and load their tools on demand. list() lists service metadata; list(server) lists tool names and descriptions without schemas. load(server) exposes that service's allowed tools starting with the next model request. unload(server) removes them from subsequent requests. Use exact server IDs from the service list. Loading lasts only for this user request, including its tool rounds; a new user message starts unloaded. Multiple services may be loaded; unload services you no longer need to save context. Loading never overrides disabled tools or execution approval requirements.",
	AgentOnly:   true,
	InputSchema: ToolSchema{
		Type: "object",
		Properties: map[string]Property{
			"action": {Type: "string", Enum: []string{"list", "load", "unload"}},
			"server": {Type: "string", Description: "Exact MCP service ID; required for load/unload, optional for list"},
		},
		Required: []string{"action"},
	},
	EffectScope:   EffectScopeLocal,
	ActionEffects: map[string]ToolEffects{"": {LocalRead: true}},
	ContextHandler: func(ctx context.Context, args map[string]any) (CallToolResult, error) {
		if discovery, ok := ctx.Value(mcpDiscoveryContextKey{}).(MCPDiscovery); ok && discovery != nil {
			return discovery(ctx, args)
		}
		return CallToolResult{IsError: true, Content: []ContentItem{{Type: "text", Text: "MCP discovery requires an active Agent request"}}}, nil
	},
}

func init() {
	register(MCPTool)
}
