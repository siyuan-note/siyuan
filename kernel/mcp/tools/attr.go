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
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var AttrTool = &Tool{
	Name:        "attr",
	Description: "Block custom-attribute operations. Actions: get(id), set(id, attrs object), batch-get(ids comma-separated).",
	InputSchema: ToolSchema{
		Type: "object",
		Properties: map[string]Property{
			"action": {Type: "string", Description: "Operation", Enum: []string{"get", "set", "batch-get"}},
			"id":     {Type: "string", Description: "Block ID"},
			"ids":    {Type: "string", Description: "Comma-separated block IDs (for batch-get)"},
			"attrs":  {Type: "object", Description: "Attribute key-value pairs (for set).\nCommon attributes:\n- icon: emoji hex codepoint like \"1f4ca\", emoji character like \"📊\", custom image path like \"1/b3log.png\", or dynamic icon URL like \"api/icon/getDynamicIcon?type=8&color=%23d23f31&content=SiYuan&id=xxx\"\n- title-img: CSS format like 'background-image:url(\"assets/example.jpg\")', NOT a bare asset path\n- tags: comma-separated tag names"},
		},
		Required: []string{"action"},
	},
	Handler: attrHandler,
}

func init() {
	register(AttrTool)
}

func attrHandler(args map[string]any) (CallToolResult, error) {
	action, _ := args["action"].(string)
	switch action {
	case "get":
		return attrGet(args)
	case "set":
		return attrSet(args)
	case "batch-get":
		return attrBatchGet(args)
	}
	return CallToolResult{
		Content: []ContentItem{{Type: "text", Text: "unknown action '" + action + "', expected one of: [get, set, batch-get]"}},
		IsError: true,
	}, nil
}

func attrGet(args map[string]any) (CallToolResult, error) {
	id, _ := args["id"].(string)
	if id == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "id is required"}}, IsError: true}, nil
	}

	attrs := sql.GetBlockAttrs(id)
	if len(attrs) == 0 {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "no custom attributes"}}}, nil
	}

	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("Attributes for %s:\n\n", id))
	for k, v := range attrs {
		sb.WriteString(fmt.Sprintf("- %s: %s\n", k, v))
	}
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: sb.String()}}}, nil
}

func attrSet(args map[string]any) (CallToolResult, error) {
	id, _ := args["id"].(string)
	if id == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "id is required"}}, IsError: true}, nil
	}

	attrsArg, ok := args["attrs"].(map[string]any)
	if !ok || len(attrsArg) == 0 {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "attrs (key-value object) is required"}}, IsError: true}, nil
	}

	nameValues := make(map[string]string, len(attrsArg))
	for k, v := range attrsArg {
		nameValues[k] = fmt.Sprintf("%v", v)
	}

	if err := model.SetBlockAttrs(id, nameValues); err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "set attrs failed: " + err.Error()}}, IsError: true}, nil
	}

	util.PushReloadFiletree()
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: "attributes set for: " + id}}}, nil
}

func attrBatchGet(args map[string]any) (CallToolResult, error) {
	idsStr, _ := args["ids"].(string)
	if idsStr == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "ids (comma-separated) is required"}}, IsError: true}, nil
	}
	idList := strings.Split(idsStr, ",")
	for i := range idList {
		idList[i] = strings.TrimSpace(idList[i])
	}

	attrs := sql.BatchGetBlockAttrs(idList)
	if len(attrs) == 0 {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "no attributes found"}}}, nil
	}

	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("Batch attributes (%d blocks):\n\n", len(attrs)))
	for id, kv := range attrs {
		sb.WriteString(fmt.Sprintf("--- %s ---\n", id))
		for k, v := range kv {
			sb.WriteString(fmt.Sprintf("- %s: %s\n", k, v))
		}
	}
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: sb.String()}}}, nil
}
