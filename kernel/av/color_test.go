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
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/goccy/go-json"
)

func testAttributeViewCustomColor(index int, lightColor, lightBackground, darkColor, darkBackground string) *AttributeViewCustomColor {
	return &AttributeViewCustomColor{
		Index: index,
		AttributeViewColor: AttributeViewColor{
			Light: AttributeViewColorTheme{Color: lightColor, BackgroundColor: lightBackground},
			Dark:  AttributeViewColorTheme{Color: darkColor, BackgroundColor: darkBackground},
		},
	}
}

func withWorkspacePalette(t *testing.T, colors *[]*AttributeViewCustomColor) {
	t.Helper()
	old := LoadWorkspacePalette
	t.Cleanup(func() { LoadWorkspacePalette = old })
	LoadWorkspacePalette = func() ([]*AttributeViewCustomColor, []string) {
		if colors == nil {
			return nil, nil
		}
		return *colors, DefaultAttributeViewColorOrder(*colors)
	}
}

func TestFilterColorValuePreservesPaletteIndex(t *testing.T) {
	for _, color := range []string{"", "1", "14"} {
		if filtered := FilterColorValue(color); filtered != color {
			t.Fatalf("palette color was changed [expected=%q, actual=%q]", color, filtered)
		}
	}
	if filtered := FilterColorValue(" 3 "); filtered != "3" {
		t.Fatalf("palette color with whitespace was not trimmed [%q]", filtered)
	}
}

func TestFilterColorValueRejectsUnsafeValues(t *testing.T) {
	for _, color := range []string{
		`1);color:red" onmouseover="alert(1)" x="`,
		"0",
		"15",
		"1.5",
		"abc",
		`"`,
		"<script>",
	} {
		if filtered := FilterColorValue(color); "" != filtered {
			t.Fatalf("unsafe color value was preserved [input=%q, actual=%q]", color, filtered)
		}
	}
}

func TestNormalizeAttributeViewCustomColors(t *testing.T) {
	colors, err := NormalizeAttributeViewCustomColors([]*AttributeViewCustomColor{
		testAttributeViewCustomColor(16, " #AABBCC ", "#DDEEFF", "#112233", "#445566"),
		testAttributeViewCustomColor(15, "#010203", "#040506", "#070809", "#0A0B0C"),
	}, true)
	if nil != err {
		t.Fatalf("normalize attribute view custom colors failed: %s", err)
	}
	if 2 != len(colors) || 15 != colors[0].Index || 16 != colors[1].Index {
		t.Fatalf("custom colors were not sorted by index: %+v", colors)
	}
	if "#aabbcc" != colors[1].Light.Color || "#0a0b0c" != colors[0].Dark.BackgroundColor {
		t.Fatalf("custom colors were not normalized: %+v", colors)
	}

	invalid := [][]*AttributeViewCustomColor{
		{testAttributeViewCustomColor(14, "#000000", "#ffffff", "#000000", "#ffffff")},
		{testAttributeViewCustomColor(79, "#000000", "#ffffff", "#000000", "#ffffff")},
		{testAttributeViewCustomColor(15, "red", "#ffffff", "#000000", "#ffffff")},
		{testAttributeViewCustomColor(15, "#000000", `url("javascript:alert(1)")`, "#000000", "#ffffff")},
		{
			testAttributeViewCustomColor(15, "#000000", "#ffffff", "#000000", "#ffffff"),
			testAttributeViewCustomColor(15, "#111111", "#eeeeee", "#111111", "#eeeeee"),
		},
	}
	for _, input := range invalid {
		if _, err = NormalizeAttributeViewCustomColors(input, true); nil == err {
			t.Fatalf("expected invalid custom colors to fail: %+v", input)
		}
	}

	tooMany := make([]*AttributeViewCustomColor, MaxCustomColors+1)
	if _, err = NormalizeAttributeViewCustomColors(tooMany, true); nil == err {
		t.Fatal("expected an oversized custom palette to fail")
	}

	data, err := json.Marshal(colors[0])
	if nil != err {
		t.Fatalf("marshal custom color failed: %s", err)
	}
	fields := map[string]json.RawMessage{}
	if err = json.Unmarshal(data, &fields); nil != err {
		t.Fatalf("unmarshal custom color fields failed: %s", err)
	}
	if nil == fields["index"] || nil == fields["light"] || nil == fields["dark"] {
		t.Fatalf("custom color JSON is missing required fields: %s", data)
	}
	for key := range fields {
		if key != "index" && key != "light" && key != "dark" && key != "hidden" {
			t.Fatalf("unexpected custom color JSON field [%s]: %s", key, data)
		}
	}

	if _, err = NormalizeAttributeViewCustomColors([]*AttributeViewCustomColor{
		testAttributeViewCustomColor(14, "#000000", "#ffffff", "#000000", "#ffffff"),
	}, true); nil == err {
		t.Fatal("invalid custom palette index was accepted")
	}
}

