// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package tools

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func databaseItemsTestView(t *testing.T) *av.AttributeView {
	t.Helper()
	databaseKeyTestWorkspace(t)
	view := &av.AttributeView{ID: ast.NewNodeID(), Spec: av.PlainTextSpec,
		KeyValues: []*av.KeyValues{{Key: &av.Key{ID: ast.NewNodeID(), Name: "Name", Type: av.KeyTypeBlock}}},
		Views:     []*av.View{{ID: ast.NewNodeID(), Name: "Table", LayoutType: av.LayoutTypeTable, Table: av.NewLayoutTable()}},
	}
	view.KeyValues = append(view.KeyValues,
		&av.KeyValues{Key: &av.Key{ID: "number", Name: "Number", Type: av.KeyTypeNumber}},
		&av.KeyValues{Key: &av.Key{ID: "text", Name: "Text", Type: av.KeyTypeText}},
		&av.KeyValues{Key: &av.Key{ID: "check", Name: "Check", Type: av.KeyTypeCheckbox}})
	if err := av.SaveAttributeView(view); err != nil {
		t.Fatal(err)
	}
	return view
}

func TestDatabaseCellValueRejectsSilentNoops(t *testing.T) {
	view := databaseItemsTestView(t)
	for _, raw := range []string{
		`{"content":12}`, `{"number":{"content":12}}`, `{"text":{"content":"wrong type"}}`,
		`{"number":{"content":12,"isNotEmpty":true,"typo":1}}`, `{"number":null}`,
	} {
		var value map[string]any
		_ = json.Unmarshal([]byte(raw), &value)
		if err := validateDatabaseCellValue(view, "number", value); err == nil {
			t.Fatalf("invalid number payload accepted: %s", raw)
		}
	}
	for _, raw := range []string{`{"number":{"content":0,"isNotEmpty":true}}`, `{"number":{"isNotEmpty":false}}`} {
		var value map[string]any
		_ = json.Unmarshal([]byte(raw), &value)
		if err := validateDatabaseCellValue(view, "number", value); err != nil {
			t.Fatal(err)
		}
	}
	view.KeyValues = append(view.KeyValues, &av.KeyValues{Key: &av.Key{ID: "select", Type: av.KeyTypeMSelect}})
	for _, raw := range []string{`{"mSelect":[null]}`, `{"mSelect":[{"content":"Todo"}],"text":{"content":"unrelated"}}`} {
		var value map[string]any
		_ = json.Unmarshal([]byte(raw), &value)
		if err := validateDatabaseCellValue(view, "select", value); err == nil {
			t.Fatalf("invalid select payload accepted: %s", raw)
		}
	}
}

func TestDatabaseItemsWriteAndReadback(t *testing.T) {
	view := databaseItemsTestView(t)
	var args map[string]any
	if err := json.Unmarshal([]byte(`{"action":"items_add","items":[{"detached":true,"content":"One","values":[{"keyID":"number","value":{"number":{"content":0,"isNotEmpty":true}}}]},{"detached":true,"content":"Two","values":[{"keyID":"check","value":{"checkbox":{"checked":false}}}]}]}`), &args); err != nil {
		t.Fatal(err)
	}
	args["id"] = view.ID
	validator, err := CompileToolValidator(DatabaseTool)
	if err != nil {
		t.Fatal(err)
	}
	if err = validator.ValidateInput(args); err != nil {
		t.Fatal(err)
	}
	result, err := databaseHandler(args)
	if err != nil || result.IsError {
		t.Fatalf("batch add: %+v %v", result, err)
	}
	var output struct {
		Data struct {
			ItemIDs []string `json:"itemIDs"`
		} `json:"data"`
	}
	if err = json.Unmarshal([]byte(result.Content[0].Text), &output); err != nil || len(output.Data.ItemIDs) != 2 {
		t.Fatalf("missing row identities: %+v %v", result, err)
	}
	stored, err := av.ParseAttributeView(view.ID)
	if err != nil {
		t.Fatal(err)
	}
	value := stored.GetValue("number", output.Data.ItemIDs[0])
	if value == nil || value.Number == nil || !value.Number.IsNotEmpty || value.Number.Content != 0 {
		t.Fatalf("zero was lost: %+v", value)
	}
	updates := []any{
		map[string]any{"itemID": output.Data.ItemIDs[0], "keyID": "text", "value": map[string]any{"text": map[string]any{"content": "Updated"}}},
		map[string]any{"itemID": output.Data.ItemIDs[1], "keyID": "check", "value": map[string]any{"checkbox": map[string]any{"checked": true}}},
	}
	result, err = databaseHandler(map[string]any{"action": "items_update", "id": view.ID, "updates": updates})
	if err != nil || result.IsError {
		t.Fatalf("batch update: %+v %v", result, err)
	}
	stored, _ = av.ParseAttributeView(view.ID)
	if stored.GetValue("text", output.Data.ItemIDs[0]).Text.Content != "Updated" || !stored.GetValue("check", output.Data.ItemIDs[1]).Checkbox.Checked {
		t.Fatal("batch cells were not persisted")
	}
	path := filepath.Join(util.DataDir, "storage", "av", view.ID+".json")
	before, _ := os.ReadFile(path)
	updates[0].(map[string]any)["value"] = map[string]any{"text": map[string]any{"content": "Must not be saved"}}
	updates = append(updates, map[string]any{"itemID": output.Data.ItemIDs[1], "keyID": "number", "value": map[string]any{"content": 12}})
	result, err = databaseHandler(map[string]any{"action": "items_update", "id": view.ID, "updates": updates})
	if err != nil || !result.IsError {
		t.Fatalf("invalid batch accepted: %+v %v", result, err)
	}
	after, _ := os.ReadFile(path)
	if string(before) != string(after) {
		t.Fatal("rejected batch changed persisted data")
	}
}

func TestDatabaseBatchLimitsAndDuplicates(t *testing.T) {
	view := databaseItemsTestView(t)
	for _, args := range []map[string]any{
		{"action": "items_add", "items": []any{}},
		{"action": "items_add", "items": make([]any, 101)},
		{"action": "items_update", "updates": make([]any, 1001)},
		{"action": "items_add", "items": []any{map[string]any{"detached": true, "values": []any{
			map[string]any{"keyID": "text", "value": map[string]any{"text": map[string]any{"content": "one"}}},
			map[string]any{"keyID": "text", "value": map[string]any{"text": map[string]any{"content": "two"}}},
		}}}},
	} {
		if _, _, err := databaseItemsOperations(view, args); err == nil {
			t.Fatalf("invalid batch accepted: %+v", args)
		}
	}
}
