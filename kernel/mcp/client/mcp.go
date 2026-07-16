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
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os/exec"
	"reflect"
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
	ServerID        string
	ServerName      string
	Session         *mcp.ClientSession
	Cmd             *exec.Cmd
	Tools           int
	RegisteredTools map[string]*tools.Tool
	Config          conf.MCPServer
}

type mcpRuntimeState struct {
	Status           string
	Tools            int
	Error            string
	AuthorizationURL string
}

var (
	mcpMu            sync.Mutex
	mcpConns         []Connection
	mcpServers       []conf.MCPServer
	mcpConnecting    bool // 是否有后台连接 goroutine 正在进行，防止重复启动
	mcpConnectCancel context.CancelFunc
	mcpGeneration    uint64
	mcpRuntime       = map[string]mcpRuntimeState{}
)

type mcpGenerationContextKey struct{}

func setMCPRuntimeState(serverID, status string, toolsCount int, errMsg, authorizationURL string) {
	mcpMu.Lock()
	setMCPRuntimeStateLocked(serverID, status, toolsCount, errMsg, authorizationURL)
	mcpMu.Unlock()
}

func setMCPRuntimeStateForContext(ctx context.Context, serverID, status string, toolsCount int, errMsg, authorizationURL string) {
	generation, ok := ctx.Value(mcpGenerationContextKey{}).(uint64)
	mcpMu.Lock()
	if ok && generation != mcpGeneration {
		mcpMu.Unlock()
		return
	}
	setMCPRuntimeStateLocked(serverID, status, toolsCount, errMsg, authorizationURL)
	mcpMu.Unlock()
}

func setOAuthRetryStateForError(ctx context.Context, serverID, errMsg string) bool {
	generation, ok := ctx.Value(mcpGenerationContextKey{}).(uint64)
	mcpMu.Lock()
	defer mcpMu.Unlock()
	if ok && generation != mcpGeneration {
		return false
	}
	status := mcpRuntime[serverID].Status
	if status == "oauth_retrying" && !isOAuthAuthenticationError(errMsg) {
		return false
	}
	if status != "authorizing" && status != "authorization_required" && status != "oauth_retrying" {
		return false
	}
	setMCPRuntimeStateLocked(serverID, "authorization_required", 0, errMsg, "")
	return true
}

func isOAuthAuthenticationError(errMsg string) bool {
	message := strings.ToLower(errMsg)
	return strings.Contains(message, "401") || strings.Contains(message, "403") ||
		strings.Contains(message, "unauthorized") || strings.Contains(message, "forbidden") ||
		strings.Contains(message, "invalid_token")
}

func setMCPRuntimeStateLocked(serverID, status string, toolsCount int, errMsg, authorizationURL string) {
	mcpRuntime[serverID] = mcpRuntimeState{
		Status:           status,
		Tools:            toolsCount,
		Error:            errMsg,
		AuthorizationURL: authorizationURL,
	}
}

// EnsureMCPConnected 确保 MCP server 已连接。
// 首次调用时在后台异步连接，立即返回不阻塞调用方（如 Agent 请求路径）。
// 连接完成前发起的 Agent 请求本轮可能看不到 MCP 工具，下轮即可用。
// 后续调用若已连接则直接返回；若后台连接仍在进行则也直接返回，等其完成。
func EnsureMCPConnected(servers []conf.MCPServer) {
	servers = append([]conf.MCPServer(nil), servers...)
	mcpMu.Lock()
	if mcpConnecting {
		mcpMu.Unlock()
		return
	}
	connected := make(map[string]bool, len(mcpConns))
	for _, connection := range mcpConns {
		connected[connection.ServerID] = true
	}
	needsConnect := len(mcpServers) == 0
	for _, server := range servers {
		if server.Enabled && !connected[server.ID] && mcpRuntime[server.ID].Status != "authorization_required" {
			needsConnect = true
			break
		}
	}
	mcpMu.Unlock()
	if needsConnect {
		ReconnectMCPAsync(servers, nil, nil)
	}
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
	if mcpConnectCancel != nil {
		mcpConnectCancel()
		mcpConnectCancel = nil
	}
	mcpGeneration++
	mcpConnecting = false
	closeConnections(mcpConns)
	mcpConns = nil
}

