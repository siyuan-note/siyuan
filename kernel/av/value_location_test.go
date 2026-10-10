package av

import (
	"encoding/json"
	"math"
	"reflect"
	"testing"
)

func locationCoordinate(value float64) *float64 { return &value }

func TestLocationValueValidationAndDisplay(t *testing.T) {
	for _, test := range []struct {
		name     string
		location *ValueLocation
		want     string
		empty    bool
		invalid  bool
	}{
		{"missing", nil, "", true, false},
		{"name", &ValueLocation{Name: " Home "}, "Home", false, false},
		{"raw only", &ValueLocation{OriginalInput: "source"}, "", true, false},
		{"zero", &ValueLocation{Latitude: locationCoordinate(0), Longitude: locationCoordinate(0)}, "0, 0 [WGS84]", false, false},
		{"negative zero", &ValueLocation{Latitude: locationCoordinate(math.Copysign(0, -1)), Longitude: locationCoordinate(math.Copysign(0, -1))}, "0, 0 [WGS84]", false, false},
		{"named zero", &ValueLocation{Name: "Home", Latitude: locationCoordinate(0), Longitude: locationCoordinate(0)}, "Home; 0, 0 [WGS84]", false, false},
		{"lower latitude upper longitude", &ValueLocation{Latitude: locationCoordinate(-90), Longitude: locationCoordinate(180)}, "-90, 180 [WGS84]", false, false},
		{"upper latitude lower longitude", &ValueLocation{Latitude: locationCoordinate(90), Longitude: locationCoordinate(-180)}, "90, -180 [WGS84]", false, false},
		{"latitude missing", &ValueLocation{Longitude: locationCoordinate(0)}, "", false, true},
		{"longitude missing", &ValueLocation{Latitude: locationCoordinate(0)}, "", false, true},
		{"latitude range", &ValueLocation{Latitude: locationCoordinate(90.001), Longitude: locationCoordinate(0)}, "", false, true},
		{"longitude range", &ValueLocation{Latitude: locationCoordinate(0), Longitude: locationCoordinate(-180.001)}, "", false, true},
		{"nan", &ValueLocation{Latitude: locationCoordinate(math.NaN()), Longitude: locationCoordinate(0)}, "", false, true},
		{"infinity", &ValueLocation{Latitude: locationCoordinate(0), Longitude: locationCoordinate(math.Inf(1))}, "", false, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			if err := test.location.Normalize(); (err != nil) != test.invalid {
				t.Fatalf("validation: %v", err)
			}
			if test.invalid {
				return
			}
			value := &Value{Type: KeyTypeLocation, Location: test.location}
			if value.String(false) != test.want || value.String(true) != test.want || value.IsEmpty() != test.empty || value.IsBlank() != test.empty {
				t.Fatalf("display %q, empty %v", value.String(false), value.IsEmpty())
			}
			if cloned := value.Clone(); !reflect.DeepEqual(value, cloned) {
				t.Fatalf("clone changed location: %#v", cloned)
			}
		})
	}
}

