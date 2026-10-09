package model

import (
	"bytes"
	"encoding/json"
	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/util"
	"testing"
)

func TestAttributeViewLocationImportOmittedValues(t *testing.T) {
	setupAttributeViewValidationTest(t)
	setAttributeViewListTestLangs()
	util.AttrViewLangs["en"]["calendar"] = "Calendar"
	for _, scenario := range []struct {
		name   string
		layout av.LayoutType
		loc    bool
	}{
		{"location", av.LayoutTypeTable, true},
		{"legacy table", av.LayoutTypeTable, false},
		{"legacy calendar", av.LayoutTypeCalendar, false},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			database := newAttributeViewWithLayout(ast.NewNodeID(), scenario.layout)
			if scenario.loc {
				database.KeyValues = append(database.KeyValues, &av.KeyValues{Key: av.NewKey(ast.NewNodeID(), "Location", "", av.KeyTypeLocation)})
			}
			if err := av.SaveAttributeView(database); err != nil {
				t.Fatal(err)
			}
			data, err := json.Marshal(database)
			if err != nil {
				t.Fatal(err)
			}
			var root map[string]json.RawMessage
			if err = json.Unmarshal(data, &root); err != nil {
				t.Fatal(err)
			}
			var keyValues []map[string]json.RawMessage
			if err = json.Unmarshal(root["keyValues"], &keyValues); err != nil {
				t.Fatal(err)
			}
			for _, values := range []string{"", "null", "[]", "{}", `"invalid"`} {
				delete(keyValues[0], "values")
				if values != "" {
					keyValues[0]["values"] = json.RawMessage(values)
				}
				root["keyValues"], err = json.Marshal(keyValues)
				if err != nil {
					t.Fatal(err)
				}
				input, err := json.Marshal(root)
				if err != nil {
					t.Fatal(err)
				}
				for _, encrypted := range []bool{false, true} {
					got, importErr := isolateImportedAttributeViewBindings(input, nil, encrypted)
					wantSuccess := values == "null" || values == "[]" || values == ""
					if wantSuccess && (importErr != nil || !bytes.Equal(got, input)) {
						t.Fatalf("values=%q encrypted=%t rejected or rewrote valid empty data: %v", values, encrypted, importErr)
					}
					if !wantSuccess && importErr == nil {
						t.Fatalf("values=%q encrypted=%t accepted malformed data", values, encrypted)
					}
				}
			}
		})
	}
}
