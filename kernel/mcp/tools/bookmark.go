// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

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

func bookmarkList(_ map[string]any) (CallToolResult, error) {
	bookmarks := model.BuildBookmark()
	var sb strings.Builder
	fmt.Fprintf(&sb, "Bookmarks (%d):\n\n", len(*bookmarks))
	for _, b := range *bookmarks {
		fmt.Fprintf(&sb, "- %s: %d blocks\n", b.Name, b.Count)
	}
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: sb.String()}}}, nil
}

func bookmarkLabels(_ map[string]any) (CallToolResult, error) {
	labels := model.BookmarkLabels()
	if len(labels) == 0 {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "no bookmark labels found"}}}, nil
	}
	var sb strings.Builder
	fmt.Fprintf(&sb, "Bookmark labels (%d):\n\n", len(labels))
	for _, l := range labels {
		fmt.Fprintf(&sb, "- %s\n", l)
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
