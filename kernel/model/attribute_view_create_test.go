// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package model

import (
	"testing"

	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestConfigureCreatedAttributeViewKeepsRequestedFieldOrder(t *testing.T) {
	setupAttributeViewValidationTest(t)

	attrView := av.NewAttributeView("20260816000000-create1")
	nameKey, err := newAttributeViewKey("20260816000000-name001", "Name", string(av.KeyTypeText), "",
		av.DateDisplayFormatFull)
	if nil != err {
		t.Fatal(err)
	}
	phoneKey, err := newAttributeViewKey("20260816000000-phone01", "Phone", string(av.KeyTypePhone), "",
		av.DateDisplayFormatFull)
	if nil != err {
		t.Fatal(err)
	}
	notesKey, err := newAttributeViewKey("20260816000000-notes01", "Notes", string(av.KeyTypeText), "",
		av.DateDisplayFormatFull)
	if nil != err {
		t.Fatal(err)
	}
	if err = configureCreatedAttributeView(attrView, "Contacts", "ID", []*av.Key{nameKey, phoneKey, notesKey}); nil != err {
		t.Fatalf("configure database failed: %s", err)
	}

	attrView, err = av.ParseAttributeView(attrView.ID)
	if nil != err {
		t.Fatalf("parse configured database failed: %s", err)
	}
	if "Contacts" != attrView.Name {
		t.Fatalf("unexpected database name: %q", attrView.Name)
	}
	view, err := attrView.GetFirstView()
	if nil != err || nil == view.Table {
		t.Fatalf("created table view not found: %v", err)
	}

	keysByID := map[string]*av.Key{}
	for _, keyValues := range attrView.KeyValues {
		keysByID[keyValues.Key.ID] = keyValues.Key
	}
	var names []string
	for _, column := range view.Table.Columns {
		key := keysByID[column.ID]
		if nil == key {
			t.Fatalf("table column has no key: %s", column.ID)
		}
		names = append(names, key.Name)
	}
	want := []string{"ID", "Name", "Phone", "Notes"}
	if len(names) != len(want) {
		t.Fatalf("unexpected table fields: got %v, want %v", names, want)
	}
	for i := range want {
		if names[i] != want[i] {
			t.Fatalf("unexpected table fields: got %v, want %v", names, want)
		}
	}
}

func TestConfigureCreatedKanbanUsesRequestedSelectField(t *testing.T) {
	setupAttributeViewValidationTest(t)
	util.AttrViewLangs["en"]["gallery"] = "Gallery"
	util.AttrViewLangs["en"]["kanban"] = "Kanban"

	attrView := newAttributeViewWithLayout("20260816000000-kanban1", av.LayoutTypeKanban)
	statusKey, err := newAttributeViewKey("20260816000000-status1", "Status", string(av.KeyTypeSelect), "",
		av.DateDisplayFormatFull)
	if nil != err {
		t.Fatal(err)
	}
	notesKey, err := newAttributeViewKey("20260816000000-notes01", "Notes", string(av.KeyTypeText), "",
		av.DateDisplayFormatFull)
	if nil != err {
		t.Fatal(err)
	}
	if err = configureCreatedAttributeView(attrView, "Tasks", "Task", []*av.Key{statusKey, notesKey}); nil != err {
		t.Fatalf("configure kanban failed: %s", err)
	}

	view, err := attrView.GetFirstView()
	if nil != err || nil == view.Kanban {
		t.Fatalf("configured kanban view not found: %v", err)
	}
	if nil == view.Group || statusKey.ID != view.Group.Field {
		t.Fatalf("unexpected kanban group: %+v", view.Group)
	}
	var fieldIDs []string
	for _, field := range view.Kanban.Fields {
		fieldIDs = append(fieldIDs, field.ID)
	}
	want := []string{attrView.GetBlockKeyValues().Key.ID, statusKey.ID, notesKey.ID}
	for i := range want {
		if len(fieldIDs) <= i || fieldIDs[i] != want[i] {
			t.Fatalf("unexpected kanban fields: got %v, want %v", fieldIDs, want)
		}
	}
}
