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
	"testing"

	"github.com/siyuan-note/siyuan/kernel/av"
)

func TestApplyFilterDefaultValuesUsesFirstOrBranch(t *testing.T) {
	attrView := &av.AttributeView{KeyValues: []*av.KeyValues{
		{Key: &av.Key{ID: "first", Type: av.KeyTypeText}},
		{Key: &av.Key{ID: "second", Type: av.KeyTypeText}},
	}}
	root := &av.ViewFilter{Combination: av.FilterCombinationOr, Filters: []*av.ViewFilter{
		{
			Column:   "first",
			Operator: av.FilterOperatorContains,
			Value:    &av.Value{Type: av.KeyTypeText, Text: &av.ValueText{Content: "first value"}},
		},
		{
			Column:   "second",
			Operator: av.FilterOperatorContains,
			Value:    &av.Value{Type: av.KeyTypeText, Text: &av.ValueText{Content: "second value"}},
		},
	}}
	values := map[string]*av.Value{}
	filterKeyIDs := map[string]bool{}

	if applyFilterDefaultValues([]*av.ViewFilter{root}, attrView, "new-item", nil,
		map[string][]*av.Key{}, map[string]*av.Key{}, values, filterKeyIDs) {
		t.Fatalf("text filter should not stop default value calculation")
	}
	if 1 != len(values) || nil == values["first"] || nil != values["second"] {
		t.Fatalf("OR filter should use only the first productive branch, got %#v", values)
	}
}

func TestApplyFilterDefaultValuesKeepsEmptyMatchingOrBranch(t *testing.T) {
	attrView := &av.AttributeView{KeyValues: []*av.KeyValues{
		{Key: &av.Key{ID: "relation", Type: av.KeyTypeRelation}},
		{Key: &av.Key{ID: "text", Type: av.KeyTypeText}},
	}}
	root := &av.ViewFilter{Combination: av.FilterCombinationOr, Filters: []*av.ViewFilter{
		{
			Column:   "relation",
			Operator: av.FilterOperatorDoesNotContainAnyItem,
			Value: &av.Value{
				Type:     av.KeyTypeRelation,
				Relation: &av.ValueRelation{BlockIDs: []string{"related-item"}},
			},
		},
		{
			Column:   "text",
			Operator: av.FilterOperatorContains,
			Value:    &av.Value{Type: av.KeyTypeText, Text: &av.ValueText{Content: "fallback"}},
		},
	}}
	values := map[string]*av.Value{}
	filterKeyIDs := map[string]bool{}

	applyFilterDefaultValues([]*av.ViewFilter{root}, attrView, "new-item", nil,
		map[string][]*av.Key{}, map[string]*av.Key{}, values, filterKeyIDs)
	if 0 != len(values) || !filterKeyIDs["relation"] || filterKeyIDs["text"] {
		t.Fatalf("an empty item already satisfies the first negative OR branch")
	}
}

func TestApplyFilterDefaultValuesSkipsConflictingOrBranch(t *testing.T) {
	attrView := &av.AttributeView{KeyValues: []*av.KeyValues{
		{Key: &av.Key{ID: "text", Type: av.KeyTypeText}},
		{Key: &av.Key{ID: "fallback", Type: av.KeyTypeText}},
	}}
	root := &av.ViewFilter{Combination: av.FilterCombinationOr, Filters: []*av.ViewFilter{
		{Combination: av.FilterCombinationAnd, Filters: []*av.ViewFilter{
			{
				Column:   "text",
				Operator: av.FilterOperatorIsEqual,
				Value:    &av.Value{Type: av.KeyTypeText, Text: &av.ValueText{Content: "first"}},
			},
			{
				Column:   "text",
				Operator: av.FilterOperatorIsEqual,
				Value:    &av.Value{Type: av.KeyTypeText, Text: &av.ValueText{Content: "second"}},
			},
		}},
		{
			Column:   "fallback",
			Operator: av.FilterOperatorIsEqual,
			Value:    &av.Value{Type: av.KeyTypeText, Text: &av.ValueText{Content: "available"}},
		},
	}}
	values := map[string]*av.Value{}
	filterKeyIDs := map[string]bool{}

	applyFilterDefaultValues([]*av.ViewFilter{root}, attrView, "new-item", nil,
		map[string][]*av.Key{}, map[string]*av.Key{}, values, filterKeyIDs)
	if 1 != len(values) || nil != values["text"] || nil == values["fallback"] ||
		"available" != values["fallback"].Text.Content {
		t.Fatalf("OR filter should skip a conflicting branch, got %#v", values)
	}
}

