package av

import (
	"math"
	"testing"
)

func TestRollupCheckboxPercent(t *testing.T) {
	for _, operator := range []CalcOperator{CalcOperatorPercentChecked, CalcOperatorPercentUnchecked} {
		for _, test := range []struct {
			name         string
			count, total int
			text         string
		}{
			{"empty", 0, 0, ""},
			{"none", 0, 3, "0%"},
			{"third", 1, 3, "33.33%"},
			{"small fraction", 1, 103, "0.97%"},
			{"all", 3, 3, "100%"},
		} {
			t.Run(string(operator)+"/"+test.name, func(t *testing.T) {
				rollup := &ValueRollup{}
				for i := 0; i < test.total; i++ {
					checked := i < test.count
					if operator == CalcOperatorPercentUnchecked {
						checked = !checked
					}
					rollup.Contents = append(rollup.Contents, &Value{Type: KeyTypeCheckbox, Checkbox: &ValueCheckbox{Checked: checked}})
				}
				rollup.calcContents(&RollupCalc{Operator: operator}, &Key{Type: KeyTypeCheckbox})
				if test.total == 0 {
					if len(rollup.Contents) != 0 {
						t.Fatal("empty relation should remain empty")
					}
					return
				}
				value := rollup.Contents[0]
				want := float64(test.count) / float64(test.total) * 100
				if value.Number == nil || !value.Number.IsNotEmpty || math.Abs(value.Number.Content-want) > 1e-10 {
					t.Fatalf("numeric result = %+v, want %v", value.Number, want)
				}
				if value.String(true) != test.text {
					t.Errorf("display = %q, want %q", value.String(true), test.text)
				}
				threshold := &Value{Type: KeyTypeNumber, Number: NewFormattedValueNumber(1, NumberFormatNone)}
				if got := value.filter(threshold, nil, nil, FilterOperatorIsGreater, ""); got != (want > 1) {
					t.Errorf("numeric filter = %v, want %v", got, want > 1)
				}
				column := &TableColumn{BaseInstanceField: &BaseInstanceField{Type: KeyTypeRollup, Calc: &FieldCalc{Operator: CalcOperatorSum}}}
				table := &Table{BaseInstance: &BaseInstance{}, Columns: []*TableColumn{column}, Rows: []*TableRow{{Cells: []*TableCell{{BaseValue: &BaseValue{Value: &Value{Type: KeyTypeRollup, Rollup: rollup}, ValueType: KeyTypeRollup}}}}}}
				for _, calcOperator := range []CalcOperator{CalcOperatorSum, CalcOperatorAverage} {
					column.Calc.Operator = calcOperator
					calcFieldRollup(table, column, 0)
					if got := column.Calc.Result.Number.Content; math.Abs(got-want) > 1e-6 {
						t.Errorf("%s = %v, want %v", calcOperator, got, want)
					}
				}
			})
		}
	}
}
