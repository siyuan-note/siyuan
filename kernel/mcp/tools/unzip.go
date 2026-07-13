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

	"github.com/88250/gulu"
)

// UnzipTool 提供工作区内 zip 文件解压能力。
// zipPath 和 destPath 均为工作区相对路径，通过 resolvePath 校验防逃逸。
// 解压是写操作，自动触发 UI 确认和仓库快照（不在 safeActions 中）。
var UnzipTool = &Tool{
	Name:        "unzip",
	Description: "Extract a zip archive within the workspace. Provide the workspace-relative path to the zip file and the destination directory (also workspace-relative). The destination will be created if it does not exist.",
	InputSchema: ToolSchema{
		Type: "object",
		Properties: map[string]Property{
			"zipPath": {
				Type:        "string",
				Description: "Workspace-relative path to the .zip file to extract.",
			},
			"destPath": {
				Type:        "string",
				Description: "Workspace-relative destination directory to extract into.",
			},
		},
		Required: []string{"zipPath", "destPath"},
	},
	Handler: unzipHandler,
}

func init() {
	register(UnzipTool)
}

func unzipHandler(args map[string]any) (CallToolResult, error) {
	zipPath, _ := args["zipPath"].(string)
	destPath, _ := args["destPath"].(string)
	if zipPath == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "zipPath is required"}}, IsError: true}, nil
	}
	if destPath == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "destPath is required"}}, IsError: true}, nil
	}

	// 解析并校验路径在工作区内（防逃逸），复用 file 工具的 resolvePath。
	zipAbs, err := resolvePath(zipPath)
	if err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "invalid zipPath: " + err.Error()}}, IsError: true}, nil
	}
	destAbs, err := resolvePath(destPath)
	if err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "invalid destPath: " + err.Error()}}, IsError: true}, nil
	}

	// 检查 zip 文件存在。
	if !gulu.File.IsExist(zipAbs) {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "zip file not found: " + zipPath}}, IsError: true}, nil
	}

	// 解压（gulu.Zip.Unzip 是内核统一使用的解压 API，与 /api/archive/unzip 一致）。
	if err := gulu.Zip.Unzip(zipAbs, destAbs); err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "unzip failed: " + err.Error()}}, IsError: true}, nil
	}

	return CallToolResult{
		Content: []ContentItem{{Type: "text", Text: fmt.Sprintf("Extracted %s to %s", zipPath, destPath)}},
	}, nil
}