func connectServers(ctx context.Context, servers []conf.MCPServer, interactive map[string]bool, connected func(Connection) bool) {
	for _, server := range servers {
		if ctx.Err() != nil {
			break
		}
		if !server.Enabled {
			setMCPRuntimeStateForContext(ctx, server.ID, "disabled", 0, "", "")
			continue
		}
		setMCPRuntimeStateForContext(ctx, server.ID, "connecting", 0, "", "")
		connection := connectOneServer(ctx, server, interactive[server.ID])
		if connection != nil && !connected(*connection) {
			closeConnections([]Connection{*connection})
		}
	}
}

func connectOneServer(ctx context.Context, server conf.MCPServer, interactive bool) *Connection {
	session, cmd, oauthHandler, err := connectServer(ctx, server, interactive)
	if err != nil {
		if ctx.Err() != nil {
			return nil
		}
		if errors.Is(err, errOAuthAuthorizationRequired) {
			return nil
		}
		if setOAuthRetryStateForError(ctx, server.ID, err.Error()) {
			if markErr := markOAuthCredentialRejected(server.ID, server.URL); markErr != nil {
				logging.LogWarnf("mcp oauth: mark rejected credentials failed: %s", markErr)
			}
			return nil
		}
		setMCPRuntimeStateForContext(ctx, server.ID, "failed", 0, err.Error(), "")
		logging.LogWarnf("mcp: server [%s] connect failed: %s", server.Name, err)
		return nil
	}
	if ctx.Err() != nil {
		session.Close()
		if cmd != nil && cmd.Process != nil {
			cmd.Process.Kill()
			cmd.Wait()
		}
		return nil
	}

	listCtx, listCancel := context.WithTimeout(ctx, serverTimeout(server))
	toolList, err := session.ListTools(listCtx, nil)
	listCancel()
	if err != nil {
		if ctx.Err() != nil {
			session.Close()
			if cmd != nil && cmd.Process != nil {
				cmd.Process.Kill()
				cmd.Wait()
			}
			return nil
		}
		if errors.Is(err, errOAuthAuthorizationRequired) || setOAuthRetryStateForError(ctx, server.ID, err.Error()) {
			if markErr := markOAuthCredentialRejected(server.ID, server.URL); markErr != nil {
				logging.LogWarnf("mcp oauth: mark rejected credentials failed: %s", markErr)
			}
			session.Close()
			if cmd != nil && cmd.Process != nil {
				cmd.Process.Kill()
				cmd.Wait()
			}
			return nil
		}
		setMCPRuntimeStateForContext(ctx, server.ID, "failed", 0, err.Error(), "")
		logging.LogWarnf("mcp: server [%s] list tools failed: %s", server.Name, err)
		session.Close()
		if cmd != nil && cmd.Process != nil {
			cmd.Process.Kill()
			cmd.Wait()
		}
		return nil
	}
	if oauthHandler != nil {
		oauthHandler.disableInteractive()
	}

	baseNameCounts := make(map[string]int, len(toolList.Tools))
	for _, tool := range toolList.Tools {
		baseNameCounts["mcp_"+sanitize(server.Name)+"_"+sanitize(tool.Name)]++
	}
	serverNameCollision := sanitizedServerNameCollision(server)
	registeredTools := map[string]*tools.Tool{}
	for _, t := range toolList.Tools {
		tool := t
		baseName := "mcp_" + sanitize(server.Name) + "_" + sanitize(tool.Name)
		name := mcpToolName(server, tool.Name,
			serverNameCollision || baseNameCounts[baseName] > 1 || tools.LookupTool(baseName) != nil)
		desc := tool.Description
		if !strings.HasPrefix(desc, "[MCP]") {
			desc = "[MCP:" + server.Name + "] " + desc
		}

		readOnlyHint := trustedReadOnlyHint(server, tool)
		handler := mcpToolContextHandler(server.Name, tool.Name, serverTimeout(server))
		registeredTool := &tools.Tool{
			Name:         name,
			Description:  desc,
			InputSchema:  convertMCPSchema(tool.InputSchema),
			Source:       "mcp",
			ReadOnlyHint: readOnlyHint,
			EffectScope:  tools.EffectScopeExternal,
			Handler: func(args map[string]any) (tools.CallToolResult, error) {
				return handler(context.Background(), args)
			},
			ContextHandler: handler,
		}
		registeredTools[name] = registeredTool
	}
	if !registerMCPToolsForContext(ctx, registeredTools) {
		session.Close()
		if cmd != nil && cmd.Process != nil {
			cmd.Process.Kill()
			cmd.Wait()
		}
		return nil
	}
	registered := len(registeredTools)

	connection := &Connection{
		ServerID:        server.ID,
		ServerName:      server.Name,
		Session:         session,
		Cmd:             cmd,
		Tools:           registered,
		RegisteredTools: registeredTools,
		Config:          server,
	}
	setMCPRuntimeStateForContext(ctx, server.ID, "connected", registered, "", "")
	logging.LogInfof("mcp: server [%s] connected, %d tools registered", server.Name, registered)
	return connection
}

