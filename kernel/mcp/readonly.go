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

package mcp

import (
	"fmt"

	mcpsdk "github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/siyuan-note/siyuan/kernel/mcp/tools"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// isReadOnlyRequest 判断当前工具调用是否来自只读请求。
// 内置 Claude Code 提供方在只读权限模式下携带该请求头，使混合工具中的读取动作可用、写入动作被拒绝。
func isReadOnlyRequest(request *mcpsdk.CallToolRequest) bool {
	if request == nil {
		return false
	}
	extra := request.GetExtra()
	if extra == nil || extra.Header == nil {
		return false
	}
	return extra.Header.Get(util.MCPReadOnlyHeader) == "1"
}

// readOnlyDenial 返回只读请求下拒绝写入调用的错误结果，调用方未要求只读时返回空值。
func readOnlyDenial(tool *tools.Tool, request *mcpsdk.CallToolRequest, arguments map[string]any) (string, bool) {
	if !isReadOnlyRequest(request) {
		return "", false
	}
	action, _ := arguments["action"].(string)
	if tool.ReadsOnly(action) {
		return "", false
	}
	if "" == action {
		return fmt.Sprintf("read-only mode: tool [%s] is not permitted", tool.Name), true
	}
	return fmt.Sprintf("read-only mode: action [%s] of tool [%s] is not permitted", action, tool.Name), true
}
