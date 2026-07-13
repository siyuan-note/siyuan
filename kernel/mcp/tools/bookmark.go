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

var BookmarkTool = &Tool{
	Name:        "bookmark",
	Description: "Bookmark management. Actions: list(), labels(), remove(label), rename(old, new).",
	InputSchema: ToolSchema{
		Type: "object",
		Properties: map[string]Property{
			"action": {Type: "string", Description: "Operation", Enum: []string{"list", "labels", "remove", "rename"}},
			"label":  {Type: "string", Description: "Bookmark label (for remove)"},
			"old":    {Type: "string", Description: "Old label (for rename)"},
			"new":    {Type: "string", Description: "New label (for rename)"},
		},
		Required: []string{"action"},
	},
	Handler: bookmarkHandler,
}

func init() {
	register(BookmarkTool)
}

func bookmarkHandler(args map[string]any) (CallToolResult, error) {
	action, _ := args["action"].(string)
	switch action {
	case "list":
		return bookmarkList(args)
	case "labels":
		return bookmarkLabels(args)
	case "remove":
		return bookmarkRemove(args)
	case "rename":
		return bookmarkRename(args)
	}
	return CallToolResult{
		Content: []ContentItem{{Type: "text", Text: "unknown action '" + action + "', expected one of: [list, labels, remove, rename]"}},
		IsError: true,
	}, nil
}

func bookmarkList(args map[string]any) (CallToolResult, error) {
	bookmarks := model.BuildBookmark()
	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("Bookmarks (%d):\n\n", len(*bookmarks)))
	for _, b := range *bookmarks {
		sb.WriteString(fmt.Sprintf("- %s: %d blocks\n", b.Name, b.Count))
	}
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: sb.String()}}}, nil
}

func bookmarkLabels(args map[string]any) (CallToolResult, error) {
	labels := model.BookmarkLabels()
	if len(labels) == 0 {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "no bookmark labels found"}}}, nil
	}
	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("Bookmark labels (%d):\n\n", len(labels)))
	for _, l := range labels {
		sb.WriteString(fmt.Sprintf("- %s\n", l))
	}
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: sb.String()}}}, nil
}

func bookmarkRemove(args map[string]any) (CallToolResult, error) {
	label, _ := args["label"].(string)
	if label == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "label is required"}}, IsError: true}, nil
	}
	if err := model.RemoveBookmark(label); err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "remove bookmark failed: " + err.Error()}}, IsError: true}, nil
	}
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: "bookmark removed: " + label}}}, nil
}

func bookmarkRename(args map[string]any) (CallToolResult, error) {
	oldLabel, _ := args["old"].(string)
	newLabel, _ := args["new"].(string)
	if oldLabel == "" || newLabel == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "old and new are required"}}, IsError: true}, nil
	}
	if err := model.RenameBookmark(oldLabel, newLabel); err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "rename bookmark failed: " + err.Error()}}, IsError: true}, nil
	}
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: "bookmark renamed: " + oldLabel + " -> " + newLabel}}}, nil
}
