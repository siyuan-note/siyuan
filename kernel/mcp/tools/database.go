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
	"encoding/json"
	"fmt"
	"strings"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/model"
)

var DatabaseTool = &Tool{
	Name:        "database",
	Description: "Attribute view (database) operations. Actions: search(keyword), get(id), render(id, viewID?, query?, page=1, pageSize=50), keys(id), key_add(id, name, type, icon?, prev?), key_remove(id, keyID, removeRelationDest?), item_add(id, blockID?, content?, viewID?, groupID?, previousID?, detached?, ignoreDefaultFill?), item_remove(id, itemIDs comma-separated), item_update(id, keyID, itemID, value as JSON string), unused(), clean(id?).",
	InputSchema: ToolSchema{
		Type: "object",
		Properties: map[string]Property{
			"action":             {Type: "string", Description: "Operation", Enum: []string{"search", "get", "render", "keys", "key_add", "key_remove", "item_add", "item_remove", "item_update", "unused", "clean"}},
			"keyword":            {Type: "string", Description: "Search keyword (for search)"},
			"id":                 {Type: "string", Description: "Attribute view ID (for get, render, keys, key_add, key_remove, item_add, item_remove, item_update, clean)"},
			"viewID":             {Type: "string", Description: "View ID (for render, item_add)"},
			"query":              {Type: "string", Description: "Filter query (for render)"},
			"page":               {Type: "number", Description: "Page number (default 1)"},
			"pageSize":           {Type: "number", Description: "Results per page (default 50)"},
			"name":               {Type: "string", Description: "Key name (for key_add)"},
			"type":               {Type: "string", Description: "Key type: block/text/number/date/select/mSelect/url/email/phone/mAsset/template/created/updated/checkbox/relation/rollup/lineNumber (for key_add)"},
			"icon":               {Type: "string", Description: "Key icon (for key_add, optional)"},
			"prev":               {Type: "string", Description: "Previous key ID for ordering (for key_add, optional)"},
			"keyID":              {Type: "string", Description: "Key ID (for key_remove, item_update)"},
			"removeRelationDest": {Type: "boolean", Description: "Also remove related data in linked databases (for key_remove, optional)"},
			"blockID":            {Type: "string", Description: "Block ID to bind (for item_add, optional)"},
			"content":            {Type: "string", Description: "Block column text content (for item_add, optional)"},
			"groupID":            {Type: "string", Description: "Group ID for positioning (for item_add, optional)"},
			"previousID":         {Type: "string", Description: "Previous item ID for positioning (for item_add, optional)"},
			"detached":           {Type: "boolean", Description: "Create detached row (for item_add, optional)"},
			"ignoreDefaultFill":  {Type: "boolean", Description: "Skip filling default values (for item_add, optional)"},
			"itemID":             {Type: "string", Description: "Item ID (for item_update)"},
			"itemIDs":            {Type: "string", Description: "Comma-separated item IDs (for item_remove)"},
			"value":              {Type: "string", Description: "JSON value for the cell (for item_update)"},
		},
		Required: []string{"action"},
	},
	Handler: databaseHandler,
}

func init() {
	register(DatabaseTool)
}

func databaseHandler(args map[string]any) (CallToolResult, error) {
	action, _ := args["action"].(string)
	switch action {
	case "search":
		return databaseSearch(args)
	case "get":
		return databaseGet(args)
	case "render":
		return databaseRender(args)
	case "keys":
		return databaseKeys(args)
	case "key_add":
		return databaseKeyAdd(args)
	case "key_remove":
		return databaseKeyRemove(args)
	case "item_add":
		return databaseItemAdd(args)
	case "item_remove":
		return databaseItemRemove(args)
	case "item_update":
		return databaseItemUpdate(args)
	case "unused":
		return databaseUnused(args)
	case "clean":
		return databaseClean(args)
	}
	return CallToolResult{
		Content: []ContentItem{{Type: "text", Text: "unknown action '" + action + "', expected one of: [search, get, render, keys, key_add, key_remove, item_add, item_remove, item_update, unused, clean]"}},
		IsError: true,
	}, nil
}

