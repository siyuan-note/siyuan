// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package av

import (
	"encoding/json"
	"errors"
	"os"
	"slices"
	"testing"

	"github.com/88250/lute/ast"
)

func TestAutomationStoredRelationFilters(t *testing.T) {
	view := &AttributeView{ID: "source", KeyValues: []*KeyValues{{
		Key: &Key{ID: "relation", Type: KeyTypeRelation, Relation: &Relation{AvID: "target"}},
		Values: []*Value{
			{KeyID: "relation", BlockID: "linked", Type: KeyTypeRelation, Relation: &ValueRelation{BlockIDs: []string{"target-row"}}},
			{KeyID: "relation", BlockID: "empty", Type: KeyTypeRelation, Relation: &ValueRelation{}},
			{KeyID: "relation", BlockID: "nil-payload", Type: KeyTypeRelation},
			{KeyID: "relation", BlockID: "deleted", Type: KeyTypeRelation, Relation: &ValueRelation{BlockIDs: []string{"deleted-row"}}},
		},
	}}}
	resolve := func(_ *Key, ids []string) ([]*Value, error) {
		if ids[0] == "target-row" {
			return []*Value{{Type: KeyTypeBlock, Block: &ValueBlock{Content: "Project Alpha"}}}, nil
		}
		return nil, nil
	}
	for _, test := range []struct {
		itemID   string
		operator FilterOperator
		query    string
		want     bool
	}{
		{"linked", FilterOperatorIsEmpty, "", false},
		{"linked", FilterOperatorIsNotEmpty, "", true},
		{"empty", FilterOperatorIsEmpty, "", true},
		{"nil-payload", FilterOperatorIsEmpty, "", true},
		{"missing", FilterOperatorIsNotEmpty, "", false},
		{"deleted", FilterOperatorIsNotEmpty, "", true},
		{"linked", FilterOperatorContains, "Alpha", true},
		{"linked", FilterOperatorDoesNotContain, "Alpha", false},
		{"linked", FilterOperatorContains, "Beta", false},
		{"linked", FilterOperatorDoesNotContain, "Beta", true},
		{"linked", FilterOperatorContainsAnyItem, "target-row", true},
		{"linked", FilterOperatorDoesNotContainAnyItem, "target-row", false},
		{"deleted", FilterOperatorContains, "Alpha", false},
	} {
		t.Run(test.itemID+"/"+string(test.operator)+"/"+test.query, func(t *testing.T) {
			filter := &ViewFilter{Column: "relation", Operator: test.operator,
				Value: &Value{Type: KeyTypeRelation, Relation: &ValueRelation{BlockIDs: []string{test.query}}}}
			filters := []*ViewFilter{{Combination: FilterCombinationAnd, Filters: []*ViewFilter{filter}}}
			if err := ValidateAutomationFilters(view, filters); err != nil {
				t.Fatal(err)
			}
			got, err := view.MatchesAutomationFilters(test.itemID, filters, resolve)
			if err != nil || got != test.want {
				t.Fatalf("got %v, %v; want %v", got, err, test.want)
			}
		})
	}
	if len(view.GetValue("relation", "linked").Relation.Contents) != 0 {
		t.Fatal("filter evaluation modified the stored relation")
	}
	filter := &ViewFilter{Column: "relation", Operator: FilterOperatorIsNotEmpty,
		Value: &Value{Type: KeyTypeRelation, Relation: &ValueRelation{BlockIDs: []string{"Alpha"}}}}
	unavailable := errors.New("related database cannot be authenticated")
	resolve = func(*Key, []string) ([]*Value, error) { return nil, unavailable }
	if got, err := view.MatchesAutomationFilters("linked", []*ViewFilter{filter}, resolve); err != nil || !got {
		t.Fatalf("empty-value check unexpectedly read the related database: %v", err)
	}
	filter.Operator = FilterOperatorContains
	if _, err := view.MatchesAutomationFilters("linked", []*ViewFilter{filter}, resolve); !errors.Is(err, unavailable) {
		t.Fatalf("relation read error was discarded: %v", err)
	}
}

