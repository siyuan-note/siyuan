package api

import (
	"testing"

	"github.com/siyuan-note/siyuan/kernel/av"
)

func TestAVContractLocationTransportMapping(t *testing.T) {
	zero, longitude := 0.0, 102.42
	for _, location := range []*av.ValueLocation{nil, {}, {Name: "Office"}, {
		Name: "Office", Latitude: &zero, Longitude: &longitude,
		OriginalInput: "(102.42,0)",
	}, {Latitude: &zero, Longitude: &zero}} {
		value := &av.Value{ID: "value", KeyID: "location", BlockID: "item", Type: av.KeyTypeLocation, Location: location}
		t.Run(value.String(false), func(t *testing.T) {
			assertAVContractJSONEqual(t, value, toContractAVValue(value))
			assertAVContractJSONEqual(t, value, fromContractAVValue(toContractAVValue(value)))
			for _, nested := range []*av.Value{
				{Type: av.KeyTypeRelation, Relation: &av.ValueRelation{Contents: []*av.Value{value}}},
				{Type: av.KeyTypeRollup, Rollup: &av.ValueRollup{Contents: []*av.Value{value}}},
			} {
				assertAVContractJSONEqual(t, nested, toContractAVValue(nested))
				assertAVContractJSONEqual(t, nested, fromContractAVValue(toContractAVValue(nested)))
			}
		})
	}
}

func TestAVContractLocationFieldAndRenderMapping(t *testing.T) {
	zero, longitude := 0.0, 102.42
	for _, location := range []*av.ValueLocation{{Name: "Office"}, {
		Latitude: &zero, Longitude: &longitude, OriginalInput: "(102.42,0)",
	}} {
		key := &av.Key{ID: "location", Type: av.KeyTypeLocation}
		field := &av.BaseInstanceField{ID: key.ID, Type: key.Type}
		value := &av.Value{Type: av.KeyTypeLocation, Location: location}
		assertAVContractJSONEqual(t, key, toContractAVKey(key))
		assertAVContractJSONEqual(t, field, toContractAVBaseInstanceField(field))
		table := &av.Table{BaseInstance: &av.BaseInstance{ID: "view"},
			Columns: []*av.TableColumn{{BaseInstanceField: field}},
			Rows:    []*av.TableRow{{ID: "item", Cells: []*av.TableCell{{BaseValue: &av.BaseValue{Value: value, ValueType: key.Type}}}}}}
		for _, view := range []av.Viewable{table, &av.List{Table: table}, &av.Map{Table: table}} {
			assertAVContractJSONEqual(t, view, avContractView(view))
		}
	}
}
