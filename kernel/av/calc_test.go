package av

import "testing"

func TestCalcRelationAndRollupCounts(t *testing.T) {
	for _, keyType := range []KeyType{KeyTypeRelation, KeyTypeRollup} {
		t.Run(string(keyType), func(t *testing.T) {
			makeValue := func(contents ...string) *Value {
				value := &Value{Type: keyType}
				if keyType == KeyTypeRelation {
					value.Relation = &ValueRelation{BlockIDs: contents}
				} else {
					value.Rollup = &ValueRollup{}
					for _, content := range contents {
						value.Rollup.Contents = append(value.Rollup.Contents, &Value{
							Type: KeyTypeText, Text: &ValueText{Content: content},
						})
					}
				}
				return value
			}
			for _, test := range []struct {
				name     string
				values   []*Value
				count    float64
				empty    float64
				notEmpty float64
			}{
				{name: "no rows"},
				{name: "empty containers", values: []*Value{makeValue(), makeValue(), makeValue()}, empty: 3},
				{name: "missing containers", values: []*Value{{Type: keyType}}, empty: 1},
				{name: "multiple and repeated values", values: []*Value{makeValue(), makeValue("a", "b"), makeValue("a")}, count: 3, empty: 1, notEmpty: 2},
			} {
				t.Run(test.name, func(t *testing.T) {
					column := &TableColumn{BaseInstanceField: &BaseInstanceField{Type: keyType}}
					table := &Table{BaseInstance: &BaseInstance{}, Columns: []*TableColumn{column}}
					for _, value := range test.values {
						table.Rows = append(table.Rows, &TableRow{Cells: []*TableCell{
							{BaseValue: &BaseValue{Value: value, ValueType: keyType}},
						}})
					}
					for _, check := range []struct {
						operator CalcOperator
						want     float64
					}{
						{CalcOperatorCountValues, test.count},
						{CalcOperatorCountAll, float64(len(test.values))},
						{CalcOperatorCountEmpty, test.empty},
						{CalcOperatorCountNotEmpty, test.notEmpty},
					} {
						column.Calc = &FieldCalc{Operator: check.operator}
						Calc(table, &AttributeView{})
						if result := column.Calc.Result; result == nil || result.Number == nil {
							t.Fatalf("%s: missing numeric result", check.operator)
						} else if result.Number.Content != check.want {
							t.Errorf("%s: got %v, want %v", check.operator, result.Number.Content, check.want)
						}
					}
				})
			}
		})
	}
}
