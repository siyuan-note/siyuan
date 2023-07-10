// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package av

import (
	"github.com/88250/lute/ast"
	"math"
	"sort"
)

type ColumnType string

const (
	ColumnTypeBlock    ColumnType = "block"
	ColumnTypeText     ColumnType = "text"
	ColumnTypeNumber   ColumnType = "number"
	ColumnTypeDate     ColumnType = "date"
	ColumnTypeSelect   ColumnType = "select"
	ColumnTypeMSelect  ColumnType = "mSelect"
	ColumnTypeRelation ColumnType = "relation"
	ColumnTypeRollup   ColumnType = "rollup"
)

// Column 描述了属性视图的基础结构。
type Column struct {
	ID     string      `json:"id"`     // 列 ID
	Name   string      `json:"name"`   // 列名
	Type   ColumnType  `json:"type"`   // 列类型
	Icon   string      `json:"icon"`   // 列图标
	Wrap   bool        `json:"wrap"`   // 是否换行
	Hidden bool        `json:"hidden"` // 是否隐藏
	Width  string      `json:"width"`  // 列宽度
	Calc   *ColumnCalc `json:"calc"`   // 计算

	// 以下是某些列类型的特有属性

	AttributeViewID  string                `json:"attributeViewId"`  // 关联的属性视图 ID
	RelationColumnID string                `json:"relationColumnId"` // 目标关联列 ID
	Options          []*ColumnSelectOption `json:"options"`          // 选项列表
}

type ColumnSelectOption struct {
	Name  string `json:"name"`
	Color string `json:"color"`
}

func NewColumn(name string, columnType ColumnType) *Column {
	return &Column{
		ID:   ast.NewNodeID(),
		Name: name,
		Type: columnType,
	}
}

type ColumnCalc struct {
	Column   string       `json:"column"`
	Operator CalcOperator `json:"operator"`
	Result   *Value       `json:"result"`
}

type CalcOperator string

const (
	CalcOperatorNone              CalcOperator = ""
	CalcOperatorCountAll          CalcOperator = "Count all"
	CalcOperatorCountValues       CalcOperator = "Count values"
	CalcOperatorCountUniqueValues CalcOperator = "Count unique values"
	CalcOperatorCountEmpty        CalcOperator = "Count empty"
	CalcOperatorCountNotEmpty     CalcOperator = "Count not empty"
	CalcOperatorPercentEmpty      CalcOperator = "Percent empty"
	CalcOperatorPercentNotEmpty   CalcOperator = "Percent not empty"
	CalcOperatorSum               CalcOperator = "Sum"
	CalcOperatorAverage           CalcOperator = "Average"
	CalcOperatorMedian            CalcOperator = "Median"
	CalcOperatorMin               CalcOperator = "Min"
	CalcOperatorMax               CalcOperator = "Max"
	CalcOperatorRange             CalcOperator = "Range"
	CalcOperatorEarliest          CalcOperator = "Earliest"
	CalcOperatorLatest            CalcOperator = "Latest"
)

func (av *AttributeView) CalcCols() {
	for i, col := range av.Columns {
		if nil == col.Calc {
			continue
		}

		if CalcOperatorNone == col.Calc.Operator {
			continue
		}

		switch col.Type {
		case ColumnTypeText:
			av.calcColText(col, i)
		case ColumnTypeNumber:
			av.calcColNumber(col, i)
		case ColumnTypeDate:
			av.calcColDate(col, i)
		case ColumnTypeSelect:
			av.calcColSelect(col, i)
		case ColumnTypeMSelect:
			av.calcColMSelect(col, i)
		}
	}
}

