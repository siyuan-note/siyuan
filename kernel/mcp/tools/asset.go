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

var AssetTool = &Tool{
	Name:        "asset",
	Description: "Asset management. Actions: upload(id, files=comma-separated absolute paths), unused(), clean(path?), stat(path).",
	InputSchema: ToolSchema{
		Type: "object",
		Properties: map[string]Property{
			"action": {Type: "string", Description: "Operation", Enum: []string{"upload", "unused", "clean", "stat"}},
			"id":     {Type: "string", Description: "Document block ID (for upload)"},
			"files":  {Type: "string", Description: "Comma-separated absolute file paths (for upload)"},
			"path":   {Type: "string", Description: "Single unused asset path to remove, relative to data directory (for clean, optional). Use as returned by the unused action, e.g. assets/image/xxx.png."},
		},
		Required: []string{"action"},
	},
	Handler: assetHandler,
}

func init() {
	register(AssetTool)
}

func assetHandler(args map[string]any) (CallToolResult, error) {
	action, _ := args["action"].(string)
	switch action {
	case "upload":
		return assetUpload(args)
	case "unused":
		return assetUnused(args)
	case "clean":
		return assetClean(args)
	case "stat":
		return assetStat(args)
	}
	return CallToolResult{
		Content: []ContentItem{{Type: "text", Text: "unknown action '" + action + "', expected one of: [upload, unused, clean, stat]"}},
		IsError: true,
	}, nil
}

func assetUpload(args map[string]any) (CallToolResult, error) {
	id, _ := args["id"].(string)
	if id == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "id is required"}}, IsError: true}, nil
	}
	filesStr, _ := args["files"].(string)
	if filesStr == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "files is required"}}, IsError: true}, nil
	}
	fileList := strings.Split(filesStr, ",")
	for i, f := range fileList {
		abs, err := filepath.Abs(strings.TrimSpace(f))
		if err != nil {
			return CallToolResult{Content: []ContentItem{{Type: "text", Text: "resolve path failed: " + err.Error()}}, IsError: true}, nil
		}
		fileList[i] = abs
	}

	succMap, err := model.InsertLocalAssets(id, fileList, true)
	if err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "upload assets failed: " + err.Error()}}, IsError: true}, nil
	}

	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("Uploaded %d file(s):\n\n", len(succMap)))
	for k, v := range succMap {
		sb.WriteString(fmt.Sprintf("- %s -> %v\n", k, v))
	}
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: sb.String()}}}, nil
}

func assetUnused(args map[string]any) (CallToolResult, error) {
	items := model.UnusedAssets(true)
	if len(items) == 0 {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "no unused assets found"}}}, nil
	}
	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("Unused assets (%d):\n\n", len(items)))
	for _, item := range items {
		sb.WriteString(fmt.Sprintf("- %s (%s)\n", item.Item, item.Name))
	}
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: sb.String()}}}, nil
}

func assetClean(args map[string]any) (CallToolResult, error) {
	singlePath, _ := args["path"].(string)
	if singlePath != "" {
		ret := model.RemoveUnusedAsset(singlePath)
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: fmt.Sprintf("removed: %v", ret)}}}, nil
	}
	removed := model.RemoveUnusedAssets()
	if len(removed) == 0 {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "no unused assets to clean"}}}, nil
	}
	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("Removed %d asset(s):\n\n", len(removed)))
	for _, p := range removed {
		sb.WriteString(fmt.Sprintf("- %s\n", p))
	}
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: sb.String()}}}, nil
}

func assetStat(args map[string]any) (CallToolResult, error) {
	p, _ := args["path"].(string)
	if p == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "path is required"}}, IsError: true}, nil
	}

	abs := filepath.Join(util.DataDir, p)
	info, err := os.Stat(abs)
	if err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "stat failed: " + err.Error()}}, IsError: true}, nil
	}

	return CallToolResult{Content: []ContentItem{{Type: "text", Text: fmt.Sprintf(
		"Path: %s\nSize: %d\nIsDir: %v\nModTime: %s",
		p, info.Size(), info.IsDir(), info.ModTime().Format("2006-01-02 15:04:05"),
	)}}}, nil
}
