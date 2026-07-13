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

package tools

import (
	"fmt"
	"strings"

	"github.com/siyuan-note/siyuan/kernel/model"
)

var TodoWriteTool = &Tool{
	Name:        "todo_write",
	Description: "Maintain a session task list (each call replaces the list). todos[]: each {content, status: pending|in_progress|completed|cancelled}.",
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

	todos := make([]model.AgentTodoItem, 0, len(items))
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
		todos = append(todos, model.AgentTodoItem{Content: content, Status: status})
	}

	// Save todos for this session
	if err := model.SaveAgentTodos(args["_sessionID"].(string), todos); err != nil {
		return CallToolResult{
			Content: []ContentItem{{Type: "text", Text: "todo_write error: " + err.Error()}},
			IsError: true,
		}, nil
	}

	result := formatTodoResult(todos)
	return CallToolResult{
		Content: []ContentItem{{Type: "text", Text: result}},
	}, nil
}

func formatTodoResult(todos []model.AgentTodoItem) string {
	if len(todos) == 0 {
		return "Todo list is empty."
	}

	var sb strings.Builder
	sb.WriteString("Todo List\n\n")
	for _, t := range todos {
		switch t.Status {
		case "completed":
			sb.WriteString(fmt.Sprintf("- [x] %s\n", t.Content))
		case "in_progress":
			sb.WriteString(fmt.Sprintf("- [/] %s\n", t.Content))
		case "cancelled":
			sb.WriteString(fmt.Sprintf("- [-] %s\n", t.Content))
		default:
			sb.WriteString(fmt.Sprintf("- [ ] %s\n", t.Content))
		}
	}
	return sb.String()
}
