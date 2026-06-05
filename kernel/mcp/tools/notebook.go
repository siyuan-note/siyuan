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

var NotebookTool = &Tool{
	Name:        "notebook",
	Description: "Notebook management for SiYuan.\n- list: List all notebooks.\n- create: Create a notebook. Requires: name.\n- rename: Rename a notebook. Requires: id, name.\n- remove: Remove a notebook. Requires: id.",
	InputSchema: ToolSchema{
		Type: "object",
		Properties: map[string]Property{
			"action": {Type: "string", Description: "Operation", Enum: []string{"list", "create", "rename", "remove"}},
			"id":     {Type: "string", Description: "Notebook ID (for rename, remove)"},
			"name":   {Type: "string", Description: "Notebook name (for create, rename)"},
		},
		Required: []string{"action"},
	},
	Handler: notebookHandler,
}

func init() {
	register(NotebookTool)
}

func notebookHandler(args map[string]interface{}) (CallToolResult, error) {
	action, _ := args["action"].(string)
	switch action {
	case "list":
		return notebookList(args)
	case "create":
		return notebookCreate(args)
	case "rename":
		return notebookRename(args)
	case "remove":
		return notebookRemove(args)
	}
	return CallToolResult{
		Content: []ContentItem{{Type: "text", Text: "unknown action '" + action + "', expected one of: [list, create, rename, remove]"}},
		IsError: true,
	}, nil
}

func notebookList(args map[string]interface{}) (CallToolResult, error) {
	notebooks, err := model.ListNotebooks()
	if err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "list notebooks failed: " + err.Error()}}, IsError: true}, nil
	}

	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("Notebooks (%d):\n\n", len(notebooks)))
	for _, nb := range notebooks {
		sb.WriteString(fmt.Sprintf("- %s (id: %s, icon: %s, closed: %v)\n", nb.Name, nb.ID, nb.Icon, nb.Closed))
	}
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: sb.String()}}}, nil
}

func notebookCreate(args map[string]interface{}) (CallToolResult, error) {
	name, _ := args["name"].(string)
	if name == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "name is required"}}, IsError: true}, nil
	}

	id, err := model.CreateBox(name)
	if err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "create notebook failed: " + err.Error()}}, IsError: true}, nil
	}

	return CallToolResult{Content: []ContentItem{{Type: "text", Text: "notebook created: " + name + " (id: " + id + ")"}}}, nil
}

func notebookRename(args map[string]interface{}) (CallToolResult, error) {
	id, _ := args["id"].(string)
	name, _ := args["name"].(string)
	if id == "" || name == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "id and name are required"}}, IsError: true}, nil
	}

	if err := model.RenameBox(id, name); err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "rename notebook failed: " + err.Error()}}, IsError: true}, nil
	}

	return CallToolResult{Content: []ContentItem{{Type: "text", Text: "notebook renamed: " + id + " -> " + name}}}, nil
}

func notebookRemove(args map[string]interface{}) (CallToolResult, error) {
	id, _ := args["id"].(string)
	if id == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "id is required"}}, IsError: true}, nil
	}

	if err := model.RemoveBox(id); err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "remove notebook failed: " + err.Error()}}, IsError: true}, nil
	}

	return CallToolResult{Content: []ContentItem{{Type: "text", Text: "notebook removed: " + id}}}, nil
}