func TestAttributeViewCustomColorIndexes(t *testing.T) {
	palette := []*AttributeViewCustomColor{
		testAttributeViewCustomColor(15, "#010203", "#040506", "#070809", "#0a0b0c"),
		testAttributeViewCustomColor(17, "#111213", "#141516", "#171819", "#1a1b1c"),
	}
	withWorkspacePalette(t, &palette)
	attrView := &AttributeView{}
	if 16 != attrView.NextCustomColorIndex() {
		t.Fatalf("expected the smallest free custom color index, got %d", attrView.NextCustomColorIndex())
	}
	if "15" != attrView.FilterColorValue(" 15 ") {
		t.Fatal("defined custom color index was rejected")
	}
	if "" != attrView.FilterColorValue("16") || "" != attrView.FilterColorValue(`15);color:red`) {
		t.Fatal("undefined or unsafe custom color index was accepted")
	}
	resolved := attrView.ResolveColor("15")
	if nil == resolved || "#010203" != resolved.Light.Color || "#0a0b0c" != resolved.Dark.BackgroundColor {
		t.Fatalf("unexpected resolved custom color: %+v", resolved)
	}

	key := NewKey("key", "Select", "", KeyTypeSelect)
	key.Options = []*SelectOption{{Name: "Used", Color: " 015 "}}
	attrView.KeyValues = []*KeyValues{{Key: key}}
	if !attrView.UsesCustomColor(15) {
		t.Fatal("custom color reference with a non-canonical index was not detected")
	}
	used := attrView.UsedCustomColorIndexes()
	if 1 != len(used) || 15 != used[0] {
		t.Fatalf("unexpected used custom color indexes: %+v", used)
	}

	attrView.KeyValues = []*KeyValues{{Values: []*Value{
		{Rollup: &ValueRollup{Contents: []*Value{{MSelect: []*ValueSelect{{Content: "Target", Color: "15"}}}}}},
		{Relation: &ValueRelation{Contents: []*Value{{MSelect: []*ValueSelect{{Content: "Target", Color: "15"}}}}}},
	}}}
	if attrView.UsesCustomColor(15) || 0 != len(attrView.UsedCustomColorIndexes()) {
		t.Fatal("target database colors in rollup/relation contents were counted as current database references")
	}
	if 16 != attrView.NextCustomColorIndex() {
		t.Fatalf("existing gaps were unexpectedly reordered, got next index %d", attrView.NextCustomColorIndex())
	}
	palette = palette[1:]
	if 15 != attrView.NextCustomColorIndex() || 17 != palette[0].Index {
		t.Fatalf("deleting a color reordered stable indexes: %+v", palette)
	}
}

func TestResolveDirectColorsLoadsWorkspacePaletteOnce(t *testing.T) {
	color := testAttributeViewCustomColor(15, "#010203", "#040506", "#070809", "#0a0b0c")
	old := LoadWorkspacePalette
	t.Cleanup(func() { LoadWorkspacePalette = old })
	calls := 0
	LoadWorkspacePalette = func() ([]*AttributeViewCustomColor, []string) {
		calls++
		return []*AttributeViewCustomColor{color}, []string{"15", "1"}
	}
	attrView := &AttributeView{
		KeyValues: []*KeyValues{{
			Key:    &Key{ID: "select", Type: KeyTypeSelect, Options: []*SelectOption{{Color: "15"}, {Color: "15"}}},
			Values: []*Value{{MSelect: []*ValueSelect{{Color: "15"}, {Color: "15"}}}},
		}},
		Views: []*View{{
			GroupKey: &Key{ID: "select", Type: KeyTypeSelect, Options: []*SelectOption{{Color: "15"}}},
			GroupVal: &Value{MSelect: []*ValueSelect{{Color: "15"}}},
		}},
	}
	attrView.ResolveDirectColors()
	if calls != 1 {
		t.Fatalf("workspace palette was loaded %d times, want 1", calls)
	}
}

