// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package tools

import (
	"encoding/json"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/model"
)

func TestDatabaseStructuredRenderOutput(t *testing.T) {
	attrView := &av.AttributeView{ID: "20260806000000-avtest1", Name: "Tasks"}
	table := &av.Table{
		BaseInstance: &av.BaseInstance{ID: "20260806000000-view001", Name: "Table"},
		Columns: []*av.TableColumn{{BaseInstanceField: &av.BaseInstanceField{
			ID:      "20260806000000-key0001",
			Name:    "State",
			Type:    av.KeyTypeSelect,
			Options: []*av.SelectOption{{Name: "Todo", Color: "1"}},
		}}},
		Rows: []*av.TableRow{{
			ID: "20260806000000-item001",
			Cells: []*av.TableCell{{BaseValue: &av.BaseValue{
				ID:        "20260806000000-value01",
				ValueType: av.KeyTypeSelect,
				Value: &av.Value{
					ID:      "20260806000000-value01",
					KeyID:   "20260806000000-key0001",
					BlockID: "20260806000000-item001",
					Type:    av.KeyTypeSelect,
					MSelect: []*av.ValueSelect{{Content: "Todo", Color: "1"}},
				},
			}}},
		}},
		RowCount: 1,
	}
	data := model.NewAttributeViewRenderData(attrView, table, "", 1, 50)
	result, err := databaseSuccess("render", data)
	if nil != err {
		t.Fatal(err)
	}

	validator, err := CompileToolValidator(DatabaseTool)
	if nil != err {
		t.Fatal(err)
	}
	if err = validator.ValidateOutput(result); nil != err {
		t.Fatal(err)
	}
	serialized, err := json.Marshal(result.StructuredContent)
	if nil != err {
		t.Fatal(err)
	}
	if len(result.Content) != 1 || result.Content[0].Text != string(serialized) {
		t.Fatalf("text and structured database results differ: %q, %s", result.Content[0].Text, serialized)
	}

	var output struct {
		Action string `json:"action"`
		Data   struct {
			View struct {
				Columns []struct {
					Options []*av.SelectOption `json:"options"`
				} `json:"columns"`
				Rows []struct {
					Cells []struct {
						Value *av.Value `json:"value"`
					} `json:"cells"`
				} `json:"rows"`
			} `json:"view"`
		} `json:"data"`
	}
	if err = json.Unmarshal(serialized, &output); nil != err {
		t.Fatal(err)
	}
	if output.Action != "render" || len(output.Data.View.Columns) != 1 ||
		len(output.Data.View.Columns[0].Options) != 1 || output.Data.View.Columns[0].Options[0].Name != "Todo" {
		t.Fatalf("unexpected rendered columns: %+v", output.Data.View.Columns)
	}
	value := output.Data.View.Rows[0].Cells[0].Value
	if nil == value || len(value.MSelect) != 1 || value.MSelect[0].Content != "Todo" {
		t.Fatalf("unexpected rendered select value: %+v", value)
	}
}

func TestDatabaseNativeStructuredArguments(t *testing.T) {
	validator, err := CompileToolValidator(DatabaseTool)
	if nil != err {
		t.Fatal(err)
	}
	if err = validator.ValidateInput(map[string]any{
		"action":  "item_remove",
		"itemIDs": []any{"20260806000000-item001"},
	}); nil != err {
		t.Fatal(err)
	}
	if err = validator.ValidateInput(map[string]any{
		"action": "item_update",
		"value":  map[string]any{"text": map[string]any{"content": "Updated"}},
	}); nil != err {
		t.Fatal(err)
	}
	if err = validator.ValidateInput(map[string]any{"action": "item_remove", "itemIDs": "item-1,item-2"}); nil == err {
		t.Fatal("expected comma-separated item IDs to be rejected")
	}
	if err = validator.ValidateInput(map[string]any{"action": "item_update", "value": `{"text":{"content":"Updated"}}`}); nil == err {
		t.Fatal("expected string-encoded cell value to be rejected")
	}
}

func TestDatabaseStringArray(t *testing.T) {
	values := databaseStringArray([]any{" first ", 1, "", "second"})
	if len(values) != 2 || values[0] != "first" || values[1] != "second" {
		t.Fatalf("unexpected database string array: %+v", values)
	}
}