func TestAutomationClonePreservesPausedRules(t *testing.T) {
	data, err := os.ReadFile("testdata/spec9-layouts.json")
	if err != nil {
		t.Fatal(err)
	}
	source, err := ParseAttributeViewData("20260921000000-layouts", data)
	if err != nil || source.Automations != nil {
		t.Fatalf("legacy database read failed: %v", err)
	}
	primaryID := source.GetBlockKeyValues().Key.ID
	relationID, externalID, externalField := ast.NewNodeID(), ast.NewNodeID(), ast.NewNodeID()
	source.KeyValues = append(source.KeyValues, &KeyValues{Key: &Key{ID: relationID, Type: KeyTypeRelation,
		Relation: &Relation{AvID: externalID}}})
	rule := &AutomationRule{ID: ast.NewNodeID(), Name: "Copy", Enabled: true, Trigger: "changed", KeyID: primaryID,
		Actions: []*AutomationAction{
			{Type: "edit", Target: "current", Fields: map[string]*AutomationValue{primaryID: {Mode: "source", KeyID: primaryID}}},
			{Type: "edit", Target: "related", RelationKeyID: relationID, Fields: map[string]*AutomationValue{externalField: {Mode: "source", KeyID: primaryID}}},
		}}
	source.Automations = &AutomationConfig{Spec: 1, Rules: []*AutomationRule{rule}}
	copy := source.Clone()
	if copy == nil || copy.Automations == nil {
		t.Fatal("copy lost automation configuration")
	}
	copiedRule := copy.Automations.Rules[0]
	newPrimary := copy.GetBlockKeyValues().Key.ID
	if copiedRule.Enabled || copiedRule.ID == rule.ID || copiedRule.KeyID != newPrimary {
		t.Fatal("copied rule was not paused and remapped")
	}
	if field := copiedRule.Actions[0].Fields[newPrimary]; field == nil || field.KeyID != newPrimary {
		t.Fatal("current database field mapping was lost")
	}
	if field := copiedRule.Actions[1].Fields[externalField]; field == nil || field.KeyID != newPrimary {
		t.Fatal("related database field mapping was lost")
	}
	if copiedRule.Actions[1].RelationKeyID == relationID || !rule.Enabled || rule.KeyID != primaryID {
		t.Fatal("copy changed the original rule or retained its source field")
	}
	source.Automations.Spec = 9
	future, _ := json.Marshal(source)
	if _, err := ParseAttributeViewData(source.ID, future); err == nil {
		t.Fatal("unknown automation format was accepted")
	}
}

func TestAutomationBlockTypeAndSpecCompatibility(t *testing.T) {
	for _, typ := range []string{"l", "i", "h", "mindmap", "callout", "l:u", "l:o", "l:t", "i:t", "h:h1", "h:h6", "callout:WARNING", "callout:CUSTOM"} {
		if !IsAutomationBlockType(typ) {
			t.Fatalf("valid type rejected: %s", typ)
		}
	}
	for _, typ := range []string{"ial", "l:task", "h:h7", "p:u", "mindmap:u", "callout:", "callout: NOTE", "callout:NOTE\n"} {
		if IsAutomationBlockType(typ) {
			t.Fatalf("invalid type accepted: %s", typ)
		}
	}
	data, err := os.ReadFile("testdata/spec9-layouts.json")
	if err != nil {
		t.Fatal(err)
	}
	for _, spec := range []int{1, 2, 3, 4, 5, 6, 7} {
		view, err := ParseAttributeViewData("20260921000000-layouts", data)
		if err != nil {
			t.Fatal(err)
		}
		rule := &AutomationRule{ID: ast.NewNodeID(), Name: "Collect", BlockSource: &AutomationBlockSource{Types: []string{"l"}}}
		view.Automations = &AutomationConfig{Spec: spec, Rules: []*AutomationRule{rule}}
		raw, _ := json.Marshal(view)
		if _, err := ParseAttributeViewData(view.ID, raw); err != nil {
			t.Fatalf("legacy type spec %d: %v", spec, err)
		}
		rule.BlockSource.Types = []string{"l:t"}
		raw, _ = json.Marshal(view)
		_, err = ParseAttributeViewData(view.ID, raw)
		if (err == nil) != (spec >= 3) {
			t.Fatalf("subtype spec %d: %v", spec, err)
		}
		rule.BlockSource.Types = []string{"l"}
		rule.BlockSource.TagMatch = "or"
		raw, _ = json.Marshal(view)
		_, err = ParseAttributeViewData(view.ID, raw)
		if (err == nil) != (spec >= 3) {
			t.Fatalf("OR spec %d: %v", spec, err)
		}
		for _, target := range []string{"block", "container"} {
			rule.BlockSource.TagTarget = target
			raw, _ = json.Marshal(view)
			_, err = ParseAttributeViewData(view.ID, raw)
			if (err == nil) != (spec >= 4) {
				t.Fatalf("tag target %s spec %d: %v", target, spec, err)
			}
		}
		for _, depth := range []int{0, 1, 12} {
			rule.BlockSource.DocumentDepth = &depth
			raw, _ = json.Marshal(view)
			parsed, parseErr := ParseAttributeViewData(view.ID, raw)
			if (parseErr == nil) != (spec >= 5) {
				t.Fatalf("document depth %d spec %d: %v", depth, spec, parseErr)
			}
			if parseErr == nil && *parsed.Automations.Rules[0].BlockSource.DocumentDepth != depth {
				t.Fatal("document depth was not preserved")
			}
		}
	}
}

