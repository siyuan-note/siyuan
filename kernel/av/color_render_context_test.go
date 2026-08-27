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
