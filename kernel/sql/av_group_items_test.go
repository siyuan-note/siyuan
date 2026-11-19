// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package sql

import (
	"encoding/json"
	"fmt"
	"reflect"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/av"
)

func TestRenderViewGroupItemsStoredValues(t *testing.T) {
	values := []struct {
		typ     av.KeyType
		content string
	}{
		{av.KeyTypeText, `{"text":{"content":"stored"}}`},
		{av.KeyTypeNumber, `{"number":{"content":12.5,"isNotEmpty":true}}`},
		{av.KeyTypeDate, `{"date":{"content":1794748624000,"isNotEmpty":true}}`},
		{av.KeyTypeSelect, `{"mSelect":[{"content":"one"}]}`},
		{av.KeyTypeMSelect, `{"mSelect":[{"content":"one"},{"content":"two"}]}`},
		{av.KeyTypeCheckbox, `{"checkbox":{"checked":true}}`},
		{av.KeyTypeURL, `{"url":{"content":"https://b3log.org"}}`},
		{av.KeyTypeEmail, `{"email":{"content":"test@b3log.org"}}`},
		{av.KeyTypePhone, `{"phone":{"content":"123456"}}`},
		{av.KeyTypeMAsset, `{"mAsset":[{"name":"example","content":"assets/example.png","type":"image"}]}`},
	}
	for _, layout := range []av.LayoutType{av.LayoutTypeTable, av.LayoutTypeList, av.LayoutTypeGallery, av.LayoutTypeKanban} {
		for _, value := range values {
			t.Run(string(layout)+"/"+string(value.typ), func(t *testing.T) {
				database := newItemRenderTestDatabase()
				view := database.Views[0]
				field := database.KeyValues[1]
				field.Key.Type, field.Key.RenderTemplate = value.typ, "display"
				field.Values = field.Values[:1]
				stored := field.Values[0]
				*stored = av.Value{ID: stored.ID, KeyID: field.Key.ID, BlockID: stored.BlockID, Type: value.typ}
				if err := json.Unmarshal([]byte(value.content), stored); err != nil {
					t.Fatal(err)
				}
				rollup := addNestedRollupTestFields(database, database, database.KeyValues[2].Key, true)
				view.ItemIDs = []string{database.GetBlockKeyValues().Values[1].BlockID, stored.BlockID}
				view.Group = &av.ViewGroup{Field: field.Key.ID}
				view.PageSize = 1
				view.Filters = []*av.ViewFilter{{Column: field.Key.ID, Operator: av.FilterOperatorIsEmpty}}
				view.LayoutType = layout
				switch layout {
				case av.LayoutTypeList:
					view.List = view.Table
				case av.LayoutTypeGallery:
					view.Gallery = av.NewLayoutGallery()
					view.Gallery.CoverFrom = av.CoverFromNone
					for _, col := range view.Table.Columns {
						view.Gallery.CardFields = append(view.Gallery.CardFields, &av.ViewGalleryCardField{BaseField: col.BaseField})
					}
				case av.LayoutTypeKanban:
					view.Kanban = av.NewLayoutKanban()
					for _, col := range view.Table.Columns {
						view.Kanban.Fields = append(view.Kanban.Fields, &av.ViewKanbanField{BaseField: col.BaseField})
					}
				}
				cached := &av.Table{}
				database.RenderedViewables[view.ID] = cached
				items := RenderViewGroupItems(database, view)
				if len(items) != 2 || items[0].GetID() != view.ItemIDs[0] {
					t.Fatalf("group source lost empty values, rows or manual order: %+v", items)
				}
				empty := items[0].GetValue(field.Key.ID)
				if value.typ == av.KeyTypeCheckbox {
					if empty.Checkbox.Checked {
						t.Fatal("missing checkbox value should be unchecked")
					}
				} else if !empty.IsBlank() {
					t.Fatal("missing field value should be blank")
				}
				if len(database.KeyValues[2].Values) != 0 || database.GetValue(rollup.ID, stored.BlockID).String(true) != "stale" {
					t.Fatal("stored grouping evaluated unrelated templates or rollups")
				}
				if len(database.RenderedViewables) != 1 || database.RenderedViewables[view.ID] != cached || view.GroupItemIDs != nil {
					t.Fatal("group source changed the full-view cache or row scope")
				}
				snapshot := func(items []av.Item) []string {
					var ret []string
					for _, item := range items {
						ret = append(ret, fmt.Sprintf("%s:%s", item.GetID(), item.GetValue(field.Key.ID).String(false)))
					}
					return ret
				}
				got := snapshot(items)
				delete(database.RenderedViewables, view.ID)
				want := snapshot(RenderView(database, view, "", false).(av.Collection).GetItems())
				if !reflect.DeepEqual(got, want) {
					t.Fatalf("group source=%v, full render=%v", got, want)
				}
			})
		}
	}
}

func TestRenderViewGroupItemsComputedValues(t *testing.T) {
	for _, field := range []string{"block", "template", "rendered", "relation", "rollup", "created", "updated"} {
		t.Run(field, func(t *testing.T) {
			database := newItemRenderTestDatabase()
			view := database.Views[0]
			key := database.KeyValues[1].Key
			view.Group = &av.ViewGroup{Field: key.ID}
			switch field {
			case "block":
				view.Group.Field = database.GetBlockKey().ID
			case "template":
				view.Group.Field = "leaf-value"
			case "rendered":
				key.RenderTemplate = `.action{index . "Template"}`
				view.Group.ValueSource = av.ValueSourceRendered
			case "relation", "rollup":
				rollup := addNestedRollupTestFields(database, database, database.KeyValues[2].Key, true)
				view.Group.Field = rollup.ID
				if field == "relation" {
					view.Group.Field = rollup.Rollup.RelationKeyID
				}
			case "created", "updated":
				key = &av.Key{ID: field, Type: av.KeyType(field)}
				database.KeyValues = append(database.KeyValues, &av.KeyValues{Key: key})
				view.Table.Columns = append(view.Table.Columns, &av.ViewTableColumn{BaseField: &av.BaseField{ID: key.ID}})
				view.Group.Field = key.ID
			}
			items := RenderViewGroupItems(database, view)
			if len(items) != 2 || items[0].GetValue("leaf-value").Template.Content != "fresh-0" {
				t.Fatal("computed grouping did not evaluate its dependencies")
			}
			if field == "rendered" && items[0].GetValue(key.ID).RenderedContent != "fresh-0" {
				t.Fatal("rendered grouping did not evaluate its display template")
			}
			if field == "rollup" && items[0].GetValue(view.Group.Field).String(true) != "fresh-0" {
				t.Fatal("rollup grouping reused stale dependencies")
			}
		})
	}
}
