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

import "testing"

func TestValueNormalizeBlockRefSubtype(t *testing.T) {
	const avID = "20260814000000-avtest1"
	staticAttr := NodeAttrViewStaticText + "-" + avID
	tests := []struct {
		name            string
		value           *Value
		attrs           map[string]string
		expectedSubtype BlockRefSubtype
		expectedContent string
		expectedChanged bool
	}{
		{
			name: "Legacy dynamic",
			value: &Value{Type: KeyTypeBlock, Block: &ValueBlock{
				ID: "20260814000001-dynamic", Content: "Dynamic",
			}},
			expectedSubtype: BlockRefSubtypeDynamic,
			expectedContent: "Dynamic",
			expectedChanged: true,
		},
		{
			name: "Legacy static",
			value: &Value{Type: KeyTypeBlock, Block: &ValueBlock{
				ID: "20260814000002-static1", Content: "Old",
			}},
			attrs:           map[string]string{staticAttr: "Static"},
			expectedSubtype: BlockRefSubtypeStatic,
			expectedContent: "Static",
			expectedChanged: true,
		},
		{
			name: "Persisted dynamic is authoritative",
			value: &Value{Type: KeyTypeBlock, Block: &ValueBlock{
				ID: "20260814000003-current", Content: "Dynamic", RefSubtype: BlockRefSubtypeDynamic,
			}},
			attrs:           map[string]string{staticAttr: "Stale"},
			expectedSubtype: BlockRefSubtypeDynamic,
			expectedContent: "Dynamic",
			expectedChanged: false,
		},
		{
			name: "Invalid subtype",
			value: &Value{Type: KeyTypeBlock, Block: &ValueBlock{
				ID: "20260814000004-invalid", Content: "Dynamic", RefSubtype: BlockRefSubtype("invalid"),
			}},
			expectedSubtype: BlockRefSubtypeDynamic,
			expectedContent: "Dynamic",
			expectedChanged: true,
		},
		{
			name: "Detached",
			value: &Value{Type: KeyTypeBlock, IsDetached: true, Block: &ValueBlock{
				Content: "Detached", RefSubtype: BlockRefSubtypeStatic,
			}},
			expectedContent: "Detached",
			expectedChanged: true,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			changed := test.value.NormalizeBlockRefSubtype(avID, test.attrs)
			if test.expectedChanged != changed {
				t.Fatalf("unexpected changed state: %v", changed)
			}
			if test.expectedSubtype != test.value.Block.RefSubtype || test.expectedContent != test.value.Block.Content {
				t.Fatalf("unexpected normalized block value: %+v", test.value.Block)
			}
		})
	}
}

func TestValueRollupCalcUniqueValues(t *testing.T) {
	t.Run("Text", func(t *testing.T) {
		rollup := &ValueRollup{Contents: []*Value{
			{Type: KeyTypeText, Text: &ValueText{Content: "11"}},
			{Type: KeyTypeText, Text: &ValueText{Content: "Carry Bag"}},
			{Type: KeyTypeText, Text: &ValueText{Content: "Carry Bag"}},
		}}

		rollup.calcContents(&RollupCalc{Operator: CalcOperatorUniqueValues}, &Key{Type: KeyTypeText})

		if 2 != len(rollup.Contents) {
			t.Fatalf("expected 2 unique values, got %d", len(rollup.Contents))
		}
		if "11" != rollup.Contents[0].String(true) || "Carry Bag" != rollup.Contents[1].String(true) {
			t.Fatalf("unexpected unique values: %q, %q", rollup.Contents[0].String(true), rollup.Contents[1].String(true))
		}
	})

	t.Run("Multiple Select", func(t *testing.T) {
		rollup := &ValueRollup{Contents: []*Value{
			{Type: KeyTypeMSelect, MSelect: []*ValueSelect{{Content: "A"}, {Content: "B"}}},
			{Type: KeyTypeMSelect, MSelect: []*ValueSelect{{Content: "B"}, {Content: "C"}}},
			{Type: KeyTypeMSelect, MSelect: []*ValueSelect{{Content: "A"}}},
		}}

		rollup.calcContents(&RollupCalc{Operator: CalcOperatorUniqueValues}, &Key{Type: KeyTypeMSelect})

		if 2 != len(rollup.Contents) {
			t.Fatalf("expected 2 non-empty values, got %d", len(rollup.Contents))
		}
		if "A B" != rollup.Contents[0].String(true) || "C" != rollup.Contents[1].String(true) {
			t.Fatalf("unexpected unique values: %q, %q", rollup.Contents[0].String(true), rollup.Contents[1].String(true))
		}
	})
}

