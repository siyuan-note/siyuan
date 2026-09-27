package av

import (
	"encoding/json"
	"reflect"
	"testing"
)

func TestConditionalColorPriority(t *testing.T) {
	textValue := &Value{Type: KeyTypeText, Text: &ValueText{Content: "ready"}}
	selected := &Value{Type: KeyTypeMSelect, MSelect: []*ValueSelect{{Content: "third", Color: "3"}, {Content: "first", Color: "1"}}}
	rule := func(id, column, target, color string) *ConditionalColorRule {
		return &ConditionalColorRule{ID: id, Target: target, Color: &ValueSelect{Color: color},
			Filter: &ViewFilter{Column: column, Operator: FilterOperatorIsNotEmpty}}
	}
	for _, test := range []struct {
		name       string
		rules      []*ConditionalColorRule
		layout     LayoutType
		background string
		properties map[string]string
	}{
		{"property before item", []*ConditionalColorRule{rule("1", "tags", "property", "4"), rule("2", "text", "item", "5"), rule("3", "text", "property", "6")}, LayoutTypeTable, "5", map[string]string{"tags": "4"}},
		{"item before property", []*ConditionalColorRule{rule("1", "text", "item", "5"), rule("2", "tags", "property", "4")}, LayoutTypeTable, "5", nil},
		{"independent properties", []*ConditionalColorRule{rule("1", "tags", "property", "4"), rule("2", "text", "property", "5"), rule("3", "tags", "property", "6")}, LayoutTypeTable, "none", map[string]string{"tags": "4", "text": "5"}},
		{"default consumes priority", []*ConditionalColorRule{rule("1", "text", "item", ""), rule("2", "text", "item", "5")}, LayoutTypeTable, "", nil},
		{"missing field skipped", []*ConditionalColorRule{rule("1", "missing", "item", "4"), rule("2", "text", "item", "5")}, LayoutTypeTable, "5", nil},
		{"list ignores property", []*ConditionalColorRule{rule("1", "text", "property", "4"), rule("2", "text", "item", "5")}, LayoutTypeList, "5", nil},
	} {
		t.Run(test.name, func(t *testing.T) {
			row := &TableRow{ID: "row", Cells: []*TableCell{{BaseValue: &BaseValue{Value: textValue}}, {BaseValue: &BaseValue{Value: selected}}}}
			table := &Table{Columns: []*TableColumn{{BaseInstanceField: &BaseInstanceField{ID: "text", Type: KeyTypeText, Hidden: true}}, {BaseInstanceField: &BaseInstanceField{ID: "tags", Type: KeyTypeMSelect}}}, Rows: []*TableRow{row}}
			before, _ := json.Marshal(row.Cells)
			RenderConditionalColors(table, &View{LayoutType: test.layout, ConditionalColors: test.rules}, &AttributeView{}, nil, nil)
			if row.ConditionalColors == nil {
				t.Fatal("missing colors")
			}
			actual := "none"
			if row.ConditionalColors.Background != nil {
				actual = row.ConditionalColors.Background.Color
			}
			if actual != test.background {
				t.Fatalf("background %q, want %q", actual, test.background)
			}
			properties := map[string]string{}
			for id, color := range row.ConditionalColors.Properties {
				properties[id] = color.Color
			}
			if len(properties) != len(test.properties) {
				t.Fatalf("properties: %v", properties)
			}
			for id, color := range test.properties {
				if properties[id] != color {
					t.Fatalf("properties: %v", properties)
				}
			}
			after, _ := json.Marshal(row.Cells)
			if string(before) != string(after) || len(table.Rows) != 1 {
				t.Fatal("color evaluation modified source values or rows")
			}
		})
	}
}

func TestConditionalColorOptionAndIncompleteRules(t *testing.T) {
	value := &Value{Type: KeyTypeMSelect, MSelect: []*ValueSelect{{Content: "third", Color: "3"}, {Content: "first", Color: "1"}}}
	row := &TableRow{Cells: []*TableCell{{BaseValue: &BaseValue{Value: value}}}}
	table := &Table{Columns: []*TableColumn{{BaseInstanceField: &BaseInstanceField{ID: "tags", Type: KeyTypeMSelect}}}, Rows: []*TableRow{row}}
	rule := &ConditionalColorRule{ID: "rule", Target: "item", MatchOption: true, Filter: &ViewFilter{Column: "tags", Operator: FilterOperatorIsNotEmpty, Value: &Value{Type: KeyTypeMSelect}}}
	view := &View{LayoutType: LayoutTypeTable, ConditionalColors: []*ConditionalColorRule{rule}}
	RenderConditionalColors(table, view, &AttributeView{}, nil, nil)
	if row.ConditionalColors.Background.Color != "3" {
		t.Fatal("must use selected value order")
	}
	value.MSelect[0].Color = ""
	RenderConditionalColors(table, view, &AttributeView{}, nil, nil)
	if row.ConditionalColors.Background.Color != "" {
		t.Fatal("default first option must not be skipped")
	}
	rule.Filter.Operator = FilterOperatorContains
	RenderConditionalColors(table, view, &AttributeView{}, nil, nil)
	if row.ConditionalColors != nil {
		t.Fatal("incomplete filter must not color all items")
	}
	rule.Filter.Operator = FilterOperatorIsNotEmpty
	rule.Filter.Value.Type = KeyTypeText
	RenderConditionalColors(table, view, &AttributeView{}, nil, nil)
	if row.ConditionalColors != nil {
		t.Fatal("changed field type must not reuse an incompatible condition")
	}
}

