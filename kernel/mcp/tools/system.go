// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package tools

import (
	"fmt"
	"time"

	"github.com/siyuan-note/siyuan/kernel/util"
)

var SystemTool = &Tool{
	Name:        "system",
	Description: "System info. Actions: version(), current_time(), workspace().",
	InputSchema: ToolSchema{
		Type: "object",
		Properties: map[string]Property{
			"action": {Type: "string", Description: "Operation", Enum: []string{"version", "current_time", "workspace"}},
		},
		Required: []string{"action"},
	},
	Handler: systemHandler,
}

func init() {
	register(SystemTool)
}

func systemHandler(args map[string]any) (CallToolResult, error) {
	action, _ := args["action"].(string)
	switch action {
	case "version":
		return systemVersion(args)
	case "current_time":
		return systemCurrentTime(args)
	case "workspace":
		return systemWorkspace(args)
	}
	return CallToolResult{
		Content: []ContentItem{{Type: "text", Text: "unknown action '" + action + "', expected one of: [version, current_time, workspace]"}},
		IsError: true,
	}, nil
}

func systemVersion(_ map[string]any) (CallToolResult, error) {
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: util.Ver}}}, nil
}

func systemCurrentTime(_ map[string]any) (CallToolResult, error) {
	ms := util.CurrentTimeMillis()
	t := time.UnixMilli(ms)
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: t.Format(time.RFC3339)}}}, nil
}

func systemWorkspace(_ map[string]any) (CallToolResult, error) {
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: fmt.Sprintf("Workspace: %s\nVersion: %s\nContainer: %s", util.WorkspaceDir, util.Ver, util.Container)}}}, nil
}
