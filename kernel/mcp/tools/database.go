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
	"strings"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/model"
)

var databaseActions = []string{
	"search", "get", "render", "keys", "key_add", "key_remove", "item_add", "item_remove", "item_update", "unused", "clean",
}

var databaseKeyTypes = []string{
	"text", "number", "date", "select", "mSelect", "url", "email", "phone", "mAsset", "template", "created", "updated",
	"checkbox", "relation", "rollup", "lineNumber",
}

type databaseToolOutput struct {
	Action string `json:"action"`
	Data   any    `json:"data"`
}

var DatabaseTool = &Tool{
	Name:        "database",
	Description: "Attribute view (database) operations. Every successful call returns {action, data}. Actions: search(keyword), get(id), render(id, viewID?, query?, page=1, pageSize=50), keys(id), key_add(id, name, type, icon?, prev?), key_remove(id, keyID, removeRelationDest?), item_add(id, blockID?, content?, viewID?, groupID?, previousID?, detached?, ignoreDefaultFill?), item_remove(id, itemIDs), item_update(id, keyID, itemID, value), unused(), clean(id?).",
	InputSchema: ToolSchema{
		Type: "object",
		Properties: map[string]Property{
			"action":             {Type: "string", Description: "Operation", Enum: databaseActions},
			"keyword":            {Type: "string", Description: "Search keyword (for search)"},
			"id":                 {Type: "string", Description: "Attribute view ID (for get, render, keys, key_add, key_remove, item_add, item_remove, item_update, clean)"},
			"viewID":             {Type: "string", Description: "View ID (for render, item_add)"},
			"query":              {Type: "string", Description: "Filter query (for render)"},
			"page":               {Type: "integer", Description: "Page number (default 1)"},
			"pageSize":           {Type: "integer", Description: "Results per page (default 50)"},
			"name":               {Type: "string", Description: "Key name (for key_add)"},
			"type":               {Type: "string", Description: "Key type (for key_add)", Enum: databaseKeyTypes},
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
			"itemIDs":            {Type: "array", Description: "Item IDs (for item_remove)", Items: &Property{Type: "string"}},
			"value":              {Type: "object", Description: "Typed cell value (for item_update)"},
		},
		Required: []string{"action"},
	},
	OutputSchema: &ToolSchema{
		Type: "object",
		Properties: map[string]Property{
			"action": {Type: "string", Description: "Completed operation", Enum: databaseActions},
			"data":   {Type: "object", Description: "Operation result"},
		},
		Required: []string{"action", "data"},
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
		Content: []ContentItem{{Type: "text", Text: "unknown action '" + action + "', expected one of: [" + strings.Join(databaseActions, ", ") + "]"}},
		IsError: true,
	}, nil
}

func databaseSuccess(action string, data any) (CallToolResult, error) {
	output := &databaseToolOutput{Action: action, Data: data}
	serialized, err := json.Marshal(output)
	if nil != err {
		return CallToolResult{}, err
	}
	return CallToolResult{
		Content:              []ContentItem{{Type: "text", Text: string(serialized)}},
		StructuredContent:    output,
		StructuredContentSet: true,
	}, nil
}