func TestLocationFilterSortAndStatistics(t *testing.T) {
	value := &Value{Type: KeyTypeLocation, Location: &ValueLocation{Name: "Home", Latitude: locationCoordinate(0), Longitude: locationCoordinate(0), OriginalInput: "private provenance"}}
	for _, test := range []struct {
		operator FilterOperator
		text     string
		want     bool
	}{
		{FilterOperatorContains, "home", true},
		{FilterOperatorContains, "WGS84", true},
		{FilterOperatorContains, "0, 0", true},
		{FilterOperatorContains, "private", false},
		{FilterOperatorDoesNotContain, "private", true},
		{FilterOperatorIsEqual, "Home; 0, 0 [WGS84]", true},
		{FilterOperatorIsNotEqual, "Home", true},
		{FilterOperatorStartsWith, "Home;", true},
		{FilterOperatorEndsWith, "[WGS84]", true},
		{FilterOperatorIsEmpty, "", false},
		{FilterOperatorIsNotEmpty, "", true},
	} {
		filter := &ViewFilter{Operator: test.operator, Value: &Value{Type: KeyTypeLocation, Text: &ValueText{Content: test.text}}}
		if got := value.Filter(filter, nil, "", nil, nil); got != test.want {
			t.Fatalf("operator %s with %q: %v", test.operator, test.text, got)
		}
		if !filter.IsValid() {
			t.Fatalf("valid location filter rejected: %s", test.operator)
		}
	}
	other := value.Clone()
	other.Location.OriginalInput = "different source"
	if value.Compare(other, nil) != 0 {
		t.Fatal("provenance affected sort order")
	}
	other.Location.Longitude = locationCoordinate(1)
	if value.Compare(other, nil) == 0 {
		t.Fatal("coordinates did not distinguish values")
	}
	for _, names := range [][2]string{{"Home", "home"}, {"Home", "🏠Home"}, {"A", "B"}, {"", "Home"}} {
		left := &Value{Type: KeyTypeLocation, Location: &ValueLocation{Name: names[0]}}
		right := &Value{Type: KeyTypeLocation, Location: &ValueLocation{Name: names[1]}}
		if left.Compare(right, nil) != -right.Compare(left, nil) {
			t.Fatalf("location sort is not antisymmetric: %v", names)
		}
	}
	filter := &ViewFilter{Value: &Value{Type: KeyTypeRollup, Rollup: &ValueRollup{Contents: []*Value{{Type: KeyTypeLocation, Text: &ValueText{Content: "Home"}}}}}}
	if isRollupFilterValueEmpty(filter) {
		t.Fatal("rollup discarded textual location operand")
	}
	filter.Value.Rollup.Contents[0].Text = nil
	if !isRollupFilterValueEmpty(filter) {
		t.Fatal("missing location operand accepted")
	}
	rollup := &ValueRollup{Contents: []*Value{value, value.Clone(), other}}
	rollup.calcContents(&RollupCalc{Operator: CalcOperatorUniqueValues}, &Key{Type: KeyTypeLocation})
	if len(rollup.Contents) != 2 {
		t.Fatalf("unique locations: %d", len(rollup.Contents))
	}
	column := &TableColumn{BaseInstanceField: &BaseInstanceField{Calc: &FieldCalc{Operator: CalcOperatorCountUniqueValues}}}
	table := &Table{Rows: []*TableRow{
		{Cells: []*TableCell{{BaseValue: &BaseValue{Value: value}}}},
		{Cells: []*TableCell{{BaseValue: &BaseValue{Value: value.Clone()}}}},
		{Cells: []*TableCell{{BaseValue: &BaseValue{Value: other}}}},
		{Cells: []*TableCell{{BaseValue: &BaseValue{Value: &Value{Type: KeyTypeLocation}}}}},
	}}
	calcFieldLocation(table, column, 0)
	if column.Calc.Result.Number.Content != 2 {
		t.Fatalf("unique count: %v", column.Calc.Result)
	}
}

func TestLocationPersistedSpecAndValidation(t *testing.T) {
	location := func() *Value {
		return &Value{Type: KeyTypeLocation, Location: &ValueLocation{Latitude: locationCoordinate(0), Longitude: locationCoordinate(0)}}
	}
	for _, test := range []struct {
		name string
		view *AttributeView
	}{
		{"key", &AttributeView{KeyValues: []*KeyValues{{Key: &Key{Type: KeyTypeLocation}}}}},
		{"value", &AttributeView{KeyValues: []*KeyValues{{Values: []*Value{location()}}}}},
		{"filter", &AttributeView{Views: []*View{{Filters: []*ViewFilter{{Combination: FilterCombinationAnd, Filters: []*ViewFilter{{Value: &Value{Type: KeyTypeLocation, Text: &ValueText{Content: "Home"}}}}}}}}}},
		{"color", &AttributeView{Views: []*View{{ConditionalColors: []*ConditionalColorRule{{Filter: &ViewFilter{Value: location()}}}}}}},
		{"template", &AttributeView{NewItemTemplates: []*NewItemTemplate{{FieldValues: map[string]*NewItemFieldValue{"location": {Value: location()}}}}}},
		{"automation", &AttributeView{Automations: &AutomationConfig{Spec: 1, Rules: []*AutomationRule{{Actions: []*AutomationAction{{Fields: map[string]*AutomationValue{"location": {Value: location()}}}}}}}}},
		{"nested rollup", &AttributeView{KeyValues: []*KeyValues{{Values: []*Value{{Type: KeyTypeRollup, Rollup: &ValueRollup{Contents: []*Value{{Type: KeyTypeRollup, Rollup: &ValueRollup{Contents: []*Value{location()}}}}}}}}}}},
	} {
		t.Run(test.name, func(t *testing.T) {
			test.view.Spec = PlainTextSpec
			if CheckSpec(test.view) != ErrLocationSpecMismatch {
				t.Fatal("location payload with old specification accepted")
			}
			UpgradeSpec(test.view)
			if test.view.Spec != LocationSpec {
				t.Fatalf("location specification: %d", test.view.Spec)
			}
			if err := test.view.NormalizeLocations(); err != nil {
				t.Fatal(err)
			}
			data, _ := json.Marshal(test.view)
			if _, err := ParseAttributeViewData("location", data); err != nil {
				t.Fatal(err)
			}
		})
	}
	legacy := &AttributeView{Spec: PlainTextSpec}
	UpgradeSpec(legacy)
	if legacy.Spec != PlainTextSpec {
		t.Fatal("legacy database was unnecessarily upgraded")
	}
	valid := location()
	invalid := location()
	invalid.Location.Latitude = locationCoordinate(91)
	view := &AttributeView{Spec: LocationSpec, KeyValues: []*KeyValues{{Values: []*Value{valid, invalid}}}}
	before, _ := json.Marshal(view)
	err := view.NormalizeLocations()
	after, _ := json.Marshal(view)
	if err == nil || string(before) != string(after) {
		t.Fatal("invalid location partially normalized the database")
	}
	data, _ := json.Marshal(view)
	if _, err := ParseAttributeViewData("location", data); err == nil {
		t.Fatal("invalid imported location accepted")
	}
}

