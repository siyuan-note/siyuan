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

	"github.com/siyuan-note/siyuan/kernel/util"
)

var WorkspaceTool = &Tool{
	Name:        "workspace",
	Description: "Workspace management. Actions: list(), info() (path, version, valid).",
	InputSchema: ToolSchema{
		Type: "object",
		Properties: map[string]Property{
			"action": {Type: "string", Description: "Operation", Enum: []string{"list", "info"}},
		},
		Required: []string{"action"},
	},
	Handler: workspaceHandler,
}

func init() {
	register(WorkspaceTool)
}

func workspaceHandler(args map[string]any) (CallToolResult, error) {
	action, _ := args["action"].(string)
	switch action {
	case "list":
		return workspaceList(args)
	case "info":
		return workspaceInfo(args)
	}
	return CallToolResult{
		Content: []ContentItem{{Type: "text", Text: "unknown action '" + action + "', expected one of: [list, info]"}},
		IsError: true,
	}, nil
}

func workspaceList(args map[string]any) (CallToolResult, error) {
	paths, err := util.ReadWorkspacePaths()
	if err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "list workspaces failed: " + err.Error()}}, IsError: true}, nil
	}

	var sb strings.Builder
	seen := map[string]bool{}
	sb.WriteString(fmt.Sprintf("Registered workspaces (%d):\n\n", len(paths)))
	for _, p := range paths {
		key := strings.ToLower(p)
		if seen[key] {
			continue
		}
		seen[key] = true
		sb.WriteString(fmt.Sprintf("- %s\n", p))
	}
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: sb.String()}}}, nil
}

func workspaceInfo(args map[string]any) (CallToolResult, error) {
	dir := util.WorkspaceDir
	sb := strings.Builder{}
	sb.WriteString(fmt.Sprintf("Path:    %s\n", dir))
	sb.WriteString(fmt.Sprintf("Version: %s\n", util.Ver))
	sb.WriteString(fmt.Sprintf("Valid:   %v\n", util.IsWorkspaceDir(dir)))
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: sb.String()}}}, nil
}
