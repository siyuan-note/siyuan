package sql

import (
	"reflect"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/av"
)

func TestLocationRenderFillsEmptyCellsAndPreservesStoredValues(t *testing.T) {
	zero := 0.0
	for _, test := range []struct {
		name  string
		value *av.Value
		want  *av.ValueLocation
	}{
		{"missing", nil, &av.ValueLocation{}},
		{"nil payload", &av.Value{Type: av.KeyTypeLocation}, &av.ValueLocation{}},
		{"empty", &av.Value{Type: av.KeyTypeLocation, Location: &av.ValueLocation{}}, &av.ValueLocation{}},
		{"name only", &av.Value{Type: av.KeyTypeLocation, Location: &av.ValueLocation{Name: "Home"}}, &av.ValueLocation{Name: "Home"}},
		{"zero coordinates", &av.Value{Type: av.KeyTypeLocation, Location: &av.ValueLocation{Latitude: &zero, Longitude: &zero, OriginalInput: "0,0"}},
			&av.ValueLocation{Latitude: &zero, Longitude: &zero, OriginalInput: "0,0"}},
	} {
		t.Run(test.name, func(t *testing.T) {
			base := &av.BaseValue{ID: "20261009000000-locaval", ValueType: av.KeyTypeLocation, Value: test.value}
			for range 2 {
				fillAttributeViewBaseValue(base, "location", "20261009000000-locarow", "", "", "", false)
				if base.Value == nil || !reflect.DeepEqual(base.Value.Location, test.want) {
					t.Fatalf("render changed stored location: %+v", base.Value)
				}
			}
		})
	}
}
