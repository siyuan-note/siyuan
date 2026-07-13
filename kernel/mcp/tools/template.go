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
	"os"
	"path/filepath"
	"strings"

	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var TemplateTool = &Tool{
	Name:        "template",
	Description: "Template management. Actions: search(keyword?), get(path), remove(path), render(path, id), save_as(id, name, overwrite?), create(name, content, overwrite?).",
	InputSchema: ToolSchema{
		Type: "object",
		Properties: map[string]Property{
			"action":    {Type: "string", Description: "Operation", Enum: []string{"search", "get", "remove", "render", "save_as", "create"}},
			"keyword":   {Type: "string", Description: "Search keyword; empty lists all (for search)"},
			"path":      {Type: "string", Description: "Template file path as returned by search (for get, remove, render)"},
			"id":        {Type: "string", Description: "Block ID (for render, save_as)"},
			"name":      {Type: "string", Description: "Template name without extension (for save_as, create)"},
			"content":   {Type: "string", Description: "Markdown content (for create)"},
			"overwrite": {Type: "boolean", Description: "Overwrite if exists (for save_as, create, default false)"},
		},
		Required: []string{"action"},
	},
	Handler: templateHandler,
}

func init() {
	register(TemplateTool)
}

func templateHandler(args map[string]any) (CallToolResult, error) {
	action, _ := args["action"].(string)
	switch action {
	case "search":
		return templateSearch(args)
	case "get":
		return templateGet(args)
	case "remove":
		return templateRemove(args)
	case "render":
		return templateRender(args)
	case "save_as":
		return templateSaveAs(args)
	case "create":
		return templateCreate(args)
	}
	return CallToolResult{
		Content: []ContentItem{{Type: "text", Text: "unknown action '" + action + "', expected one of: [search, get, remove, render, save_as, create]"}},
		IsError: true,
	}, nil
}

func templateSearch(args map[string]any) (CallToolResult, error) {
	keyword, _ := args["keyword"].(string)
	results := model.SearchTemplate(keyword)
	if len(results) == 0 {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "no templates found"}}}, nil
	}

	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("Templates (%d):\n\n", len(results)))
	for _, r := range results {
		sb.WriteString(fmt.Sprintf("- %s\n", r.Content))
		sb.WriteString(fmt.Sprintf("  path: %s\n", r.Path))
	}
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: sb.String()}}}, nil
}

func resolveTemplatePath(p string) (string, error) {
	if p == "" {
		return "", fmt.Errorf("path is required")
	}
	abs := p
	if !filepath.IsAbs(abs) {
		abs = filepath.Join(util.DataDir, "templates", p)
	}
	abs = filepath.Clean(abs)
	templatesBase := filepath.Clean(filepath.Join(util.DataDir, "templates"))
	rel, err := filepath.Rel(templatesBase, abs)
	if err != nil || strings.HasPrefix(rel, "..") || rel == ".." {
		return "", fmt.Errorf("path escapes templates dir: %s", p)
	}
	return abs, nil
}

func templateGet(args map[string]any) (CallToolResult, error) {
	p, _ := args["path"].(string)
	abs, err := resolveTemplatePath(p)
	if err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: err.Error()}}, IsError: true}, nil
	}
	data, err := os.ReadFile(abs)
	if err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "read template failed: " + err.Error()}}, IsError: true}, nil
	}
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: string(data)}}}, nil
}

func templateRemove(args map[string]any) (CallToolResult, error) {
	p, _ := args["path"].(string)
	abs, err := resolveTemplatePath(p)
	if err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: err.Error()}}, IsError: true}, nil
	}
	if err := model.RemoveTemplate(abs); err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "remove template failed: " + err.Error()}}, IsError: true}, nil
	}
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: "template removed: " + p}}}, nil
}

func templateRender(args map[string]any) (CallToolResult, error) {
	p, _ := args["path"].(string)
	id, _ := args["id"].(string)
	if id == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "id is required"}}, IsError: true}, nil
	}
	abs, err := resolveTemplatePath(p)
	if err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: err.Error()}}, IsError: true}, nil
	}

	_, dom, err := model.RenderTemplate(abs, id, true)
	if err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "render template failed: " + err.Error()}}, IsError: true}, nil
	}
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: dom}}}, nil
}

func templateSaveAs(args map[string]any) (CallToolResult, error) {
	id, _ := args["id"].(string)
	name, _ := args["name"].(string)
	if id == "" || name == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "id and name are required"}}, IsError: true}, nil
	}
	overwrite, _ := args["overwrite"].(bool)

	code, err := model.DocSaveAsTemplate(id, name, overwrite)
	if err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "save as template failed: " + err.Error()}}, IsError: true}, nil
	}
	if code == 1 {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "template already exists, set overwrite=true to replace: " + name}}, IsError: true}, nil
	}
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: "template saved: " + name + ".md"}}}, nil
}

func templateCreate(args map[string]any) (CallToolResult, error) {
	name, _ := args["name"].(string)
	content, _ := args["content"].(string)
	if name == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "name is required"}}, IsError: true}, nil
	}
	overwrite, _ := args["overwrite"].(bool)

	code, err := model.CreateTemplate(name, content, overwrite)
	if err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "create template failed: " + err.Error()}}, IsError: true}, nil
	}
	if code == 1 {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "template already exists, set overwrite=true to replace: " + name}}, IsError: true}, nil
	}
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: "template created: " + name + ".md"}}}, nil
}
