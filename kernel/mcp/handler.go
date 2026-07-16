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

package mcp

import (
	"github.com/siyuan-note/siyuan/kernel/mcp/tools"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var supportedProtocolVersions = map[string]bool{
	"2025-06-18": true,
	"2024-11-05": true,
	"2026-07-28": true,
}

func processRequest(req *JsonRpcRequest, session *Session, protocolVersion string) any {
	isNotification := req.ID == nil

	switch req.Method {
	case "initialize":
		if isNotification {
			return nil
		}
		return handleInitialize(req, session)

	case "notifications/initialized":
		session.ready = true
		return nil

	case "ping":
		if isNotification {
			return nil
		}
		return &JsonRpcResponse{
			JsonRpc: "2.0",
			Result:  map[string]any{},
			ID:      req.ID,
		}

	case "tools/list":
		if isNotification {
			return nil
		}
		return handleToolsList(req.ID)

	case "tools/call":
		if isNotification {
			return nil
		}
		return handleToolsCall(req)

	default:
		if isNotification {
			return nil
		}
		return &JsonRpcErrorResponse{
			JsonRpc: "2.0",
			Error:   RpcError{Code: -32601, Message: "Method not found"},
			ID:      req.ID,
		}
	}
}

func processRequest2026(req *JsonRpcRequest) any {
	isNotification := req.ID == nil

	switch req.Method {
	case "server/discover":
		if isNotification {
			return nil
		}
		return handleDiscover(req)

	case "ping":
		if isNotification {
			return nil
		}
		return &JsonRpcResponse{
			JsonRpc: "2.0",
			Result:  map[string]any{},
			ID:      req.ID,
		}

	case "tools/list":
		if isNotification {
			return nil
		}
		return handleToolsList2026(req.ID)

	case "tools/call":
		if isNotification {
			return nil
		}
		return handleToolsCall(req)

	default:
		if isNotification {
			return nil
		}
		return &JsonRpcErrorResponse{
			JsonRpc: "2.0",
			Error:   RpcError{Code: -32601, Message: "Method not found"},
			ID:      req.ID,
		}
	}
}

func handleInitialize(req *JsonRpcRequest, session *Session) *JsonRpcResponse {
	params, _ := req.Params.(map[string]any)

	serverVersion := ProtocolVersion
	if clientVersion, ok := params["protocolVersion"].(string); ok {
		if supportedProtocolVersions[clientVersion] {
			serverVersion = clientVersion
		}
	}

	session.initialized = true

	return &JsonRpcResponse{
		JsonRpc: "2.0",
		Result: map[string]any{
			"protocolVersion": serverVersion,
			"capabilities": ServerCapabilities{
				Tools: &ToolsCapability{ListChanged: false},
			},
			"serverInfo": ServerInfo{
				Name:    ServerName,
				Version: util.Ver,
			},
		},
		ID: req.ID,
	}
}

func handleToolsList(id any) *JsonRpcResponse {
	toolList := tools.GetAllTools()
	return &JsonRpcResponse{
		JsonRpc: "2.0",
		Result:  map[string]any{"tools": toolList},
		ID:      id,
	}
}

func handleToolsCall(req *JsonRpcRequest) any {
	params, ok := req.Params.(map[string]any)
	if !ok {
		return &JsonRpcErrorResponse{
			JsonRpc: "2.0",
			Error:   RpcError{Code: -32602, Message: "Invalid params"},
			ID:      req.ID,
		}
	}

	toolName, _ := params["name"].(string)
	if toolName == "" {
		return &JsonRpcErrorResponse{
			JsonRpc: "2.0",
			Error:   RpcError{Code: -32602, Message: "Invalid params: name is required"},
			ID:      req.ID,
		}
	}

	t := tools.LookupTool(toolName)
	if t == nil {
		return &JsonRpcResponse{
			JsonRpc: "2.0",
			Result: tools.CallToolResult{
				Content: []tools.ContentItem{{Type: "text", Text: "tool not found: " + toolName}},
				IsError: true,
			},
			ID: req.ID,
		}
	}

	toolArgs, _ := params["arguments"].(map[string]any)
	if toolArgs == nil {
		toolArgs = map[string]any{}
	}

	result, err := t.Handler(toolArgs)
	if err != nil {
		return &JsonRpcResponse{
			JsonRpc: "2.0",
			Result: tools.CallToolResult{
				Content: []tools.ContentItem{{Type: "text", Text: err.Error()}},
				IsError: true,
			},
			ID: req.ID,
		}
	}

	return &JsonRpcResponse{
		JsonRpc: "2.0",
		Result:  result,
		ID:      req.ID,
	}
}

func handleDiscover(req *JsonRpcRequest) *JsonRpcResponse {
	return &JsonRpcResponse{
		JsonRpc: "2.0",
		Result: map[string]any{
			"protocolVersion": ProtocolV20260728,
			"capabilities": ServerCapabilities{
				Tools: &ToolsCapability{ListChanged: false},
			},
			"serverInfo": ServerInfo{
				Name:    ServerName,
				Version: util.Ver,
			},
		},
		ID: req.ID,
	}
}

func handleToolsList2026(id any) *JsonRpcResponse {
	toolList := tools.GetAllTools()
	return &JsonRpcResponse{
		JsonRpc: "2.0",
		Result: map[string]any{
			"tools":      toolList,
			"ttlMs":      60000,
			"cacheScope": "user",
		},
		ID: id,
	}
}
