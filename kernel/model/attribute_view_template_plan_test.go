// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/sql"
)

func newTemplatePlanTestView(size, displays int, layout av.LayoutType) (*av.AttributeView, *av.View) {
	keys := []*av.Key{av.NewKey("block", "Block", "", av.KeyTypeBlock), av.NewKey("text", "Text", "", av.KeyTypeText),
		av.NewKey("source", "Source", "", av.KeyTypeTemplate), av.NewKey("required", "Required", "", av.KeyTypeTemplate)}
	keys[2].Template = `.action{index . "Text"}`
	keys[3].Template = `.action{printf "%s eligible" (index . "Source")}`
	for i := range displays {
		key := av.NewKey(fmt.Sprintf("display%d", i), fmt.Sprintf("Display%d", i), "", av.KeyTypeTemplate)
		key.Template = fmt.Sprintf(`.action{printf "display%d:%%s" (index . "Required")}`, i)
		keys = append(keys, key)
	}
	view := &av.View{ID: "view", LayoutType: layout, PageSize: 1, Table: av.NewLayoutTable(),
		Filters: []*av.ViewFilter{{Column: "required", Operator: av.FilterOperatorContains,
			Value: &av.Value{Type: av.KeyTypeTemplate, Template: &av.ValueTemplate{Content: "eligible"}}}},
		Sorts: []*av.ViewSort{{Column: "required", Order: av.SortOrderDesc}}}
	database := &av.AttributeView{ID: "av", Views: []*av.View{view}, RenderedViewables: map[string]av.Viewable{}}
	for _, key := range keys {
		values := &av.KeyValues{Key: key}
		for i := range size {
			id := fmt.Sprintf("20261019000000-%07d", i)
			value := &av.Value{ID: id + "-" + key.ID, KeyID: key.ID, BlockID: id, Type: key.Type}
			content := fmt.Sprintf("row%07d", i)
			switch key.Type {
			case av.KeyTypeBlock:
				value.IsDetached, value.Block = true, &av.ValueBlock{Content: content}
				view.ItemIDs = append(view.ItemIDs, id)
			case av.KeyTypeText:
				value.Text = &av.ValueText{Content: content}
			case av.KeyTypeTemplate:
				value.Template = &av.ValueTemplate{Content: key.Template}
			}
			values.Values = append(values.Values, value)
		}
		database.KeyValues = append(database.KeyValues, values)
		view.Table.Columns = append(view.Table.Columns, &av.ViewTableColumn{BaseField: &av.BaseField{ID: key.ID}})
	}
	if layout == av.LayoutTypeList {
		view.List, view.Table = view.Table, nil
	} else if layout == av.LayoutTypeGallery {
		view.Gallery = av.NewLayoutGallery()
		view.Gallery.CoverFrom = av.CoverFromNone
		for _, column := range view.Table.Columns {
			view.Gallery.CardFields = append(view.Gallery.CardFields, &av.ViewGalleryCardField{BaseField: column.BaseField})
		}
		view.Table = nil
	}
	return database, view
}

func renderTemplatePlanTestView(database *av.AttributeView, view *av.View, selective bool, pageSize int) (av.Viewable, error) {
	context := sql.NewAttributeViewRenderContext()
	context.ReadOnly = true
	var rendered av.Viewable
	var plan *attributeViewTemplatePlan
	if selective {
		plan = planAttributeViewTemplates(database, view, "", false)
	}
	if plan == nil {
		rendered = sql.RenderViewWithContext(database, view, "", false, context)
	} else {
		rendered = sql.RenderViewWithDeferredTemplatesContext(database, view, "", false, context)
		sql.FillAttributeViewTemplateValuesForKeysWithContext(database, view, rendered.(av.Collection), plan.required, context)
	}
	if _, _, err := renderViewableInstance(rendered, view, database, 1, pageSize, false, "", context); err != nil {
		return nil, err
	}
	if plan != nil {
		sql.FillAttributeViewTemplateValuesForKeysWithContext(database, view, rendered.(av.Collection), plan.deferred, context)
	}
	return rendered, nil
}