func (av *AttributeView) calcColMSelect(col *Column, colIndex int) {
	switch col.Calc.Operator {
	case CalcOperatorCountAll:
		col.Calc.Result = &Value{Number: &ValueNumber{Content: float64(len(av.Rows))}}
	case CalcOperatorCountValues:
		countValues := 0
		for _, row := range av.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.MSelect && 0 < len(row.Cells[colIndex].Value.MSelect) {
				countValues += len(row.Cells[colIndex].Value.MSelect)
			}
		}
		col.Calc.Result = &Value{Number: &ValueNumber{Content: float64(countValues)}}
	case CalcOperatorCountUniqueValues:
		countUniqueValues := 0
		uniqueValues := map[string]bool{}
		for _, row := range av.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.MSelect && 0 < len(row.Cells[colIndex].Value.MSelect) {
				for _, sel := range row.Cells[colIndex].Value.MSelect {
					if _, ok := uniqueValues[sel.Content]; !ok {
						uniqueValues[sel.Content] = true
						countUniqueValues++
					}
				}
			}
		}
		col.Calc.Result = &Value{Number: &ValueNumber{Content: float64(countUniqueValues)}}
	case CalcOperatorCountEmpty:
		countEmpty := 0
		for _, row := range av.Rows {
			if nil == row.Cells[colIndex] || nil == row.Cells[colIndex].Value || nil == row.Cells[colIndex].Value.MSelect || 0 == len(row.Cells[colIndex].Value.MSelect) {
				countEmpty++
			}
		}
		col.Calc.Result = &Value{Number: &ValueNumber{Content: float64(countEmpty)}}
	case CalcOperatorCountNotEmpty:
		countNotEmpty := 0
		for _, row := range av.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.MSelect && 0 < len(row.Cells[colIndex].Value.MSelect) {
				countNotEmpty++
			}
		}
		col.Calc.Result = &Value{Number: &ValueNumber{Content: float64(countNotEmpty)}}
	case CalcOperatorPercentEmpty:
		countEmpty := 0
		for _, row := range av.Rows {
			if nil == row.Cells[colIndex] || nil == row.Cells[colIndex].Value || nil == row.Cells[colIndex].Value.MSelect || 0 == len(row.Cells[colIndex].Value.MSelect) {
				countEmpty++
			}
		}
		col.Calc.Result = &Value{Number: &ValueNumber{Content: float64(countEmpty) / float64(len(av.Rows))}}
	case CalcOperatorPercentNotEmpty:
		countNotEmpty := 0
		for _, row := range av.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.MSelect && 0 < len(row.Cells[colIndex].Value.MSelect) {
				countNotEmpty++
			}
		}
		col.Calc.Result = &Value{Number: &ValueNumber{Content: float64(countNotEmpty) / float64(len(av.Rows))}}
	}
}

func (av *AttributeView) calcColSelect(col *Column, colIndex int) {
	switch col.Calc.Operator {
	case CalcOperatorCountAll:
		col.Calc.Result = &Value{Number: &ValueNumber{Content: float64(len(av.Rows))}}
	case CalcOperatorCountValues:
		countValues := 0
		for _, row := range av.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.MSelect && 0 < len(row.Cells[colIndex].Value.MSelect) && nil != row.Cells[colIndex].Value.MSelect[0] && "" != row.Cells[colIndex].Value.MSelect[0].Content {
				countValues++
			}
		}
		col.Calc.Result = &Value{Number: &ValueNumber{Content: float64(countValues)}}
	case CalcOperatorCountUniqueValues:
		countUniqueValues := 0
		uniqueValues := map[string]bool{}
		for _, row := range av.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.MSelect && 0 < len(row.Cells[colIndex].Value.MSelect) && nil != row.Cells[colIndex].Value.MSelect[0] && "" != row.Cells[colIndex].Value.MSelect[0].Content {
				uniqueValues[row.Cells[colIndex].Value.MSelect[0].Content] = true
				countUniqueValues++
			}
		}
		col.Calc.Result = &Value{Number: &ValueNumber{Content: float64(countUniqueValues)}}
	case CalcOperatorCountEmpty:
		countEmpty := 0
		for _, row := range av.Rows {
			if nil == row.Cells[colIndex] || nil == row.Cells[colIndex].Value || nil == row.Cells[colIndex].Value.MSelect || 1 > len(row.Cells[colIndex].Value.MSelect) || nil == row.Cells[colIndex].Value.MSelect[0] || "" == row.Cells[colIndex].Value.MSelect[0].Content {
				countEmpty++
			}
		}
		col.Calc.Result = &Value{Number: &ValueNumber{Content: float64(countEmpty)}}
	case CalcOperatorCountNotEmpty:
		countNotEmpty := 0
		for _, row := range av.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.MSelect && 0 < len(row.Cells[colIndex].Value.MSelect) && nil != row.Cells[colIndex].Value.MSelect[0] && "" != row.Cells[colIndex].Value.MSelect[0].Content {
				countNotEmpty++
			}
		}
		col.Calc.Result = &Value{Number: &ValueNumber{Content: float64(countNotEmpty)}}
	case CalcOperatorPercentEmpty:
		countEmpty := 0
		for _, row := range av.Rows {
			if nil == row.Cells[colIndex] || nil == row.Cells[colIndex].Value || nil == row.Cells[colIndex].Value.MSelect || 1 > len(row.Cells[colIndex].Value.MSelect) || nil == row.Cells[colIndex].Value.MSelect[0] || "" == row.Cells[colIndex].Value.MSelect[0].Content {
				countEmpty++
			}
		}
		col.Calc.Result = &Value{Number: &ValueNumber{Content: float64(countEmpty) / float64(len(av.Rows))}}
	case CalcOperatorPercentNotEmpty:
		countNotEmpty := 0
		for _, row := range av.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.MSelect && 0 < len(row.Cells[colIndex].Value.MSelect) && nil != row.Cells[colIndex].Value.MSelect[0] && "" != row.Cells[colIndex].Value.MSelect[0].Content {
				countNotEmpty++
			}
		}
		col.Calc.Result = &Value{Number: &ValueNumber{Content: float64(countNotEmpty) / float64(len(av.Rows))}}
	}
}

