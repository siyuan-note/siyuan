package av

import (
	"bytes"
	"encoding/json"
	"testing"

	"github.com/88250/lute/ast"
)

func TestMapPrivatePaginationBufferIsNotSerialized(t *testing.T) {
	mapped := &Map{Table: &Table{Rows: []*TableRow{}}, RowsBeforePagination: []*TableRow{{ID: "private-row-buffer"}}}
	data, err := json.Marshal(mapped)
	if err != nil || bytes.Contains(data, []byte("private-row-buffer")) {
		t.Fatalf("private map pagination buffer escaped: %s, %v", data, err)
	}
}

func TestMapConditionalSpecAndValidation(t *testing.T) {
	for _, spec := range []int{PlainTextSpec, RichTextSpec, 10, 11, 12, CurrentSpec} {
		plain := &AttributeView{Spec: spec}
		UpgradeSpec(plain)
		if plain.Spec != spec {
			t.Fatalf("unrelated database upgraded from %d to %d", spec, plain.Spec)
		}
	}
	for _, nested := range []bool{false, true} {
		view := &View{LayoutType: LayoutTypeTable, Map: &LayoutMap{LayoutTable: NewLayoutTable(),
			Settings: MapSettings{LocationKeyID: ast.NewNodeID()}}}
		attrView := &AttributeView{Spec: 12, Views: []*View{view}}
		if nested {
			attrView.Views = []*View{{Groups: []*View{view}}}
		}
		if CheckSpec(attrView) != ErrMapSpecMismatch {
			t.Fatal("stored map settings bypassed the specification gate")
		}
		UpgradeSpec(attrView)
		if attrView.Spec != MapSpec {
			t.Fatalf("map specification: %d", attrView.Spec)
		}
		data, _ := json.Marshal(attrView)
		if _, err := ParseAttributeViewData("map", data); err != nil {
			t.Fatal(err)
		}
		view.Map.Spec = 1
		data, _ = json.Marshal(attrView)
		if _, err := ParseAttributeViewData("map", data); err == nil {
			t.Fatal("future map layout accepted")
		}
	}
	for _, layout := range []*LayoutMap{nil, {}, {LayoutTable: &LayoutTable{}},
		{LayoutTable: &LayoutTable{BaseLayout: &BaseLayout{}, Columns: []*ViewTableColumn{nil}}}} {
		attrView := &AttributeView{Spec: MapSpec, Views: []*View{{LayoutType: LayoutTypeMap, Map: layout}}}
		if attrView.ValidateMapLayouts() == nil {
			t.Fatal("corrupt map layout accepted")
		}
	}
	if CheckSpec(&AttributeView{Spec: CurrentSpec + 1}) != ErrSpecTooNew {
		t.Fatal("future database accepted")
	}
}

func TestMapSettingsValidation(t *testing.T) {
	for _, settings := range []MapSettings{{}, {LocationKeyID: ast.NewNodeID()}} {
		if err := settings.Validate(); err != nil {
			t.Fatal(err)
		}
	}
	for _, settings := range []MapSettings{{LocationKeyID: "invalid"}, {LocationKeyID: " key"}} {
		if settings.Validate() == nil {
			t.Fatalf("invalid map settings accepted: %+v", settings)
		}
	}
}

func TestMapSettingsJSONRejectsLegacyFieldsWithoutMutation(t *testing.T) {
	for _, payload := range []string{
		`{"locationKeyID":"","serviceID":"openfreemap"}`,
		`{"locationKeyID":"","serviceID":""}`,
		`{"locationKeyID":"","showRecordList":true}`,
		`{"locationKeyID":"","showRecordList":false}`,
		`{"locationKeyID":"","apiKey":"secret"}`,
	} {
		settings := MapSettings{LocationKeyID: ast.NewNodeID()}
		before := settings
		if err := json.Unmarshal([]byte(payload), &settings); err == nil {
			t.Fatalf("legacy map setting accepted: %s", payload)
		}
		if settings != before {
			t.Fatalf("rejected settings changed field binding: %s", payload)
		}
	}
}
