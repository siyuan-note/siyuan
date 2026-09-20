// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"bytes"
	"encoding/json"
	"os"
	"reflect"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func setAttributeViewListTestLangs() {
	util.AttrViewLangs["en"]["list"] = "List"
	util.AttrViewLangs["en"]["gallery"] = "Gallery"
	util.AttrViewLangs["en"]["kanban"] = "Kanban"
}

func assertListDefaultFields(t *testing.T, attrView *av.AttributeView, view *av.View) {
	t.Helper()
	if nil == view || av.LayoutTypeList != view.LayoutType || nil == view.List {
		t.Fatalf("expected a list layout: %+v", view)
	}
	if len(view.List.Columns) != len(attrView.KeyValues) {
		t.Fatalf("list fields were lost: got %d, want %d", len(view.List.Columns), len(attrView.KeyValues))
	}
	for _, column := range view.List.Columns {
		key, err := attrView.GetKey(column.ID)
		if nil != err || column.Hidden != (av.KeyTypeBlock != key.Type) {
			t.Fatalf("unexpected list field visibility: %+v, %v", column, err)
		}
	}
}

func TestAttributeViewListInitialFieldsAndLayoutSwitch(t *testing.T) {
	setupAttributeViewValidationTest(t)
	setAttributeViewListTestLangs()
	attrView := newAttributeViewWithLayout(ast.NewNodeID(), av.LayoutTypeList)
	view := attrView.Views[0]
	assertListDefaultFields(t, attrView, view)
	primaryID := attrView.GetBlockKeyValues().Key.ID
	otherID := attrView.KeyValues[1].Key.ID
	if err := setAttributeViewFieldsHidden(attrView, primaryID, []string{view.ID}, true); nil == err {
		t.Fatal("list primary key must remain visible")
	}
	if err := setAttributeViewFieldsHidden(attrView, otherID, []string{view.ID}, false); nil != err {
		t.Fatal(err)
	}
	list := view.List
	for _, layout := range []av.LayoutType{av.LayoutTypeTable, av.LayoutTypeGallery, av.LayoutTypeKanban} {
		if err := changeAttrViewLayout(attrView, view, layout); nil != err {
			t.Fatal(err)
		}
		if err := changeAttrViewLayout(attrView, view, av.LayoutTypeList); nil != err {
			t.Fatal(err)
		}
		if view.List != list || getAttributeViewField(view, otherID).Hidden {
			t.Fatal("switching back must retain list field visibility")
		}
	}
	if err := av.SaveAttributeView(attrView); nil != err {
		t.Fatal(err)
	}
	cache.ClearAVCache()
	restored, err := av.ParseAttributeView(attrView.ID)
	if nil != err || getAttributeViewField(restored.Views[0], otherID).Hidden {
		t.Fatalf("list visibility was not persisted: %v", err)
	}
	if restored.Views[0].Table.Columns[1].Hidden {
		t.Fatal("list configuration must not affect stored table configuration")
	}
}

func TestAttributeViewListNewFieldVisibility(t *testing.T) {
	setupAttributeViewValidationTest(t)
	setAttributeViewListTestLangs()
	attrView := newAttributeViewWithLayout(ast.NewNodeID(), av.LayoutTypeList)
	view := attrView.Views[0]
	view.LayoutType = av.LayoutTypeTable
	key := av.NewKey(ast.NewNodeID(), "Added in table", "", av.KeyTypeText)
	addAttributeViewKey(attrView, view, key, "")
	view.LayoutType = av.LayoutTypeList
	if !getAttributeViewField(view, key.ID).Hidden {
		t.Fatal("fields added in another layout must be hidden in the list")
	}
	for _, column := range view.Table.Columns {
		if column.ID == key.ID && column.Hidden {
			t.Fatal("list fields must have independent visibility storage")
		}
	}
	activeKey := av.NewKey(ast.NewNodeID(), "Added in list", "", av.KeyTypeText)
	addAttributeViewKey(attrView, view, activeKey, key.ID)
	if getAttributeViewField(view, activeKey.ID).Hidden {
		t.Fatal("a field explicitly added to the active list should be visible")
	}
	removeAttributeViewFieldDefinition(attrView, key.ID)
	if nil != getAttributeViewField(view, key.ID) {
		t.Fatal("removed field remains in the list")
	}
}

func TestAttributeViewListDatabaseCreationKeys(t *testing.T) {
	setupAttributeViewValidationTest(t)
	setAttributeViewListTestLangs()
	attrView := newAttributeViewWithLayout(ast.NewNodeID(), av.LayoutTypeList)
	key := av.NewKey(ast.NewNodeID(), "Notes", "", av.KeyTypeText)
	if err := configureCreatedAttributeView(attrView, "Tasks", "Task", []*av.Key{key}); nil != err {
		t.Fatal(err)
	}
	cache.ClearAVCache()
	attrView, err := av.ParseAttributeView(attrView.ID)
	if nil != err {
		t.Fatal(err)
	}
	assertListDefaultFields(t, attrView, attrView.Views[0])
}

