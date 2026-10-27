// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package tools

import (
	"fmt"
	"strings"

	"github.com/88250/lute/ast"
)

var TodoWriteTool = &Tool{
	Name:        "todo_write",
	Description: "Maintain a session task list (each call replaces the list). todos[]: each {content, status: pending|in_progress|completed|cancelled}.",
	AgentOnly:   true,
	InputSchema: ToolSchema{
		Type: "object",
		Properties: map[string]Property{
			"todos": {
				Type: "array", Description: "The updated todo list",
				Items: &Property{
					Type: "object",
					Properties: map[string]Property{
						"content": {Type: "string", Description: "Brief task description"},
						"status":  {Type: "string", Description: "Task status", Enum: []string{"pending", "in_progress", "completed", "cancelled"}},
					},
					Required: []string{"content", "status"},
				},
			},
		},
		Required: []string{"todos"},
	},
	Handler: todoWriteHandler,
}

type agentTodoItem struct {
	Content string
	Status  string
}

func init() {
	register(TodoWriteTool)
}

func todoWriteHandler(args map[string]any) (CallToolResult, error) {
	rawTodos, ok := args["todos"]
	if !ok {
		return CallToolResult{
			Content: []ContentItem{{Type: "text", Text: "todo_write error: missing 'todos' parameter"}},
			IsError: true,
		}, nil
	}

	items, ok := rawTodos.([]any)
	if !ok {
		return CallToolResult{
			Content: []ContentItem{{Type: "text", Text: "todo_write error: 'todos' must be an array"}},
			IsError: true,
		}, nil
	}

	todos := make([]agentTodoItem, 0, len(items))
	for _, item := range items {
		obj, ok := item.(map[string]any)
		if !ok {
			continue
		}
		content, _ := obj["content"].(string)
		status, _ := obj["status"].(string)
		if content == "" {
			continue
		}
		if status != "pending" && status != "in_progress" && status != "completed" && status != "cancelled" {
			status = "pending"
		}
		todos = append(todos, agentTodoItem{Content: content, Status: status})
	}

	sessionID, ok := args["_sessionID"].(string)
	if !ok || sessionID == "" {
		return CallToolResult{
			Content: []ContentItem{{Type: "text", Text: "todo_write error: missing Agent session context"}},
			IsError: true,
		}, nil
	}
	if !ast.IsNodeIDPattern(sessionID) {
		return CallToolResult{
			Content: []ContentItem{{Type: "text", Text: "todo_write error: invalid Agent session ID"}},
			IsError: true,
		}, nil
	}

	result := formatTodoResult(todos)
	return CallToolResult{
		Content: []ContentItem{{Type: "text", Text: result}},
	}, nil
}

// formatTodoResult 生成待办展示内容，由会话工具结果统一持久化与恢复。
func formatTodoResult(todos []agentTodoItem) string {
	if len(todos) == 0 {
		return "Todo list is empty."
	}

	var sb strings.Builder
	sb.WriteString("Todo List\n\n")
	for _, t := range todos {
		switch t.Status {
		case "completed":
			fmt.Fprintf(&sb, "- [x] %s\n", t.Content)
		case "in_progress":
			fmt.Fprintf(&sb, "- [/] %s\n", t.Content)
		case "cancelled":
			fmt.Fprintf(&sb, "- [-] %s\n", t.Content)
		default:
			fmt.Fprintf(&sb, "- [ ] %s\n", t.Content)
		}
	}
	return sb.String()
}