func TestValueRollupCalcCountAll(t *testing.T) {
	t.Run("Relation", func(t *testing.T) {
		rollup := &ValueRollup{Contents: []*Value{
			{Type: KeyTypeRelation, Relation: &ValueRelation{BlockIDs: []string{"order-1", "order-2"}}},
			{Type: KeyTypeRelation, Relation: &ValueRelation{BlockIDs: []string{"order-3"}}},
		}}

		rollup.calcContents(&RollupCalc{Operator: CalcOperatorCountAll}, &Key{Type: KeyTypeRelation})

		if 1 != len(rollup.Contents) || nil == rollup.Contents[0].Number {
			t.Fatalf("unexpected calculation result: %+v", rollup.Contents)
		}
		if 3 != rollup.Contents[0].Number.Content {
			t.Fatalf("expected 3 relation entries, got %v", rollup.Contents[0].Number.Content)
		}
	})

	t.Run("Scalar", func(t *testing.T) {
		rollup := &ValueRollup{Contents: []*Value{
			{Type: KeyTypeText, Text: &ValueText{Content: "A"}},
			{Type: KeyTypeText, Text: &ValueText{Content: "B"}},
		}}

		rollup.calcContents(&RollupCalc{Operator: CalcOperatorCountAll}, &Key{Type: KeyTypeText})

		if 1 != len(rollup.Contents) || nil == rollup.Contents[0].Number {
			t.Fatalf("unexpected calculation result: %+v", rollup.Contents)
		}
		if 2 != rollup.Contents[0].Number.Content {
			t.Fatalf("expected 2 scalar entries, got %v", rollup.Contents[0].Number.Content)
		}
	})
}

func TestValueRollupBuildContentsFiltersEligibleItems(t *testing.T) {
	destKey := &Key{ID: "target", Type: KeyTypeText}
	keyValues := []*KeyValues{{
		Key: destKey,
		Values: []*Value{
			{BlockID: "item-a", Type: KeyTypeText, Text: &ValueText{Content: "A"}},
			{BlockID: "item-b", Type: KeyTypeText, Text: &ValueText{Content: "B"}},
			{BlockID: "item-c", Type: KeyTypeText, Text: &ValueText{Content: "C"}},
		},
	}}
	relationValue := &Value{
		Type: KeyTypeRelation,
		Relation: &ValueRelation{
			BlockIDs: []string{"item-a", "item-b", "item-c"},
		},
	}
	rollup := &ValueRollup{}

	rollup.BuildContents(keyValues, destKey, relationValue, &RollupCalc{Operator: CalcOperatorCountAll},
		&RollupRenderContext{EligibleItemIDs: map[string]bool{"item-b": true, "item-c": true}})

	if 1 != len(rollup.Contents) || nil == rollup.Contents[0].Number {
		t.Fatalf("unexpected calculation result: %+v", rollup.Contents)
	}
	if 2 != rollup.Contents[0].Number.Content {
		t.Fatalf("expected 2 eligible items, got %v", rollup.Contents[0].Number.Content)
	}
}

func TestValueRollupBuildContentsPreservesBlockRefSubtype(t *testing.T) {
	destKey := &Key{ID: "target", Type: KeyTypeBlock}
	keyValues := []*KeyValues{{
		Key: destKey,
		Values: []*Value{{
			BlockID: "item-a",
			Type:    KeyTypeBlock,
			Block:   &ValueBlock{ID: "block-a", Content: "A", RefSubtype: BlockRefSubtypeDynamic},
		}},
	}}
	relationValue := &Value{Type: KeyTypeRelation, Relation: &ValueRelation{BlockIDs: []string{"item-a"}}}
	rollup := &ValueRollup{}

	rollup.BuildContents(keyValues, destKey, relationValue, nil, nil)

	if 1 != len(rollup.Contents) || nil == rollup.Contents[0].Block ||
		BlockRefSubtypeDynamic != rollup.Contents[0].Block.RefSubtype {
		t.Fatalf("rollup did not preserve the block reference subtype: %+v", rollup.Contents)
	}
}
