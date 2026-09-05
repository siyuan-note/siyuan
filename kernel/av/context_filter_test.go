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
	"encoding/json"
	"testing"
)

func TestAttributeViewContextFilterJSON(t *testing.T) {
	filter := &AttributeViewContextFilter{
		Spec:  AttributeViewContextFilterSpec,
		KeyID: "relation-key",
	}
	data, err := json.Marshal(filter)
	if nil != err {
		t.Fatal(err)
	}
	if got, want := string(data), `{"spec":1,"keyID":"relation-key"}`; got != want {
		t.Fatalf("unexpected context filter JSON: got %s, want %s", got, want)
	}

	parsed, err := ParseAttributeViewContextFilter(string(data))
	if nil != err {
		t.Fatal(err)
	}
	if nil == parsed || AttributeViewContextFilterSpec != parsed.Spec || "relation-key" != parsed.KeyID {
		t.Fatalf("unexpected parsed context filter: %#v", parsed)
	}
}

func TestParseAttributeViewContextFilter(t *testing.T) {
	tests := []struct {
		name    string
		raw     string
		wantNil bool
		wantErr bool
	}{
		{name: "missing", wantNil: true},
		{name: "malformed", raw: `{`, wantNil: true, wantErr: true},
		{name: "missing spec", raw: `{"keyID":"relation-key"}`, wantNil: true, wantErr: true},
		{name: "unknown spec", raw: `{"spec":2,"keyID":"relation-key"}`, wantNil: true, wantErr: true},
		{name: "current spec", raw: `{"spec":1,"keyID":"relation-key"}`},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			filter, err := ParseAttributeViewContextFilter(test.raw)
			if test.wantErr != (nil != err) {
				t.Fatalf("unexpected error state: %v", err)
			}
			if test.wantNil != (nil == filter) {
				t.Fatalf("unexpected parsed context filter: %#v", filter)
			}
		})
	}
}

func TestAttributeViewContextFilterValidate(t *testing.T) {
	attrView := &AttributeView{KeyValues: []*KeyValues{
		{Key: &Key{ID: "relation-key", Type: KeyTypeRelation, Relation: &Relation{AvID: "target-av"}}},
		{Key: &Key{ID: "text-key", Type: KeyTypeText}},
		{Key: &Key{ID: "unconfigured-relation-key", Type: KeyTypeRelation}},
		{Key: &Key{ID: "empty-target-relation-key", Type: KeyTypeRelation, Relation: &Relation{}}},
	}}
	tests := []struct {
		name     string
		filter   *AttributeViewContextFilter
		attrView *AttributeView
		wantErr  bool
	}{
		{
			name:     "valid relation",
			filter:   &AttributeViewContextFilter{Spec: AttributeViewContextFilterSpec, KeyID: "relation-key"},
			attrView: attrView,
		},
		{
			name:    "nil attribute view",
			filter:  &AttributeViewContextFilter{Spec: AttributeViewContextFilterSpec, KeyID: "relation-key"},
			wantErr: true,
		},
		{
			name:     "unknown spec",
			filter:   &AttributeViewContextFilter{Spec: AttributeViewContextFilterSpec + 1, KeyID: "relation-key"},
			attrView: attrView,
			wantErr:  true,
		},
		{
			name:     "missing key ID",
			filter:   &AttributeViewContextFilter{Spec: AttributeViewContextFilterSpec},
			attrView: attrView,
			wantErr:  true,
		},
		{
			name:     "unknown key",
			filter:   &AttributeViewContextFilter{Spec: AttributeViewContextFilterSpec, KeyID: "missing-key"},
			attrView: attrView,
			wantErr:  true,
		},
		{
			name:     "non relation key",
			filter:   &AttributeViewContextFilter{Spec: AttributeViewContextFilterSpec, KeyID: "text-key"},
			attrView: attrView,
			wantErr:  true,
		},
		{
			name:     "relation without configuration",
			filter:   &AttributeViewContextFilter{Spec: AttributeViewContextFilterSpec, KeyID: "unconfigured-relation-key"},
			attrView: attrView,
			wantErr:  true,
		},
		{
			name:     "relation without target",
			filter:   &AttributeViewContextFilter{Spec: AttributeViewContextFilterSpec, KeyID: "empty-target-relation-key"},
			attrView: attrView,
			wantErr:  true,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := test.filter.Validate(test.attrView)
			if test.wantErr != (nil != err) {
				t.Fatalf("unexpected validation result: %v", err)
			}
		})
	}
}

