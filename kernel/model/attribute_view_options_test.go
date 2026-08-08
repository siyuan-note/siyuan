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
