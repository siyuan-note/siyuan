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

	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var BlockTool = &Tool{
	Name:        "block",
	Description: "Block operations for SiYuan.\n- get: Get block info by ID. Requires: id.\n- get_kramdown: Get block kramdown by ID. Requires: id.\n- get_children: Get child blocks by parent ID. Requires: id.\n- tree_stat: Get tree statistics (word count, character count, block count, etc.) by document ID. Requires: id.\n- dom: Get block DOM by ID. Requires: id.\n- insert: Insert a new block. Requires: data, dataType (markdown or dom). Optional: parentID, nextID, previousID.\n- append: Append a child block. Requires: data, dataType, parentID.\n- prepend: Prepend a child block. Requires: data, dataType, parentID.\n- update: Update a block. Requires: id, data, dataType.\n- delete: Delete a block. Requires: id.\n- move: Move a block. Requires: id, parentID. Optional: previousID.\n- breadcrumb: Get block breadcrumb path. Requires: id.",
	InputSchema: ToolSchema{
		Type: "object",
		Properties: map[string]Property{
			"action":     {Type: "string", Description: "Operation", Enum: []string{"get", "get_kramdown", "get_children", "tree_stat", "dom", "insert", "append", "prepend", "update", "delete", "move", "breadcrumb"}},
			"id":         {Type: "string", Description: "Block ID"},
			"data":       {Type: "string", Description: "Content (markdown or dom)"},
			"dataType":   {Type: "string", Description: "Content type: markdown or dom", Enum: []string{"markdown", "dom"}},
			"parentID":   {Type: "string", Description: "Parent block ID"},
			"nextID":     {Type: "string", Description: "Next sibling block ID (for insert)"},
			"previousID": {Type: "string", Description: "Previous sibling block ID (for insert)"},
		},
		Required: []string{"action"},
	},
	Handler: blockHandler,
}

func init() {
	register(BlockTool)
}

func blockHandler(args map[string]interface{}) (CallToolResult, error) {
	action, _ := args["action"].(string)
	switch action {
	case "get":
		return blockGet(args)
	case "get_kramdown":
		return blockGetKramdown(args)
	case "get_children":
		return blockGetChildren(args)
	case "tree_stat":
		return blockTreeStat(args)
	case "dom":
		return blockDom(args)
	case "insert":
		return blockInsert(args)
	case "append":
		return blockAppend(args)
	case "prepend":
		return blockPrepend(args)
	case "update":
		return blockUpdate(args)
	case "delete":
		return blockDelete(args)
	case "move":
		return blockMove(args)
	case "breadcrumb":
		return blockBreadcrumb(args)
	}
	return CallToolResult{
		Content: []ContentItem{{Type: "text", Text: "unknown action '" + action + "', expected one of: [get, get_kramdown, get_children, tree_stat, dom, insert, append, prepend, update, delete, move, breadcrumb]"}},
		IsError: true,
	}, nil
}

func blockGet(args map[string]interface{}) (CallToolResult, error) {
	id, _ := args["id"].(string)
	if id == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "id is required"}}, IsError: true}, nil
	}

	b, err := model.GetBlock(id, nil)
	if err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: fmt.Sprintf("get block failed: %s", err)}}, IsError: true}, nil
	}
	if b == nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "block not found: " + id}}, IsError: true}, nil
	}

	return CallToolResult{Content: []ContentItem{{Type: "text", Text: fmt.Sprintf(
		"ID: %s\nType: %s\nHPath: %s\nContent: %s\nMarkdown: %s\nTags: %s\nCreated: %s\nUpdated: %s",
		b.ID, b.Type, b.HPath, b.Content, b.Markdown, b.Tag, b.Created, b.Updated,
	)}}}, nil
}

func blockGetKramdown(args map[string]interface{}) (CallToolResult, error) {
	id, _ := args["id"].(string)
	if id == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "id is required"}}, IsError: true}, nil
	}

	kramdown := model.GetBlockKramdown(id, "md")
	if kramdown == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "block not found or empty: " + id}}, IsError: true}, nil
	}

	return CallToolResult{Content: []ContentItem{{Type: "text", Text: kramdown}}}, nil
}