func databaseSearch(args map[string]any) (CallToolResult, error) {
	keyword, _ := args["keyword"].(string)
	if keyword == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "keyword is required"}}, IsError: true}, nil
	}

	results := model.SearchAttributeView(keyword, nil, "", "")
	if len(results) == 0 {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "no attribute views found"}}}, nil
	}

	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("Attribute views matching '%s' (%d):\n\n", keyword, len(results)))
	for _, r := range results {
		sb.WriteString(fmt.Sprintf("- %s (id: %s, hPath: %s)\n", r.AvName, r.AvID, r.HPath))
	}
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: sb.String()}}}, nil
}

func databaseGet(args map[string]any) (CallToolResult, error) {
	id, _ := args["id"].(string)
	if id == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "id is required"}}, IsError: true}, nil
	}

	attrView := model.GetAttributeView(id)
	if attrView == nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "attribute view not found: " + id}}, IsError: true}, nil
	}

	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("Attribute View: %s\n\n", id))
	sb.WriteString(fmt.Sprintf("Name: %s\n", attrView.Name))
	sb.WriteString(fmt.Sprintf("Keys (%d):\n", len(attrView.KeyValues)))
	for _, kv := range attrView.KeyValues {
		sb.WriteString(fmt.Sprintf("- %s (%s): %s\n", kv.Key.Name, kv.Key.Type, kv.Key.Icon))
	}
	sb.WriteString(fmt.Sprintf("\nViews (%d):\n", len(attrView.Views)))
	for _, v := range attrView.Views {
		sb.WriteString(fmt.Sprintf("- %s (%s, pageSize: %d)\n", v.Name, v.LayoutType, v.PageSize))
	}
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: sb.String()}}}, nil
}

func databaseRender(args map[string]any) (CallToolResult, error) {
	id, _ := args["id"].(string)
	if id == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "id is required"}}, IsError: true}, nil
	}
	viewID, _ := args["viewID"].(string)
	query, _ := args["query"].(string)
	page := 1
	if v, ok := args["page"].(float64); ok {
		page = int(v)
	}
	pageSize := 50
	if v, ok := args["pageSize"].(float64); ok {
		pageSize = int(v)
	}

	viewable, _, err := model.RenderAttributeView("", id, viewID, query, page, pageSize, nil, false, false)
	if err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "render failed: " + err.Error()}}, IsError: true}, nil
	}

	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("Attribute View Render (page %d):\n\n", page))
	if viewable != nil {
		if table, ok := viewable.(*av.Table); ok {
			for _, row := range table.Rows {
				vals := make([]string, 0, len(row.Cells))
				for _, cell := range row.Cells {
					vals = append(vals, fmt.Sprintf("%v", cell.Value))
				}
				sb.WriteString(strings.Join(vals, " | ") + "\n")
			}
		}
	}
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: sb.String()}}}, nil
}

func databaseKeys(args map[string]any) (CallToolResult, error) {
	id, _ := args["id"].(string)
	if id == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "id is required"}}, IsError: true}, nil
	}
	attrView := model.GetAttributeView(id)
	if attrView == nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "attribute view not found: " + id}}, IsError: true}, nil
	}
	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("Keys for %s (%s):\n\n", id, attrView.Name))
	for _, kv := range attrView.KeyValues {
		sb.WriteString(fmt.Sprintf("- %s (%s) [%s]\n", kv.Key.ID, kv.Key.Name, kv.Key.Type))
	}
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: sb.String()}}}, nil
}

func databaseKeyAdd(args map[string]any) (CallToolResult, error) {
	id, _ := args["id"].(string)
	name, _ := args["name"].(string)
	keyType, _ := args["type"].(string)
	if id == "" || name == "" || keyType == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "id, name and type are required"}}, IsError: true}, nil
	}
	icon, _ := args["icon"].(string)
	prev, _ := args["prev"].(string)
	keyID := ast.NewNodeID()
	if err := model.AddAttributeViewKey(id, keyID, name, keyType, icon, prev); err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "add key failed: " + err.Error()}}, IsError: true}, nil
	}
	model.ReloadAttrView(id)
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: fmt.Sprintf("key added: %s (%s)", keyID, name)}}}, nil
}