func TestApplyFilterDefaultValuesDropsConflictingAndDefaults(t *testing.T) {
	attrView := &av.AttributeView{KeyValues: []*av.KeyValues{
		{Key: &av.Key{ID: "text", Type: av.KeyTypeText}},
	}}
	root := &av.ViewFilter{Combination: av.FilterCombinationAnd, Filters: []*av.ViewFilter{
		{
			Column:   "text",
			Operator: av.FilterOperatorIsEqual,
			Value:    &av.Value{Type: av.KeyTypeText, Text: &av.ValueText{Content: "first"}},
		},
		{
			Column:   "text",
			Operator: av.FilterOperatorIsEqual,
			Value:    &av.Value{Type: av.KeyTypeText, Text: &av.ValueText{Content: "second"}},
		},
	}}
	values := map[string]*av.Value{}
	filterKeyIDs := map[string]bool{}

	applyFilterDefaultValues([]*av.ViewFilter{root}, attrView, "new-item", nil,
		map[string][]*av.Key{}, map[string]*av.Key{}, values, filterKeyIDs)
	if 0 != len(values) || 0 != len(filterKeyIDs) {
		t.Fatalf("conflicting AND filters should not generate defaults, got %#v", values)
	}
}

func TestTopAddingDoesNotUseGroupedViewDefault(t *testing.T) {
	attrView := &av.AttributeView{KeyValues: []*av.KeyValues{
		{Key: &av.Key{ID: "date", Type: av.KeyTypeDate, Date: &av.Date{}}},
	}}
	view := &av.View{Group: &av.ViewGroup{Field: "date"}}

	values := getAttrViewAddingBlockDefaultValues(attrView, view, view, "", "new-item", true, false)
	if 0 != len(values) {
		t.Fatalf("top adding should not use the first visible group, got %#v", values)
	}
}

func TestFillAttrViewAutoFillNowValuesOverridesExistingValue(t *testing.T) {
	const (
		itemID = "new-item"
		now    = int64(1770000000000)
	)
	attrView := &av.AttributeView{KeyValues: []*av.KeyValues{
		{
			Key: &av.Key{ID: "date", Type: av.KeyTypeDate, Date: &av.Date{AutoFillNow: true, FillSpecificTime: true}},
			Values: []*av.Value{{
				ID:      "value",
				KeyID:   "date",
				BlockID: itemID,
				Type:    av.KeyTypeDate,
				Date:    &av.ValueDate{Content: now - 1000, IsNotEmpty: true, IsNotTime: true},
			}},
		},
	}}

	fillAttrViewAutoFillNowValues(attrView, itemID, true, now)
	value := attrView.KeyValues[0].GetValue(itemID)
	if now != value.Date.Content || !value.Date.IsNotEmpty || value.Date.IsNotTime {
		t.Fatalf("auto-fill-now should override filter and group defaults, got %#v", value.Date)
	}
}

func TestNormalizeAttrViewAddingDefaultValueUsesNow(t *testing.T) {
	key := &av.Key{ID: "date", Type: av.KeyTypeDate, Date: &av.Date{AutoFillNow: true}}
	value := &av.Value{Type: av.KeyTypeDate, Date: &av.ValueDate{Content: 1, IsNotEmpty: true}}

	normalizeAttrViewAddingDefaultValue(key, value)
	if 1 == value.Date.Content || !value.Date.IsNotEmpty {
		t.Fatalf("auto-fill-now preview should override the filter default, got %#v", value.Date)
	}
}
