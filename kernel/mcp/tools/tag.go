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

var TagTool = &Tool{
	Name:        "tag",
	Description: "Tag management. Actions: list(keyword?), rename(old, new), remove(label).",
	InputSchema: ToolSchema{
		Type: "object",
		Properties: map[string]Property{
			"action":  {Type: "string", Description: "Operation", Enum: []string{"list", "rename", "remove"}},
			"keyword": {Type: "string", Description: "Search keyword (for list)"},
			"old":     {Type: "string", Description: "Old tag label (for rename)"},
			"new":     {Type: "string", Description: "New tag label (for rename)"},
			"label":   {Type: "string", Description: "Tag label (for remove)"},
		},
		Required: []string{"action"},
	},
	Handler: tagHandler,
}

func init() {
	register(TagTool)
}

func tagHandler(args map[string]any) (CallToolResult, error) {
	action, _ := args["action"].(string)
	switch action {
	case "list":
		return tagList(args)
	case "rename":
		return tagRename(args)
	case "remove":
		return tagRemove(args)
	}
	return CallToolResult{
		Content: []ContentItem{{Type: "text", Text: "unknown action '" + action + "', expected one of: [list, rename, remove]"}},
		IsError: true,
	}, nil
}

func tagList(args map[string]any) (CallToolResult, error) {
	keyword, _ := args["keyword"].(string)
	tags := model.SearchTags(keyword)

	if len(tags) == 0 {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "no tags found"}}}, nil
	}

	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("Tags (%d):\n\n", len(tags)))
	for _, t := range tags {
		sb.WriteString(fmt.Sprintf("- #%s\n", t))
	}
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: sb.String()}}}, nil
}

func tagRename(args map[string]any) (CallToolResult, error) {
	oldLabel, _ := args["old"].(string)
	newLabel, _ := args["new"].(string)
	if oldLabel == "" || newLabel == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "old and new are required"}}, IsError: true}, nil
	}

	if err := model.RenameTag(oldLabel, newLabel); err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "rename tag failed: " + err.Error()}}, IsError: true}, nil
	}

	return CallToolResult{Content: []ContentItem{{Type: "text", Text: "tag renamed: #" + oldLabel + " -> #" + newLabel}}}, nil
}

func tagRemove(args map[string]any) (CallToolResult, error) {
	label, _ := args["label"].(string)
	if label == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "label is required"}}, IsError: true}, nil
	}

	if err := model.RemoveTag(label); err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "remove tag failed: " + err.Error()}}, IsError: true}, nil
	}

	return CallToolResult{Content: []ContentItem{{Type: "text", Text: "tag removed: #" + label}}}, nil
}