func sanitizedServerNameCollision(server conf.MCPServer) bool {
	mcpMu.Lock()
	defer mcpMu.Unlock()
	sanitizedName := sanitize(server.Name)
	for _, configured := range mcpServers {
		if configured.ID != server.ID && sanitize(configured.Name) == sanitizedName {
			return true
		}
	}
	return false
}

func mcpToolName(server conf.MCPServer, toolName string, collision bool) string {
	name := "mcp_" + sanitize(server.Name) + "_" + sanitize(toolName)
	if !collision {
		return name
	}
	hash := sha256.Sum256([]byte(server.ID + "\x00" + toolName))
	return fmt.Sprintf("%s_%x", name, hash[:6])
}

func registerMCPToolsForContext(ctx context.Context, registeredTools map[string]*tools.Tool) bool {
	generation, ok := ctx.Value(mcpGenerationContextKey{}).(uint64)
	mcpMu.Lock()
	defer mcpMu.Unlock()
	if ctx.Err() != nil || ok && generation != mcpGeneration {
		return false
	}
	for name, tool := range registeredTools {
		tools.SetTool(name, tool)
	}
	return true
}

func closeConnections(connections []Connection) {
	for _, conn := range connections {
		for toolName, registeredTool := range conn.RegisteredTools {
			tools.RemoveToolIf(toolName, registeredTool)
		}
		if conn.Session != nil {
			conn.Session.Close()
		}
		if conn.Cmd != nil && conn.Cmd.Process != nil {
			conn.Cmd.Process.Kill()
			conn.Cmd.Wait()
		}
	}
}

func connectServer(ctx context.Context, server conf.MCPServer, interactive bool) (*mcp.ClientSession, *exec.Cmd, *mcpOAuthHandler, error) {
	c := mcp.NewClient(&mcp.Implementation{Name: "siyuan", Version: "3.0"}, nil)

	switch server.Type {
	case "stdio":
		session, cmd, err := connectStdio(ctx, c, server)
		return session, cmd, nil, err
	case "http":
		return connectHTTP(ctx, c, server, interactive)
	default:
		return nil, nil, nil, fmt.Errorf("unsupported server type: %s", server.Type)
	}
}

