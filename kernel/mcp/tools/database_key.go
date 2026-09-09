// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package tools

import "github.com/siyuan-note/siyuan/kernel/model"

var databaseKeyConfigProperty = Property{
	Type:        "object",
	Description: "For key_update: exactly ONE setting per call. Inspect keys first; omitted settings are preserved. Type conversion follows the UI and can change how existing values are interpreted; primary key type is immutable. Render after updating to verify.",
	Properties: map[string]Property{
		"name":             {Type: "string", Description: "Nonempty field name"},
		"type":             {Type: "string", Enum: databaseKeyTypes, Description: "New field type"},
		"icon":             {Type: "string", Description: "Field icon, empty string clears it"},
		"desc":             {Type: "string", Description: "Field description, empty string clears it"},
		"numberFormat":     {Type: "string", Enum: model.AttributeViewKeyNumberFormats},
		"dateFormat":       {Type: "string", Enum: []string{"", "full", "month-day-year", "day-month-year", "year-month-day"}, Description: "Display format for date, created or updated fields"},
		"template":         {Type: "string", Description: "Template field formula, e.g. .action{add .Number 1}; empty string clears it"},
		"renderTemplate":   {Type: "string", Description: "Display template for non-template fields; empty string clears it"},
		"autoFillNow":      {Type: "boolean", Description: "Date field: fill the current time by default"},
		"fillSpecificTime": {Type: "boolean", Description: "Date field: include a specific time by default"},
		"includeTime":      {Type: "boolean", Description: "Created or updated field: include time"},
		"options": {
			Type: "array", Description: "Add/update and order select/mSelect options. Existing unlisted options are retained. Color and desc default to empty. Use optionUpdate to rename and optionRemove to delete.",
			Items: &Property{Type: "object", Properties: map[string]Property{
				"name": {Type: "string"}, "color": {Type: "string", Description: "Empty, palette index 1-14, or an existing custom color ID"}, "desc": {Type: "string"},
			}, Required: []string{"name"}},
		},
		"optionUpdate": {
			Type: "object", Description: "Update an existing option, preserving omitted properties and synchronizing row selections and filters",
			Properties: map[string]Property{
				"name": {Type: "string", Description: "Existing option name"}, "newName": {Type: "string"}, "color": {Type: "string"}, "desc": {Type: "string"},
			}, Required: []string{"name"},
		},
		"optionRemove": {Type: "string", Description: "Existing option name to delete, also removing its selections and filter references"},
		"relation": {
			Type: "object", Description: "Configure a relation field. A two-way back field is created automatically or reused for the same target; changing targets maintains backlinks using the UI operation.",
			Properties: map[string]Property{
				"avID": {Type: "string", Description: "Target database ID"}, "isTwoWay": {Type: "boolean"}, "backKeyName": {Type: "string", Description: "Optional back field name"},
			}, Required: []string{"avID", "isTwoWay"},
		},
		"rollup": {
			Type: "object", Description: "Configure a rollup field using an existing relation and a field in its target database",
			Properties: map[string]Property{
				"relationKeyID": {Type: "string"}, "keyID": {Type: "string"}, "operator": {Type: "string", Enum: model.AttributeViewKeyRollupOperators},
			}, Required: []string{"relationKeyID", "keyID", "operator"},
		},
		"relationFilters": {Type: "array", Items: &Property{Type: "object"}, Description: "Relation candidate filters in native ViewFilter format using target field IDs; [] clears them"},
		"rollupFilters":   {Type: "array", Items: &Property{Type: "object"}, Description: "Rollup filters in native ViewFilter format using target field IDs; [] clears them"},
	},
}

func databaseKeyUpdate(args map[string]any) (CallToolResult, error) {
	id, _ := args["id"].(string)
	keyID, _ := args["keyID"].(string)
	config, ok := args["config"].(map[string]any)
	if "" == id || "" == keyID || !ok {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "id, keyID and config object are required"}}, IsError: true}, nil
	}
	if err := model.UpdateAttributeViewKeyConfig(id, keyID, config); nil != err {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "update key failed: " + err.Error()}}, IsError: true}, nil
	}
	model.ReloadAttrView(id)
	keys := model.GetAttributeViewKeysByID(id, keyID)
	if 1 != len(keys) {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "field configuration was saved but could not be read back; inspect keys before retrying"}}, IsError: true}, nil
	}
	return databaseSuccess("key_update", map[string]any{"id": id, "key": keys[0]})
}