func TestAutomationAttributeNameSpecCompatibility(t *testing.T) {
	data, err := os.ReadFile("testdata/spec9-layouts.json")
	if err != nil {
		t.Fatal(err)
	}
	for spec := 1; spec <= 7; spec++ {
		for _, mode := range []string{"", "equals", "contains", "regex"} {
			view, err := ParseAttributeViewData("20260921000000-layouts", data)
			if err != nil {
				t.Fatal(err)
			}
			attr := &AutomationBlockAttribute{Name: "custom-state", NameOperator: mode, Operator: "exists"}
			view.Automations = &AutomationConfig{Spec: spec, Rules: []*AutomationRule{{BlockSource: &AutomationBlockSource{
				Attributes: []*AutomationBlockAttribute{attr}, DocumentDepth: new(0),
			}}}}
			// 先检查独立的名称语义，再叠加文档深度，避免较低优先级覆盖新格式要求。
			view.Automations.Rules[0].BlockSource.DocumentDepth = nil
			raw, _ := json.Marshal(view)
			read, err := ParseAttributeViewData(view.ID, raw)
			want := spec >= 6 || mode == "" || mode == "equals"
			if (err == nil) != want {
				t.Fatalf("name mode %q spec %d: %v", mode, spec, err)
			}
			if want && read.Automations.Rules[0].BlockSource.Attributes[0].NameOperator != mode {
				t.Fatal("name operator lost during storage round trip")
			}
			if mode == "contains" || mode == "regex" {
				view.Automations.Rules[0].BlockSource.DocumentDepth = new(0)
				if got := view.Automations.Rules[0].RequiredSpec(); got != 6 {
					t.Fatalf("combined spec = %d", got)
				}
			}
		}
	}
}

func TestAutomationSelectedDocumentsSpecCompatibility(t *testing.T) {
	data, err := os.ReadFile("testdata/spec9-layouts.json")
	if err != nil {
		t.Fatal(err)
	}
	for spec := 1; spec <= 7; spec++ {
		for _, include := range []*bool{nil, new(true), new(false)} {
			view, err := ParseAttributeViewData("20260921000000-layouts", data)
			if err != nil {
				t.Fatal(err)
			}
			source := &AutomationBlockSource{DocumentIDs: []string{"parent"}, IncludeSelectedDocuments: include}
			view.Automations = &AutomationConfig{Spec: spec, Rules: []*AutomationRule{{BlockSource: source}}}
			raw, _ := json.Marshal(view)
			read, err := ParseAttributeViewData(view.ID, raw)
			want := include == nil || *include || spec >= 7
			if (err == nil) != want {
				t.Fatalf("include %v spec %d: %v", include, spec, err)
			}
			if want {
				got := read.Automations.Rules[0].BlockSource.IncludeSelectedDocuments
				if (got == nil) != (include == nil) || got != nil && *got != *include {
					t.Fatal("selected document inclusion lost during storage round trip")
				}
			}
			if include != nil && !*include {
				source.DocumentDepth = new(1)
				source.TagTarget = "container"
				source.Attributes = []*AutomationBlockAttribute{{Name: "state", NameOperator: "contains", Operator: "exists"}}
				if got := view.Automations.Rules[0].RequiredSpec(); got != 7 {
					t.Fatalf("combined required spec = %d", got)
				}
			}
		}
	}
}

func TestAutomationPreservesPersistedColors(t *testing.T) {
	view := &AttributeView{Automations: &AutomationConfig{Spec: 1, Rules: []*AutomationRule{{
		Actions: []*AutomationAction{{Fields: map[string]*AutomationValue{"select": {
			Mode: "static", Value: &Value{Type: KeyTypeSelect, MSelect: []*ValueSelect{{Content: "Custom", Color: "18"}}},
		}}}},
	}}}}
	if !slices.Contains(view.UsedCustomColorIndexes(), 18) {
		t.Fatal("automation-only custom color was considered unused")
	}
}

func TestAutomationReferenceSpecCompatibility(t *testing.T) {
	data, err := os.ReadFile("testdata/spec9-layouts.json")
	if err != nil {
		t.Fatal(err)
	}
	for spec := 1; spec <= 8; spec++ {
		view, err := ParseAttributeViewData("20260921000000-layouts", data)
		if err != nil {
			t.Fatal(err)
		}
		source := &AutomationBlockSource{ReferenceID: "20261026000000-target1", IncludeSelectedDocuments: new(false), TagTarget: "container"}
		view.Automations = &AutomationConfig{Spec: spec, Rules: []*AutomationRule{{BlockSource: source}}}
		raw, _ := json.Marshal(view)
		read, err := ParseAttributeViewData(view.ID, raw)
		if (err == nil) != (spec == 8) {
			t.Fatalf("reference spec %d: %v", spec, err)
		}
		if spec == 8 && read.Automations.Rules[0].BlockSource.ReferenceID != source.ReferenceID {
			t.Fatal("reference target lost in storage round trip")
		}
		if view.Automations.Rules[0].RequiredSpec() != 8 {
			t.Fatal("other options masked the reference specification")
		}
	}
}