func TestLocationConditionalColorsAndAutomationFilters(t *testing.T) {
	value := &Value{Type: KeyTypeLocation, Location: &ValueLocation{Name: "Home"}, BlockID: "row"}
	filter := &ViewFilter{Column: "location", Operator: FilterOperatorContains, Value: &Value{Type: KeyTypeLocation, Text: &ValueText{Content: "Home"}}}
	view := &AttributeView{KeyValues: []*KeyValues{{Key: &Key{ID: "location", Type: KeyTypeLocation}, Values: []*Value{value}}}}
	if err := ValidateAutomationFilters(view, []*ViewFilter{filter}); err != nil {
		t.Fatal(err)
	}
	if matched, err := view.MatchesAutomationFilters("row", []*ViewFilter{filter}, nil); err != nil || !matched {
		t.Fatalf("automation filter: %v, %v", matched, err)
	}
	row := &TableRow{ID: "row", Cells: []*TableCell{{BaseValue: &BaseValue{Value: value}}}}
	table := &Table{Columns: []*TableColumn{{BaseInstanceField: &BaseInstanceField{ID: "location", Type: KeyTypeLocation}}}, Rows: []*TableRow{row}}
	rule := &ConditionalColorRule{ID: "color", Target: "item", Color: &ValueSelect{Color: "3"}, Filter: filter}
	RenderConditionalColors(table, &View{LayoutType: LayoutTypeTable, ConditionalColors: []*ConditionalColorRule{rule}}, view, nil, nil)
	if row.ConditionalColors == nil || row.ConditionalColors.Background.Color != "3" {
		t.Fatal("location condition did not apply color")
	}
	filter.ValueSource = ValueSourceRendered
	if resolved := resolveFilterValueSource(filter); resolved.Value.Template.Content != "Home" {
		t.Fatal("rendered location filter lost text operand")
	}
	capability := GetKeyCapability(KeyTypeLocation)
	if !capability.Editable || !capability.Filterable || !capability.Sortable || capability.Groupable ||
		capability.ValueKind != "location" || HasKeyGroup(KeyTypeLocation, KeyGroupScalarContent) {
		t.Fatalf("invalid location capability: %+v", capability)
	}
}

func TestLocationTemplatePreservation(t *testing.T) {
	key := &Key{ID: "location", Type: KeyTypeLocation}
	value := &Value{Type: KeyTypeLocation, Location: &ValueLocation{Name: "Home", Latitude: locationCoordinate(0), Longitude: locationCoordinate(0), OriginalInput: "source"}}
	view := &AttributeView{Spec: LocationSpec, KeyValues: []*KeyValues{{Key: key, Values: []*Value{value}}}}
	if err := view.NormalizeLocations(); err != nil {
		t.Fatal(err)
	}
	copy, err := normalizeNewItemTemplateValue(value, key)
	if err != nil || !reflect.DeepEqual(copy.Location, value.Location) {
		t.Fatalf("template changed location coordinates or provenance: %v", err)
	}
	key.Type = KeyTypeText
	view.Spec = PlainTextSpec
	if !view.HasLocation() || CheckSpec(view) != ErrLocationSpecMismatch {
		t.Fatal("retained location value bypassed format gate")
	}
}

func TestLocationJSONRejectsUnknownFieldsWithoutMutation(t *testing.T) {
	for _, payload := range []string{
		`{"latitude":0,"longitude":0,"coordinateSystem":"wgs84"}`,
		`{"latitude":0,"longitude":0,"coordinateSystem":"gcj02"}`,
		`{"latitude":0,"longitude":0,"coordinateSystem":"bd09"}`,
		`{"latitude":0,"longitude":0,"coordinateSystem":"unknown"}`,
		`{"latitude":0,"longitude":0,"coordinateSystem":""}`,
		`{"latitude":0,"longitude":0,"coordinateSystem":null}`,
		`{"name":"Changed","unknown":true}`,
	} {
		location := &ValueLocation{Name: "Home", Latitude: locationCoordinate(1), Longitude: locationCoordinate(2), OriginalInput: "source"}
		before, _ := json.Marshal(location)
		if err := json.Unmarshal([]byte(payload), location); err == nil {
			t.Fatalf("unknown location field accepted: %s", payload)
		}
		after, _ := json.Marshal(location)
		if string(before) != string(after) {
			t.Fatalf("rejected location changed existing value: %s", payload)
		}
	}
}
