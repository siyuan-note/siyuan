// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package sql

import (
	"testing"

	"github.com/siyuan-note/siyuan/kernel/av"
)

func TestRenderViewItemKeepsFullViewAndOtherItems(t *testing.T) {
	for _, layout := range []av.LayoutType{av.LayoutTypeTable, av.LayoutTypeList, av.LayoutTypeCalendar, av.LayoutTypeGallery, av.LayoutTypeKanban} {
		t.Run(string(layout), func(t *testing.T) {
			database := newItemRenderTestDatabase()
			view := database.Views[0]
			view.LayoutType = layout
			switch layout {
			case av.LayoutTypeCalendar:
				view.Calendar = &av.LayoutCalendar{LayoutTable: view.Table}
			case av.LayoutTypeList:
				view.List = av.NewLayoutList()
				view.List.Columns = view.Table.Columns
			case av.LayoutTypeGallery:
				view.Gallery = av.NewLayoutGallery()
				for _, column := range view.Table.Columns {
					view.Gallery.CardFields = append(view.Gallery.CardFields, &av.ViewGalleryCardField{BaseField: column.BaseField})
				}
			case av.LayoutTypeKanban:
				view.Kanban = av.NewLayoutKanban()
				for _, column := range view.Table.Columns {
					view.Kanban.Fields = append(view.Kanban.Fields, &av.ViewKanbanField{BaseField: column.BaseField})
				}
			}
			before := RenderView(database, view, "", false)
			itemID := database.GetBlockKeyValues().Values[1].BlockID
			rendered := RenderViewItem(database, view, itemID).(av.Collection)
			if len(rendered.GetItems()) != 1 || rendered.GetItems()[0].GetID() != itemID {
				t.Fatalf("unexpected item scope: %+v", rendered.GetItems())
			}
			if value := rendered.GetValue(itemID, "leaf-value"); value == nil || value.Template.Content != "fresh-1" {
				t.Fatalf("item template was not evaluated: %+v", value)
			}
			if len(before.(av.Collection).GetItems()) != 2 || view.GroupItemIDs != nil {
				t.Fatal("item rendering changed the complete view or its cache")
			}
			if layout != av.LayoutTypeCalendar && database.RenderedViewables[view.ID] != before {
				t.Fatal("item rendering replaced the complete view cache")
			}
			missing := RenderViewItem(database, view, "20261008000000-missing").(av.Collection)
			if len(missing.GetItems()) != 0 {
				t.Fatal("missing item fell back to all records")
			}
		})
	}
}

func TestRenderViewItemSelfRelationTemplateRollup(t *testing.T) {
	database := newItemRenderTestDatabase()
	templateKey, _ := database.GetKey("leaf-value")
	rollup := addNestedRollupTestFields(database, database, templateKey, true)
	itemID := database.GetBlockKeyValues().Values[1].BlockID
	collection := RenderViewItem(database, database.Views[0], itemID).(av.Collection)
	if value := collection.GetValue(itemID, rollup.ID); value == nil || value.String(true) != "fresh-1" {
		t.Fatalf("self relation template rollup was not refreshed: %+v", value)
	}
}

func TestItemRenderRollupsLimitRelatedTemplates(t *testing.T) {
	for _, nested := range []bool{false, true} {
		for _, empty := range []bool{false, true} {
			leaf := newItemRenderTestDatabase()
			key, _ := leaf.GetKey("leaf-value")
			outer, rollup := newNestedRollupTestLevel("outer", leaf, key, false)
			cache := map[string]*av.AttributeView{outer.ID: outer, leaf.ID: leaf}
			if nested {
				middle, middleKey := outer, rollup
				outer, rollup = newNestedRollupTestLevel("top", middle, middleKey, false)
				cache[outer.ID] = outer
			}
			itemID := outer.GetBlockKeyValues().Values[0].BlockID
			if empty {
				values, _ := outer.GetKeyValues(rollup.Rollup.RelationKeyID)
				values.Values[0].Relation.BlockIDs = nil
			}
			context := NewAttributeViewRenderContext()
			context.itemScope = true
			depth := 1
			collection := renderView(outer, attributeViewItemScope(outer.Views[0], []string{itemID}), "", &depth,
				cache, false, false, context).(av.Collection)
			want := "fresh-0"
			if empty {
				want = ""
			}
			if got := collection.GetValue(itemID, rollup.ID); got == nil || got.String(true) != want {
				t.Fatalf("nested=%v empty=%v: unexpected rollup %+v, want %q", nested, empty, got, want)
			}
			values, _ := leaf.GetKeyValues(key.ID)
			for _, value := range values.Values {
				if empty || value.BlockID != leaf.GetBlockKeyValues().Values[0].BlockID {
					t.Fatalf("evaluated an unrelated template: nested=%v empty=%v value=%+v", nested, empty, value)
				}
			}
		}
	}
}

func TestItemRenderRollupFiltersKeepCompleteTargetScope(t *testing.T) {
	leaf := newItemRenderTestDatabase()
	key, _ := leaf.GetKey("leaf-value")
	outer, rollup := newNestedRollupTestLevel("outer", leaf, key, false)
	rollup.Rollup.Filters = []*av.ViewFilter{{Column: key.ID, Operator: av.FilterOperatorIsEqual,
		Value: &av.Value{Type: av.KeyTypeTemplate, Template: &av.ValueTemplate{Content: "fresh-1"}}}}
	itemID := outer.GetBlockKeyValues().Values[0].BlockID
	context := NewAttributeViewRenderContext()
	context.itemScope = true
	depth := 1
	collection := renderView(outer, attributeViewItemScope(outer.Views[0], []string{itemID}), "", &depth,
		map[string]*av.AttributeView{outer.ID: outer, leaf.ID: leaf}, false, false, context).(av.Collection)
	if value := collection.GetValue(itemID, rollup.ID); value == nil || value.String(true) != "" {
		t.Fatalf("excluded related item remained in the rollup: %+v", value)
	}
}

func newItemRenderTestDatabase() *av.AttributeView {
	database, textKey := newNestedRollupTestLeaf(av.KeyTypeText)
	textKey.Name = "Text"
	templateKey := &av.Key{ID: "leaf-value", Name: "Template", Type: av.KeyTypeTemplate, Template: ".action{.Text}"}
	textKey.ID = "text"
	for _, value := range database.KeyValues[1].Values {
		value.KeyID = textKey.ID
	}
	database.Views[0].Table.Columns[1].ID = textKey.ID
	database.KeyValues = append(database.KeyValues, &av.KeyValues{Key: templateKey})
	database.Views[0].Table.Columns = append(database.Views[0].Table.Columns,
		&av.ViewTableColumn{BaseField: &av.BaseField{ID: templateKey.ID}})
	return database
}