func databaseSearch(args map[string]any) (CallToolResult, error) {
	keyword, _ := args["keyword"].(string)
	if keyword == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "keyword is required"}}, IsError: true}, nil
	}

	results := model.SearchAttributeView(keyword, nil, "", "")
	return databaseSuccess("search", map[string]any{
		"keyword": keyword,
		"count":   len(results),
		"results": results,
	})
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

	return databaseSuccess("get", model.NewAttributeViewMetadata(attrView))
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
	if 1 > page {
		page = 1
	}
	pageSize := 50
	if v, ok := args["pageSize"].(float64); ok {
		pageSize = int(v)
	}
	if 1 > pageSize {
		pageSize = 50
	}

	viewable, attrView, err := model.RenderAttributeView("", id, viewID, query, page, pageSize, nil, false, false)
	if err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "render failed: " + err.Error()}}, IsError: true}, nil
	}
	return databaseSuccess("render", model.NewAttributeViewRenderData(attrView, viewable, query, page, pageSize))
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
	return databaseSuccess("keys", model.NewAttributeViewKeys(attrView))
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
	if err := model.AddAttributeViewKey(id, "", keyID, name, keyType, icon, prev, av.DateDisplayFormatFull); err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "add key failed: " + err.Error()}}, IsError: true}, nil
	}
	model.ReloadAttrView(id)
	attrView := model.GetAttributeView(id)
	key := &av.Key{ID: keyID, Name: name, Type: av.KeyType(keyType), Icon: icon, DateFormat: av.DateDisplayFormatFull}
	if nil != attrView {
		if storedKey, getErr := attrView.GetKey(keyID); nil == getErr {
			key = storedKey
		}
	}
	return databaseSuccess("key_add", map[string]any{"id": id, "key": key})
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
	return databaseSuccess("key_remove", map[string]any{"id": id, "keyID": keyID, "removed": true})
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
	itemID := ast.NewNodeID()
	src := map[string]any{"isDetached": isDetached, "itemID": itemID}
	if blockID != "" {
		src["id"] = blockID
	}
	if content != "" {
		src["content"] = content
	}
	srcs := []map[string]any{src}
	if err := model.AddAttributeViewBlock(nil, srcs, id, "", viewID, groupID, previousID, ignoreFill); err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "add item failed: " + err.Error()}}, IsError: true}, nil
	}
	model.ReloadAttrView(id)
	if resultingItemID, ok := src["itemID"].(string); ok {
		itemID = resultingItemID
	}
	return databaseSuccess("item_add", map[string]any{"id": id, "itemID": itemID})
}

func databaseItemRemove(args map[string]any) (CallToolResult, error) {
	id, _ := args["id"].(string)
	itemIDs := databaseStringArray(args["itemIDs"])
	if id == "" || 1 > len(itemIDs) {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "id and itemIDs are required"}}, IsError: true}, nil
	}
	if err := model.RemoveAttributeViewBlock(itemIDs, id); err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "remove items failed: " + err.Error()}}, IsError: true}, nil
	}
	model.ReloadAttrView(id)
	return databaseSuccess("item_remove", map[string]any{
		"id":           id,
		"itemIDs":      itemIDs,
		"removedCount": len(itemIDs),
	})
}

func databaseItemUpdate(args map[string]any) (CallToolResult, error) {
	id, _ := args["id"].(string)
	keyID, _ := args["keyID"].(string)
	itemID, _ := args["itemID"].(string)
	valueData, _ := args["value"].(map[string]any)
	if id == "" || keyID == "" || itemID == "" || nil == valueData {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "id, keyID, itemID and value are required"}}, IsError: true}, nil
	}
	value, err := model.UpdateAttributeViewCell(nil, id, keyID, itemID, valueData)
	if err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "update cell failed: " + err.Error()}}, IsError: true}, nil
	}
	model.ReloadAttrView(id)
	return databaseSuccess("item_update", map[string]any{
		"id":     id,
		"keyID":  keyID,
		"itemID": itemID,
		"value":  value,
	})
}

func databaseUnused(args map[string]any) (CallToolResult, error) {
	items := model.UnusedAttributeViews(true)
	return databaseSuccess("unused", map[string]any{"count": len(items), "items": items})
}

func databaseClean(args map[string]any) (CallToolResult, error) {
	id, _ := args["id"].(string)
	if id != "" {
		model.RemoveUnusedAttributeView(id)
		return databaseSuccess("clean", map[string]any{"count": 1, "ids": []string{id}})
	}
	removed := model.RemoveUnusedAttributeViews()
	return databaseSuccess("clean", map[string]any{"count": len(removed), "ids": removed})
}

func databaseStringArray(value any) (ret []string) {
	switch values := value.(type) {
	case []string:
		for _, item := range values {
			if item = strings.TrimSpace(item); "" != item {
				ret = append(ret, item)
			}
		}
	case []any:
		for _, value := range values {
			item, ok := value.(string)
			if !ok {
				continue
			}
			if item = strings.TrimSpace(item); "" != item {
				ret = append(ret, item)
			}
		}
	}
	return
}
