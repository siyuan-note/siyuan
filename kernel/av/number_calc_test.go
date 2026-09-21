package av

import (
	"math"
	"strconv"
	"testing"
)

var numberCalculationCases = []struct {
	name                       string
	values                     []float64
	sum, average, median, span float64
}{
	{"decimals", []float64{0.1, 0.2}, 0.3, 0.15, 0.15, 0.1},
	{"decimal range", []float64{0.1, 0.3}, 0.4, 0.2, 0.2, 0.2},
	{"negative decimals", []float64{-0.1, -0.2}, -0.3, -0.15, -0.15, 0.1},
	{"cancellation", []float64{0.1, 0.2, -0.3}, 0, 0, 0.1, 0.5},
	{"large cancellation", []float64{1e16, 0.1, -1e16}, 0.1, 1.0 / 30, 0.1, 2e16},
	{"precision", []float64{1.2345678, 2.3456789}, 3.5802467, 1.79012335, 1.79012335, 1.1111111},
	{"small decimals", []float64{1e-20, 2e-20}, 3e-20, 1.5e-20, 1.5e-20, 1e-20},
	{"smallest decimals", []float64{math.SmallestNonzeroFloat64, math.SmallestNonzeroFloat64}, 1e-323, math.SmallestNonzeroFloat64, math.SmallestNonzeroFloat64, 0},
	{"repeated precise value", []float64{1.2345678901234567, 1.2345678901234567}, 2.4691357802469134, 1.2345678901234567, 1.2345678901234567, 0},
	{"finite average", []float64{1e308, 1e308}, math.Inf(1), 1e308, 1e308, 0},
}

func calculationValue(number float64, typ KeyType) *Value {
	value := &Value{Type: typ}
	switch typ {
	case KeyTypeNumber:
		value.Number = &ValueNumber{Content: number, IsNotEmpty: true}
	case KeyTypeTemplate:
		value.Template = &ValueTemplate{Content: strconv.FormatFloat(number, 'f', -1, 64)}
	case KeyTypeText:
		value.Text = &ValueText{Content: strconv.FormatFloat(number, 'f', -1, 64)}
	case KeyTypeRollup:
		value.Rollup = &ValueRollup{Contents: []*Value{calculationValue(number, KeyTypeNumber)}}
	}
	return value
}

func checkCalculationNumber(t *testing.T, got *Value, want float64) {
	t.Helper()
	if nil == got || nil == got.Number || !got.Number.IsNotEmpty {
		t.Fatalf("missing numeric result: %+v", got)
	}
	if got.Number.Content != want {
		t.Errorf("content = %v, want %v", got.Number.Content, want)
	}
	if formatted := strconv.FormatFloat(want, 'f', -1, 64); got.Number.FormattedContent != formatted {
		t.Errorf("display = %q, want %q", got.Number.FormattedContent, formatted)
	}
}

func TestCalcNumberPrecision(t *testing.T) {
	for _, typ := range []KeyType{KeyTypeNumber, KeyTypeTemplate, KeyTypeRollup} {
		for _, test := range numberCalculationCases {
			t.Run(string(typ)+"/"+test.name, func(t *testing.T) {
				column := &TableColumn{BaseInstanceField: &BaseInstanceField{Type: typ}}
				table := &Table{BaseInstance: &BaseInstance{}, Columns: []*TableColumn{column}}
				for _, number := range test.values {
					table.Rows = append(table.Rows, &TableRow{Cells: []*TableCell{{BaseValue: &BaseValue{
						Value: calculationValue(number, typ), ValueType: typ,
					}}}})
				}
				// 缺失值不参与求和与平均值计数。
				table.Rows = append(table.Rows, &TableRow{Cells: []*TableCell{{BaseValue: &BaseValue{Value: &Value{Type: typ}, ValueType: typ}}}})
				for _, check := range []struct {
					operator CalcOperator
					want     float64
				}{
					{CalcOperatorSum, test.sum},
					{CalcOperatorAverage, test.average},
					{CalcOperatorMedian, test.median},
					{CalcOperatorRange, test.span},
				} {
					t.Run(string(check.operator), func(t *testing.T) {
						column.Calc = &FieldCalc{Operator: check.operator}
						Calc(table, &AttributeView{})
						checkCalculationNumber(t, column.Calc.Result, check.want)
					})
				}
			})
		}
	}
}

