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
	"os/exec"
	"strings"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/mcp/tools"
)

const (
	mcpTimeout = 30 * time.Second
)

type Connection struct {
	ServerName string
	Session    *mcp.ClientSession
	Cmd        *exec.Cmd // non-nil for stdio servers
}

func ConnectServers(servers []conf.MCPServer) []Connection {
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

		listCtx, listCancel := context.WithTimeout(context.Background(), mcpTimeout)
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

			tools.Registry[name] = &tools.Tool{
				Name:        name,
				Description: desc,
				InputSchema: convertMCPSchema(tool.InputSchema),
				Handler:     mcpToolHandler(session, tool.Name),
			}
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

func CloseConnections(connections []Connection) {
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

	connectCtx, connectCancel := context.WithTimeout(context.Background(), mcpTimeout)
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

	connectCtx, connectCancel := context.WithTimeout(context.Background(), mcpTimeout)
	defer connectCancel()
	session, err := client.Connect(connectCtx, transport, nil)
	if err != nil {
		return nil, nil, fmt.Errorf("connect: %w", err)
	}

	return session, nil, nil
}

func mcpToolHandler(session *mcp.ClientSession, toolName string) func(args map[string]interface{}) (tools.CallToolResult, error) {
	return func(args map[string]interface{}) (tools.CallToolResult, error) {
		ctx, cancel := context.WithTimeout(context.Background(), mcpTimeout)
		defer cancel()

		result, err := session.CallTool(ctx, &mcp.CallToolParams{
			Name:      toolName,
			Arguments: args,
		})
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