func TestFilterWithContext(t *testing.T) {
	relationKey := &Key{ID: "relation", Type: KeyTypeRelation, Relation: &Relation{AvID: "projects"}}
	textKey := &Key{ID: "status", Type: KeyTypeText}
	attrView := &AttributeView{KeyValues: []*KeyValues{
		{
			Key: relationKey,
			Values: []*Value{
				contextFilterRelationValue(relationKey.ID, "alpha-open", "project-alpha"),
				contextFilterRelationValue(relationKey.ID, "alpha-closed", "project-alpha"),
				contextFilterRelationValue(relationKey.ID, "beta-open", "project-beta"),
			},
		},
		{Key: textKey},
	}}
	context := &FilterContext{KeyID: relationKey.ID, CurrentDocumentItemIDs: []string{"project-alpha"}}

	t.Run("without view filter and without relation layout field", func(t *testing.T) {
		table := contextFilterTable(nil, textKey)
		FilterWithContext(table, attrView, nil, nil, context)
		assertContextFilterItemIDs(t, table, "alpha-open", "alpha-closed")
	})

	t.Run("combined with view filter using AND", func(t *testing.T) {
		filters := []*ViewFilter{{
			Combination: FilterCombinationAnd,
			Filters: []*ViewFilter{{
				Column: textKey.ID, Operator: FilterOperatorIsEqual,
				Value: &Value{Type: KeyTypeText, Text: &ValueText{Content: "open"}},
			}},
		}}
		table := contextFilterTable(filters, textKey)
		FilterWithContext(table, attrView, nil, nil, context)
		assertContextFilterItemIDs(t, table, "alpha-open")
	})

	t.Run("empty current document items", func(t *testing.T) {
		table := contextFilterTable(nil, textKey)
		FilterWithContext(table, attrView, nil, nil, &FilterContext{KeyID: relationKey.ID})
		assertContextFilterItemIDs(t, table)
	})
}

func TestAttributeViewContextFilterFields(t *testing.T) {
	attrView := &AttributeView{KeyValues: []*KeyValues{
		nil,
		{},
		{Key: &Key{ID: "text", Name: "Text", Type: KeyTypeText}},
		{Key: &Key{ID: "nil-relation", Name: "Nil relation", Type: KeyTypeRelation}},
		{Key: &Key{ID: "empty-target", Name: "Empty target", Type: KeyTypeRelation, Relation: &Relation{}}},
		{Key: &Key{
			ID: "project", Name: "Project", Icon: "1f4c1", Type: KeyTypeRelation,
			Relation: &Relation{AvID: "projects"},
		}},
	}}

	fields := attrView.ContextFilterFields()
	if 1 != len(fields) {
		t.Fatalf("unexpected context filter fields: %#v", fields)
	}
	field := fields[0]
	if nil == field || "project" != field.ID || "Project" != field.Name || "1f4c1" != field.Icon ||
		"projects" != field.TargetAvID {
		t.Fatalf("unexpected context filter field: %#v", field)
	}
	if fields := (*AttributeView)(nil).ContextFilterFields(); nil == fields || 0 != len(fields) {
		t.Fatalf("nil attribute view should return a non-nil empty field list: %#v", fields)
	}
}

func contextFilterRelationValue(keyID, blockID, relationItemID string) *Value {
	return &Value{
		KeyID: keyID, BlockID: blockID, Type: KeyTypeRelation,
		Relation: &ValueRelation{BlockIDs: []string{relationItemID}},
	}
}

func contextFilterTable(filters []*ViewFilter, textKey *Key) *Table {
	view := &View{ID: "view", LayoutType: LayoutTypeTable, Filters: filters, Table: NewLayoutTable()}
	return &Table{
		BaseInstance: NewViewBaseInstance(view),
		// 上下文关联字段有意不放入视图列，验证隐藏字段仍可参与筛选。
		Columns: []*TableColumn{{BaseInstanceField: &BaseInstanceField{ID: textKey.ID, Type: textKey.Type}}},
		Rows: []*TableRow{
			contextFilterTableRow("alpha-open", textKey.ID, "open"),
			contextFilterTableRow("alpha-closed", textKey.ID, "closed"),
			contextFilterTableRow("beta-open", textKey.ID, "open"),
		},
	}
}

func contextFilterTableRow(id, keyID, content string) *TableRow {
	return &TableRow{ID: id, Cells: []*TableCell{{BaseValue: &BaseValue{
		ValueType: KeyTypeText,
		Value:     &Value{KeyID: keyID, BlockID: id, Type: KeyTypeText, Text: &ValueText{Content: content}},
	}}}}
}

func assertContextFilterItemIDs(t *testing.T, table *Table, expected ...string) {
	t.Helper()
	items := table.GetItems()
	if len(expected) != len(items) {
		t.Fatalf("unexpected item count: got %d, want %d", len(items), len(expected))
	}
	for i, item := range items {
		if expected[i] != item.GetID() {
			t.Fatalf("unexpected item at %d: got %s, want %s", i, item.GetID(), expected[i])
		}
	}
}
