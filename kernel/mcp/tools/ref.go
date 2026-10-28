// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package tools

import (
	"fmt"
	"strings"

	"github.com/siyuan-note/siyuan/kernel/model"
)

var RefTool = &Tool{
	Name:        "ref",
	Description: "Reference/backlink operations. Actions: backlinks(id, keyword?, sort?), mentions(id, keyword?, sort?), refresh(id).",
	InputSchema: ToolSchema{
		Type: "object",
		Properties: map[string]Property{
			"action":  {Type: "string", Description: "Operation", Enum: []string{"backlinks", "mentions", "refresh"}},
			"id":      {Type: "string", Description: "Block ID"},
			"keyword": {Type: "string", Description: "Filter by keyword"},
			"sort":    {Type: "number", Description: "Sort mode for backlinks and mentions: 0=updated-desc 1=updated-asc 2=created-desc 3=created-asc 4=name-desc 5=name-asc 6=alphanum-desc 7=alphanum-asc (default 0)"},
		},
		Required: []string{"action", "id"},
	},
	Handler: refHandler,
}

func init() {
	register(RefTool)
}

func refHandler(args map[string]any) (CallToolResult, error) {
	action, _ := args["action"].(string)
	switch action {
	case "backlinks":
		return refBacklinks(args)
	case "mentions":
		return refMentions(args)
	case "refresh":
		return refRefresh(args)
	}
	return CallToolResult{
		Content: []ContentItem{{Type: "text", Text: "unknown action '" + action + "', expected one of: [backlinks, mentions, refresh]"}},
		IsError: true,
	}, nil
}

func refBacklinks(args map[string]any) (CallToolResult, error) {
	id, _ := args["id"].(string)
	keyword, _ := args["keyword"].(string)
	sortMode := 0
	if v, ok := args["sort"].(float64); ok {
		sortMode = int(v)
	}

	_, backlinks, _, _, _ := model.GetBacklink2(id, keyword, "", sortMode, 0, model.Conf.Editor.Load().BacklinkContainChildren)
	if len(backlinks) == 0 {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "no backlinks found"}}}, nil
	}

	var sb strings.Builder
	fmt.Fprintf(&sb, "Backlinks (%d):\n\n", len(backlinks))
	for _, p := range backlinks {
		fmt.Fprintf(&sb, "- [%s] %s (id: %s)\n", p.NodeType, p.HPath, p.ID)
	}
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: sb.String()}}}, nil
}

func refMentions(args map[string]any) (CallToolResult, error) {
	id, _ := args["id"].(string)
	keyword, _ := args["keyword"].(string)
	sortMode := 0
	if v, ok := args["sort"].(float64); ok {
		sortMode = int(v)
	}

	_, _, mentions, _, _ := model.GetBacklink2(id, "", keyword, 0, sortMode, model.Conf.Editor.Load().BacklinkContainChildren)
	if len(mentions) == 0 {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "no mentions found"}}}, nil
	}

	var sb strings.Builder
	fmt.Fprintf(&sb, "Mentions (%d):\n\n", len(mentions))
	for _, p := range mentions {
		fmt.Fprintf(&sb, "- [%s] %s (id: %s)\n", p.NodeType, p.HPath, p.ID)
	}
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: sb.String()}}}, nil
}

func refRefresh(args map[string]any) (CallToolResult, error) {
	id, _ := args["id"].(string)
	model.RefreshBacklink(id)
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: "backlink refreshed for: " + id}}}, nil
}
