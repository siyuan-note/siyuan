// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package tools

import (
	"encoding/json"
	"path/filepath"
	"slices"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestDatabaseViewActionsAndArguments(t *testing.T) {
	validator, err := CompileToolValidator(DatabaseTool)
	if nil != err {
		t.Fatal(err)
	}
	for _, action := range []string{"view_add", "view_duplicate", "view_remove", "view_update", "view_move", "view_field_move", "view_visibility_set",
		"view_filters_set", "view_sorts_set", "view_group_set", "view_layout_set"} {
		effects, ok := DatabaseTool.EffectsFor(action)
		if !ok || !effects.LocalWrite {
			t.Fatalf("%s must require write approval", action)
		}
	}
	if effects, ok := DatabaseTool.EffectsFor("view_get"); !ok || !effects.LocalRead || effects.LocalWrite {
		t.Fatal("view_get must be read only")
	}
	for _, args := range []map[string]any{
		{"action": "view_add", "layout": "future-layout", "name": "New view"},
		{"action": "view_update", "name": "New name", "icon": "", "desc": ""},
		{"action": "view_move", "previousID": ""},
		{"action": "view_field_move", "keyID": "key", "previousID": ""},
		{"action": "view_visibility_set", "viewIDs": []any{"view-a"}},
		{"action": "view_filters_set", "revision": "rev", "filters": []any{map[string]any{"combination": "and", "filters": []any{}}}},
		{"action": "view_sorts_set", "revision": "rev", "sorts": []any{map[string]any{"column": "key", "order": "ASC"}}},
		{"action": "view_group_set", "revision": "rev", "group": map[string]any{"field": "key", "hideEmpty": true}},
	} {
		if err = validator.ValidateInput(args); nil != err {
			t.Fatalf("valid view argument rejected: %v", err)
		}
	}
	if err = validator.ValidateInput(map[string]any{"action": "view_filters_set", "filters": "[]"}); nil == err {
		t.Fatal("string encoded filters must be rejected")
	}
}

func TestDatabaseViewFieldMovePersistence(t *testing.T) {
	previousData, previousDB, previousConf := util.DataDir, util.BlockTreeDBPath, model.Conf
	util.DataDir = t.TempDir()
	util.BlockTreeDBPath = filepath.Join(util.DataDir, "blocktree.db")
	model.Conf = model.NewAppConf()
	model.Conf.FileTree.Store(conf.NewFileTree())
	treenode.InitBlockTree(true)
	t.Cleanup(func() {
		cache.ClearTreeCache()
		treenode.CloseDatabase()
		util.DataDir, util.BlockTreeDBPath, model.Conf = previousData, previousDB, previousConf
		if previousDB != "" {
			treenode.InitBlockTree(false)
		}
	})
	boxID, rootID, avID, blockID := ast.NewNodeID(), ast.NewNodeID(), ast.NewNodeID(), ast.NewNodeID()
	if err := (&model.Box{ID: boxID}).SaveConf(conf.NewBoxConf()); err != nil {
		t.Fatal(err)
	}
	attrView := &av.AttributeView{ID: avID, Spec: av.PlainTextSpec, Views: []*av.View{{ID: ast.NewNodeID(), LayoutType: av.LayoutTypeTable, Table: &av.LayoutTable{}}}}
	view := &av.View{ID: ast.NewNodeID(), LayoutType: av.LayoutTypeTable, Table: &av.LayoutTable{Columns: []*av.ViewTableColumn{
		{BaseField: &av.BaseField{ID: "primary"}}, {BaseField: &av.BaseField{ID: "hidden", Hidden: true}, Width: "234px"},
	}}}
	attrView.Views = append(attrView.Views, view)
	if err := av.SaveAttributeView(attrView); err != nil {
		t.Fatal(err)
	}
	tree := treenode.NewTree(boxID, "/"+rootID+".sy", "/Database", "Database")
	node := util.NewLute().BlockDOM2Tree(`<div class="av" data-type="NodeAttributeView" data-node-id="` + blockID + `" data-av-id="` + avID + `" data-av-type="table"></div>`).Root.FirstChild
	tree.Root.AppendChild(node)
	if _, err := filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	treenode.UpsertBlockTree(tree)
	validator, err := CompileToolValidator(DatabaseTool)
	if err != nil {
		t.Fatal(err)
	}
	call := func(action string, extra map[string]any, want []string) {
		t.Helper()
		args := map[string]any{"action": action, "id": avID, "blockID": blockID, "viewID": view.ID}
		for key, value := range extra {
			args[key] = value
		}
		result, err := databaseHandler(args)
		if err != nil || result.IsError {
			t.Fatalf("%s: %+v, %v", action, result, err)
		}
		if err = validator.ValidateOutput(result); err != nil {
			t.Fatal(err)
		}
		var output struct {
			Data struct {
				FieldIDs []string `json:"fieldIDs"`
			} `json:"data"`
		}
		if err = json.Unmarshal([]byte(result.Content[0].Text), &output); err != nil {
			t.Fatal(err)
		}
		if !slices.Equal(output.Data.FieldIDs, want) {
			t.Fatalf("unexpected field order: %v", output.Data.FieldIDs)
		}
	}
	call("view_get", nil, []string{"primary", "hidden"})
	call("view_field_move", map[string]any{"keyID": "primary", "previousID": "hidden"}, []string{"hidden", "primary"})
	for _, extra := range []map[string]any{
		{"keyID": "primary"}, {"keyID": "primary", "previousID": nil},
		{"previousID": ""}, {"keyID": "missing", "previousID": ""},
		{"keyID": "primary", "previousID": "missing"}, {"keyID": "primary", "previousID": "", "viewID": "missing"},
	} {
		args := map[string]any{"action": "view_field_move", "id": avID, "blockID": blockID, "viewID": view.ID}
		for key, value := range extra {
			args[key] = value
		}
		if result, err := databaseHandler(args); err != nil || !result.IsError {
			t.Fatalf("invalid move accepted: %+v, %v", result, err)
		}
	}
	call("view_get", nil, []string{"hidden", "primary"})
	call("view_field_move", map[string]any{"keyID": "primary", "previousID": ""}, []string{"primary", "hidden"})
	stored, err := av.ParseAttributeView(avID)
	if err != nil {
		t.Fatal(err)
	}
	if !stored.GetView(view.ID).Table.Columns[1].Hidden || stored.GetView(view.ID).Table.Columns[1].Width != "234px" {
		t.Fatal("column configuration changed")
	}
	if stored.Views[0].ID != attrView.Views[0].ID {
		t.Fatal("view order changed")
	}
}

func TestDatabaseViewPartialUpdateArguments(t *testing.T) {
	update, err := databaseViewUpdateConfig(map[string]any{"name": "Weekly tasks"})
	if nil != err || nil == update.Name || *update.Name != "Weekly tasks" || nil != update.Icon || nil != update.Desc {
		t.Fatalf("omitted fields must stay absent: %+v, %v", update, err)
	}
	update, err = databaseViewUpdateConfig(map[string]any{"icon": "", "desc": ""})
	if nil != err || nil != update.Name || nil == update.Icon || *update.Icon != "" || nil == update.Desc || *update.Desc != "" {
		t.Fatalf("explicit empty fields must preserve clearing semantics: %+v, %v", update, err)
	}
	for _, invalid := range []map[string]any{{}, {"name": nil}, {"icon": true}, {"desc": 1}} {
		if _, err = databaseViewUpdateConfig(invalid); nil == err {
			t.Fatalf("invalid update accepted: %+v", invalid)
		}
	}
}

func TestDatabaseViewConfigurationValidation(t *testing.T) {
	attrView := &av.AttributeView{KeyValues: []*av.KeyValues{
		{Key: &av.Key{ID: "text", Type: av.KeyTypeText}},
		{Key: &av.Key{ID: "rendered", Type: av.KeyTypeNumber, RenderTemplate: "{{.Number}}"}},
		{Key: &av.Key{ID: "checkbox", Type: av.KeyTypeCheckbox}},
		{Key: &av.Key{ID: "date", Type: av.KeyTypeDate}},
		{Key: &av.Key{ID: "rollup", Type: av.KeyTypeRollup}},
		{Key: &av.Key{ID: "select", Type: av.KeyTypeSelect}},
	}}
	valid := []*av.ViewFilter{{Combination: av.FilterCombinationAnd, Filters: []*av.ViewFilter{
		{Column: "text", Operator: av.FilterOperatorContains, Value: &av.Value{Type: av.KeyTypeText}},
		{Column: "checkbox", Operator: av.FilterOperatorIsTrue},
		{Combination: av.FilterCombinationOr, Filters: []*av.ViewFilter{
			{Column: "date", Operator: av.FilterOperatorIsBetween, Value: &av.Value{Type: av.KeyTypeDate}},
			{Column: "select", Operator: av.FilterOperatorIsEqual, Value: &av.Value{Type: av.KeyTypeSelect}},
		}},
	}}}
	if err := databaseValidateViewFilters(attrView, valid); nil != err {
		t.Fatalf("nested filter should be valid: %v", err)
	}
	for _, rendered := range []*av.ViewFilter{
		{Column: "rendered", ValueSource: av.ValueSourceRendered, Operator: av.FilterOperatorIsGreater,
			Value: &av.Value{Type: av.KeyTypeTemplate, Template: &av.ValueTemplate{Content: "100"}}},
		{Column: "rendered", ValueSource: av.ValueSourceRendered, Operator: av.FilterOperatorIsLessOrEqual,
			Value: &av.Value{Type: av.KeyTypeText, Text: &av.ValueText{Content: "100"}}},
	} {
		if err := databaseValidateViewFilters(attrView, []*av.ViewFilter{rendered}); nil != err {
			t.Fatalf("rendered filter should match the frontend format: %v", err)
		}
	}
	rollupDate := &av.ViewFilter{Column: "rollup", Operator: av.FilterOperatorIsBetween,
		Value:        &av.Value{Type: av.KeyTypeRollup, Rollup: &av.ValueRollup{Contents: []*av.Value{{Type: av.KeyTypeDate}}}},
		RelativeDate: &av.RelativeDate{Count: 7, Unit: av.RelativeDateUnitDay, Direction: av.RelativeDateDirectionAfter}}
	if err := databaseValidateViewFilters(attrView, []*av.ViewFilter{rollupDate}); nil != err {
		t.Fatalf("date rollup should allow relative dates: %v", err)
	}
	for _, invalid := range []*av.ViewFilter{
		{Column: "missing", Operator: av.FilterOperatorContains},
		{Column: "text", Operator: av.FilterOperatorIsBetween},
		{Column: "text", Operator: av.FilterOperatorContains, Value: &av.Value{Type: av.KeyTypeNumber}},
		{Column: "rollup", Operator: av.FilterOperatorIsBetween,
			Value:        &av.Value{Type: av.KeyTypeRollup, Rollup: &av.ValueRollup{Contents: []*av.Value{{Type: av.KeyTypeNumber}}}},
			RelativeDate: &av.RelativeDate{Count: 7, Unit: av.RelativeDateUnitDay, Direction: av.RelativeDateDirectionAfter}},
		{Combination: "xor", Filters: valid},
	} {
		if err := databaseValidateViewFilters(attrView, []*av.ViewFilter{invalid}); nil == err {
			t.Fatalf("invalid filter accepted: %+v", invalid)
		}
	}
	if err := databaseValidateViewSorts(attrView, []*av.ViewSort{{Column: "date", Order: av.SortOrderAsc}}); nil != err {
		t.Fatal(err)
	}
	if err := databaseValidateViewSorts(attrView, []*av.ViewSort{{Column: "text", Order: "UP"}}); nil == err {
		t.Fatal("invalid sort order accepted")
	}
	if err := databaseValidateViewGroup(attrView, &av.View{LayoutType: av.LayoutTypeCalendar}, &av.ViewGroup{Field: "text"}); nil == err {
		t.Fatal("calendar grouping accepted")
	}
	if err := databaseValidateViewGroup(attrView, &av.View{LayoutType: av.LayoutTypeKanban}, &av.ViewGroup{}); nil == err {
		t.Fatal("kanban grouping cleared")
	}
}
