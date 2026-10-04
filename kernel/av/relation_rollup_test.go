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

package av

import (
	"errors"
	"reflect"
	"testing"
)

func relationRollupFixture() (*AttributeView, *AttributeView, *Key) {
	relation := &Key{ID: "tasks", Type: KeyTypeRelation, Relation: &Relation{AvID: "tasks-db"}}
	rollup := &Key{ID: "employees", Name: "Employees", Type: KeyTypeRollup,
		Rollup: &Rollup{RelationKeyID: relation.ID, KeyID: "staff"}}
	source := &AttributeView{ID: "projects-db", KeyValues: []*KeyValues{
		{Key: relation, Values: []*Value{
			{KeyID: relation.ID, BlockID: "project", Type: KeyTypeRelation,
				Relation: &ValueRelation{BlockIDs: []string{"task-a", "task-b"}}},
		}},
		{Key: rollup},
	}}
	target := &AttributeView{ID: "tasks-db", KeyValues: []*KeyValues{{
		Key: &Key{ID: "staff", Type: KeyTypeRelation, Relation: &Relation{AvID: "employees-db"}},
		Values: []*Value{
			{KeyID: "staff", BlockID: "task-a", Type: KeyTypeRelation,
				Relation: &ValueRelation{BlockIDs: []string{"alice", "alice"}, Contents: []*Value{
					{BlockID: "alice", Type: KeyTypeBlock, Block: &ValueBlock{ID: "alice", Content: "Same name"}},
				}}},
			{KeyID: "staff", BlockID: "task-b", Type: KeyTypeRelation,
				Relation: &ValueRelation{BlockIDs: []string{"bob"}, Contents: []*Value{
					{BlockID: "bob", Type: KeyTypeBlock, Block: &ValueBlock{ID: "bob", Content: "Same name"}},
				}}},
		},
	}}}
	return source, target, rollup
}

func TestRollupRelationTargetAndContextFields(t *testing.T) {
	source, target, rollup := relationRollupFixture()
	loads := 0
	load := func(id string) (*AttributeView, error) {
		loads++
		if id != target.ID {
			t.Fatalf("unexpected intermediate database: %s", id)
		}
		return target, nil
	}
	for _, operator := range []CalcOperator{CalcOperatorNone, CalcOperatorUniqueValues} {
		rollup.Rollup.Calc = &RollupCalc{Operator: operator}
		key, err := source.ResolveRelationKey(rollup.ID, load)
		if nil != err || key.Relation.AvID != "employees-db" {
			t.Fatalf("unexpected final relation: %+v, %v", key, err)
		}
		fields := source.ContextFilterFields(load)
		if 2 != len(fields) || fields[1].ID != rollup.ID || fields[1].TargetAvID != "employees-db" {
			t.Fatalf("unexpected context candidates: %+v", fields)
		}
	}
	if loads != 4 {
		t.Fatalf("unexpected database loads: %d", loads)
	}
	for _, operator := range []CalcOperator{CalcOperatorCountAll, CalcOperatorTemplate} {
		rollup.Rollup.Calc = &RollupCalc{Operator: operator}
		if _, err := source.ResolveRelationKey(rollup.ID, load); nil == err {
			t.Fatalf("calculated rollup %s accepted as relation", operator)
		}
	}
	rollup.Rollup.Calc = nil
	target.KeyValues[0].Key.Type = KeyTypeText
	if _, err := source.ResolveRelationKey(rollup.ID, load); nil == err {
		t.Fatal("changed destination field should invalidate relation rollup")
	}
	target.KeyValues[0].Key.Type = KeyTypeRelation
	if _, err := source.ResolveRelationKey(rollup.ID, func(string) (*AttributeView, error) {
		return nil, errors.New("database unavailable")
	}); nil == err {
		t.Fatal("unavailable intermediate database should invalidate relation rollup")
	}
}

func TestRollupExactRelationFilterUsesWholeSet(t *testing.T) {
	source, target, rollup := relationRollupFixture()
	value := &Value{KeyID: rollup.ID, Type: KeyTypeRollup, Rollup: &ValueRollup{}}
	comparison := &Value{Type: KeyTypeRelation, Relation: &ValueRelation{BlockIDs: []string{"alice"}}}
	filter := &ViewFilter{Column: rollup.ID, Value: &Value{Type: KeyTypeRollup,
		Rollup: &ValueRollup{Contents: []*Value{comparison}}}}
	cache := map[string]*AttributeView{target.ID: target}
	for _, operator := range []CalcOperator{CalcOperatorNone, CalcOperatorUniqueValues} {
		rollup.Rollup.Calc = &RollupCalc{Operator: operator}
		comparison.Relation.BlockIDs = []string{"bob"}
		filter.Operator = FilterOperatorContainsAnyItem
		if !value.Filter(filter, source, "project", nil, cache) {
			t.Fatal("unique display names must not remove a different employee ID from exact matching")
		}
		comparison.Relation.BlockIDs = []string{"alice"}
		for _, qualifier := range []FilterQuantifier{FilterQuantifierAny, FilterQuantifierAll, FilterQuantifierNone} {
			filter.Qualifier = qualifier
			filter.Operator = FilterOperatorContainsAnyItem
			if !value.Filter(filter, source, "project", nil, cache) {
				t.Fatal("matching employee should pass exact set filter")
			}
			filter.Operator = FilterOperatorDoesNotContainAnyItem
			if value.Filter(filter, source, "project", nil, cache) {
				t.Fatal("one unrelated task must not make the negative filter pass")
			}
		}
	}
	comparison.Relation.BlockIDs = []string{"different-id-same-name"}
	filter.Operator = FilterOperatorContainsAnyItem
	if value.Filter(filter, source, "project", nil, cache) {
		t.Fatal("names must not match different employee IDs")
	}
	comparison.Relation.BlockIDs = []string{"alice"}
	eligible := map[string]*RollupRenderContext{rollup.ID: {EligibleItemIDs: map[string]bool{"task-b": true}}}
	if value.Filter(filter, source, "project", eligible, cache) {
		t.Fatal("excluded task employee must not match")
	}
	filter.Operator = FilterOperatorDoesNotContainAnyItem
	if !value.Filter(filter, source, "project", eligible, cache) {
		t.Fatal("negative filter should pass when employee only belongs to an excluded task")
	}
	if !value.Filter(filter, source, "empty-project", nil, cache) {
		t.Fatal("empty rollup should pass the negative filter")
	}
	filter.Operator = FilterOperatorContainsAnyItem
	if value.Filter(filter, source, "empty-project", nil, cache) || evalMissingLeaf(filter) {
		t.Fatal("empty rollup must fail the positive filter")
	}
	comparison.Relation.BlockIDs = nil
	if !value.Filter(filter, source, "empty-project", nil, cache) {
		t.Fatal("unconfigured filter should be ignored")
	}
}

func TestRollupRelationContextFilterUsesDerivedValues(t *testing.T) {
	source, target, rollup := relationRollupFixture()
	table := &Table{Rows: []*TableRow{{ID: "project"}, {ID: "empty-project"}}}
	filterByContext(table, source, nil, map[string]*AttributeView{target.ID: target},
		&FilterContext{KeyID: rollup.ID, CurrentDocumentItemIDs: []string{"alice"}})
	if len(table.Rows) != 1 || table.Rows[0].ID != "project" {
		t.Fatalf("unexpected context rows: %+v", table.Rows)
	}
	if !reflect.DeepEqual(source.KeyValues[0].Values[0].Relation.BlockIDs, []string{"task-a", "task-b"}) {
		t.Fatal("context filtering changed the source relations")
	}
}
