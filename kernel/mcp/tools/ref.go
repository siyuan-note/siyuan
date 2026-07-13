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

	_, backlinks, _, _, _ := model.GetBacklink2(id, keyword, "", sortMode, 0, model.Conf.Editor.BacklinkContainChildren)
	if len(backlinks) == 0 {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "no backlinks found"}}}, nil
	}

	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("Backlinks (%d):\n\n", len(backlinks)))
	for _, p := range backlinks {
		sb.WriteString(fmt.Sprintf("- [%s] %s (id: %s)\n", p.NodeType, p.HPath, p.ID))
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

	_, _, mentions, _, _ := model.GetBacklink2(id, "", keyword, 0, sortMode, model.Conf.Editor.BacklinkContainChildren)
	if len(mentions) == 0 {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "no mentions found"}}}, nil
	}

	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("Mentions (%d):\n\n", len(mentions)))
	for _, p := range mentions {
		sb.WriteString(fmt.Sprintf("- [%s] %s (id: %s)\n", p.NodeType, p.HPath, p.ID))
	}
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: sb.String()}}}, nil
}

func refRefresh(args map[string]any) (CallToolResult, error) {
	id, _ := args["id"].(string)
	model.RefreshBacklink(id)
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: "backlink refreshed for: " + id}}}, nil
}