func templatePlanSnapshot(t *testing.T, rendered av.Viewable) string {
	t.Helper()
	collection := rendered.(av.Collection)
	var rows []any
	for _, item := range collection.GetItems() {
		var values []any
		for _, value := range item.GetValues() {
			values = append(values, []any{value.KeyID, value.String(true), value.RenderedContent, value.HasRenderTemplate})
		}
		var colors *av.ItemConditionalColors
		switch row := item.(type) {
		case *av.TableRow:
			colors = row.ConditionalColors
		case *av.GalleryCard:
			colors = row.ConditionalColors
		}
		rows = append(rows, []any{item.GetID(), values, colors})
	}
	var calculations []any
	for _, field := range collection.GetFields() {
		if calc := field.GetCalc(); calc != nil && calc.Result != nil {
			calculations = append(calculations, []string{field.GetID(), calc.Result.String(true)})
		}
	}
	count := 0
	if gallery, ok := rendered.(*av.Gallery); ok {
		count = gallery.CardCount
	} else {
		count = av.TableFromViewable(rendered).RowCount
	}
	data, err := json.Marshal([]any{count, rows, calculations, rendered.GetGroupCalc()})
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

func TestAttributeViewTemplatePlanMatchesCompleteEvaluation(t *testing.T) {
	for _, layout := range []av.LayoutType{av.LayoutTypeTable, av.LayoutTypeList, av.LayoutTypeGallery} {
		for _, scenario := range []string{"dependencies", "rendered filter", "raw dependency", "conditional color", "calculation"} {
			t.Run(string(layout)+"/"+scenario, func(t *testing.T) {
				makeView := func() (*av.AttributeView, *av.View) {
					database, view := newTemplatePlanTestView(3, 2, layout)
					switch scenario {
					case "rendered filter":
						source, _ := database.GetKey("source")
						source.Template = `.action{index . "Block"}`
						text, _ := database.GetKey("text")
						text.RenderTemplate = `.action{printf "shown:%s" .Text_raw.Text.Content}`
						view.Filters = append(view.Filters, &av.ViewFilter{Column: "text", ValueSource: av.ValueSourceRendered,
							Operator: av.FilterOperatorContains, Value: &av.Value{Type: av.KeyTypeText, Text: &av.ValueText{Content: "shown:"}}})
						view.Sorts = []*av.ViewSort{{Column: "text", Order: av.SortOrderDesc, ValueSource: av.ValueSourceRendered}}
					case "raw dependency":
						key, _ := database.GetKey("display0")
						key.Template = `.action{.Source_raw.Template.Content}`
					case "conditional color":
						view.ConditionalColors = []*av.ConditionalColorRule{{ID: "color", Target: "item", Color: &av.ValueSelect{Color: "3"},
							Filter: &av.ViewFilter{Column: "display0", Operator: av.FilterOperatorContains,
								Value: &av.Value{Type: av.KeyTypeTemplate, Template: &av.ValueTemplate{Content: "eligible"}}}}}
					case "calculation":
						if layout == av.LayoutTypeGallery {
							view.Gallery.CardFields[4].Calc = &av.FieldCalc{Operator: av.CalcOperatorCountValues}
						} else {
							view.GetTableLayout().Columns[4].Calc = &av.FieldCalc{Operator: av.CalcOperatorCountValues}
						}
						view.GroupCalc = &av.GroupCalc{Field: "required", FieldCalc: &av.FieldCalc{Operator: av.CalcOperatorCountValues}}
					}
					return database, view
				}
				full, fullView := makeView()
				partial, view := makeView()
				plan := planAttributeViewTemplates(partial, view, "", false)
				if plan == nil || !plan.required["source"] || !plan.required["required"] || !plan.deferred["display1"] {
					t.Fatalf("missing transitive dependency or deferred display: %+v", plan)
				}
				want, err := renderTemplatePlanTestView(full, fullView, false, 1)
				if err != nil {
					t.Fatal(err)
				}
				got, err := renderTemplatePlanTestView(partial, view, true, 1)
				if err != nil {
					t.Fatal(err)
				}
				if actual, expected := templatePlanSnapshot(t, got), templatePlanSnapshot(t, want); actual != expected {
					t.Fatalf("selective result differs:\ngot  %s\nwant %s", actual, expected)
				}
				items := got.(av.Collection).GetItems()
				if len(items) != 1 || items[0].GetID() != view.ItemIDs[2] || items[0].GetValue("required").Template.Content != "row0000002 eligible" {
					t.Fatalf("filter, sort, or dependency output is incorrect: %+v", items)
				}
				values, _ := partial.GetKeyValues("display1")
				for _, value := range values.Values {
					if value.BlockID != items[0].GetID() && value.Template.Content != values.Key.Template {
						t.Fatal("display template outside current page was evaluated")
					}
				}
				if scenario == "rendered filter" {
					value := items[0].GetValue("text")
					if !value.HasRenderTemplate || value.RenderedContent != "shown:row0000002" {
						t.Fatalf("late evaluation cleared required display output: %+v", value)
					}
				}
				if scenario == "conditional color" {
					var colors *av.ItemConditionalColors
					switch item := items[0].(type) {
					case *av.TableRow:
						colors = item.ConditionalColors
					case *av.GalleryCard:
						colors = item.ConditionalColors
					}
					if colors == nil || colors.Background == nil || colors.Background.Color != "3" {
						t.Fatalf("conditional color dependency was not evaluated: %+v", colors)
					}
				}
				if scenario == "calculation" {
					field, _ := got.(av.Collection).GetField("display0")
					if calc := field.GetCalc(); calc == nil || calc.Result == nil || calc.Result.Number == nil || calc.Result.Number.Content != 3 {
						t.Fatalf("field calculation did not include off-page rows: %+v", calc)
					}
					if calc := got.GetGroupCalc(); calc == nil || calc.FieldCalc == nil || calc.FieldCalc.Result == nil || calc.FieldCalc.Result.Number == nil || calc.FieldCalc.Result.Number.Content != 3 {
						t.Fatalf("group calculation did not include off-page rows: %+v", calc)
					}
				}
			})
		}
	}
}

func TestAttributeViewTemplatePlanEligibility(t *testing.T) {
	for _, test := range []struct {
		name      string
		configure func(*av.AttributeView, *av.View)
		full      bool
	}{
		{"nested filter", func(_ *av.AttributeView, view *av.View) { view.Filters = []*av.ViewFilter{{Filters: view.Filters}} }, false},
		{"query-dependent group", func(_ *av.AttributeView, view *av.View) { view.Group = &av.ViewGroup{Field: "text"} }, true},
		{"kanban", func(_ *av.AttributeView, view *av.View) { view.LayoutType = av.LayoutTypeKanban }, true},
		{"calendar", func(_ *av.AttributeView, view *av.View) { view.LayoutType = av.LayoutTypeCalendar }, true},
		{"branch", func(database *av.AttributeView, _ *av.View) {
			database.KeyValues[4].Key.Template = `.action{if .Required}.action{.Required}.action{end}`
		}, true},
		{"dynamic key", func(database *av.AttributeView, _ *av.View) {
			database.KeyValues[4].Key.Template = `.action{index . (print "Required")}`
		}, true},
		{"parse error", func(database *av.AttributeView, _ *av.View) { database.KeyValues[4].Key.Template = `.action{` }, true},
		{"cycle", func(database *av.AttributeView, _ *av.View) {
			database.KeyValues[2].Key.Template = `.action{.Required}`
		}, true},
		{"later rendered dependency", func(database *av.AttributeView, _ *av.View) { database.KeyValues[1].Key.RenderTemplate = "display" }, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			database, view := newTemplatePlanTestView(3, 2, av.LayoutTypeTable)
			test.configure(database, view)
			if got := planAttributeViewTemplates(database, view, "", false); (got == nil) != test.full {
				t.Fatalf("unexpected plan: %+v", got)
			}
		})
	}
	database, view := newTemplatePlanTestView(3, 2, av.LayoutTypeTable)
	for _, query := range []string{"search", " search "} {
		if planAttributeViewTemplates(database, view, query, false) != nil {
			t.Fatal("search path must evaluate all templates")
		}
	}
	if planAttributeViewTemplates(database, view, "", true) != nil || planAttributeViewTemplates(nil, view, "", false) != nil {
		t.Fatal("empty rendering must not create a template plan")
	}
	view.Filters, view.Sorts = nil, nil
	database.KeyValues[4].Key.Template = `.action{if .Required}display.action{end}`
	if plan := planAttributeViewTemplates(database, view, "", false); plan == nil || len(plan.required) != 0 || len(plan.deferred) != 4 {
		t.Fatal("existing all-deferred eligibility regressed")
	}
}

