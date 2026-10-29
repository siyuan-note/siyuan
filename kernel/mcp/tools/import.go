// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package tools

import (
	"path/filepath"

	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var ImportTool = &Tool{
	Name:        "import",
	Description: "Import operations (absolute local paths). Actions: md(notebook, path, targetPath?), sy(notebook, path, targetPath?) — .sy.zip, data(path) — full backup zip.",
	InputSchema: ToolSchema{
		Type: "object",
		Properties: map[string]Property{
			"action":     {Type: "string", Description: "Operation", Enum: []string{"md", "sy", "data"}},
			"notebook":   {Type: "string", Description: "Notebook ID (for md, sy)"},
			"path":       {Type: "string", Description: "Absolute local file path"},
			"targetPath": {Type: "string", Description: "Target internal filesystem path (for md, sy; default /). This is the ID-based path like /2022...ws.sy, not hPath."},
		},
		Required: []string{"action"},
	},
	Handler: importHandler,
}

func init() {
	register(ImportTool)
}

func importHandler(args map[string]any) (CallToolResult, error) {
	action, _ := args["action"].(string)
	switch action {
	case "md":
		return importMd(args)
	case "sy":
		return importSy(args)
	case "data":
		return importData(args)
	}
	return CallToolResult{
		Content: []ContentItem{{Type: "text", Text: "unknown action '" + action + "', expected one of: [md, sy, data]"}},
		IsError: true,
	}, nil
}

func importMd(args map[string]any) (CallToolResult, error) {
	notebook, _ := args["notebook"].(string)
	filePath, _ := args["path"].(string)
	if filePath == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "path is required"}}, IsError: true}, nil
	}
	if notebook == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "notebook is required"}}, IsError: true}, nil
	}
	absPath, err := filepath.Abs(filePath)
	if err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "resolve path failed: " + err.Error()}}, IsError: true}, nil
	}
	targetPath, _ := args["targetPath"].(string)
	if targetPath == "" {
		targetPath = "/"
	}
	if err := model.ImportFromLocalPath(notebook, absPath, targetPath); err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "import md failed: " + err.Error()}}, IsError: true}, nil
	}
	util.PushReloadFiletree()
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: "markdown imported to notebook " + notebook}}}, nil
}

func importSy(args map[string]any) (CallToolResult, error) {
	notebook, _ := args["notebook"].(string)
	filePath, _ := args["path"].(string)
	if filePath == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "path is required"}}, IsError: true}, nil
	}
	if notebook == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "notebook is required"}}, IsError: true}, nil
	}
	absPath, err := filepath.Abs(filePath)
	if err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "resolve path failed: " + err.Error()}}, IsError: true}, nil
	}
	targetPath, _ := args["targetPath"].(string)
	if targetPath == "" {
		targetPath = "/"
	}
	if err := model.ImportSY(absPath, notebook, targetPath); err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "import sy failed: " + err.Error()}}, IsError: true}, nil
	}
	util.PushReloadFiletree()
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: "sy archive imported to notebook " + notebook}}}, nil
}

func importData(args map[string]any) (CallToolResult, error) {
	filePath, _ := args["path"].(string)
	if filePath == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "path is required"}}, IsError: true}, nil
	}
	absPath, err := filepath.Abs(filePath)
	if err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "resolve path failed: " + err.Error()}}, IsError: true}, nil
	}
	if err := model.ImportData(absPath); err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "import data failed: " + err.Error()}}, IsError: true}, nil
	}
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: "data backup imported"}}}, nil
}