func TestUsedCustomColorIndexesScansPersistedReferences(t *testing.T) {
	selectValue := func(index string) *Value {
		return &Value{MSelect: []*ValueSelect{{Content: "Value", Color: index}}}
	}
	filter := func(column, index string) *ViewFilter {
		return &ViewFilter{Column: column, Value: selectValue(index)}
	}
	selectKey := &Key{ID: "select", Type: KeyTypeSelect, Options: []*SelectOption{{Color: "20"}}}
	attrView := &AttributeView{
		KeyValues: []*KeyValues{
			{Key: &Key{ID: "relation", Type: KeyTypeRelation, Relation: &Relation{
				CandidateFilters: []*ViewFilter{{Filters: []*ViewFilter{filter("target-select", "15")}}},
			}}},
			{Key: &Key{ID: "rollup", Type: KeyTypeRollup, Rollup: &Rollup{
				Filters: []*ViewFilter{filter("target-select", "16")}, Calc: &RollupCalc{Result: selectValue("17")},
			}}},
			{Key: selectKey, Values: []*Value{selectValue("18")}},
		},
		Views: []*View{{
			Filters:   []*ViewFilter{filter(selectKey.ID, "19")},
			GroupKey:  selectKey,
			GroupVal:  selectValue("21"),
			GroupCalc: &GroupCalc{FieldCalc: &FieldCalc{Result: selectValue("22")}},
			Table: &LayoutTable{
				BaseLayout: &BaseLayout{Filters: []*ViewFilter{filter(selectKey.ID, "23")}},
				Columns: []*ViewTableColumn{{
					BaseField: &BaseField{Calc: &FieldCalc{Result: selectValue("24")}},
					Calc:      &FieldCalc{Result: selectValue("25")},
				}},
			},
			Groups: []*View{{GroupVal: selectValue("26")}},
		}},
		NewItemTemplates: []*NewItemTemplate{{FieldValues: map[string]*NewItemFieldValue{
			"field": {Value: selectValue("27")},
		}}},
	}
	want := []int{18, 19, 20, 21, 23, 26, 27}
	got := attrView.UsedCustomColorIndexes()
	if len(want) != len(got) {
		t.Fatalf("unexpected used custom color indexes: %+v", got)
	}
	for i := range want {
		if want[i] != got[i] {
			t.Fatalf("unexpected used custom color indexes: %+v", got)
		}
	}
}

func TestResolvedColorCannotBeLoadedFromJSON(t *testing.T) {
	payload := `{"name":"Option","content":"Value","color":"15","resolvedColor":{"light":{"color":"#000000","backgroundColor":"#ffffff"},"dark":{"color":"#ffffff","backgroundColor":"#000000"}}}`
	option := &SelectOption{}
	if err := json.Unmarshal([]byte(payload), option); nil != err {
		t.Fatalf("unmarshal select option failed: %s", err)
	}
	if nil != option.ResolvedColor {
		t.Fatal("select option accepted an externally supplied resolved color")
	}
	selection := &ValueSelect{}
	if err := json.Unmarshal([]byte(payload), selection); nil != err {
		t.Fatalf("unmarshal select value failed: %s", err)
	}
	if nil != selection.ResolvedColor {
		t.Fatal("select value accepted an externally supplied resolved color")
	}

	attrView := &AttributeView{
		KeyValues: []*KeyValues{{
			Key:    &Key{Options: []*SelectOption{option}},
			Values: []*Value{{Type: KeyTypeSelect, MSelect: []*ValueSelect{selection}}},
		}},
	}
	palette := []*AttributeViewCustomColor{
		testAttributeViewCustomColor(15, "#010203", "#040506", "#070809", "#0a0b0c"),
	}
	withWorkspacePalette(t, &palette)
	attrView.ResolveDirectColors()
	if nil == option.ResolvedColor || nil == selection.ResolvedColor {
		t.Fatal("direct option and value colors were not resolved from the validated palette")
	}
	restore := attrView.suspendResolvedColors()
	data, err := json.Marshal(attrView)
	if nil != err {
		t.Fatalf("marshal attribute view failed: %s", err)
	}
	if strings.Contains(string(data), "resolvedColor") {
		t.Fatalf("derived colors leaked into persisted JSON: %s", data)
	}
	restore()
	if nil == option.ResolvedColor || nil == selection.ResolvedColor {
		t.Fatal("derived colors were not restored after persistence serialization")
	}

	nested := &Value{Rollup: &ValueRollup{Contents: []*Value{{MSelect: []*ValueSelect{selection}}}}}
	cloned := nested.Clone()
	if nil == cloned || nil == cloned.Rollup || 1 != len(cloned.Rollup.Contents) ||
		nil == cloned.Rollup.Contents[0].MSelect[0].ResolvedColor {
		t.Fatalf("internal value clone discarded a trusted resolved color: %+v", cloned)
	}
	if cloned.Rollup.Contents[0].MSelect[0].ResolvedColor == selection.ResolvedColor {
		t.Fatal("internal value clone reused a mutable resolved color pointer")
	}
}