func TestRollupNumberPrecision(t *testing.T) {
	for _, typ := range []KeyType{KeyTypeNumber, KeyTypeText, KeyTypeTemplate} {
		for _, test := range numberCalculationCases {
			for _, check := range []struct {
				operator CalcOperator
				want     float64
			}{
				{CalcOperatorSum, test.sum},
				{CalcOperatorAverage, test.average},
				{CalcOperatorMedian, test.median},
				{CalcOperatorRange, test.span},
			} {
				t.Run(string(typ)+"/"+test.name+"/"+string(check.operator), func(t *testing.T) {
					rollup := &ValueRollup{}
					for _, number := range test.values {
						rollup.Contents = append(rollup.Contents, calculationValue(number, typ))
					}
					rollup.calcContents(&RollupCalc{Operator: check.operator}, &Key{Type: typ})
					if 1 != len(rollup.Contents) {
						t.Fatalf("result count = %d, want 1", len(rollup.Contents))
					}
					checkCalculationNumber(t, rollup.Contents[0], check.want)
				})
			}
		}
	}
}

func TestCalcTemplateNumberPrecision(t *testing.T) {
	for _, test := range numberCalculationCases {
		t.Run(test.name, func(t *testing.T) {
			context := buildRollupTemplateContext(test.values, nil, nil)
			for key, want := range map[string]float64{"sum": test.sum, "avg": test.average, "median": test.median} {
				if got := context[key].(float64); got != want {
					t.Errorf("%s = %v, want %v", key, got, want)
				}
			}
		})
	}
	for _, typ := range []KeyType{KeyTypeNumber, KeyTypeTemplate, KeyTypeRollup} {
		for _, test := range numberCalculationCases {
			for key, want := range map[string]float64{"sum": test.sum, "avg": test.average, "median": test.median} {
				t.Run(string(typ)+"/"+test.name+"/"+key, func(t *testing.T) {
					column := &TableColumn{BaseInstanceField: &BaseInstanceField{
						Type: typ, Calc: &FieldCalc{Operator: CalcOperatorTemplate, Template: ".action{." + key + "}"},
					}}
					table := &Table{BaseInstance: &BaseInstance{}, Columns: []*TableColumn{column}}
					for _, number := range test.values {
						table.Rows = append(table.Rows, &TableRow{Cells: []*TableCell{{BaseValue: &BaseValue{
							Value: calculationValue(number, typ), ValueType: typ,
						}}}})
					}
					Calc(table, &AttributeView{})
					checkCalculationNumber(t, column.Calc.Result, want)
				})
			}
		}
	}
}

func TestCalcRollupExtremaPrecision(t *testing.T) {
	column := &TableColumn{BaseInstanceField: &BaseInstanceField{Type: KeyTypeRollup}}
	table := &Table{BaseInstance: &BaseInstance{}, Columns: []*TableColumn{column}}
	for _, number := range []float64{1e-20, 1.2345678901234567} {
		table.Rows = append(table.Rows, &TableRow{Cells: []*TableCell{{BaseValue: &BaseValue{
			Value: calculationValue(number, KeyTypeRollup), ValueType: KeyTypeRollup,
		}}}})
	}
	for operator, want := range map[CalcOperator]float64{CalcOperatorMin: 1e-20, CalcOperatorMax: 1.2345678901234567} {
		column.Calc = &FieldCalc{Operator: operator}
		Calc(table, &AttributeView{})
		checkCalculationNumber(t, column.Calc.Result, want)
	}
}

func TestDecimalSumNonFinite(t *testing.T) {
	for _, test := range []struct {
		name   string
		values []float64
		want   float64
	}{
		{"positive infinity", []float64{1, math.Inf(1), 2}, math.Inf(1)},
		{"negative infinity", []float64{1, math.Inf(-1), 2}, math.Inf(-1)},
		{"opposite infinities", []float64{math.Inf(1), math.Inf(-1)}, math.NaN()},
		{"not a number", []float64{1, math.NaN(), 2}, math.NaN()},
	} {
		t.Run(test.name, func(t *testing.T) {
			var sum decimalSum
			for _, value := range test.values {
				sum.add(value)
			}
			for _, got := range []float64{sum.float64(), sum.average(len(test.values))} {
				if got != test.want && !(math.IsNaN(got) && math.IsNaN(test.want)) {
					t.Errorf("result = %v, want %v", got, test.want)
				}
			}
		})
	}
}

func BenchmarkDecimalSum(b *testing.B) {
	for i := 0; i < b.N; i++ {
		var sum decimalSum
		for j := 0; j < 10000; j++ {
			sum.add(0.1)
		}
		if 1000 != sum.float64() {
			b.Fatal("unexpected sum")
		}
	}
}
