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
	source.Automations.Spec = 2
	future, _ := json.Marshal(source)
	if _, err := ParseAttributeViewData(source.ID, future); err == nil {
		t.Fatal("unknown automation format was accepted")
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
