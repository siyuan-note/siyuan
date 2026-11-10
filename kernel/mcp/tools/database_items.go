// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package tools

import (
	"bytes"
	"encoding/json"
	"fmt"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/model"
)

var databaseCellValueProperty = Property{Type: "object", Description: `Native typed cell value. Match the field type from keys: text={"text":{"content":"hello"}}, number={"number":{"content":12,"isNotEmpty":true}}, date={"date":{"content":1793894400000,"isNotEmpty":true}}, checkbox={"checkbox":{"checked":false}}, select/mSelect={"mSelect":[{"content":"Todo"}]}. Use mSelect:[] or mAsset:[] to clear lists. Number/date content requires isNotEmpty; false clears the value. Computed fields are read-only. Unknown or mismatched fields are rejected.`}

var databaseCellProperties = map[string]Property{
	"keyID": {Type: "string"}, "value": databaseCellValueProperty,
}

var databaseItemsProperty = Property{Type: "array", Description: "items_add: 1-100 rows, in input order, committed in one transaction. Each row uses blockID for a bound row, or detached=true and optional content. Optional values is an array of {keyID,value} for other fields. At most 1000 cells total. Do not retry a call whose execution result is unknown.", Items: &Property{Type: "object", Properties: map[string]Property{
	"blockID": {Type: "string"}, "content": {Type: "string"}, "detached": {Type: "boolean"},
	"values": {Type: "array", Items: &Property{Type: "object", Properties: databaseCellProperties, Required: []string{"keyID", "value"}}},
}}}

var databaseUpdatesProperty = Property{Type: "array", Description: "items_update: 1-1000 cells {itemID,keyID,value}, committed in one transaction; omitted cells stay unchanged. Each cell may appear only once. Returns the saved cell values.", Items: &Property{Type: "object", Properties: map[string]Property{
	"itemID": {Type: "string"}, "keyID": {Type: "string"}, "value": databaseCellValueProperty,
}, Required: []string{"itemID", "keyID", "value"}}}

func validateDatabaseCellValue(view *av.AttributeView, keyID string, value map[string]any) error {
	key, err := view.GetKey(keyID)
	if err != nil {
		return err
	}
	field := string(key.Type)
	switch key.Type {
	case av.KeyTypeSelect:
		field = "mSelect"
	case av.KeyTypeTemplate, av.KeyTypeCreated, av.KeyTypeUpdated, av.KeyTypeRollup, av.KeyTypeLineNumber:
		return fmt.Errorf("field [%s] is computed and cannot be written", keyID)
	}
	if payload, ok := value[field]; !ok || payload == nil {
		return fmt.Errorf("field [%s] requires a non-null %s value; inspect keys and use a native typed cell value", keyID, field)
	}
	for name := range value {
		switch name {
		case field, "id", "keyID", "blockID", "type", "createdAt", "updatedAt", "renderedContent", "hasRenderTemplate":
		case "isDetached":
			if key.Type != av.KeyTypeBlock {
				return fmt.Errorf("isDetached is only valid for the block field")
			}
		default:
			return fmt.Errorf("unexpected cell value field [%s] for %s", name, key.Type)
		}
	}
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	var decoded av.Value
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err = decoder.Decode(&decoded); err != nil {
		return fmt.Errorf("invalid %s cell value: %w", key.Type, err)
	}
	for _, option := range decoded.MSelect {
		if option == nil {
			return fmt.Errorf("mSelect entries must be objects, not null")
		}
	}
	for _, asset := range decoded.MAsset {
		if asset == nil {
			return fmt.Errorf("mAsset entries must be objects, not null")
		}
	}
	if key.Type == av.KeyTypeNumber || key.Type == av.KeyTypeDate {
		payload, ok := value[field].(map[string]any)
		if !ok {
			return fmt.Errorf("%s must be an object", field)
		}
		if _, content := payload["content"]; content {
			if _, explicit := payload["isNotEmpty"].(bool); !explicit {
				return fmt.Errorf("%s.content requires explicit isNotEmpty=true to set a value or false to clear it", field)
			}
		}
	}
	return nil
}

