// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func setupAttributeViewOrderReuseTest(t *testing.T, layout av.LayoutType) func() *av.AttributeView {
	return setupAttributeViewOrderReuseFixture(t, layout, 600, 2)
}

func setupAttributeViewOrderReuseFixture(t testing.TB, layout av.LayoutType, size, displays int) func() *av.AttributeView {
	t.Helper()
	previousDir, previousLang, previousLangs := util.DataDir, util.Lang, util.AttrViewLangs
	util.DataDir, util.Lang = t.TempDir(), "en"
	util.AttrViewLangs = map[string]map[string]any{"en": {"key": "Key", "table": "Table", "list": "List", "gallery": "Gallery", "select": "Select"}}
	cache.ClearAVCache()
	t.Cleanup(func() {
		util.DataDir, util.Lang, util.AttrViewLangs = previousDir, previousLang, previousLangs
		cache.ClearAVCache()
	})
	database, view := newTemplatePlanTestView(size, displays, layout)
	database.ID, view.ID = "20261019130000-av00001", "20261019130000-view001"
	database.Spec = 6
	data, err := json.Marshal(database)
	if err != nil {
		t.Fatal(err)
	}
	directory := filepath.Join(util.DataDir, "storage", "av")
	if err = os.MkdirAll(directory, 0700); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(directory, database.ID+".json"), data, 0600); err != nil {
		t.Fatal(err)
	}
	return func() *av.AttributeView {
		t.Helper()
		result, parseErr := av.ParseAttributeView(database.ID)
		if parseErr != nil {
			t.Fatal(parseErr)
		}
		return result
	}
}

func TestAttributeViewOrderReuseMatchesCompletePageRendering(t *testing.T) {
	for _, layout := range []av.LayoutType{av.LayoutTypeTable, av.LayoutTypeList, av.LayoutTypeGallery} {
		t.Run(string(layout), func(t *testing.T) {
			load := setupAttributeViewOrderReuseTest(t, layout)
			cold := load()
			cold.Views[0].ConditionalColors = []*av.ConditionalColorRule{{ID: "page-color", Target: "item", Color: &av.ValueSelect{Color: "3"},
				Filter: &av.ViewFilter{Column: "required", Operator: av.FilterOperatorContains,
					Value: &av.Value{Type: av.KeyTypeTemplate, Template: &av.ValueTemplate{Content: "eligible"}}}}}
			if err := av.SaveAttributeView(cold); err != nil {
				t.Fatal(err)
			}
			cold = load()
			viewID := cold.Views[0].ID
			if _, err := renderAttributeView(cold, "", viewID, "", "", 1, 50, nil, false, false, nil, ""); err != nil {
				t.Fatal(err)
			}
			hot := load()
			actual, err := renderAttributeView(hot, "", viewID, "", "", 2, 50, nil, false, false, nil, "")
			if err != nil {
				t.Fatal(err)
			}
			values, _ := hot.GetKeyValues("required")
			if values.Values[0].Template.Content != values.Key.Template {
				t.Fatal("cached order still evaluated off-page required templates")
			}
			data, _ := json.Marshal(load())
			complete, err := av.ParseAttributeViewData(hot.ID, data)
			if err != nil {
				t.Fatal(err)
			}
			expected, err := renderAttributeView(complete, "", viewID, "", "", 2, 50, nil, false, false, nil, "")
			if err != nil {
				t.Fatal(err)
			}
			if got, want := templatePlanSnapshot(t, actual), templatePlanSnapshot(t, expected); got != want {
				t.Fatalf("reused page differs: got=%s want=%s", got, want)
			}
			gotJSON, _ := json.Marshal(actual)
			wantJSON, _ := json.Marshal(expected)
			if string(gotJSON) != string(wantJSON) {
				t.Fatal("reused page changed response metadata or value identity")
			}
			changed := load()
			text, _ := changed.GetKeyValues("text")
			text.Values[0].Text.Content = "zzz temporary edit"
			rendered, err := renderAttributeView(changed, "", viewID, "", "", 1, 1, nil, false, false, nil, "")
			if err != nil || rendered.(av.Collection).GetItems()[0].GetID() != text.Values[0].BlockID {
				t.Fatalf("temporary data mutation reused stale order: %v", err)
			}
		})
	}
}

