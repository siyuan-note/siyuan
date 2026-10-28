// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package av

import (
	"math"
	"testing"
)

// scalarContentTypes 是共用单值内容统计口径的字段类型。
var scalarContentTypes = []KeyType{
	KeyTypeBlock, KeyTypeText, KeyTypeURL, KeyTypeEmail, KeyTypePhone, KeyTypeSelect,
}

// scalarContentValue 按类型构造只带内容的字段值，用于验证统计口径与类型无关。
func scalarContentValue(t *testing.T, typ KeyType, content string) *Value {
	t.Helper()
	value := &Value{Type: typ}
	switch typ {
	case KeyTypeBlock:
		value.Block = &ValueBlock{Content: content}
	case KeyTypeText:
		value.Text = &ValueText{Content: content}
	case KeyTypeURL:
		value.URL = &ValueURL{Content: content}
	case KeyTypeEmail:
		value.Email = &ValueEmail{Content: content}
	case KeyTypePhone:
		value.Phone = &ValuePhone{Content: content}
	case KeyTypeSelect:
		value.MSelect = []*ValueSelect{{Content: content}}
	default:
		t.Fatalf("类型 %s 不是单值内容字段", typ)
	}
	return value
}

// scalarContentTable 构造单列表格，nil 表示该行缺少字段值。
func scalarContentTable(t *testing.T, typ KeyType, contents []*string) *Table {
	t.Helper()
	column := &TableColumn{BaseInstanceField: &BaseInstanceField{ID: "field", Type: typ}}
	table := &Table{BaseInstance: &BaseInstance{}, Columns: []*TableColumn{column}}
	for _, content := range contents {
		cell := &TableCell{BaseValue: &BaseValue{}}
		if nil != content {
			cell.Value = scalarContentValue(t, typ, *content)
		}
		table.Rows = append(table.Rows, &TableRow{Cells: []*TableCell{cell}})
	}
	return table
}

func textPointer(text string) *string {
	return &text
}

// TestScalarContentCalc 固定单值内容字段各算子的结果。五种取值形态覆盖有内容、
// 重复内容、空内容和缺少值，避免归并时把空值判定或计数单位改错。
func TestScalarContentCalc(t *testing.T) {
	contents := []*string{textPointer("甲"), textPointer("乙"), textPointer("甲"), textPointer(""), nil}
	const (
		total        = 5
		values       = 3
		uniqueValues = 2
		empty        = 2
	)

	tests := []struct {
		operator CalcOperator
		want     float64
		format   NumberFormat
	}{
		{CalcOperatorCountAll, total, NumberFormatNone},
		{CalcOperatorCountValues, values, NumberFormatNone},
		{CalcOperatorCountNotEmpty, values, NumberFormatNone},
		{CalcOperatorCountUniqueValues, uniqueValues, NumberFormatNone},
		{CalcOperatorCountEmpty, empty, NumberFormatNone},
		{CalcOperatorPercentEmpty, float64(empty) / total, NumberFormatPercent},
		{CalcOperatorPercentNotEmpty, float64(values) / total, NumberFormatPercent},
		{CalcOperatorPercentUniqueValues, float64(uniqueValues) / total, NumberFormatPercent},
	}

	for _, typ := range scalarContentTypes {
		t.Run(string(typ), func(t *testing.T) {
			for _, test := range tests {
				t.Run(string(test.operator), func(t *testing.T) {
					table := scalarContentTable(t, typ, contents)
					column := table.Columns[0]
					column.Calc = &FieldCalc{Operator: test.operator}
					calcField(table, column, 0, nil)

					if nil == column.Calc.Result || nil == column.Calc.Result.Number {
						t.Fatalf("算子 %s 没有产生结果", test.operator)
					}
					if math.Abs(column.Calc.Result.Number.Content-test.want) > 1e-10 {
						t.Fatalf("结果 = %v，期望 %v", column.Calc.Result.Number.Content, test.want)
					}
					if test.format != column.Calc.Result.Number.Format {
						t.Fatalf("格式 = %v，期望 %v", column.Calc.Result.Number.Format, test.format)
					}
				})
			}
		})
	}
}

// TestScalarContentCalcEmptyCollection 空集合的占比算子不产生结果，与计数算子区分开。
func TestScalarContentCalcEmptyCollection(t *testing.T) {
	for _, typ := range scalarContentTypes {
		t.Run(string(typ), func(t *testing.T) {
			table := scalarContentTable(t, typ, nil)
			column := table.Columns[0]
			for _, operator := range []CalcOperator{CalcOperatorPercentEmpty, CalcOperatorPercentNotEmpty, CalcOperatorPercentUniqueValues} {
				column.Calc = &FieldCalc{Operator: operator}
				calcField(table, column, 0, nil)
				if nil != column.Calc.Result {
					t.Fatalf("空集合的 %s 应无结果，实际 %v", operator, column.Calc.Result.Number.Content)
				}
			}
			column.Calc = &FieldCalc{Operator: CalcOperatorCountAll}
			calcField(table, column, 0, nil)
			if nil == column.Calc.Result || 0 != column.Calc.Result.Number.Content {
				t.Fatalf("空集合的 Count all 应为 0")
			}
		})
	}
}

// BenchmarkScalarContentCount 固定单值内容统计的开销，归并后仍应是按条目一次遍历。
func BenchmarkScalarContentCount(b *testing.B) {
	contents := make([]*string, 10000)
	for i := range contents {
		text := "值"
		if 0 == i%3 {
			text = ""
		}
		contents[i] = &text
	}
	table := &Table{BaseInstance: &BaseInstance{}, Columns: []*TableColumn{{BaseInstanceField: &BaseInstanceField{ID: "field", Type: KeyTypeText}}}}
	for _, content := range contents {
		table.Rows = append(table.Rows, &TableRow{Cells: []*TableCell{{BaseValue: &BaseValue{Value: &Value{Type: KeyTypeText, Text: &ValueText{Content: *content}}}}}})
	}
	column := table.Columns[0]

	for _, operator := range []CalcOperator{CalcOperatorCountValues, CalcOperatorCountEmpty, CalcOperatorCountUniqueValues} {
		b.Run(string(operator), func(b *testing.B) {
			column.Calc = &FieldCalc{Operator: operator}
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				calcField(table, column, 0, nil)
			}
		})
	}
}
