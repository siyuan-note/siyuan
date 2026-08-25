// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package model

import (
	"reflect"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/av"
)

func TestUpdateAttributeViewColumnOptionsAddsAndSorts(t *testing.T) {
	setupAttributeViewValidationTest(t)

	attrView := av.NewAttributeView("20260802100000-options")
	selectKey := attrView.KeyValues[1].Key
	selectKey.Options = []*av.SelectOption{
		{Name: "Doing", Color: "1"},
		{Name: "Todo", Color: "2"},
	}
	if err := av.SaveAttributeView(attrView); nil != err {
		t.Fatalf("save attribute view failed: %s", err)
	}

	targetOptions := []*av.SelectOption{
		{Name: "Inbox", Color: "1"},
		{Name: "Todo", Color: "2"},
		{Name: "Shelved", Color: "3"},
		{Name: "Doing", Color: "4"},
		{Name: "Done", Color: "5"},
	}
	operation := &Operation{AvID: attrView.ID, ID: selectKey.ID, Data: targetOptions}
	if err := updateAttributeViewColumnOptions(operation); nil != err {
		t.Fatalf("update attribute view column options failed: %s", err)
	}

	parsed, err := av.ParseAttributeView(attrView.ID)
	if nil != err {
		t.Fatalf("parse attribute view failed: %s", err)
	}
	updatedKey, err := parsed.GetKey(selectKey.ID)
	if nil != err {
		t.Fatalf("get select key failed: %s", err)
	}
	assertSelectOptionNames(t, updatedKey.Options, []string{"Inbox", "Todo", "Shelved", "Doing", "Done"})
	if "4" != updatedKey.GetOption("Doing").Color {
		t.Fatalf("expected existing option color to be updated, got [%s]", updatedKey.GetOption("Doing").Color)
	}
}

func TestUpdateAttributeViewColumnOptionsKeepsUnspecifiedOptionsInPlace(t *testing.T) {
	setupAttributeViewValidationTest(t)

	attrView := av.NewAttributeView("20260802100001-options")
	selectKey := attrView.KeyValues[1].Key
	selectKey.Options = []*av.SelectOption{
		{Name: "First", Color: "1"},
		{Name: "Second", Color: "2"},
		{Name: "Concurrent", Color: "3"},
	}
	if err := av.SaveAttributeView(attrView); nil != err {
		t.Fatalf("save attribute view failed: %s", err)
	}

	targetOptions := []*av.SelectOption{
		{Name: "Second", Color: "2"},
		{Name: "First", Color: "1"},
		{Name: "New", Color: "4"},
	}
	operation := &Operation{AvID: attrView.ID, ID: selectKey.ID, Data: targetOptions}
	if err := updateAttributeViewColumnOptions(operation); nil != err {
		t.Fatalf("update attribute view column options failed: %s", err)
	}

	parsed, err := av.ParseAttributeView(attrView.ID)
	if nil != err {
		t.Fatalf("parse attribute view failed: %s", err)
	}
	updatedKey, err := parsed.GetKey(selectKey.ID)
	if nil != err {
		t.Fatalf("get select key failed: %s", err)
	}
	assertSelectOptionNames(t, updatedKey.Options, []string{"Second", "First", "Concurrent", "New"})
}

func TestUpdateAttributeViewColumnOptionsSynchronizesOptionColorReferences(t *testing.T) {
	setupAttributeViewValidationTest(t)

	attrView := av.NewAttributeView("20260824120000-options")
	attrView.CustomColors = []*av.AttributeViewCustomColor{{
		Index: 15,
		AttributeViewColor: av.AttributeViewColor{
			Light: av.AttributeViewColorTheme{Color: "#010203", BackgroundColor: "#040506"},
			Dark:  av.AttributeViewColorTheme{Color: "#070809", BackgroundColor: "#0a0b0c"},
		},
	}}
	selectKey := attrView.KeyValues[1].Key
	selectKey.Options = []*av.SelectOption{{Name: "Used", Color: "15"}}
	selectValue := func() *av.Value {
		return &av.Value{Type: av.KeyTypeSelect, MSelect: []*av.ValueSelect{{Content: "Used", Color: "15"}}}
	}
	attrView.KeyValues[1].Values = []*av.Value{selectValue()}
	attrView.Views[0].Filters = []*av.ViewFilter{{
		Combination: av.FilterCombinationAnd,
		Filters:     []*av.ViewFilter{{Column: selectKey.ID, Value: selectValue()}},
	}}
	attrView.NewItemTemplates = []*av.NewItemTemplate{{
		FieldValues: map[string]*av.NewItemFieldValue{
			selectKey.ID: {Mode: av.NewItemFieldValueStatic, Value: selectValue()},
		},
	}}
	if err := av.SaveAttributeView(attrView); nil != err {
		t.Fatalf("save attribute view failed: %s", err)
	}

	operation := &Operation{AvID: attrView.ID, ID: selectKey.ID, Data: []*av.SelectOption{{Name: "Used", Color: "1"}}}
	if err := updateAttributeViewColumnOptions(operation); nil != err {
		t.Fatalf("update attribute view column options failed: %s", err)
	}

	parsed, err := av.ParseAttributeView(attrView.ID)
	if nil != err {
		t.Fatalf("parse attribute view failed: %s", err)
	}
	if parsed.UsesCustomColor(15) {
		t.Fatal("old option color remained referenced after a batch option update")
	}
	if "1" != parsed.KeyValues[1].Values[0].MSelect[0].Color ||
		"1" != parsed.Views[0].Filters[0].Filters[0].Value.MSelect[0].Color ||
		"1" != parsed.NewItemTemplates[0].FieldValues[selectKey.ID].Value.MSelect[0].Color {
		t.Fatal("batch option update did not synchronize persisted color references")
	}
	if err = setAttrViewCustomColors(&Operation{AvID: attrView.ID, Data: []*av.AttributeViewCustomColor{}}); nil != err {
		t.Fatalf("unused custom color could not be deleted after a batch option update: %s", err)
	}
}

