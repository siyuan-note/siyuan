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
	runtime := claudeCodeBaseRuntime(provider, util.ClaudeCodePermissionReadOnly)
	runtime.Model = model.Name
	runtime.MCPServers = claudeCodeMCPServers(runtime.PermissionMode)
	if util.ClaudeCodePermissionFull == runtime.PermissionMode {
		// 完全放行模式下允许命令行直接处理工作空间文件
		runtime.WorkingDir = util.WorkspaceDir
	}
	return runtime
}

// ClaudeCodeTestRuntime 组装设置页测试模型所需的运行期配置，不挂载 MCP 服务器也不指定工作空间。
func ClaudeCodeTestRuntime(provider *conf.Provider) util.ClaudeCodeRuntime {
	return claudeCodeBaseRuntime(provider, util.ClaudeCodePermissionReadOnly)
}

// claudeCodeBaseRuntime 读取提供方配置的路径、工具权限与注入命令行的环境变量。
func claudeCodeBaseRuntime(provider *conf.Provider, defaultPermissionMode string) util.ClaudeCodeRuntime {
	runtime := util.ClaudeCodeRuntime{PermissionMode: defaultPermissionMode}
	if nil == provider {
		return runtime
	}
	config := provider.ClaudeCode
	if nil == config {
		return runtime
	}
	runtime.CLIPath = config.CLIPath
	if "" != config.PermissionMode {
		runtime.PermissionMode = config.PermissionMode
	}
	runtime.Env = ResolveClaudeCodeEnv(config.Env)
	return runtime
}

// ResolveClaudeCodeEnv 解析命令行环境变量值中的密钥与变量引用，与请求头使用同一套占位符。
func ResolveClaudeCodeEnv(env map[string]string) map[string]string {
	if 0 == len(env) || nil == Conf {
		return env
	}
	resolved := make(map[string]string, len(env))
	for name, value := range env {
		resolved[name] = conf.ResolveSecretsVars(Conf.Secrets, Conf.Variables, value)
	}
	return resolved
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