func blockGetChildren(args map[string]interface{}) (CallToolResult, error) {
	id, _ := args["id"].(string)
	if id == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "id is required"}}, IsError: true}, nil
	}

	children := model.GetChildBlocks(id)
	if len(children) == 0 {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "no child blocks found"}}}, nil
	}

	var sb strings.Builder
	for _, c := range children {
		content := c.Markdown
		if content == "" {
			content = c.Content
		}
		if len(content) > 200 {
			content = content[:200] + "..."
		}
		sb.WriteString(fmt.Sprintf("- [%s] %s (%s)\n", c.Type, content, c.ID))
	}
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: sb.String()}}}, nil
}

func blockInsert(args map[string]interface{}) (CallToolResult, error) {
	data, dataType := getBlockData(args)
	if data == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "data is required"}}, IsError: true}, nil
	}

	var parentID, previousID, nextID string
	if v, ok := args["parentID"].(string); ok {
		parentID = v
	}
	if v, ok := args["previousID"].(string); ok {
		previousID = v
	}
	if v, ok := args["nextID"].(string); ok {
		nextID = v
	}

	if dataType == "markdown" {
		var err error
		data, err = markdownToBlockDOM(data)
		if err != nil {
			return CallToolResult{Content: []ContentItem{{Type: "text", Text: "convert markdown failed: " + err.Error()}}, IsError: true}, nil
		}
	}

	transactions := []*model.Transaction{{
		DoOperations: []*model.Operation{{
			Action:     "insert",
			Data:       data,
			ParentID:   parentID,
			PreviousID: previousID,
			NextID:     nextID,
		}},
	}}

	model.PerformTransactions(&transactions)
	model.FlushTxQueue()
	model.AppendPushReloadProtyleEntry(parentID)
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: "block inserted"}}}, nil
}

func blockAppend(args map[string]interface{}) (CallToolResult, error) {
	data, dataType := getBlockData(args)
	if data == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "data is required"}}, IsError: true}, nil
	}
	parentID, _ := args["parentID"].(string)
	if parentID == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "parentID is required"}}, IsError: true}, nil
	}

	if dataType == "markdown" {
		var err error
		data, err = markdownToBlockDOM(data)
		if err != nil {
			return CallToolResult{Content: []ContentItem{{Type: "text", Text: "convert markdown failed: " + err.Error()}}, IsError: true}, nil
		}
	}

	transactions := []*model.Transaction{{
		DoOperations: []*model.Operation{{
			Action:   "appendInsert",
			Data:     data,
			ParentID: parentID,
		}},
	}}

	model.PerformTransactions(&transactions)
	model.FlushTxQueue()
	model.AppendPushReloadProtyleEntry(parentID)
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: "block appended"}}}, nil
}

func blockPrepend(args map[string]interface{}) (CallToolResult, error) {
	data, dataType := getBlockData(args)
	if data == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "data is required"}}, IsError: true}, nil
	}
	parentID, _ := args["parentID"].(string)
	if parentID == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "parentID is required"}}, IsError: true}, nil
	}

	if dataType == "markdown" {
		var err error
		data, err = markdownToBlockDOM(data)
		if err != nil {
			return CallToolResult{Content: []ContentItem{{Type: "text", Text: "convert markdown failed: " + err.Error()}}, IsError: true}, nil
		}
	}

	transactions := []*model.Transaction{{
		DoOperations: []*model.Operation{{
			Action:   "prependInsert",
			Data:     data,
			ParentID: parentID,
		}},
	}}

	model.PerformTransactions(&transactions)
	model.FlushTxQueue()
	model.AppendPushReloadProtyleEntry(parentID)
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: "block prepended"}}}, nil
}

