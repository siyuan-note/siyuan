// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package av

import "testing"

func TestRollupFilterUsesHistoricalTargetCustomColorContext(t *testing.T) {
	relationKey := &Key{ID: "relation", Type: KeyTypeRelation, Relation: &Relation{AvID: "target"}}
	rollupKey := &Key{
		ID: "rollup", Type: KeyTypeRollup,
		Rollup: &Rollup{RelationKeyID: relationKey.ID, KeyID: "select"},
	}
	source := &AttributeView{
		CustomColorRenderContext: &CustomColorRenderContext{
			ResolveRelatedCustomColors: func(string) ([]*AttributeViewCustomColor, []string, bool) {
				return []*AttributeViewCustomColor{{
					Index: 15,
					AttributeViewColor: AttributeViewColor{
						Light: AttributeViewColorTheme{Color: "#010203", BackgroundColor: "#040506"},
						Dark:  AttributeViewColorTheme{Color: "#070809", BackgroundColor: "#0a0b0c"},
					},
				}}, []string{"15", "1"}, true
			},
		},
		KeyValues: []*KeyValues{
			{Key: relationKey, Values: []*Value{{
				KeyID: relationKey.ID, BlockID: "source-item", Type: KeyTypeRelation,
				Relation: &ValueRelation{BlockIDs: []string{"target-item"}},
			}}},
			{Key: rollupKey},
		},
	}
	targetValue := &Value{
		KeyID: "select", BlockID: "target-item", Type: KeyTypeSelect,
		MSelect: []*ValueSelect{{Content: "Current target value", Color: "15"}},
	}
	target := &AttributeView{
		ID: "target",
		KeyValues: []*KeyValues{{
			Key: &Key{ID: "select", Type: KeyTypeSelect}, Values: []*Value{targetValue},
		}},
	}
	current := []*AttributeViewCustomColor{{
		Index: 15,
		AttributeViewColor: AttributeViewColor{
			Light: AttributeViewColorTheme{Color: "#111213", BackgroundColor: "#141516"},
			Dark:  AttributeViewColorTheme{Color: "#171819", BackgroundColor: "#1a1b1c"},
		},
	}}
	old := LoadWorkspacePalette
	t.Cleanup(func() { LoadWorkspacePalette = old })
	LoadWorkspacePalette = func() ([]*AttributeViewCustomColor, []string) {
		return current, DefaultAttributeViewColorOrder(current)
	}
	target.ResolveDirectColors()
	rollupValue := &Value{KeyID: rollupKey.ID, BlockID: "source-item", Type: KeyTypeRollup, Rollup: &ValueRollup{}}
	filter := &ViewFilter{
		Qualifier: FilterQuantifierAny,
		Operator:  FilterOperatorIsEqual,
		Value: &Value{Type: KeyTypeRollup, Rollup: &ValueRollup{Contents: []*Value{{
			Type: KeyTypeSelect, MSelect: []*ValueSelect{{Content: "Current target value", Color: "15"}},
		}}}},
	}

	if !rollupValue.Filter(filter, source, "source-item", map[string]*RollupRenderContext{},
		map[string]*AttributeView{"target": target}) {
		t.Fatal("matching current target value did not pass the rollup filter")
	}
	if "Current target value" != targetValue.MSelect[0].Content {
		t.Fatal("historical palette context changed the current target value")
	}
	if 1 != len(rollupValue.Rollup.Contents) || nil == rollupValue.Rollup.Contents[0].MSelect[0].ResolvedColor ||
		"#010203" != rollupValue.Rollup.Contents[0].MSelect[0].ResolvedColor.Light.Color {
		t.Fatalf("filter rollup did not use the historical target palette: %+v", rollupValue.Rollup.Contents)
	}
}