func databaseItemsWrite(args map[string]any) (CallToolResult, error) {
	id, _ := args["id"].(string)
	action, _ := args["action"].(string)
	if id == "" {
		return blockToolError("id is required")
	}
	var operations []*model.Operation
	var itemIDs []string
	err := model.PerformPreparedAttributeViewOperations(func() ([]*model.Operation, error) {
		view, err := av.ParseAttributeView(id)
		if err != nil {
			return nil, err
		}
		operations, itemIDs, err = databaseItemsOperations(view, args)
		return operations, err
	})
	if err != nil {
		return blockToolError("batch write failed: " + err.Error())
	}
	model.ReloadAttrView(id)
	stored, err := av.ParseAttributeView(id)
	if err != nil {
		return CallToolResult{IsError: true, ExecutionUnknown: true, Content: []ContentItem{{Type: "text", Text: "batch committed but readback failed; do not retry automatically: " + err.Error()}}}, nil
	}
	values := []any{}
	for _, op := range operations {
		if op.Action == "updateAttrViewCell" {
			values = append(values, map[string]any{"itemID": op.RowID, "keyID": op.KeyID, "value": stored.GetValue(op.KeyID, op.RowID)})
		}
	}
	return databaseSuccess(action, map[string]any{"id": id, "itemIDs": itemIDs, "values": values})
}

func databaseItemsOperations(view *av.AttributeView, args map[string]any) (operations []*model.Operation, itemIDs []string, err error) {
	seen := map[string]bool{}
	cellCount := 0
	addCell := func(itemID string, cell map[string]any) error {
		keyID, _ := cell["keyID"].(string)
		value, ok := cell["value"].(map[string]any)
		if itemID == "" || keyID == "" || !ok {
			return fmt.Errorf("each cell requires itemID, keyID and a value object")
		}
		for name := range cell {
			if name != "keyID" && name != "value" && name != "itemID" {
				return fmt.Errorf("unknown cell parameter [%s]", name)
			}
		}
		identity := itemID + "/" + keyID
		if seen[identity] {
			return fmt.Errorf("duplicate cell [%s]", identity)
		}
		if err := validateDatabaseCellValue(view, keyID, value); err != nil {
			return err
		}
		seen[identity] = true
		cellCount++
		if cellCount > 1000 {
			return fmt.Errorf("batch exceeds 1000 cells")
		}
		operations = append(operations, &model.Operation{Action: "updateAttrViewCell", AvID: view.ID, RowID: itemID, KeyID: keyID, Data: value})
		return nil
	}
	action, _ := args["action"].(string)
	if action == "items_update" {
		updates, ok := args["updates"].([]any)
		if !ok || len(updates) == 0 || len(updates) > 1000 {
			return nil, nil, fmt.Errorf("updates must contain 1-1000 cells")
		}
		for _, input := range updates {
			cell, _ := input.(map[string]any)
			itemID, _ := cell["itemID"].(string)
			if view.GetBlockValue(itemID) == nil {
				return nil, nil, fmt.Errorf("item not found [%s]", itemID)
			}
			if err = addCell(itemID, cell); err != nil {
				return nil, nil, err
			}
		}
		return
	}
	items, ok := args["items"].([]any)
	if !ok || len(items) == 0 || len(items) > 100 {
		return nil, nil, fmt.Errorf("items must contain 1-100 rows")
	}
	for _, input := range items {
		row, _ := input.(map[string]any)
		for name := range row {
			if name != "blockID" && name != "content" && name != "detached" && name != "values" {
				return nil, nil, fmt.Errorf("unknown row parameter [%s]", name)
			}
		}
		detached, _ := row["detached"].(bool)
		blockID, _ := row["blockID"].(string)
		if !detached && blockID == "" || detached && blockID != "" {
			return nil, nil, fmt.Errorf("each row requires blockID or detached=true, exclusively")
		}
		if !detached && !ast.IsNodeIDPattern(blockID) {
			return nil, nil, fmt.Errorf("invalid bound block ID [%s]", blockID)
		}
		itemID := ast.NewNodeID()
		if !detached {
			if existing := view.GetBlockValueByBoundID(blockID); existing != nil {
				itemID = existing.BlockID
			}
			if seen[blockID] {
				return nil, nil, fmt.Errorf("duplicate bound block [%s]", blockID)
			}
			seen[blockID] = true
		}
		itemIDs = append(itemIDs, itemID)
		src := map[string]any{"itemID": itemID, "isDetached": detached}
		if blockID != "" {
			src["id"] = blockID
		}
		if content, ok := row["content"].(string); ok {
			src["content"] = content
		}
		previousID := ""
		if len(itemIDs) > 1 {
			previousID = itemIDs[len(itemIDs)-2]
		}
		operations = append(operations, &model.Operation{Action: "insertAttrViewBlock", AvID: view.ID, Srcs: []map[string]any{src}, PreviousID: previousID})
		if raw, exists := row["values"]; exists {
			cells, ok := raw.([]any)
			if !ok {
				return nil, nil, fmt.Errorf("row values must be an array")
			}
			for _, rawCell := range cells {
				cell, _ := rawCell.(map[string]any)
				if err = addCell(itemID, cell); err != nil {
					return nil, nil, err
				}
			}
		}
	}
	return
}
