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
	"github.com/siyuan-note/httpclient"
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
	Tools      int // 已注册的工具数量，供状态查询展示
}

var (
	mcpMu           sync.Mutex
	mcpConns        []Connection
	mcpServers      []conf.MCPServer
	mcpConnecting   bool // 是否有后台连接 goroutine 正在进行，防止重复启动
	mcpDisconnected bool // 连接期间是否被 DisconnectMCP 要求放弃结果
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
	mcpDisconnected = false
	mcpMu.Unlock()

	// 后台连接：耗时操作（握手 + 拉取工具列表）不阻塞调用方。
	go func() {
		conns := connectServers(servers)
		mcpMu.Lock()
		mcpConnecting = false
		if mcpDisconnected {
			// 连接期间被 DisconnectMCP 要求放弃，丢弃结果并关闭刚建好的连接避免泄漏。
			mcpDisconnected = false
			mcpMu.Unlock()
			closeConnections(conns)
			return
		}
		mcpConns = conns
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
	// 若后台仍有连接 goroutine 在进行，标记其结果应被丢弃。
	mcpDisconnected = true
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
			Tools:      registered,
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
	// 所有 MCP HTTP 出站请求统一带上 SiYuan UA，便于第三方 MCP server 识别客户端身份
	uaBase := httpclient.NewUserAgentRoundTripper(http.DefaultTransport)
	if len(server.Headers) > 0 {
		transport.HTTPClient = &http.Client{
			Transport: &headerRoundTripper{
				base:    uaBase,
				headers: server.Headers,
			},
		}
	} else {
		transport.HTTPClient = &http.Client{Transport: uaBase}
	}

	connectCtx, connectCancel := context.WithTimeout(context.Background(), serverTimeout(server))
	defer connectCancel()
	session, err := client.Connect(connectCtx, transport, nil)
	if err != nil {
		return nil, nil, fmt.Errorf("connect: %w", err)
	}

	return session, nil, nil
}

func mcpToolHandler(serverName, toolName string, timeout time.Duration) func(args map[string]any) (tools.CallToolResult, error) {
	return func(args map[string]any) (tools.CallToolResult, error) {
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

func callMCPTool(serverName, toolName string, timeout time.Duration, args map[string]any) (*mcp.CallToolResult, error) {
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
	mcpConnecting = true
	mcpMu.Unlock()

	conns := connectServers(mcpServers)
	mcpMu.Lock()
	mcpConnecting = false
	if mcpDisconnected {
		mcpDisconnected = false
		mcpMu.Unlock()
		closeConnections(conns)
		return false
	}
	mcpConns = conns
	for _, conn := range mcpConns {
		if conn.Session != nil {
			logging.LogInfof("mcp: reconnected server [%s]", conn.ServerName)
			mcpMu.Unlock()
			return true
		}
	}
	mcpMu.Unlock()
	return false
}

// ReconnectMCPAsync 用最新的 server 配置异步重连，不阻塞调用方（如 setAI 配置保存）。
// 适用于配置变更（开关切换、编辑、增删 server）后让连接立即跟上，而非等下次 Agent 请求。
func ReconnectMCPAsync(servers []conf.MCPServer) {
	mcpMu.Lock()
	mcpServers = servers
	mcpConnecting = true
	mcpDisconnected = false
	closeConnections(mcpConns)
	mcpConns = nil
	mcpMu.Unlock()

	go func() {
		conns := connectServers(servers)
		mcpMu.Lock()
		mcpConnecting = false
		if mcpDisconnected {
			// 连接期间被 DisconnectMCP 要求放弃，丢弃结果并关闭刚建好的连接避免泄漏。
			mcpDisconnected = false
			mcpMu.Unlock()
			closeConnections(conns)
			return
		}
		mcpConns = conns
		mcpMu.Unlock()
	}()
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

// MCPStatusItem 描述单个 MCP server 的连接状态，供前端展示。
type MCPStatusItem struct {
	Name   string `json:"name"`
	Status string `json:"status"` // connected | connecting | failed | disabled
	Tools  int    `json:"tools"`  // 已注册工具数（仅 connected 时有意义）
}

// MCPStatus 返回所有已配置 MCP server 的当前连接状态。
func MCPStatus() []MCPStatusItem {
	mcpMu.Lock()
	servers := mcpServers
	conns := mcpConns
	connecting := mcpConnecting
	mcpMu.Unlock()

	// 建立已连接 server 名 → 连接信息的索引。
	connMap := make(map[string]*Connection, len(conns))
	for i := range conns {
		connMap[conns[i].ServerName] = &conns[i]
	}

	items := make([]MCPStatusItem, 0, len(servers))
	for _, srv := range servers {
		item := MCPStatusItem{Name: srv.Name}
		switch {
		case !srv.Enabled:
			item.Status = "disabled"
		case connecting && connMap[srv.Name] == nil:
			// 后台连接仍在进行，且该 server 尚未出现在已连接列表中。
			item.Status = "connecting"
		case connMap[srv.Name] != nil:
			item.Status = "connected"
			item.Tools = connMap[srv.Name].Tools
		default:
			// 已启用但既未连上、也不在连接中（连接失败或尚未触发首次连接）。
			item.Status = "failed"
		}
		items = append(items, item)
	}
	return items
}
