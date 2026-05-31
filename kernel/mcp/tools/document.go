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

var DocumentTool = &Tool{
	Name:        "document",
	Description: "Document operations for SiYuan notebooks.\n- get: Get document content by ID. Requires: id.\n- create: Create a new document. Requires: notebook, title, path (e.g. /folder/doc). Optional: markdown.\n- list: List documents in a notebook path. Requires: notebook. Optional: path (default /).\n- delete: Delete a document by ID. Requires: id.\n- rename: Rename a document by ID. Requires: id, title.",
	InputSchema: ToolSchema{
		Type: "object",
		Properties: map[string]Property{
			"action":   {Type: "string", Description: "Operation", Enum: []string{"get", "create", "list", "delete", "rename"}},
			"id":       {Type: "string", Description: "Document block ID"},
			"notebook": {Type: "string", Description: "Notebook ID (required for create, list)"},
			"title":    {Type: "string", Description: "Document title (for create, rename)"},
			"path":     {Type: "string", Description: "Document path like /folder/doc (for create, list)"},
			"markdown": {Type: "string", Description: "Initial markdown content (for create)"},
		},
		Required: []string{"action"},
	},
	Handler: documentHandler,
}

func init() {
	register(DocumentTool)
}

func documentHandler(args map[string]interface{}) (CallToolResult, error) {
	action, _ := args["action"].(string)
	switch action {
	case "get":
		return documentGet(args)
	case "create":
		return documentCreate(args)
	case "list":
		return documentList(args)
	case "delete":
		return documentDelete(args)
	case "rename":
		return documentRename(args)
	}
	return CallToolResult{
		Content: []ContentItem{{Type: "text", Text: "unknown action: " + action}},
		IsError: true,
	}, nil
}

func documentGet(args map[string]interface{}) (CallToolResult, error) {
	id, _ := args["id"].(string)
	if id == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "id is required"}}, IsError: true}, nil
	}

	tree, err := model.LoadTreeByBlockID(id)
	if err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: fmt.Sprintf("load doc failed: %s", err)}}, IsError: true}, nil
	}

	b, _ := model.GetBlock(id, tree)
	if b == nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "document not found: " + id}}, IsError: true}, nil
	}

	return CallToolResult{Content: []ContentItem{{Type: "text", Text: fmt.Sprintf(
		"ID: %s\nTitle: %s\nHPath: %s\nBox: %s\nContent: %s\nMarkdown: %s\nType: %s\nCreated: %s\nUpdated: %s",
		b.ID, b.Name, b.HPath, b.Box, b.Content, b.Markdown, b.Type, b.Created, b.Updated,
	)}}}, nil
}

func documentCreate(args map[string]interface{}) (CallToolResult, error) {
	notebook, _ := args["notebook"].(string)
	if notebook == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "notebook is required"}}, IsError: true}, nil
	}
	path, _ := args["path"].(string)
	if path == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "path is required"}}, IsError: true}, nil
	}
	markdown, _ := args["markdown"].(string)
	title, _ := args["title"].(string)
	if title == "" {
		title = path
		if strings.Contains(title, "/") {
			parts := strings.Split(strings.TrimRight(title, "/"), "/")
			title = parts[len(parts)-1]
		}
	}

	tree, err := model.CreateDocByMd(notebook, path, title, markdown, nil, nil)
	if err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: fmt.Sprintf("create doc failed: %s", err)}}, IsError: true}, nil
	}

	return CallToolResult{Content: []ContentItem{{Type: "text", Text: fmt.Sprintf("document created: %s (path: %s)", tree.Root.ID, path)}}}, nil
}

func documentList(args map[string]interface{}) (CallToolResult, error) {
	notebook, _ := args["notebook"].(string)
	if notebook == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "notebook is required"}}, IsError: true}, nil
	}
	path, _ := args["path"].(string)
	if path == "" {
		path = "/"
	}

	files, _, err := model.ListDocTree(notebook, path, 0, false, false, 128)
	if err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: fmt.Sprintf("list docs failed: %s", err)}}, IsError: true}, nil
	}

	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("Documents in %s%s:\n\n", notebook, path))
	for _, f := range files {
		sb.WriteString(fmt.Sprintf("- %s (id: %s, path: %s)\n", f.Name, f.ID, f.Path))
	}
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: sb.String()}}}, nil
}

func documentDelete(args map[string]interface{}) (CallToolResult, error) {
	id, _ := args["id"].(string)
	if id == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "id is required"}}, IsError: true}, nil
	}

	tree, err := model.LoadTreeByBlockID(id)
	if err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: fmt.Sprintf("load doc failed: %s", err)}}, IsError: true}, nil
	}

	model.RemoveDoc(tree.Box, tree.Path)
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: "document deleted: " + id}}}, nil
}

func documentRename(args map[string]interface{}) (CallToolResult, error) {
	id, _ := args["id"].(string)
	title, _ := args["title"].(string)
	if id == "" || title == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "id and title are required"}}, IsError: true}, nil
	}

	tree, err := model.LoadTreeByBlockID(id)
	if err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: fmt.Sprintf("load doc failed: %s", err)}}, IsError: true}, nil
	}

	if err := model.RenameDoc(tree.Box, tree.Path, title); err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: fmt.Sprintf("rename doc failed: %s", err)}}, IsError: true}, nil
	}

	return CallToolResult{Content: []ContentItem{{Type: "text", Text: fmt.Sprintf("document renamed: %s -> %s", id, title)}}}, nil
}
