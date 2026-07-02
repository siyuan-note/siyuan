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

package client

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os/exec"
	"strings"
	"sync"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/mcp/tools"
	"github.com/siyuan-note/siyuan/kernel/model"
)

const (
	defaultMCPServerTimeout = 30 * time.Second
)

type Connection struct {
	ServerName string
	Session    *mcp.ClientSession
	Cmd        *exec.Cmd
}

var (
	mcpMu         sync.Mutex
	mcpConns      []Connection
	mcpServers    []conf.MCPServer
	mcpConnecting bool // 是否有后台连接 goroutine 正在进行，防止重复启动
)

// EnsureMCPConnected 确保 MCP server 已连接。
// 首次调用时在后台异步连接，立即返回不阻塞调用方（如 Agent 请求路径）。
// 连接完成前发起的 Agent 请求本轮可能看不到 MCP 工具，下轮即可用。
// 后续调用若已连接则直接返回；若后台连接仍在进行则也直接返回，等其完成。
func EnsureMCPConnected(servers []conf.MCPServer) {
	mcpMu.Lock()
	mcpServers = servers
	if len(mcpConns) > 0 || mcpConnecting {
		mcpMu.Unlock()
		return
	}
	mcpConnecting = true
	mcpMu.Unlock()

	// 后台连接：耗时操作（握手 + 拉取工具列表）不阻塞调用方。
	go func() {
		conns := connectServers(servers)
		mcpMu.Lock()
		// 若连接期间被 DisconnectMCP 清空，则丢弃本次结果，避免断开后又被覆盖。
		if mcpConns == nil && len(conns) > 0 {
			// 仍需关闭刚建好的连接，避免泄漏。
			mcpMu.Unlock()
			closeConnections(conns)
			mcpMu.Lock()
			mcpConnecting = false
			mcpMu.Unlock()
			return
		}
		mcpConns = conns
		mcpConnecting = false
		mcpMu.Unlock()
	}()
}

// serverTimeout 归一化服务器配置的超时（秒），未配置或非法时回退到默认值。
func serverTimeout(server conf.MCPServer) time.Duration {
	if server.Timeout > 0 {
		return time.Duration(server.Timeout) * time.Second
	}
	return defaultMCPServerTimeout
}

// headerRoundTripper 把 server 配置的自定义 HTTP 头附加到每个出站请求上。
type headerRoundTripper struct {
	base    http.RoundTripper
	headers map[string]string
}

func (h *headerRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	clone := req.Clone(req.Context())
	for k, v := range h.headers {
		// 对每个 header 值里的 {{secrets.NAME}}、{{vars.NAME}} 占位符插值，
		// 使 MCP 服务的 Authorization 等头部可引用密钥/变量而无需明文存储。
		clone.Header.Set(k, conf.ResolveSecretsVars(model.Conf.Secrets, model.Conf.Variables, v))
	}
	return h.base.RoundTrip(clone)
}

func DisconnectMCP() {
	mcpMu.Lock()
	defer mcpMu.Unlock()
	closeConnections(mcpConns)
	mcpConns = nil
	// 若后台仍有连接 goroutine 在进行，标记其结果应被丢弃（写回时检查 mcpConns==nil）。
	mcpConnecting = false
}

func connectServers(servers []conf.MCPServer) []Connection {
	var connections []Connection

	for _, server := range servers {
		if !server.Enabled {
			continue
		}

		session, cmd, err := connectServer(server)
		if err != nil {
			logging.LogWarnf("mcp: server [%s] connect failed: %s", server.Name, err)
			continue
		}

		listCtx, listCancel := context.WithTimeout(context.Background(), serverTimeout(server))
		toolList, err := session.ListTools(listCtx, nil)
		listCancel()
		if err != nil {
			logging.LogWarnf("mcp: server [%s] list tools failed: %s", server.Name, err)
			session.Close()
			if cmd != nil && cmd.Process != nil {
				cmd.Process.Kill()
				cmd.Wait()
			}
			continue
		}

		registered := 0
		for _, t := range toolList.Tools {
			tool := t
			name := "mcp_" + sanitize(server.Name) + "_" + sanitize(tool.Name)
			desc := tool.Description
			if !strings.HasPrefix(desc, "[MCP]") {
				desc = "[MCP:" + server.Name + "] " + desc
			}

			tools.SetTool(name, &tools.Tool{
				Name:        name,
				Description: desc,
				InputSchema: convertMCPSchema(tool.InputSchema),
				Source:      "mcp",
				Handler:     mcpToolHandler(server.Name, tool.Name, serverTimeout(server)),
			})
			registered++
		}

		connections = append(connections, Connection{
			ServerName: server.Name,
			Session:    session,
			Cmd:        cmd,
		})
		logging.LogInfof("mcp: server [%s] connected, %d tools registered", server.Name, registered)
	}

	return connections
}

func closeConnections(connections []Connection) {
	for _, conn := range connections {
		if conn.Session != nil {
			conn.Session.Close()
		}
		if conn.Cmd != nil && conn.Cmd.Process != nil {
			conn.Cmd.Process.Kill()
			conn.Cmd.Wait()
		}
	}
}

func connectServer(server conf.MCPServer) (*mcp.ClientSession, *exec.Cmd, error) {
	c := mcp.NewClient(&mcp.Implementation{Name: "siyuan", Version: "3.0"}, nil)

	switch server.Type {
	case "stdio":
		return connectStdio(c, server)
	case "http":
		return connectHTTP(c, server)
	default:
		return nil, nil, fmt.Errorf("unsupported server type: %s", server.Type)
	}
}