func TestSetAttrViewCustomColorsRejectsDeletingUsedColor(t *testing.T) {
	setupAttributeViewValidationTest(t)

	attrView := av.NewAttributeView("20260824130000-colors1")
	attrView.CustomColors = []*av.AttributeViewCustomColor{{
		Index: 15,
		AttributeViewColor: av.AttributeViewColor{
			Light: av.AttributeViewColorTheme{Color: "#010203", BackgroundColor: "#040506"},
			Dark:  av.AttributeViewColorTheme{Color: "#070809", BackgroundColor: "#0a0b0c"},
		},
	}}
	selectKey := attrView.KeyValues[1].Key
	selectKey.Options = []*av.SelectOption{{Name: "Used", Color: "15"}}
	if err := av.SaveAttributeView(attrView); nil != err {
		t.Fatalf("save attribute view failed: %s", err)
	}

	if err := setAttrViewCustomColors(&Operation{AvID: attrView.ID}); nil == err {
		t.Fatal("missing custom color array should fail")
	}

	operation := &Operation{AvID: attrView.ID, Data: []*av.AttributeViewCustomColor{}}
	if err := setAttrViewCustomColors(operation); nil == err {
		t.Fatal("deleting a referenced custom color should fail")
	}

	updated := []*av.AttributeViewCustomColor{{
		Index: 15,
		AttributeViewColor: av.AttributeViewColor{
			Light: av.AttributeViewColorTheme{Color: "#111111", BackgroundColor: "#222222"},
			Dark:  av.AttributeViewColorTheme{Color: "#eeeeee", BackgroundColor: "#333333"},
		},
	}}
	operation.Data = updated
	if err := setAttrViewCustomColors(operation); nil != err {
		t.Fatalf("editing a referenced custom color should succeed: %s", err)
	}
	parsed, err := av.ParseAttributeView(attrView.ID)
	if nil != err {
		t.Fatalf("parse attribute view failed: %s", err)
	}
	if 1 != len(parsed.CustomColors) || "#111111" != parsed.CustomColors[0].Light.Color {
		t.Fatalf("custom palette update was not saved: %+v", parsed.CustomColors)
	}
}

func TestGenerateAttributeViewGroupsPreservesResolvedCustomColor(t *testing.T) {
	setupAttributeViewValidationTest(t)

	attrView := av.NewAttributeView("20260824140000-colors2")
	attrView.CustomColors = []*av.AttributeViewCustomColor{{
		Index: 15,
		AttributeViewColor: av.AttributeViewColor{
			Light: av.AttributeViewColorTheme{Color: "#010203", BackgroundColor: "#040506"},
			Dark:  av.AttributeViewColorTheme{Color: "#070809", BackgroundColor: "#0a0b0c"},
		},
	}}
	selectKey := attrView.KeyValues[1].Key
	selectKey.Options = []*av.SelectOption{{Name: "Custom", Color: "15"}}
	attrView.ResolveDirectColors()
	view := attrView.Views[0]
	view.Group = &av.ViewGroup{Field: selectKey.ID, Method: av.GroupMethodValue}

	genAttrViewGroups(view, attrView)
	group := view.GetGroupByGroupValue("Custom")
	if nil == group || nil == group.GroupVal || 1 != len(group.GroupVal.MSelect) {
		t.Fatalf("custom color group was not generated: %+v", group)
	}
	resolved := group.GroupVal.MSelect[0].ResolvedColor
	if nil == resolved || "#010203" != resolved.Light.Color || "#0a0b0c" != resolved.Dark.BackgroundColor {
		t.Fatalf("custom color group lost its resolved color: %+v", group.GroupVal.MSelect[0])
	}
}

func assertSelectOptionNames(t *testing.T, options []*av.SelectOption, expected []string) {
	t.Helper()

	actual := make([]string, 0, len(options))
	for _, option := range options {
		actual = append(actual, option.Name)
	}
	if !reflect.DeepEqual(expected, actual) {
		t.Fatalf("expected option names %v, got %v", expected, actual)
	}
}
