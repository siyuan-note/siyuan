// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"testing"

	"github.com/siyuan-note/siyuan/kernel/av"
)

func TestBacklinkDatabaseFilterValidation(t *testing.T) {
	setupAttributeViewValidationTest(t)
	view := av.NewAttributeView("20261022130000-databas")
	key := view.GetBlockKey()
	leaf := &av.ViewFilter{Column: key.ID, Operator: av.FilterOperatorContains,
		Value: &av.Value{Type: av.KeyTypeBlock, Block: &av.ValueBlock{Content: "task"}}}
	if err := validateBacklinkDatabaseFilters(view, []*av.ViewFilter{{Combination: av.FilterCombinationAnd, Filters: []*av.ViewFilter{leaf}}}); err != nil {
		t.Fatal(err)
	}
	if err := validateBacklinkDatabaseFilters(view, nil); err != nil {
		t.Fatal("membership-only filters must be allowed", err)
	}
	for name, filters := range map[string][]*av.ViewFilter{
		"nil condition":      {nil},
		"removed field":      {{Column: "missing", Operator: av.FilterOperatorIsEmpty}},
		"wrong operator":     {{Column: key.ID, Operator: av.FilterOperatorIsGreater}},
		"changed field type": {{Column: key.ID, Operator: av.FilterOperatorIsEqual, Value: &av.Value{Type: av.KeyTypeNumber}}},
		"wrong combination":  {{Combination: "xor", Filters: []*av.ViewFilter{leaf}}},
	} {
		t.Run(name, func(t *testing.T) {
			if err := validateBacklinkDatabaseFilters(view, filters); err == nil {
				t.Fatal("invalid conditions must not expand the result set")
			}
		})
	}
	deep := leaf
	for i := 0; i < 10; i++ {
		deep = &av.ViewFilter{Combination: av.FilterCombinationAnd, Filters: []*av.ViewFilter{deep}}
	}
	if err := validateBacklinkDatabaseFilters(view, []*av.ViewFilter{deep}); err == nil {
		t.Fatal("excessively nested filters accepted")
	}
	filter := NormalizeBacklinkSourceFilter(&BacklinkSourceFilter{Database: &BacklinkDatabaseFilter{AvID: view.ID}})
	if filter == nil || filter.Database == nil {
		t.Fatal("membership-only filters must remain active")
	}
	if NormalizeBacklinkSourceFilter(&BacklinkSourceFilter{Database: &BacklinkDatabaseFilter{}}) == nil {
		t.Fatal("malformed database filters must not silently disappear")
	}
}

func TestBacklinkDatabaseBindingsExcludeDetachedItems(t *testing.T) {
	setupAttributeViewValidationTest(t)
	view := av.NewAttributeView("20261022130000-databas")
	view.KeyValues[0].Values = []*av.Value{
		{BlockID: "bound-item", Block: &av.ValueBlock{ID: "source-block"}},
		{BlockID: "detached-item", IsDetached: true, Block: &av.ValueBlock{ID: "detached-source"}},
		{BlockID: "empty-item", Block: &av.ValueBlock{}},
		nil,
	}
	bindings := backlinkDatabaseBindings(view)
	if len(bindings) != 1 || bindings["source-block"] != "bound-item" {
		t.Fatalf("unexpected database bindings: %+v", bindings)
	}
}