func blockUpdate(args map[string]interface{}) (CallToolResult, error) {
	id, _ := args["id"].(string)
	if id == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "id is required"}}, IsError: true}, nil
	}
	data, dataType := getBlockData(args)
	if data == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "data is required"}}, IsError: true}, nil
	}

	if dataType == "markdown" {
		var err error
		data, err = markdownToBlockDOM(data)
		if err != nil {
			return CallToolResult{Content: []ContentItem{{Type: "text", Text: "convert markdown failed: " + err.Error()}}, IsError: true}, nil
		}
	}

	transactions := []*model.Transaction{{
		DoOperations: []*model.Operation{{
			Action: "update",
			ID:     id,
			Data:   data,
		}},
	}}

	model.PerformTransactions(&transactions)
	model.FlushTxQueue()
	model.AppendPushReloadProtyleEntry(id)
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: "block updated"}}}, nil
}

func blockDelete(args map[string]interface{}) (CallToolResult, error) {
	id, _ := args["id"].(string)
	if id == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "id is required"}}, IsError: true}, nil
	}

	transactions := []*model.Transaction{{
		DoOperations: []*model.Operation{{
			Action: "delete",
			ID:     id,
		}},
	}}

	model.PerformTransactions(&transactions)
	model.FlushTxQueue()
	model.AppendPushReloadProtyleEntry(id)
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: "block deleted: " + id}}}, nil
}

func getBlockData(args map[string]interface{}) (data, dataType string) {
	data, _ = args["data"].(string)
	dataType, _ = args["dataType"].(string)
	if dataType == "" {
		dataType = "markdown"
	}
	return
}

func markdownToBlockDOM(md string) (string, error) {
	luteEngine := util.NewLute()
	luteEngine.SetHTMLTag2TextMark(true)
	result, _ := luteEngine.Md2BlockDOMTree(md, true)
	if result == "" {
		return "", fmt.Errorf("empty result")
	}
	return result, nil
}

func blockMove(args map[string]interface{}) (CallToolResult, error) {
	id, _ := args["id"].(string)
	if id == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "id is required"}}, IsError: true}, nil
	}
	parentID, _ := args["parentID"].(string)
	if parentID == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "parentID is required"}}, IsError: true}, nil
	}
	previousID, _ := args["previousID"].(string)

	transactions := []*model.Transaction{{
		DoOperations: []*model.Operation{{
			Action:     "move",
			ID:         id,
			ParentID:   parentID,
			PreviousID: previousID,
		}},
	}}

	model.PerformTransactions(&transactions)
	model.FlushTxQueue()
	model.AppendPushReloadProtyleEntry(id)
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: "block moved: " + id}}}, nil
}

func blockBreadcrumb(args map[string]interface{}) (CallToolResult, error) {
	id, _ := args["id"].(string)
	if id == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "id is required"}}, IsError: true}, nil
	}

	paths, err := model.BuildBlockBreadcrumb(id, nil)
	if err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "breadcrumb failed: " + err.Error()}}, IsError: true}, nil
	}

	var sb strings.Builder
	for _, p := range paths {
		sb.WriteString(fmt.Sprintf("%s/%s (%s)\n", p.Type, p.Name, p.ID))
	}
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: sb.String()}}}, nil
}

func blockTreeStat(args map[string]interface{}) (CallToolResult, error) {
	id, _ := args["id"].(string)
	if id == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "id is required"}}, IsError: true}, nil
	}
	stat := filesys.StatTree(id)
	if stat == nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "document not found or empty"}}, IsError: true}, nil
	}
	text := fmt.Sprintf("Document statistics:\n- Characters: %d\n- Words: %d\n- Blocks: %d\n- Links: %d\n- Images: %d\n- Refs: %d",
		stat.RuneCount, stat.WordCount, stat.BlockCount, stat.LinkCount, stat.ImageCount, stat.RefCount)
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: text}}}, nil
}

func blockDom(args map[string]interface{}) (CallToolResult, error) {
	id, _ := args["id"].(string)
	if id == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "id is required"}}, IsError: true}, nil
	}
	dom := model.GetBlockDOM(id)
	if dom == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "block not found or empty: " + id}}, IsError: true}, nil
	}
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: dom}}}, nil
}