func connectStdio(ctx context.Context, client *mcp.Client, server conf.MCPServer) (*mcp.ClientSession, *exec.Cmd, error) {
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

	connectCtx, connectCancel := context.WithTimeout(ctx, serverTimeout(server))
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

func connectHTTP(ctx context.Context, client *mcp.Client, server conf.MCPServer, interactive bool) (*mcp.ClientSession, *exec.Cmd, *mcpOAuthHandler, error) {
	if server.URL == "" {
		return nil, nil, nil, fmt.Errorf("url is required for http server")
	}

	transport := &mcp.StreamableClientTransport{
		Endpoint: server.URL,
	}
	var oauthHandler *mcpOAuthHandler
	if !hasAuthorizationHeader(server.Headers) {
		oauthHandler = newMCPOAuthHandler(server, interactive)
		transport.OAuthHandler = oauthHandler
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

	connectTimeout := serverTimeout(server)
	if interactive {
		connectTimeout += oauthAuthorizationTimeout
	}
	connectCtx, connectCancel := context.WithTimeout(ctx, connectTimeout)
	defer connectCancel()
	session, err := client.Connect(connectCtx, transport, nil)
	if err != nil {
		return nil, nil, oauthHandler, fmt.Errorf("connect: %w", err)
	}

	return session, nil, oauthHandler, nil
}

func hasAuthorizationHeader(headers map[string]string) bool {
	for name := range headers {
		if strings.EqualFold(name, "Authorization") {
			return true
		}
	}
	return false
}

func mcpToolContextHandler(serverName, toolName string, timeout time.Duration) func(context.Context, map[string]any) (tools.CallToolResult, error) {
	return func(ctx context.Context, args map[string]any) (tools.CallToolResult, error) {
		result := callMCPToolOnce(func() (*mcp.CallToolResult, error) {
			result, err := callMCPTool(ctx, serverName, toolName, timeout, args)
			updateMCPRuntimeAfterToolCall(serverName, err)
			return result, err
		}, func(err error) {
			logging.LogWarnf("mcp: server [%s] tool [%s] disconnected (%s), reconnecting", serverName, toolName, err)
			go reconnectMCP(serverName)
		})
		return result, nil
	}
}

func updateMCPRuntimeAfterToolCall(serverName string, callErr error) {
	mcpMu.Lock()
	connectionIndex := -1
	for i := range mcpConns {
		if mcpConns[i].ServerName == serverName {
			connectionIndex = i
			break
		}
	}
	if connectionIndex < 0 {
		mcpMu.Unlock()
		return
	}
	connection := mcpConns[connectionIndex]
	status := mcpRuntime[connection.ServerID].Status
	if status != "oauth_retrying" && status != "authorization_required" {
		mcpMu.Unlock()
		return
	}
	if (callErr != nil && isOAuthAuthenticationError(callErr.Error())) || status == "authorization_required" {
		errMsg := ""
		if callErr != nil {
			errMsg = callErr.Error()
		}
		setMCPRuntimeStateLocked(connection.ServerID, "authorization_required", 0, errMsg, "")
		mcpConns = append(mcpConns[:connectionIndex], mcpConns[connectionIndex+1:]...)
		mcpMu.Unlock()
		if markErr := markOAuthCredentialRejected(connection.ServerID, connection.Config.URL); markErr != nil {
			logging.LogWarnf("mcp oauth: mark rejected credentials failed: %s", markErr)
		}
		closeConnections([]Connection{connection})
		return
	}
	setMCPRuntimeStateLocked(connection.ServerID, "connected", connection.Tools, "", "")
	mcpMu.Unlock()
}

// callMCPToolOnce 保证一次工具请求最多发送一次。断线时只恢复后续调用所需的连接，不重放当前请求。
func callMCPToolOnce(call func() (*mcp.CallToolResult, error), reconnect func(error)) tools.CallToolResult {
	result, err := call()
	if err != nil && isExecutionUnknownError(err) {
		if isReconnectableError(err) {
			reconnect(err)
		}
		return tools.CallToolResult{
			Content: []tools.ContentItem{{
				Type: "text",
				Text: "mcp tool transport failed; execution result is unknown and must not be retried automatically",
			}},
			IsError:          true,
			ExecutionUnknown: true,
		}
	}
	if err != nil {
		return tools.CallToolResult{
			Content: []tools.ContentItem{{Type: "text", Text: fmt.Sprintf("mcp tool error: %s", err.Error())}},
			IsError: true,
		}
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
	return syr
}

func trustedReadOnlyHint(server conf.MCPServer, tool *mcp.Tool) bool {
	return server.TrustToolAnnotations && tool.Annotations != nil && tool.Annotations.ReadOnlyHint
}

func callMCPTool(parentCtx context.Context, serverName, toolName string, timeout time.Duration, args map[string]any) (*mcp.CallToolResult, error) {
	session := getMCPSession(serverName)
	if session == nil {
		return nil, fmt.Errorf("mcp server [%s] not connected", serverName)
	}

	ctx, cancel := context.WithTimeout(parentCtx, timeout)
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
func reconnectMCP(serverName string) bool {
	mcpMu.Lock()
	if mcpConnecting {
		mcpMu.Unlock()
		return false
	}
	servers := append([]conf.MCPServer(nil), mcpServers...)
	serverID := ""
	for _, server := range servers {
		if server.Name == serverName {
			serverID = server.ID
			break
		}
	}
	mcpMu.Unlock()
	if serverID == "" {
		return false
	}
	ReconnectMCPAsync(servers, []string{serverID}, nil)
	return true
}

// ReconnectMCPAsync 用最新的 server 配置异步重连，不阻塞调用方（如 setAI 配置保存）。
// 适用于配置变更（开关切换、编辑、增删 server）后让连接立即跟上，而非等下次 Agent 请求。
func ReconnectMCPAsync(servers []conf.MCPServer, forceServerIDs, interactiveServerIDs []string) {
	servers = append([]conf.MCPServer(nil), servers...)
	force := make(map[string]bool, len(forceServerIDs))
	for _, serverID := range forceServerIDs {
		force[serverID] = true
	}
	interactive := make(map[string]bool, len(interactiveServerIDs))
	for _, serverID := range interactiveServerIDs {
		interactive[serverID] = true
	}
	mcpMu.Lock()
	if mcpConnectCancel != nil {
		mcpConnectCancel()
	}
	mcpGeneration++
	generation := mcpGeneration
	connectCtx, connectCancel := context.WithCancel(context.WithValue(context.Background(), mcpGenerationContextKey{}, generation))
	mcpConnectCancel = connectCancel
	mcpServers = servers
	serverByID := make(map[string]conf.MCPServer, len(servers))
	for _, server := range servers {
		serverByID[server.ID] = server
	}
	var kept, closing []Connection
	connected := map[string]bool{}
	for _, connection := range mcpConns {
		server, exists := serverByID[connection.ServerID]
		if exists && server.Enabled && !force[server.ID] && reflect.DeepEqual(connection.Config, server) {
			kept = append(kept, connection)
			connected[server.ID] = true
		} else {
			closing = append(closing, connection)
		}
	}
	mcpConns = kept
	var connectingServers []conf.MCPServer
	for _, server := range servers {
		if !server.Enabled {
			setMCPRuntimeStateLocked(server.ID, "disabled", 0, "", "")
		} else if !connected[server.ID] {
			setMCPRuntimeStateLocked(server.ID, "connecting", 0, "", "")
			connectingServers = append(connectingServers, server)
		}
	}
	for serverID := range mcpRuntime {
		if _, exists := serverByID[serverID]; !exists {
			delete(mcpRuntime, serverID)
		}
	}
	mcpConnecting = len(connectingServers) > 0
	if !mcpConnecting {
		mcpConnectCancel = nil
		connectCancel()
	}
	mcpMu.Unlock()
	closeConnections(closing)
	if len(connectingServers) == 0 {
		return
	}

	go func() {
		defer connectCancel()
		connectServers(connectCtx, connectingServers, interactive, func(connection Connection) bool {
			mcpMu.Lock()
			defer mcpMu.Unlock()
			if generation != mcpGeneration {
				return false
			}
			mcpConns = append(mcpConns, connection)
			return true
		})
		mcpMu.Lock()
		if generation != mcpGeneration {
			mcpMu.Unlock()
			return
		}
		mcpConnecting = false
		mcpConnectCancel = nil
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
		strings.Contains(msg, "not connected") ||
		strings.Contains(msg, "connection reset") ||
		strings.Contains(msg, "broken pipe") ||
		strings.Contains(msg, "unexpected eof") ||
		strings.Contains(msg, "use of closed network connection") ||
		errors.Is(err, io.EOF)
}

func isExecutionUnknownError(err error) bool {
	if err == nil {
		return false
	}
	if isReconnectableError(err) || errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
		return true
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "deadline exceeded")
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
	ID               string `json:"id"`
	Name             string `json:"name"`
	Status           string `json:"status"` // connected | connecting | authorizing | authorization_required | failed | disabled
	Tools            int    `json:"tools"`  // 已注册工具数（仅 connected 时有意义）
	Error            string `json:"error,omitempty"`
	AuthorizationURL string `json:"authorizationURL,omitempty"`
	Authorized       bool   `json:"authorized"`
}

// MCPStatus 返回所有已配置 MCP server 的当前连接状态。
func MCPStatus() []MCPStatusItem {
	mcpMu.Lock()
	servers := append([]conf.MCPServer(nil), mcpServers...)
	runtimeStates := make(map[string]mcpRuntimeState, len(mcpRuntime))
	for serverID, state := range mcpRuntime {
		runtimeStates[serverID] = state
	}
	mcpMu.Unlock()

	items := make([]MCPStatusItem, 0, len(servers))
	for _, srv := range servers {
		state := runtimeStates[srv.ID]
		item := MCPStatusItem{
			ID:               srv.ID,
			Name:             srv.Name,
			Status:           state.Status,
			Tools:            state.Tools,
			Error:            state.Error,
			AuthorizationURL: state.AuthorizationURL,
			Authorized:       srv.Type == "http" && hasOAuthCredential(srv.ID, srv.URL),
		}
		if item.Status == "oauth_retrying" {
			item.Status = "connecting"
		}
		if !srv.Enabled {
			item.Status = "disabled"
		} else if item.Status == "" {
			item.Status = "failed"
		}
		items = append(items, item)
	}
	return items
}
