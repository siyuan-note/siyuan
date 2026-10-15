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

package model

import (
	"encoding/json"

	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// NewAIClientForProvider 按提供方协议创建生成客户端，本机命令行提供方不走 HTTP 端点。
func NewAIClientForProvider(provider *conf.Provider, model *conf.Model) *util.AIClient {
	if nil == provider || nil == model {
		return util.NewAIClientWithModel("", "", "")
	}
	if util.IsClaudeCodeProtocol(provider.Protocol) {
		return util.NewClaudeCodeAIClient(claudeCodeRuntime(provider, model))
	}
	return util.NewAIClientWithModel(provider.APIKey, provider.BaseURL, model.Name, ResolveAIProviderHeaders(provider))
}

// claudeCodeRuntime 组装本机命令行运行期配置，含工作空间 MCP 服务凭据与只读标记。
func claudeCodeRuntime(provider *conf.Provider, model *conf.Model) util.ClaudeCodeRuntime {
	runtime := util.ClaudeCodeRuntime{
		Model:  model.Name,
		APIKey: provider.APIKey,
	}
	permissionMode := util.ClaudeCodePermissionReadOnly
	if nil != provider.ClaudeCode {
		runtime.CLIPath = provider.ClaudeCode.CLIPath
		permissionMode = provider.ClaudeCode.PermissionMode
	}
	runtime.PermissionMode = permissionMode
	runtime.MCPServers = claudeCodeMCPServers(permissionMode)
	if util.ClaudeCodePermissionFull == permissionMode {
		// 完全放行模式下允许命令行直接处理工作空间文件
		runtime.WorkingDir = util.WorkspaceDir
	}
	return runtime
}

// ClaudeCodeCLIStatus 返回本机 Claude Code 命令行的路径与版本，供设置页的连通性测试使用。
func ClaudeCodeCLIStatus(provider *conf.Provider) (path, version string, err error) {
	cliPath := ""
	if nil != provider && nil != provider.ClaudeCode {
		cliPath = provider.ClaudeCode.CLIPath
	}
	return util.ResolveClaudeCodeCLI(cliPath)
}

// claudeCodeMCPServers 生成命令行挂载的 MCP 服务器配置。
// 只读模式携带只读请求头，由内核的 MCP 服务拒绝写入动作。
func claudeCodeMCPServers(permissionMode string) string {
	if nil == Conf || nil == Conf.Api || "" == Conf.Api.Token {
		return ""
	}
	headers := map[string]string{"Authorization": "Bearer " + Conf.Api.Token}
	if util.ClaudeCodePermissionReadOnly == permissionMode {
		headers[util.MCPReadOnlyHeader] = "1"
	}
	config := map[string]any{
		"mcpServers": map[string]any{
			util.ClaudeCodeMCPServerName: map[string]any{
				"type":    "http",
				"url":     "http://127.0.0.1:" + util.ServerPort + "/mcp",
				"headers": headers,
			},
		},
	}
	data, err := json.Marshal(config)
	if nil != err {
		return ""
	}
	return string(data)
}