func (av *AttributeView) calcColDate(col *Column, colIndex int) {
	switch col.Calc.Operator {
	case CalcOperatorCountAll:
		col.Calc.Result = &Value{Number: &ValueNumber{Content: float64(len(av.Rows))}}
	case CalcOperatorCountValues:
		countValues := 0
		for _, row := range av.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Date && 0 != row.Cells[colIndex].Value.Date.Content {
				countValues++
			}
		}
		col.Calc.Result = &Value{Number: &ValueNumber{Content: float64(countValues)}}
	case CalcOperatorCountUniqueValues:
		countUniqueValues := 0
		uniqueValues := map[int64]bool{}
		for _, row := range av.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Date && 0 != row.Cells[colIndex].Value.Date.Content {
				if _, ok := uniqueValues[row.Cells[colIndex].Value.Date.Content]; !ok {
					countUniqueValues++
					uniqueValues[row.Cells[colIndex].Value.Date.Content] = true
				}
			}
		}
		col.Calc.Result = &Value{Number: &ValueNumber{Content: float64(countUniqueValues)}}
	case CalcOperatorCountEmpty:
		countEmpty := 0
		for _, row := range av.Rows {
			if nil == row.Cells[colIndex] || nil == row.Cells[colIndex].Value || nil == row.Cells[colIndex].Value.Date || 0 == row.Cells[colIndex].Value.Date.Content {
				countEmpty++
			}
		}
		col.Calc.Result = &Value{Number: &ValueNumber{Content: float64(countEmpty)}}
	case CalcOperatorCountNotEmpty:
		countNotEmpty := 0
		for _, row := range av.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Date && 0 != row.Cells[colIndex].Value.Date.Content {
				countNotEmpty++
			}
		}
		col.Calc.Result = &Value{Number: &ValueNumber{Content: float64(countNotEmpty)}}
	case CalcOperatorPercentEmpty:
		countEmpty := 0
		for _, row := range av.Rows {
			if nil == row.Cells[colIndex] || nil == row.Cells[colIndex].Value || nil == row.Cells[colIndex].Value.Date || 0 == row.Cells[colIndex].Value.Date.Content {
				countEmpty++
			}
		}
		col.Calc.Result = &Value{Number: &ValueNumber{Content: float64(countEmpty) / float64(len(av.Rows))}}
	case CalcOperatorPercentNotEmpty:
		countNotEmpty := 0
		for _, row := range av.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Date && 0 != row.Cells[colIndex].Value.Date.Content {
				countNotEmpty++
			}
		}
		col.Calc.Result = &Value{Number: &ValueNumber{Content: float64(countNotEmpty) / float64(len(av.Rows))}}
	case CalcOperatorEarliest:
		earliest := int64(0)
		for _, row := range av.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Date && 0 != row.Cells[colIndex].Value.Date.Content {
				if 0 == earliest || earliest > row.Cells[colIndex].Value.Date.Content {
					earliest = row.Cells[colIndex].Value.Date.Content
				}
			}
		}
		if 0 != earliest {
			col.Calc.Result = &Value{Date: &ValueDate{Content: earliest}}
		}
	case CalcOperatorLatest:
		latest := int64(0)
		for _, row := range av.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Date && 0 != row.Cells[colIndex].Value.Date.Content {
				if 0 == latest || latest < row.Cells[colIndex].Value.Date.Content {
					latest = row.Cells[colIndex].Value.Date.Content
				}
			}
		}
		if 0 != latest {
			col.Calc.Result = &Value{Date: &ValueDate{Content: latest}}
		}
	case CalcOperatorRange:
		earliest := int64(0)
		latest := int64(0)
		for _, row := range av.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Date && 0 != row.Cells[colIndex].Value.Date.Content {
				if 0 == earliest || earliest > row.Cells[colIndex].Value.Date.Content {
					earliest = row.Cells[colIndex].Value.Date.Content
				}
				if 0 == latest || latest < row.Cells[colIndex].Value.Date.Content {
					latest = row.Cells[colIndex].Value.Date.Content
				}
			}
		}
		if 0 != earliest && 0 != latest {
			col.Calc.Result = &Value{Date: &ValueDate{Content: latest - earliest}}
		}
	}
}

