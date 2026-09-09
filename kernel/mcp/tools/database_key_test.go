// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package tools

import (
	"encoding/json"
	"os"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func databaseKeyTestWorkspace(t *testing.T) {
	t.Helper()
	originalDataDir := util.DataDir
	util.DataDir = t.TempDir()
	t.Cleanup(func() { util.DataDir = originalDataDir })
}

func databaseKeyTestFixture(t *testing.T, keys ...*av.KeyValues) *av.AttributeView {
	t.Helper()
	attrView := &av.AttributeView{ID: ast.NewNodeID(), Name: "Test", KeyValues: keys}
	if err := av.SaveAttributeView(attrView); nil != err {
		t.Fatal(err)
	}
	return attrView
}

func databaseKeyTestUpdate(t *testing.T, id, keyID string, config map[string]any) *av.Key {
	t.Helper()
	args := map[string]any{"action": "key_update", "id": id, "keyID": keyID, "config": config}
	validator, err := CompileToolValidator(DatabaseTool)
	if nil != err {
		t.Fatal(err)
	}
	if err = validator.ValidateInput(args); nil != err {
		t.Fatal(err)
	}
	result, err := databaseHandler(args)
	if nil != err || result.IsError {
		t.Fatalf("update %+v failed: %+v, %v", config, result, err)
	}
	if err = validator.ValidateOutput(result); nil != err {
		t.Fatal(err)
	}
	stored, err := av.ParseAttributeView(id)
	if nil != err {
		t.Fatal(err)
	}
	key, err := stored.GetKey(keyID)
	if nil != err {
		t.Fatal(err)
	}
	return key
}

func TestDatabaseKeyUpdateScalarSettings(t *testing.T) {
	databaseKeyTestWorkspace(t)
	for _, test := range []struct {
		setting       string
		typ           av.KeyType
		value         any
		storedSetting string
	}{
		{"name", av.KeyTypeBlock, "主键名称", "name"},
		{"type", av.KeyTypeText, "number", "type"},
		{"icon", av.KeyTypeText, "1f600", "icon"},
		{"desc", av.KeyTypeText, "字段说明", "desc"},
		{"numberFormat", av.KeyTypeNumber, "percent", "numberFormat"},
		{"dateFormat", av.KeyTypeDate, "year-month-day", "dateFormat"},
		{"dateFormat", av.KeyTypeCreated, "full", "dateFormat"},
		{"dateFormat", av.KeyTypeUpdated, "month-day-year", "dateFormat"},
		{"template", av.KeyTypeTemplate, ".action{add .数字 1}", "template"},
		{"renderTemplate", av.KeyTypeText, ".action{.text}", "renderTemplate"},
	} {
		t.Run(test.setting+string(test.typ), func(t *testing.T) {
			attrView := databaseKeyTestFixture(t, &av.KeyValues{Key: &av.Key{ID: "field", Name: "Before", Type: test.typ}})
			key := databaseKeyTestUpdate(t, attrView.ID, "field", map[string]any{test.setting: test.value})
			data, _ := json.Marshal(key)
			var fields map[string]any
			if err := json.Unmarshal(data, &fields); nil != err {
				t.Fatal(err)
			}
			if test.value != fields[test.storedSetting] {
				t.Fatalf("setting not persisted: %s", data)
			}
			if "name" != test.setting && "Before" != key.Name {
				t.Fatal("unrelated field name changed")
			}
		})
	}
	for _, typ := range []av.KeyType{av.KeyTypeDate, av.KeyTypeCreated, av.KeyTypeUpdated} {
		attrView := databaseKeyTestFixture(t, &av.KeyValues{Key: &av.Key{ID: "field", Type: typ}})
		for _, flag := range []bool{true, false} {
			if av.KeyTypeDate == typ {
				key := databaseKeyTestUpdate(t, attrView.ID, "field", map[string]any{"autoFillNow": flag})
				if nil == key.Date || flag != key.Date.AutoFillNow {
					t.Fatal("autoFillNow not persisted")
				}
				key = databaseKeyTestUpdate(t, attrView.ID, "field", map[string]any{"fillSpecificTime": flag})
				if flag != key.Date.FillSpecificTime {
					t.Fatal("fillSpecificTime not persisted")
				}
			} else {
				key := databaseKeyTestUpdate(t, attrView.ID, "field", map[string]any{"includeTime": flag})
				if av.KeyTypeCreated == typ && (nil == key.Created || flag != key.Created.IncludeTime) ||
					av.KeyTypeUpdated == typ && (nil == key.Updated || flag != key.Updated.IncludeTime) {
					t.Fatal("includeTime not persisted")
				}
			}
		}
	}
}

func TestDatabaseKeyUpdateOptionsMaintainsSelections(t *testing.T) {
	databaseKeyTestWorkspace(t)
	attrView := databaseKeyTestFixture(t, &av.KeyValues{
		Key:    &av.Key{ID: "field", Type: av.KeyTypeMSelect, Options: []*av.SelectOption{{Name: "旧选项", Color: "1", Desc: "说明"}}},
		Values: []*av.Value{{ID: ast.NewNodeID(), KeyID: "field", BlockID: ast.NewNodeID(), Type: av.KeyTypeMSelect, MSelect: []*av.ValueSelect{{Content: "旧选项", Color: "1"}}}},
	})
	key := databaseKeyTestUpdate(t, attrView.ID, "field", map[string]any{"options": []any{map[string]any{"name": "新选项", "color": "2"}}})
	if 2 != len(key.Options) || nil == key.GetOption("旧选项") {
		t.Fatal("adding options should retain existing options")
	}
	key = databaseKeyTestUpdate(t, attrView.ID, "field", map[string]any{"optionUpdate": map[string]any{"name": "旧选项", "newName": "已改名", "color": "3"}})
	if nil == key.GetOption("已改名") || "说明" != key.GetOption("已改名").Desc {
		t.Fatal("rename should preserve the option description")
	}
	stored, _ := av.ParseAttributeView(attrView.ID)
	selection := stored.KeyValues[0].Values[0].MSelect[0]
	if "已改名" != selection.Content || "3" != selection.Color {
		t.Fatalf("row selection not updated: %+v", selection)
	}
	databaseKeyTestUpdate(t, attrView.ID, "field", map[string]any{"optionRemove": "已改名"})
	stored, _ = av.ParseAttributeView(attrView.ID)
	if 0 != len(stored.KeyValues[0].Values[0].MSelect) {
		t.Fatal("removed option remains in row selection")
	}
}

func TestDatabaseKeyUpdateRelationAndRollup(t *testing.T) {
	databaseKeyTestWorkspace(t)
	dest := databaseKeyTestFixture(t, &av.KeyValues{Key: &av.Key{ID: "number", Name: "数字", Type: av.KeyTypeNumber}})
	source := databaseKeyTestFixture(t,
		&av.KeyValues{Key: &av.Key{ID: "relation", Name: "关联", Type: av.KeyTypeRelation}},
		&av.KeyValues{Key: &av.Key{ID: "rollup", Name: "汇总", Type: av.KeyTypeRollup}},
	)
	key := databaseKeyTestUpdate(t, source.ID, "relation", map[string]any{"relation": map[string]any{"avID": dest.ID, "isTwoWay": true, "backKeyName": "回链"}})
	backKeyID := key.Relation.BackKeyID
	if "" == backKeyID || !key.Relation.IsTwoWay {
		t.Fatal("two-way relation not configured")
	}
	storedDest, _ := av.ParseAttributeView(dest.ID)
	back, err := storedDest.GetKey(backKeyID)
	if nil != err || nil == back.Relation || back.Relation.AvID != source.ID || back.Relation.BackKeyID != "relation" {
		t.Fatalf("back relation not configured: %+v, %v", back, err)
	}
	key = databaseKeyTestUpdate(t, source.ID, "relation", map[string]any{"relation": map[string]any{"avID": dest.ID, "isTwoWay": true}})
	if backKeyID != key.Relation.BackKeyID {
		t.Fatal("reconfiguring the same relation created another back field")
	}
	storedDest, _ = av.ParseAttributeView(dest.ID)
	back, _ = storedDest.GetKey(backKeyID)
	if "回链" != back.Name {
		t.Fatal("omitting the back field name changed its existing name")
	}
	key = databaseKeyTestUpdate(t, source.ID, "rollup", map[string]any{"rollup": map[string]any{"relationKeyID": "relation", "keyID": "number", "operator": "Sum"}})
	if nil == key.Rollup || nil == key.Rollup.Calc || av.CalcOperatorSum != key.Rollup.Calc.Operator {
		t.Fatal("rollup was not configured")
	}
	for _, setting := range []string{"relationFilters", "rollupFilters"} {
		field := "relation"
		if "rollupFilters" == setting {
			field = "rollup"
		}
		key = databaseKeyTestUpdate(t, source.ID, field, map[string]any{setting: []any{map[string]any{"column": "number", "operator": "Is not empty"}}})
		if "relation" == field && 0 == len(key.Relation.CandidateFilters) || "rollup" == field && 0 == len(key.Rollup.Filters) {
			t.Fatal("filters were not saved")
		}
		result, callErr := databaseHandler(map[string]any{"action": "key_update", "id": source.ID, "keyID": field,
			"config": map[string]any{setting: []any{map[string]any{"column": "missing", "operator": "Is not empty"}}}})
		if nil != callErr || !result.IsError {
			t.Fatal("invalid target filter field should be rejected")
		}
		key = databaseKeyTestUpdate(t, source.ID, field, map[string]any{setting: []any{}})
		if "relation" == field && 0 != len(key.Relation.CandidateFilters) || "rollup" == field && 0 != len(key.Rollup.Filters) {
			t.Fatal("filters were not cleared")
		}
	}
	databaseKeyTestUpdate(t, source.ID, "relation", map[string]any{"relation": map[string]any{"avID": dest.ID, "isTwoWay": false}})
	storedDest, _ = av.ParseAttributeView(dest.ID)
	back, _ = storedDest.GetKey(backKeyID)
	if back.Relation.IsTwoWay || "" != back.Relation.BackKeyID {
		t.Fatal("disabling two-way relation left an active backlink")
	}
}

func TestDatabaseKeyUpdateRejectsInvalidConfigWithoutWriting(t *testing.T) {
	databaseKeyTestWorkspace(t)
	attrView := databaseKeyTestFixture(t,
		&av.KeyValues{Key: &av.Key{ID: "text", Name: "Text", Type: av.KeyTypeText}},
		&av.KeyValues{Key: &av.Key{ID: "primary", Name: "Primary", Type: av.KeyTypeBlock}},
		&av.KeyValues{Key: &av.Key{ID: "select", Type: av.KeyTypeSelect}},
		&av.KeyValues{Key: &av.Key{ID: "relation", Type: av.KeyTypeRelation}},
		&av.KeyValues{Key: &av.Key{ID: "rollup", Type: av.KeyTypeRollup}},
	)
	path := av.GetAttributeViewDataPath(attrView.ID)
	before, err := os.ReadFile(path)
	if nil != err {
		t.Fatal(err)
	}
	for _, test := range []struct {
		key    string
		config map[string]any
	}{
		{"missing", map[string]any{"name": "Name"}},
		{"text", map[string]any{}},
		{"text", map[string]any{"name": "Name", "type": "number"}},
		{"text", map[string]any{"unknown": true}},
		{"text", map[string]any{"name": " "}},
		{"text", map[string]any{"name": nil}},
		{"text", map[string]any{"type": "invalid"}},
		{"text", map[string]any{"type": "block"}},
		{"primary", map[string]any{"type": "text"}},
		{"text", map[string]any{"numberFormat": "percent"}},
		{"text", map[string]any{"dateFormat": "invalid"}},
		{"text", map[string]any{"template": "formula"}},
		{"text", map[string]any{"includeTime": true}},
		{"text", map[string]any{"autoFillNow": true}},
		{"text", map[string]any{"options": []any{}}},
		{"select", map[string]any{"options": []any{nil}}},
		{"select", map[string]any{"options": []any{map[string]any{"name": "One", "color": "999"}}}},
		{"select", map[string]any{"optionUpdate": map[string]any{"name": "missing"}}},
		{"select", map[string]any{"optionRemove": "missing"}},
		{"relation", map[string]any{"relation": map[string]any{"avID": attrView.ID}}},
		{"relation", map[string]any{"relation": map[string]any{"avID": "missing", "isTwoWay": true}}},
		{"rollup", map[string]any{"rollup": map[string]any{"relationKeyID": "text", "keyID": "text", "operator": "Sum"}}},
	} {
		result, callErr := databaseHandler(map[string]any{"action": "key_update", "id": attrView.ID, "keyID": test.key, "config": test.config})
		if nil != callErr || !result.IsError {
			t.Fatalf("expected invalid config to fail: %+v, %+v, %v", test, result, callErr)
		}
		after, readErr := os.ReadFile(path)
		if nil != readErr || string(before) != string(after) {
			t.Fatalf("invalid config changed persisted data: %+v, %v", test, readErr)
		}
	}
}
