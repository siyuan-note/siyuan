// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"testing"

	"github.com/siyuan-note/siyuan/kernel/av"
)

func fieldFilterRoot(filters ...*av.ViewFilter) []*av.ViewFilter {
	return []*av.ViewFilter{{Combination: av.FilterCombinationAnd, Filters: filters}}
}

func fieldFilterLeaf(column string) *av.ViewFilter {
	return &av.ViewFilter{
		Column:   column,
		Operator: av.FilterOperatorContains,
		Value:    &av.Value{Type: av.KeyTypeText, Text: &av.ValueText{Content: "value"}},
	}
}

func TestRemoveAttrViewColumnFromFieldFilters(t *testing.T) {
	attrView := &av.AttributeView{
		ID: "source",
		KeyValues: []*av.KeyValues{
			{Key: &av.Key{
				ID:   "relation",
				Type: av.KeyTypeRelation,
				Relation: &av.Relation{
					AvID:             "target",
					CandidateFilters: fieldFilterRoot(fieldFilterLeaf("removed"), fieldFilterLeaf("kept")),
				},
			}},
			{Key: &av.Key{
				ID:   "rollup",
				Type: av.KeyTypeRollup,
				Rollup: &av.Rollup{
					RelationKeyID: "relation",
					Filters:       fieldFilterRoot(fieldFilterLeaf("removed")),
				},
			}},
			{Key: &av.Key{
				ID:   "unrelated",
				Type: av.KeyTypeRelation,
				Relation: &av.Relation{
					AvID:             "other",
					CandidateFilters: fieldFilterRoot(fieldFilterLeaf("removed")),
				},
			}},
		},
	}

	if !removeAttrViewColumnFromFieldFilters(attrView, "target", "removed") {
		t.Fatal("expected field filters to change")
	}
	relationFilters := attrView.KeyValues[0].Key.Relation.CandidateFilters
	if attrViewFiltersContainColumn(relationFilters, "removed") ||
		!attrViewFiltersContainColumn(relationFilters, "kept") {
		t.Fatalf("unexpected relation filters: %+v", relationFilters)
	}
	if nil != attrView.KeyValues[1].Key.Rollup.Filters {
		t.Fatalf("expected empty rollup filters to be removed: %+v", attrView.KeyValues[1].Key.Rollup.Filters)
	}
	if !attrViewFiltersContainColumn(attrView.KeyValues[2].Key.Relation.CandidateFilters, "removed") {
		t.Fatal("unrelated relation filters should be preserved")
	}
}

func TestUpdateAttrViewOptionInFieldFilters(t *testing.T) {
	optionFilter := func() []*av.ViewFilter {
		return fieldFilterRoot(&av.ViewFilter{
			Column:   "status",
			Operator: av.FilterOperatorContains,
			Value: &av.Value{Type: av.KeyTypeMSelect, MSelect: []*av.ValueSelect{
				{Content: "old", Color: "1"},
				{Content: "kept", Color: "2"},
			}},
		})
	}
	attrView := &av.AttributeView{
		ID: "source",
		KeyValues: []*av.KeyValues{
			{Key: &av.Key{
				ID:   "relation",
				Type: av.KeyTypeRelation,
				Relation: &av.Relation{
					AvID:             "target",
					CandidateFilters: optionFilter(),
				},
			}},
			{Key: &av.Key{
				ID:   "rollup",
				Type: av.KeyTypeRollup,
				Rollup: &av.Rollup{
					RelationKeyID: "relation",
					Filters:       optionFilter(),
				},
			}},
		},
	}

	if !renameAttrViewOptionInFieldFilters(attrView, "target", "status", "old", "new", "3") {
		t.Fatal("expected option rename to change field filters")
	}
	relationOptions := attrView.KeyValues[0].Key.Relation.CandidateFilters[0].Filters[0].Value.MSelect
	if "new" != relationOptions[0].Content || "3" != relationOptions[0].Color {
		t.Fatalf("unexpected renamed option: %+v", relationOptions[0])
	}
	if !removeAttrViewOptionFromFieldFilters(attrView, "target", "status", "new") {
		t.Fatal("expected option removal to change field filters")
	}
	rollupOptions := attrView.KeyValues[1].Key.Rollup.Filters[0].Filters[0].Value.MSelect
	if 1 != len(rollupOptions) || "kept" != rollupOptions[0].Content {
		t.Fatalf("unexpected remaining options: %+v", rollupOptions)
	}
}
