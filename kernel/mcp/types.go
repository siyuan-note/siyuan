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

const (
	ProtocolVersion   = "2025-06-18"
	ProtocolV20260728 = "2026-07-28"
	ServerName        = "SiYuan"
)

type Meta struct {
	ClientInfo *ServerInfo `json:"io.modelcontextprotocol/clientInfo,omitempty"`
}

type JsonRpcRequest struct {
	JsonRpc string `json:"jsonrpc"`
	Method  string `json:"method"`
	Params  any    `json:"params,omitempty"`
	ID      any    `json:"id,omitempty"`
}

type JsonRpcResponse struct {
	JsonRpc string `json:"jsonrpc"`
	Result  any    `json:"result"`
	ID      any    `json:"id"`
}

type JsonRpcErrorResponse struct {
	JsonRpc string   `json:"jsonrpc"`
	Error   RpcError `json:"error"`
	ID      any      `json:"id"`
}

type RpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    any    `json:"data,omitempty"`
}

type ServerCapabilities struct {
	Tools *ToolsCapability `json:"tools,omitempty"`
}

type ToolsCapability struct {
	ListChanged bool `json:"listChanged"`
}

type ServerInfo struct {
	Name    string `json:"name"`
	Version string `json:"version"`
}
