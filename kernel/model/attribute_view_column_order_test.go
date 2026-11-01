// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"encoding/json"
	"reflect"
	"slices"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/av"
)

func TestAttributeViewColumnOrderLayouts(t *testing.T) {
	for _, layout := range []av.LayoutType{av.LayoutTypeTable, av.LayoutTypeList, av.LayoutTypeCalendar, av.LayoutTypeGallery, av.LayoutTypeKanban} {
		t.Run(string(layout), func(t *testing.T) {
			view := &av.View{LayoutType: layout}
			fields := []*av.BaseField{{ID: "primary"}, {ID: "hidden", Hidden: true}, {ID: "last"}}
			switch layout {
			case av.LayoutTypeTable:
				view.Table = &av.LayoutTable{}
			case av.LayoutTypeList:
				view.List = &av.LayoutList{}
			case av.LayoutTypeCalendar:
				view.Calendar = &av.LayoutCalendar{LayoutTable: &av.LayoutTable{}}
			case av.LayoutTypeGallery:
				view.Gallery = &av.LayoutGallery{}
			case av.LayoutTypeKanban:
				view.Kanban = &av.LayoutKanban{}
			}
			for _, field := range fields {
				switch layout {
				case av.LayoutTypeTable, av.LayoutTypeList, av.LayoutTypeCalendar:
					view.GetTableLayout().Columns = append(view.GetTableLayout().Columns, &av.ViewTableColumn{BaseField: field, Width: "234px"})
				case av.LayoutTypeGallery:
					view.Gallery.CardFields = append(view.Gallery.CardFields, &av.ViewGalleryCardField{BaseField: field})
				case av.LayoutTypeKanban:
					view.Kanban.Fields = append(view.Kanban.Fields, &av.ViewKanbanField{BaseField: field})
				}
			}
			original, _ := json.Marshal(view)
			for _, move := range [][2]string{{"missing", ""}, {"primary", "missing"}, {"", ""}} {
				if err := sortAttributeViewViewKey(view, move[0], move[1]); err == nil {
					t.Fatalf("invalid move accepted: %v", move)
				}
				after, _ := json.Marshal(view)
				if string(after) != string(original) {
					t.Fatal("invalid move mutated layout")
				}
			}
			for _, move := range []struct {
				key, previous string
				want          []string
			}{
				{"primary", "last", []string{"hidden", "last", "primary"}},
				{"hidden", "primary", []string{"last", "primary", "hidden"}},
				{"hidden", "", []string{"hidden", "last", "primary"}},
				{"primary", "primary", []string{"hidden", "last", "primary"}},
				{"primary", "", []string{"primary", "hidden", "last"}},
			} {
				if err := sortAttributeViewViewKey(view, move.key, move.previous); err != nil {
					t.Fatal(err)
				}
				if got := AttributeViewViewFieldIDs(view); !slices.Equal(got, move.want) {
					t.Fatalf("order: %v, want %v", got, move.want)
				}
			}
			// 恢复顺序后完整比较布局，验证列宽、显隐及其他配置保持一致。
			if err := sortAttributeViewViewKey(view, "hidden", "primary"); err != nil {
				t.Fatal(err)
			}
			after, _ := json.Marshal(view)
			if string(after) != string(original) {
				t.Fatal("moving fields changed their configuration")
			}
		})
	}
}

func TestAttributeViewColumnOrderTargetAndCarrier(t *testing.T) {
	fixture := setupDatabaseBlockTransactionTest(t, true)
	const blockID = "20260803091003-avblock"
	attrView := fixture.attrView
	attrView.KeyValues = []*av.KeyValues{
		{Key: &av.Key{ID: "primary", Type: av.KeyTypeBlock}},
		{Key: &av.Key{ID: "hidden", Type: av.KeyTypeText}, Values: []*av.Value{{ID: "cell", Type: av.KeyTypeText, Text: &av.ValueText{Content: "preserved"}}}},
	}
	attrView.KeyIDs = []string{"primary", "hidden"}
	first := fixture.tableView
	first.Table.Columns = []*av.ViewTableColumn{{BaseField: &av.BaseField{ID: "primary"}}, {BaseField: &av.BaseField{ID: "hidden", Hidden: true}, Width: "234px"}}
	second := &av.View{ID: "20261101000000-second0", LayoutType: av.LayoutTypeTable, Table: &av.LayoutTable{Columns: []*av.ViewTableColumn{
		{BaseField: &av.BaseField{ID: "primary"}}, {BaseField: &av.BaseField{ID: "hidden", Hidden: true}, Width: "234px"},
	}}}
	attrView.Views = []*av.View{first, second}
	if err := av.SaveAttributeView(attrView); err != nil {
		t.Fatal(err)
	}
	if err := SortAttributeViewViewKey(attrView.ID, second.ID, "primary", "hidden"); err != nil {
		t.Fatal(err)
	}
	stored, err := av.ParseAttributeView(attrView.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(AttributeViewViewFieldIDs(stored.Views[0]), []string{"primary", "hidden"}) ||
		!slices.Equal(AttributeViewViewFieldIDs(stored.Views[1]), []string{"hidden", "primary"}) {
		t.Fatal("wrong target view")
	}
	if !reflect.DeepEqual(stored.KeyValues, attrView.KeyValues) || !reflect.DeepEqual(stored.KeyIDs, attrView.KeyIDs) {
		t.Fatal("changed field definitions or global order")
	}
	if err = SortAttributeViewViewKey(attrView.ID, "missing", "primary", ""); err == nil {
		t.Fatal("unknown view accepted")
	}
	if err = MoveAttributeViewViewField(attrView.ID, blockID, second.ID, "primary", ""); err != nil {
		t.Fatal(err)
	}
	if err = MoveAttributeViewViewField(attrView.ID, fixture.tree.ID, second.ID, "primary", "hidden"); err == nil {
		t.Fatal("document accepted as carrier")
	}
	// 空视图 ID 选择首个视图；界面事务按载体当前视图定位。
	if err = SortAttributeViewViewKey(attrView.ID, "", "primary", "hidden"); err != nil {
		t.Fatal(err)
	}
	tx := &Transaction{}
	if txErr := tx.doSortAttrViewColumn(&Operation{AvID: attrView.ID, BlockID: blockID, ID: "primary", PreviousID: ""}); txErr != nil {
		t.Fatal(txErr)
	}
	stored, err = av.ParseAttributeView(attrView.ID)
	if err != nil {
		t.Fatal(err)
	}
	for _, view := range stored.Views {
		if !slices.Equal(AttributeViewViewFieldIDs(view), []string{"primary", "hidden"}) {
			t.Fatal("move was not saved")
		}
		if !view.Table.Columns[1].Hidden || view.Table.Columns[1].Width != "234px" {
			t.Fatal("hidden column configuration changed")
		}
	}
}