func databaseKeyRemove(args map[string]any) (CallToolResult, error) {
	id, _ := args["id"].(string)
	keyID, _ := args["keyID"].(string)
	if id == "" || keyID == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "id and keyID are required"}}, IsError: true}, nil
	}
	removeRelation := false
	if v, ok := args["removeRelationDest"].(bool); ok {
		removeRelation = v
	}
	if err := model.RemoveAttributeViewKey(id, keyID, removeRelation); err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "remove key failed: " + err.Error()}}, IsError: true}, nil
	}
	model.ReloadAttrView(id)
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: "key removed: " + keyID}}}, nil
}

func databaseItemAdd(args map[string]any) (CallToolResult, error) {
	id, _ := args["id"].(string)
	if id == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "id is required"}}, IsError: true}, nil
	}
	isDetached := false
	if v, ok := args["detached"].(bool); ok {
		isDetached = v
	}
	blockID, _ := args["blockID"].(string)
	if !isDetached && blockID == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "blockID is required for non-detached rows"}}, IsError: true}, nil
	}
	content, _ := args["content"].(string)
	viewID, _ := args["viewID"].(string)
	groupID, _ := args["groupID"].(string)
	previousID, _ := args["previousID"].(string)
	ignoreFill := false
	if v, ok := args["ignoreDefaultFill"].(bool); ok {
		ignoreFill = v
	}
	src := map[string]any{"isDetached": isDetached}
	if blockID != "" {
		src["id"] = blockID
	}
	if content != "" {
		src["content"] = content
	}
	srcs := []map[string]any{src}
	if err := model.AddAttributeViewBlock(nil, srcs, id, blockID, viewID, groupID, previousID, ignoreFill); err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "add item failed: " + err.Error()}}, IsError: true}, nil
	}
	model.ReloadAttrView(id)
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: "item added"}}}, nil
}

func databaseItemRemove(args map[string]any) (CallToolResult, error) {
	id, _ := args["id"].(string)
	itemIDsStr, _ := args["itemIDs"].(string)
	if id == "" || itemIDsStr == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "id and itemIDs are required"}}, IsError: true}, nil
	}
	itemIDs := strings.Split(itemIDsStr, ",")
	for i := range itemIDs {
		itemIDs[i] = strings.TrimSpace(itemIDs[i])
	}
	if err := model.RemoveAttributeViewBlock(itemIDs, id); err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "remove items failed: " + err.Error()}}, IsError: true}, nil
	}
	model.ReloadAttrView(id)
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: fmt.Sprintf("%d item(s) removed", len(itemIDs))}}}, nil
}

func databaseItemUpdate(args map[string]any) (CallToolResult, error) {
	id, _ := args["id"].(string)
	keyID, _ := args["keyID"].(string)
	itemID, _ := args["itemID"].(string)
	valueStr, _ := args["value"].(string)
	if id == "" || keyID == "" || itemID == "" || valueStr == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "id, keyID, itemID and value are required"}}, IsError: true}, nil
	}
	var valueData map[string]any
	if err := json.Unmarshal([]byte(valueStr), &valueData); err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "invalid JSON value: " + err.Error()}}, IsError: true}, nil
	}
	if _, err := model.UpdateAttributeViewCell(nil, id, keyID, itemID, valueData); err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "update cell failed: " + err.Error()}}, IsError: true}, nil
	}
	model.ReloadAttrView(id)
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: "cell updated"}}}, nil
}

func databaseUnused(args map[string]any) (CallToolResult, error) {
	items := model.UnusedAttributeViews(true)
	if len(items) == 0 {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "no unused databases found"}}}, nil
	}
	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("Unused databases (%d):\n\n", len(items)))
	for _, item := range items {
		sb.WriteString(fmt.Sprintf("- %s (%s)\n", item.Item, item.Name))
	}
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: sb.String()}}}, nil
}

func databaseClean(args map[string]any) (CallToolResult, error) {
	id, _ := args["id"].(string)
	if id != "" {
		model.RemoveUnusedAttributeView(id)
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "unused database cleaned: " + id}}}, nil
	}
	removed := model.RemoveUnusedAttributeViews()
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: fmt.Sprintf("%d unused database(s) cleaned", len(removed))}}}, nil
}