func TestAttributeViewOrderReuseRequiresCurrentLiveSourceAndRequiredTemplates(t *testing.T) {
	load := setupAttributeViewOrderReuseTest(t, av.LayoutTypeTable)
	database := load()
	view := database.Views[0]
	checkAttrView(database, view)
	upgradeAttributeViewSpec(database)
	read := planAttributeViewOrderReuse(database, view, "", false)
	write := planAttributeViewOrderReuse(database, view, "", true)
	if read == nil || write == nil || read.key == write.key {
		t.Fatal("eligible source did not separate read and write scopes")
	}
	data, err := json.Marshal(database)
	if err != nil {
		t.Fatal(err)
	}
	snapshot, err := av.ParseAttributeViewData(database.ID, data)
	if err != nil || planAttributeViewOrderReuse(snapshot, snapshot.Views[0], "", false) != nil {
		t.Fatalf("in-memory snapshot entered live reuse: %v", err)
	}
	path := filepath.Join(t.TempDir(), database.ID+".json")
	if err = os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
	snapshot, err = av.ParseAttributeViewByPath(path)
	if err != nil || planAttributeViewOrderReuse(snapshot, snapshot.Views[0], "", false) != nil {
		t.Fatalf("historical path entered live reuse: %v", err)
	}
	view.Filters, view.Sorts = nil, nil
	if planAttributeViewOrderReuse(database, view, "", false) != nil {
		t.Fatal("display-only templates paid for cross-request order reuse")
	}
	current := load()
	cache.RemoveAVData(database.ID)
	if planAttributeViewOrderReuse(current, current.Views[0], "", false) != nil {
		t.Fatal("invalidated source entered a new cache version")
	}
}

func TestAttributeViewOrderReuseExcludesExternalAndDynamicDependencies(t *testing.T) {
	for _, scenario := range []string{"bound", "rich", "time", "raw", "pointer format", "relation", "relative date", "calculation", "group"} {
		t.Run(scenario, func(t *testing.T) {
			database, view := newTemplatePlanTestView(600, 2, av.LayoutTypeTable)
			switch scenario {
			case "bound":
				database.GetBlockKeyValues().Values[0].IsDetached = false
			case "rich":
				database.KeyValues[1].Values[0].Text.Rich = &av.ValueTextRich{Content: "((block))"}
			case "time":
				database.KeyValues[2].Key.Template = `.action{now}`
			case "raw":
				database.KeyValues[2].Key.Template = `.action{.Text_raw.Text.Content}`
			case "pointer format":
				database.KeyValues[2].Key.Template = `.action{printf "%p" .Text}`
			case "relation":
				database.KeyValues[1].Key.Type = av.KeyTypeRelation
			case "relative date":
				view.Filters[0].RelativeDate = &av.RelativeDate{}
			case "calculation":
				view.Table.Columns[0].Calc = &av.FieldCalc{Operator: av.CalcOperatorCountAll}
			case "group":
				view.Group = &av.ViewGroup{Field: "text"}
			}
			if staticAttributeViewOrder(database, view) {
				t.Fatal("untracked dependency was admitted to cross-request reuse")
			}
		})
	}
}

func TestAttributeViewOrderReuseTracksSavedSourceSortAndEmptyResults(t *testing.T) {
	for _, scenario := range []string{"saved source", "temporary sort", "empty filter", "writable", "later value chunk"} {
		t.Run(scenario, func(t *testing.T) {
			load := setupAttributeViewOrderReuseTest(t, av.LayoutTypeTable)
			initial := load()
			viewID := initial.Views[0].ID
			if _, err := renderAttributeView(initial, "", viewID, "", "", 1, 50, nil, false, false, nil, ""); err != nil {
				t.Fatal(err)
			}
			current := load()
			writable := false
			switch scenario {
			case "saved source":
				text, _ := current.GetKeyValues("text")
				text.Values[0].Text.Content = "zzz saved change"
				if err := av.SaveAttributeView(current); err != nil {
					t.Fatal(err)
				}
				current = load()
			case "temporary sort":
				current.Views[0].Sorts[0].Order = av.SortOrderAsc
			case "empty filter":
				current.Views[0].Filters[0].Value.Template.Content = "no rows satisfy this filter"
			case "writable":
				writable = true
			case "later value chunk":
				text, _ := current.GetKeyValues("text")
				text.Values[513].Text.Content = "zzz later chunk change"
			}
			data, err := json.Marshal(current)
			if err != nil {
				t.Fatal(err)
			}
			complete, err := av.ParseAttributeViewData(current.ID, data)
			if err != nil {
				t.Fatal(err)
			}
			actual, err := renderAttributeView(current, "", viewID, "", "", 1, 50, nil, false, writable, nil, "")
			if err != nil {
				t.Fatal(err)
			}
			expected, err := renderAttributeView(complete, "", viewID, "", "", 1, 50, nil, false, writable, nil, "")
			if err != nil {
				t.Fatal(err)
			}
			got, _ := json.Marshal(actual)
			want, _ := json.Marshal(expected)
			if string(got) != string(want) {
				t.Fatalf("%s reused an incompatible order", scenario)
			}
			if scenario == "empty filter" && actual.(av.Collection).CountItems() != 0 {
				t.Fatal("empty filtered order retained previous rows")
			}
		})
	}
}