func TestAttributeViewListRenderAndExport(t *testing.T) {
	setupAttributeViewValidationTest(t)
	attrView, view, ids := newAttributeViewRowSortTestData(av.LayoutTypeList)
	view.List = newAttributeViewListLayout(attrView, nil)
	view.PageSize = 2
	viewable := sql.RenderView(attrView, view, "", false)
	if av.LayoutTypeList != viewable.GetType() {
		t.Fatalf("unexpected rendered type: %s", viewable.GetType())
	}
	if _, _, err := renderViewableInstance(viewable, view, attrView, 1, 2, false, "", sql.NewAttributeViewRenderContext()); nil != err {
		t.Fatal(err)
	}
	list := viewable.(*av.List)
	if list.RowCount != 4 || len(list.Rows) != 2 || list.Rows[0].ID != ids[1] || list.Rows[1].ID != ids[0] {
		t.Fatalf("unexpected sorted and paged list: %+v", list.Rows)
	}
	if list.Columns[0].Hidden || !list.Columns[1].Hidden {
		t.Fatal("rendering must preserve default list visibility")
	}
	// 导出读取列表布局字段，不能改写保留的表格字段设置。
	before := append([]*av.ViewTableColumn(nil), view.Table.Columns...)
	table := getAttrViewTable(attrView, view, "")
	if len(table.Columns) != 2 || !table.Columns[1].Hidden || !reflect.DeepEqual(before, view.Table.Columns) {
		t.Fatal("export changed layout fields or lost list visibility")
	}
}

func TestAttributeViewListRetainedLayouts(t *testing.T) {
	setupAttributeViewValidationTest(t)
	setAttributeViewListTestLangs()
	attrView := newAttributeViewWithLayout(ast.NewNodeID(), av.LayoutTypeList)
	view := attrView.Views[0]
	otherID := attrView.KeyValues[1].Key.ID
	getAttributeViewField(view, otherID).Hidden = false
	if err := av.SaveAttributeView(attrView); nil != err {
		t.Fatal(err)
	}
	duplicateID := ast.NewNodeID()
	if err := duplicateAttributeViewKey(&Operation{AvID: attrView.ID, KeyID: otherID, NextID: duplicateID}); nil != err {
		t.Fatal(err)
	}
	attrView, err := av.ParseAttributeView(attrView.ID)
	if nil != err {
		t.Fatal(err)
	}
	view = attrView.Views[0]
	if nil == getAttributeViewField(view, duplicateID) {
		t.Fatal("duplicated field is missing from the active list")
	}
	if err = changeAttrViewLayout(attrView, view, av.LayoutTypeTable); nil != err {
		t.Fatal(err)
	}
	if nil == getAttributeViewField(view, duplicateID) {
		t.Fatal("duplicated field is missing from the retained table")
	}
	copy := av.NewTableView()
	if err = cloneAttributeViewLayouts(copy, view); nil != err {
		t.Fatal(err)
	}
	if copy.List.Columns[1].Hidden || copy.List.Columns[1].BaseField == view.List.Columns[1].BaseField {
		t.Fatal("copying a table must retain an independent copy of its list settings")
	}
	copy.List.Columns[1].Hidden = true
	if view.List.Columns[1].Hidden {
		t.Fatal("changing copied list settings changed the source view")
	}
}

func TestAttributeViewListInvalidLayoutPreservesSource(t *testing.T) {
	setupAttributeViewValidationTest(t)
	setAttributeViewListTestLangs()
	attrView := newAttributeViewWithLayout(ast.NewNodeID(), av.LayoutTypeList)
	if err := av.SaveAttributeView(attrView); nil != err {
		t.Fatal(err)
	}
	path := av.GetAttributeViewDataPath(attrView.ID)
	original, err := os.ReadFile(path)
	if nil != err {
		t.Fatal(err)
	}
	attrView.Views[0].List = nil
	if err = av.SaveAttributeView(attrView); nil == err {
		t.Fatal("saving a list without a layout must fail")
	}
	preserved, err := os.ReadFile(path)
	if nil != err || !bytes.Equal(original, preserved) {
		t.Fatalf("failed save modified the source: %v", err)
	}
	corrupt, err := json.Marshal(attrView)
	if nil != err {
		t.Fatal(err)
	}
	if err = os.WriteFile(path, corrupt, 0600); nil != err {
		t.Fatal(err)
	}
	cache.ClearAVCache()
	if _, err = av.ParseAttributeView(attrView.ID); nil == err {
		t.Fatal("reading a list without a layout must fail")
	}
	preserved, err = os.ReadFile(path)
	if nil != err || !bytes.Equal(corrupt, preserved) {
		t.Fatalf("failed read modified the corrupt source: %v", err)
	}
}