func TestGroupResolvedColorSurvivesPersistenceRoundTrip(t *testing.T) {
	selectKey := &Key{ID: "select", Type: KeyTypeSelect}
	selectKey.Options = []*SelectOption{{Name: "Group", Color: "15"}}
	attrView := &AttributeView{
		Spec:      CurrentSpec,
		ID:        "20260824120000-colors2",
		KeyValues: []*KeyValues{{Key: selectKey}},
		Views: []*View{{
			ID:         "view",
			LayoutType: LayoutTypeTable,
			Group:      &ViewGroup{Field: selectKey.ID},
			Groups: []*View{{
				GroupKey: selectKey,
				GroupVal: &Value{Type: KeyTypeSelect, MSelect: []*ValueSelect{{Content: "Group", Color: "15"}}},
			}},
		}},
	}
	palette := []*AttributeViewCustomColor{
		testAttributeViewCustomColor(15, "#010203", "#040506", "#070809", "#0a0b0c"),
	}
	withWorkspacePalette(t, &palette)
	attrView.ResolveDirectColors()
	if nil == attrView.Views[0].Groups[0].GroupVal.MSelect[0].ResolvedColor {
		t.Fatal("group value color was not initially resolved")
	}

	restore := attrView.suspendResolvedColors()
	data, err := json.Marshal(attrView)
	restore()
	if nil != err {
		t.Fatalf("marshal attribute view failed: %s", err)
	}
	path := filepath.Join(t.TempDir(), attrView.ID+".json")
	if err = os.WriteFile(path, data, 0o600); nil != err {
		t.Fatalf("write attribute view failed: %s", err)
	}

	parsed, err := ParseAttributeViewByPath(path)
	if nil != err {
		t.Fatalf("parse attribute view failed: %s", err)
	}
	groupValue := parsed.Views[0].Groups[0].GroupVal.MSelect[0]
	if nil == groupValue.ResolvedColor || "#010203" != groupValue.ResolvedColor.Light.Color {
		t.Fatalf("group value color was not resolved after persistence round trip: %+v", groupValue)
	}
}

func TestNormalizeAttributeViewColorOrder(t *testing.T) {
	color := testAttributeViewCustomColor(15, "#010203", "#040506", "#070809", "#0a0b0c")
	color.Hidden = true
	got := NormalizeAttributeViewColorOrder([]string{"15", "1", "15", "99", "14"}, []*AttributeViewCustomColor{color})
	if 15 != len(got) || "15" != got[0] || "1" != got[1] || "14" != got[2] || "2" != got[3] || "13" != got[len(got)-1] {
		t.Fatalf("unexpected mixed color order: %+v", got)
	}

	normalized, err := NormalizeAttributeViewCustomColors([]*AttributeViewCustomColor{color}, true)
	if nil != err {
		t.Fatalf("normalize hidden custom color failed: %s", err)
	}
	if 1 != len(normalized) || !normalized[0].Hidden {
		t.Fatalf("custom color hidden flag was not preserved: %+v", normalized)
	}

	defaults := DefaultAttributeViewColorOrder(normalized)
	if BuiltinColorCount+1 != len(defaults) || "1" != defaults[0] || "14" != defaults[BuiltinColorCount-1] ||
		"15" != defaults[len(defaults)-1] {
		t.Fatalf("unexpected default color order: %+v", defaults)
	}
}

func TestResolveColorUsesWorkspacePalette(t *testing.T) {
	old := LoadWorkspacePalette
	t.Cleanup(func() { LoadWorkspacePalette = old })
	LoadWorkspacePalette = func() ([]*AttributeViewCustomColor, []string) {
		return []*AttributeViewCustomColor{testAttributeViewCustomColor(15, "#010203", "#040506", "#070809", "#0a0b0c")}, nil
	}

	attrView := &AttributeView{}
	if 16 != attrView.NextCustomColorIndex() {
		t.Fatalf("workspace palette was not considered: %d", attrView.NextCustomColorIndex())
	}
	resolved := attrView.ResolveColor("15")
	if nil == resolved || "#010203" != resolved.Light.Color {
		t.Fatalf("workspace palette was not resolved: %+v", resolved)
	}
}