func connectStdio(client *mcp.Client, server conf.MCPServer) (*mcp.ClientSession, *exec.Cmd, error) {
	if server.Command == "" {
		return nil, nil, fmt.Errorf("command is required for stdio server")
	}

	cmd := exec.Command(server.Command, server.Args...)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, nil, fmt.Errorf("stdin pipe: %w", err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, nil, fmt.Errorf("stdout pipe: %w", err)
	}
	cmd.Stderr = io.Discard

	if err := cmd.Start(); err != nil {
		return nil, nil, fmt.Errorf("start command: %w", err)
	}

	connectCtx, connectCancel := context.WithTimeout(context.Background(), serverTimeout(server))
	defer connectCancel()
	transport := &mcp.IOTransport{Reader: stdout, Writer: stdin}
	session, err := client.Connect(connectCtx, transport, nil)
	if err != nil {
		cmd.Process.Kill()
		cmd.Wait()
		return nil, cmd, fmt.Errorf("connect: %w", err)
	}

	return session, cmd, nil
}

func connectHTTP(client *mcp.Client, server conf.MCPServer) (*mcp.ClientSession, *exec.Cmd, error) {
	if server.URL == "" {
		return nil, nil, fmt.Errorf("url is required for http server")
	}

	transport := &mcp.StreamableClientTransport{
		Endpoint: server.URL,
	}
	if len(server.Headers) > 0 {
		transport.HTTPClient = &http.Client{
			Transport: &headerRoundTripper{
				base:    http.DefaultTransport,
				headers: server.Headers,
			},
		}
	}

	connectCtx, connectCancel := context.WithTimeout(context.Background(), serverTimeout(server))
	defer connectCancel()
	session, err := client.Connect(connectCtx, transport, nil)
	if err != nil {
		return nil, nil, fmt.Errorf("connect: %w", err)
	}

	return session, nil, nil
}

func mcpToolHandler(serverName, toolName string, timeout time.Duration) func(args map[string]interface{}) (tools.CallToolResult, error) {
	return func(args map[string]interface{}) (tools.CallToolResult, error) {
		result, err := callMCPTool(serverName, toolName, timeout, args)
		if err != nil && isReconnectableError(err) {
			logging.LogWarnf("mcp: server [%s] tool [%s] disconnected (%s), reconnecting", serverName, toolName, err)
			if reconnectMCP() {
				result, err = callMCPTool(serverName, toolName, timeout, args)
			}
		}
		if err != nil {
			return tools.CallToolResult{
				Content: []tools.ContentItem{{Type: "text", Text: fmt.Sprintf("mcp tool error: %s", err.Error())}},
				IsError: true,
			}, nil
		}

		var textParts []string
		for _, content := range result.Content {
			if textContent, ok := content.(*mcp.TextContent); ok {
				textParts = append(textParts, textContent.Text)
			}
		}
		text := strings.Join(textParts, "\n")
		if text == "" {
			text = "(empty result)"
		}

		syr := tools.CallToolResult{
			IsError: result.IsError,
			Content: []tools.ContentItem{{Type: "text", Text: text}},
		}
		return syr, nil
	}
}

func callMCPTool(serverName, toolName string, timeout time.Duration, args map[string]interface{}) (*mcp.CallToolResult, error) {
	session := getMCPSession(serverName)
	if session == nil {
		return nil, fmt.Errorf("mcp server [%s] not connected", serverName)
	}

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	return session.CallTool(ctx, &mcp.CallToolParams{
		Name:      toolName,
		Arguments: args,
	})
}

func getMCPSession(serverName string) *mcp.ClientSession {
	mcpMu.Lock()
	defer mcpMu.Unlock()
	for _, conn := range mcpConns {
		if conn.ServerName == serverName {
			return conn.Session
		}
	}
	return nil
}

// reconnectMCP 关闭现有连接并重新注册工具。
func reconnectMCP() bool {
	mcpMu.Lock()
	// 后台首次连接仍在进行时，重连无意义（连接尚未就绪，工具调用本不会到达这里）。
	if mcpConnecting || len(mcpServers) == 0 {
		mcpMu.Unlock()
		return false
	}
	closeConnections(mcpConns)
	mcpConns = nil
	mcpMu.Unlock()

	conns := connectServers(mcpServers)
	mcpMu.Lock()
	defer mcpMu.Unlock()
	mcpConns = conns
	for _, conn := range mcpConns {
		if conn.Session != nil {
			logging.LogInfof("mcp: reconnected server [%s]", conn.ServerName)
			return true
		}
	}
	return false
}

// isReconnectableError 判断 MCP 调用失败是否可能因连接断开，值得尝试重连。
func isReconnectableError(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	if strings.Contains(msg, "401") || strings.Contains(msg, "403") ||
		strings.Contains(msg, "invalid_token") || strings.Contains(msg, "unauthorized") {
		return false
	}
	return strings.Contains(msg, "connection closed") ||
		strings.Contains(msg, "client is closing") ||
		strings.Contains(msg, "standalone sse") ||
		strings.Contains(msg, "session missing") ||
		strings.Contains(msg, "not connected")
}

func sanitize(s string) string {
	var sb strings.Builder
	for _, r := range s {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '_' || r == '-' {
			sb.WriteRune(r)
		} else {
			sb.WriteByte('_')
		}
	}
	return sb.String()
}