func TestConditionalColorLegacyCalendar(t *testing.T) {
	var view View
	fixture := `{"id":"legacy","type":"calendar","calendar":{"settings":{"colorKeyID":"status"}}}`
	if err := json.Unmarshal([]byte(fixture), &view); err != nil {
		t.Fatal(err)
	}
	view.LayoutType = LayoutTypeCalendar
	before, _ := json.Marshal(view)
	rules := view.EffectiveConditionalColors()
	if len(rules) != 1 || rules[0].Filter.Column != "status" || !rules[0].MatchOption {
		t.Fatalf("legacy rules: %+v", rules)
	}
	after, _ := json.Marshal(view)
	if !reflect.DeepEqual(before, after) {
		t.Fatal("reading legacy colors must not migrate stored data")
	}
	view.ConditionalColors = []*ConditionalColorRule{}
	encoded, _ := json.Marshal(view)
	var restored View
	if err := json.Unmarshal(encoded, &restored); err != nil {
		t.Fatal(err)
	}
	if restored.ConditionalColors == nil || len(restored.EffectiveConditionalColors()) != 0 {
		t.Fatal("explicit empty rules must survive persistence")
	}
}

func TestConditionalColorValidation(t *testing.T) {
	valid := &ConditionalColorRule{ID: "rule", Target: "item", Filter: &ViewFilter{Column: "text", Operator: FilterOperatorIsEmpty}}
	if err := ValidateConditionalColors([]*ConditionalColorRule{valid}); err != nil {
		t.Fatal(err)
	}
	for _, rules := range [][]*ConditionalColorRule{{nil}, {valid, valid}, {{ID: "x", Target: "item", Filter: group(FilterCombinationAnd, leaf("text"))}}, {{ID: "x", Target: "item", Filter: valid.Filter, Color: &ValueSelect{Color: "red;display:none"}}}} {
		if ValidateConditionalColors(rules) == nil {
			t.Fatal("accepted invalid rule")
		}
	}
}

func TestConditionalColorCloneAndRenderedValue(t *testing.T) {
	rule := &ConditionalColorRule{ID: "rule", Target: "item", Color: &ValueSelect{Color: "5"}, Filter: &ViewFilter{Column: "number", ValueSource: ValueSourceRendered, Operator: FilterOperatorContains,
		Value: &Value{Type: KeyTypeTemplate, Template: &ValueTemplate{Content: "ready"}}}}
	clone := CloneConditionalColors([]*ConditionalColorRule{rule})
	clone[0].Filter.Value.Template.Content = "different"
	clone[0].Color.Color = "6"
	if rule.Filter.Value.Template.Content != "ready" || rule.Color.Color != "5" {
		t.Fatal("copy changed source rule")
	}
	if CloneConditionalColors(nil) != nil || CloneConditionalColors([]*ConditionalColorRule{}) == nil {
		t.Fatal("copy lost unset/cleared distinction")
	}
	row := &TableRow{Cells: []*TableCell{{BaseValue: &BaseValue{Value: &Value{Type: KeyTypeNumber, Number: &ValueNumber{Content: 123, IsNotEmpty: true}, HasRenderTemplate: true, RenderedContent: "ready"}}}}}
	table := &Table{Columns: []*TableColumn{{BaseInstanceField: &BaseInstanceField{ID: "number", Type: KeyTypeNumber}}}, Rows: []*TableRow{row}}
	RenderConditionalColors(table, &View{LayoutType: LayoutTypeTable, ConditionalColors: []*ConditionalColorRule{rule}}, &AttributeView{}, nil, nil)
	if row.ConditionalColors == nil || row.ConditionalColors.Background.Color != "5" {
		t.Fatal("rendered-value condition did not match")
	}
}

func TestConditionalColorCustomPalette(t *testing.T) {
	colors := []*AttributeViewCustomColor{testAttributeViewCustomColor(15, "#112233", "#ddeeff", "#aabbcc", "#223344")}
	withWorkspacePalette(t, &colors)
	rule := &ConditionalColorRule{ID: "rule", Target: "item", Color: &ValueSelect{Color: "15"}, Filter: leaf("text")}
	database := &AttributeView{Views: []*View{{ConditionalColors: []*ConditionalColorRule{rule}}}}
	database.ResolveDirectColors()
	if rule.Color.ResolvedColor == nil || rule.Color.ResolvedColor.Light.BackgroundColor != "#ddeeff" {
		t.Fatal("custom rule color was not resolved")
	}
	if !reflect.DeepEqual(database.UsedCustomColorIndexes(), []int{15}) {
		t.Fatal("rule-only color must remain referenced")
	}
	encoded, err := json.Marshal(database)
	if err != nil {
		t.Fatal(err)
	}
	var restored AttributeView
	if err = json.Unmarshal(encoded, &restored); err != nil {
		t.Fatal(err)
	}
	if restored.Views[0].ConditionalColors[0].Color.Color != "15" {
		t.Fatal("custom rule color was not retained")
	}
}
