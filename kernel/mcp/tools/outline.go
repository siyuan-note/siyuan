// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package tools

import (
	"fmt"
	"strings"

	"github.com/siyuan-note/siyuan/kernel/model"
)

var OutlineTool = &Tool{
	Name:        "outline",
	Description: "Document outline (heading tree). Action: get(id).",
	InputSchema: ToolSchema{
		Type: "object",
		Properties: map[string]Property{
			"action": {Type: "string", Description: "Operation", Enum: []string{"get"}},
			"id":     {Type: "string", Description: "Document block ID"},
		},
		Required: []string{"action", "id"},
	},
	Handler: outlineHandler,
}

func init() {
	register(OutlineTool)
}

func outlineHandler(args map[string]any) (CallToolResult, error) {
	action, _ := args["action"].(string)
	switch action {
	case "get":
		return outlineGet(args)
	}
	return CallToolResult{
		Content: []ContentItem{{Type: "text", Text: "unknown action '" + action + "', expected one of: [get]"}},
		IsError: true,
	}, nil
}

func outlineGet(args map[string]any) (CallToolResult, error) {
	id, _ := args["id"].(string)
	if id == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "id is required"}}, IsError: true}, nil
	}

	paths, err := model.Outline(id, false)
	if err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "outline failed: " + err.Error()}}, IsError: true}, nil
	}

	if len(paths) == 0 {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "document not found or has no headings"}}, IsError: true}, nil
	}

	var sb strings.Builder
	fmt.Fprintf(&sb, "Document outline (%d headings):\n\n", countHeadings(paths))
	for _, p := range paths {
		writePaths(&sb, p, 0)
	}

	return CallToolResult{Content: []ContentItem{{Type: "text", Text: sb.String()}}}, nil
}

func countHeadings(paths []*model.Path) int {
	n := 0
	for _, p := range paths {
		n++
		for _, b := range p.Blocks {
			n++
			n += countBlockChildren(b)
		}
		n += countHeadings(p.Children)
	}
	return n
}

func countBlockChildren(b *model.Block) int {
	n := 0
	for _, c := range b.Children {
		n++
		n += countBlockChildren(c)
	}
	return n
}

func writePaths(sb *strings.Builder, p *model.Path, depth int) {
	prefix := strings.Repeat("  ", depth)
	fmt.Fprintf(sb, "%s- [%s] (id: %s, depth: %d)\n", prefix, p.Name, p.ID, p.Depth)
	for _, b := range p.Blocks {
		writeBlock(sb, b, depth+1)
	}
	for _, c := range p.Children {
		writePaths(sb, c, depth+1)
	}
}

func writeBlock(sb *strings.Builder, b *model.Block, depth int) {
	prefix := strings.Repeat("  ", depth)
	fmt.Fprintf(sb, "%s- [%s] (id: %s, depth: %d)\n", prefix, b.Content, b.ID, b.Depth)
	for _, c := range b.Children {
		writeBlock(sb, c, depth+1)
	}
}