func (av *AttributeView) calcColNumber(col *Column, colIndex int) {
	switch col.Calc.Operator {
	case CalcOperatorCountAll:
		col.Calc.Result = &Value{Number: &ValueNumber{Content: float64(len(av.Rows))}}
	case CalcOperatorCountValues:
		countValues := 0
		for _, row := range av.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Number {
				countValues++
			}
		}
		col.Calc.Result = &Value{Number: &ValueNumber{Content: float64(countValues)}}
	case CalcOperatorCountUniqueValues:
		countUniqueValues := 0
		uniqueValues := map[float64]bool{}
		for _, row := range av.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Number && row.Cells[colIndex].Value.Number.IsNotEmpty {
				if !uniqueValues[row.Cells[colIndex].Value.Number.Content] {
					uniqueValues[row.Cells[colIndex].Value.Number.Content] = true
					countUniqueValues++
				}
			}
		}
		col.Calc.Result = &Value{Number: &ValueNumber{Content: float64(countUniqueValues)}}
	case CalcOperatorCountEmpty:
		countEmpty := 0
		for _, row := range av.Rows {
			if nil == row.Cells[colIndex] || nil == row.Cells[colIndex].Value || nil == row.Cells[colIndex].Value.Number && !row.Cells[colIndex].Value.Number.IsNotEmpty {
				countEmpty++
			}
		}
		col.Calc.Result = &Value{Number: &ValueNumber{Content: float64(countEmpty)}}
	case CalcOperatorCountNotEmpty:
		countNotEmpty := 0
		for _, row := range av.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Number && row.Cells[colIndex].Value.Number.IsNotEmpty {
				countNotEmpty++
			}
		}
		col.Calc.Result = &Value{Number: &ValueNumber{Content: float64(countNotEmpty)}}
	case CalcOperatorPercentEmpty:
		countEmpty := 0
		for _, row := range av.Rows {
			if nil == row.Cells[colIndex] || nil == row.Cells[colIndex].Value || nil == row.Cells[colIndex].Value.Number && !row.Cells[colIndex].Value.Number.IsNotEmpty {
				countEmpty++
			}
		}
		col.Calc.Result = &Value{Number: &ValueNumber{Content: float64(countEmpty) / float64(len(av.Rows))}}
	case CalcOperatorPercentNotEmpty:
		countNotEmpty := 0
		for _, row := range av.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Number && row.Cells[colIndex].Value.Number.IsNotEmpty {
				countNotEmpty++
			}
		}
		col.Calc.Result = &Value{Number: &ValueNumber{Content: float64(countNotEmpty) / float64(len(av.Rows))}}
	case CalcOperatorSum:
		sum := 0.0
		for _, row := range av.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Number && row.Cells[colIndex].Value.Number.IsNotEmpty {
				sum += row.Cells[colIndex].Value.Number.Content
			}
		}
		col.Calc.Result = &Value{Number: &ValueNumber{Content: sum}}
	case CalcOperatorAverage:
		sum := 0.0
		count := 0
		for _, row := range av.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Number && row.Cells[colIndex].Value.Number.IsNotEmpty {
				sum += row.Cells[colIndex].Value.Number.Content
				count++
			}
		}
		col.Calc.Result = &Value{Number: &ValueNumber{Content: sum / float64(count)}}
	case CalcOperatorMedian:
		values := []float64{}
		for _, row := range av.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Number && row.Cells[colIndex].Value.Number.IsNotEmpty {
				values = append(values, row.Cells[colIndex].Value.Number.Content)
			}
		}
		sort.Float64s(values)
		if len(values) > 0 {
			if len(values)%2 == 0 {
				col.Calc.Result = &Value{Number: &ValueNumber{Content: (values[len(values)/2-1] + values[len(values)/2]) / 2}}
			} else {
				col.Calc.Result = &Value{Number: &ValueNumber{Content: values[len(values)/2]}}
			}
		} else {
			col.Calc.Result = &Value{Number: &ValueNumber{IsNotEmpty: false}}
		}
	case CalcOperatorMin:
		min := math.MaxFloat64
		for _, row := range av.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Number && row.Cells[colIndex].Value.Number.IsNotEmpty {
				if row.Cells[colIndex].Value.Number.Content < min {
					min = row.Cells[colIndex].Value.Number.Content
				}
			}
		}
		if math.MaxFloat64 != min {
			col.Calc.Result = &Value{Number: &ValueNumber{Content: min}}
		} else {
			col.Calc.Result = &Value{Number: &ValueNumber{IsNotEmpty: false}}
		}
	case CalcOperatorMax:
		max := -math.MaxFloat64
		for _, row := range av.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Number && row.Cells[colIndex].Value.Number.IsNotEmpty {
				if row.Cells[colIndex].Value.Number.Content > max {
					max = row.Cells[colIndex].Value.Number.Content
				}
			}
		}
		if -math.MaxFloat64 != max {
			col.Calc.Result = &Value{Number: &ValueNumber{Content: max}}
		} else {
			col.Calc.Result = &Value{Number: &ValueNumber{IsNotEmpty: false}}
		}
	case CalcOperatorRange:
		min := math.MaxFloat64
		max := -math.MaxFloat64
		for _, row := range av.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Number && row.Cells[colIndex].Value.Number.IsNotEmpty {
				if row.Cells[colIndex].Value.Number.Content < min {
					min = row.Cells[colIndex].Value.Number.Content
				}
				if row.Cells[colIndex].Value.Number.Content > max {
					max = row.Cells[colIndex].Value.Number.Content
				}
			}
		}
		if math.MaxFloat64 != min && -math.MaxFloat64 != max {
			col.Calc.Result = &Value{Number: &ValueNumber{Content: max - min}}
		} else {
			col.Calc.Result = &Value{Number: &ValueNumber{IsNotEmpty: false}}
		}
	}
}

