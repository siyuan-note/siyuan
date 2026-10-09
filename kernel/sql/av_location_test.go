package sql

import (
	"testing"

	"github.com/siyuan-note/siyuan/kernel/av"
)

func TestLocationColumnDefaultOnlyFillsMissingCells(t *testing.T) {
	for _, test := range []struct {
		name  string
		value *av.Value
		want  string
	}{
		{"missing", nil, "gcj02"},
		{"nil payload", &av.Value{Type: av.KeyTypeLocation}, ""},
		{"empty", &av.Value{Type: av.KeyTypeLocation, Location: &av.ValueLocation{}}, ""},
		{"name only", &av.Value{Type: av.KeyTypeLocation, Location: &av.ValueLocation{Name: "Home"}}, ""},
		{"unknown", &av.Value{Type: av.KeyTypeLocation, Location: &av.ValueLocation{CoordinateSystem: "unknown"}}, "unknown"},
		{"explicit", &av.Value{Type: av.KeyTypeLocation, Location: &av.ValueLocation{CoordinateSystem: "wgs84"}}, "wgs84"},
	} {
		t.Run(test.name, func(t *testing.T) {
			base := &av.BaseValue{ID: "20261009000000-locaval", ValueType: av.KeyTypeLocation, Value: test.value}
			fillAttributeViewBaseValue(base, "location", "20261009000000-locarow", "", "", "", false, &av.Location{DefaultCoordinateSystem: "gcj02"})
			if base.Value.Location.CoordinateSystem != test.want {
				t.Fatalf("default overwrote existing location: %+v", base.Value.Location)
			}
			fillAttributeViewBaseValue(base, "location", "20261009000000-locarow", "", "", "", false, &av.Location{DefaultCoordinateSystem: "bd09"})
			if base.Value.Location.CoordinateSystem != test.want {
				t.Fatal("changing the column default reinterpreted existing cell")
			}
		})
	}
}