func TestAttributeViewTemplatePlanClearsPreviousDisplayState(t *testing.T) {
	database, view := newTemplatePlanTestView(3, 2, av.LayoutTypeTable)
	text, _ := database.GetKey("text")
	text.RenderTemplate = `.action{printf "shown:%s" .Text_raw.Text.Content}`
	// 存储值筛选只使用原始值，不读取上次渲染的显示文本。
	view.Filters = []*av.ViewFilter{{Column: "text", Operator: av.FilterOperatorContains,
		Value: &av.Value{Type: av.KeyTypeText, Text: &av.ValueText{Content: "row"}}}}
	view.Sorts = nil
	values, _ := database.GetKeyValues("text")
	for _, value := range values.Values {
		value.HasRenderTemplate, value.RenderedContent = true, "stale"
	}
	rendered, err := renderTemplatePlanTestView(database, view, true, 1)
	if err != nil || rendered.(av.Collection).CountItems() != 1 {
		t.Fatalf("previous display state affected pagination: %v", err)
	}
	if value := rendered.(av.Collection).GetItems()[0].GetValue("text"); !strings.HasPrefix(value.RenderedContent, "shown:") {
		t.Fatalf("display was not recalculated: %+v", value)
	}
	if values.Values[1].RenderedContent != "" || values.Values[1].HasRenderTemplate {
		t.Fatal("off-page previous display state was retained")
	}
}

func TestRenderAttributeViewUsesTemplateDependencyPlan(t *testing.T) {
	database, view := newTemplatePlanTestView(3, 2, av.LayoutTypeTable)
	rendered, err := renderAttributeView(database, "", view.ID, "", "", 1, 1, nil, false, false, nil, "")
	if err != nil {
		t.Fatal(err)
	}
	items := rendered.(av.Collection).GetItems()
	if len(items) != 1 || items[0].GetValue("display0").Template.Content != "display0:row0000002 eligible" {
		t.Fatalf("render entry did not evaluate the visible dependency chain: %+v", items)
	}
	values, _ := database.GetKeyValues("display0")
	for _, value := range values.Values {
		if value.BlockID != items[0].GetID() && value.Template.Content != values.Key.Template {
			t.Fatal("render entry evaluated an off-page display template")
		}
	}
}