func (av *AttributeView) calcColText(col *Column, colIndex int) {
	switch col.Calc.Operator {
	case CalcOperatorCountAll:
		col.Calc.Result = &Value{Number: &ValueNumber{Content: float64(len(av.Rows))}}
	case CalcOperatorCountValues:
		countValues := 0
		for _, row := range av.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Text && "" != row.Cells[colIndex].Value.Text.Content {
				countValues++
			}
		}
		col.Calc.Result = &Value{Number: &ValueNumber{Content: float64(countValues)}}
	case CalcOperatorCountUniqueValues:
		countUniqueValues := 0
		uniqueValues := map[string]bool{}
		for _, row := range av.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Text && "" != row.Cells[colIndex].Value.Text.Content {
				if !uniqueValues[row.Cells[colIndex].Value.Text.Content] {
					uniqueValues[row.Cells[colIndex].Value.Text.Content] = true
					countUniqueValues++
				}
			}
		}
		col.Calc.Result = &Value{Number: &ValueNumber{Content: float64(countUniqueValues)}}
	case CalcOperatorCountEmpty:
		countEmpty := 0
		for _, row := range av.Rows {
			if nil == row.Cells[colIndex] || nil == row.Cells[colIndex].Value || nil == row.Cells[colIndex].Value.Text || "" == row.Cells[colIndex].Value.Text.Content {
				countEmpty++
			}
		}
		col.Calc.Result = &Value{Number: &ValueNumber{Content: float64(countEmpty)}}
	case CalcOperatorCountNotEmpty:
		countNotEmpty := 0
		for _, row := range av.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Text && "" != row.Cells[colIndex].Value.Text.Content {
				countNotEmpty++
			}
		}
		col.Calc.Result = &Value{Number: &ValueNumber{Content: float64(countNotEmpty)}}
	case CalcOperatorPercentEmpty:
		countEmpty := 0
		for _, row := range av.Rows {
			if nil == row.Cells[colIndex] || nil == row.Cells[colIndex].Value || nil == row.Cells[colIndex].Value.Text || "" == row.Cells[colIndex].Value.Text.Content {
				countEmpty++
			}
		}
		col.Calc.Result = &Value{Number: &ValueNumber{Content: float64(countEmpty) / float64(len(av.Rows))}}
	case CalcOperatorPercentNotEmpty:
		countNotEmpty := 0
		for _, row := range av.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Text && "" != row.Cells[colIndex].Value.Text.Content {
				countNotEmpty++
			}
		}
		col.Calc.Result = &Value{Number: &ValueNumber{Content: float64(countNotEmpty) / float64(len(av.Rows))}}
	}
}
