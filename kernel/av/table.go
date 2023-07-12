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
	"math"
	"sort"
)

// LayoutTable 描述了表格布局的结构。
type LayoutTable struct {
	Spec int    `json:"spec"` // 布局格式版本
	ID   string `json:"id"`   // 布局 ID

	Columns []*TableColumn `json:"columns"` // 表格列
	ColIDs  []string       `json:"colIds"`  // 列 ID，用于自定义排序
	RowIDs  []string       `json:"rowIds"`  // 行 ID，用于自定义排序
	Filters []*ViewFilter  `json:"filters"` // 过滤规则
	Sorts   []*ViewSort    `json:"sorts"`   // 排序规则
}

type TableColumn struct {
	ID   string     `json:"id"`   // 列 ID
	Name string     `json:"name"` // 列名
	Type ColumnType `json:"type"` // 列类型
	Icon string     `json:"icon"` // 列图标

	Wrap   bool        `json:"wrap"`   // 是否换行
	Hidden bool        `json:"hidden"` // 是否隐藏
	Width  string      `json:"width"`  // 列宽度
	Calc   *ColumnCalc `json:"calc"`   // 计算
}

type TableRow struct {
	ID    string  `json:"id"`
	Cells []*Cell `json:"cells"`
}

// Table 描述了表格实例的结构。
type Table struct {
	ID      string         `json:"id"`      // 表格布局 ID
	Name    string         `json:"name"`    // 表格名称
	Filters []*ViewFilter  `json:"filters"` // 过滤规则
	Sorts   []*ViewSort    `json:"sorts"`   // 排序规则
	Columns []*TableColumn `json:"columns"` // 表格列
	Rows    []*TableRow    `json:"rows"`    // 表格行
}

func (table *Table) GetType() LayoutType {
	return LayoutTypeTable
}

func (table *Table) GetID() string {
	return table.ID
}

func (table *Table) SortRows() {
	if 1 > len(table.Sorts) {
		return
	}

	type ColIndexSort struct {
		Index int
		Order SortOrder
	}

	var colIndexSorts []*ColIndexSort
	for _, s := range table.Sorts {
		for i, c := range table.Columns {
			if c.ID == s.Column {
				colIndexSorts = append(colIndexSorts, &ColIndexSort{Index: i, Order: s.Order})
				break
			}
		}
	}

	sort.Slice(table.Rows, func(i, j int) bool {
		for _, colIndexSort := range colIndexSorts {
			c := table.Columns[colIndexSort.Index]
			if c.Type == ColumnTypeBlock {
				continue
			}

			result := table.Rows[i].Cells[colIndexSort.Index].Value.Compare(table.Rows[j].Cells[colIndexSort.Index].Value)
			if 0 == result {
				continue
			}

			if colIndexSort.Order == SortOrderAsc {
				return 0 > result
			}
			return 0 < result
		}
		return false
	})
}

func (table *Table) FilterRows() {
	if 1 > len(table.Filters) {
		return
	}

	var colIndexes []int
	for _, f := range table.Filters {
		for i, c := range table.Columns {
			if c.ID == f.Column {
				colIndexes = append(colIndexes, i)
				break
			}
		}
	}

	rows := []*TableRow{}
	for _, row := range table.Rows {
		pass := true
		for j, index := range colIndexes {
			c := table.Columns[index]
			if c.Type == ColumnTypeBlock {
				continue
			}

			if !row.Cells[index].Value.CompareOperator(table.Filters[j].Value, table.Filters[j].Operator) {
				pass = false
				break
			}
		}
		if pass {
			rows = append(rows, row)
		}
	}
	table.Rows = rows
}

func (table *Table) CalcCols() {
	for i, col := range table.Columns {
		if nil == col.Calc {
			continue
		}

		if CalcOperatorNone == col.Calc.Operator {
			continue
		}

		switch col.Type {
		case ColumnTypeText:
			table.calcColText(col, i)
		case ColumnTypeNumber:
			table.calcColNumber(col, i)
		case ColumnTypeDate:
			table.calcColDate(col, i)
		case ColumnTypeSelect:
			table.calcColSelect(col, i)
		case ColumnTypeMSelect:
			table.calcColMSelect(col, i)
		}
	}
}

func (table *Table) calcColMSelect(col *TableColumn, colIndex int) {
	switch col.Calc.Operator {
	case CalcOperatorCountAll:
		col.Calc.Result = &Value{Number: &ValueNumber{Content: float64(len(table.Rows))}}
	case CalcOperatorCountValues:
		countValues := 0
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.MSelect && 0 < len(row.Cells[colIndex].Value.MSelect) {
				countValues += len(row.Cells[colIndex].Value.MSelect)
			}
		}
		col.Calc.Result = &Value{Number: &ValueNumber{Content: float64(countValues)}}
	case CalcOperatorCountUniqueValues:
		countUniqueValues := 0
		uniqueValues := map[string]bool{}
		for _, row := range table.Rows {
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
		for _, row := range table.Rows {
			if nil == row.Cells[colIndex] || nil == row.Cells[colIndex].Value || nil == row.Cells[colIndex].Value.MSelect || 0 == len(row.Cells[colIndex].Value.MSelect) {
				countEmpty++
			}
		}
		col.Calc.Result = &Value{Number: &ValueNumber{Content: float64(countEmpty)}}
	case CalcOperatorCountNotEmpty:
		countNotEmpty := 0
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.MSelect && 0 < len(row.Cells[colIndex].Value.MSelect) {
				countNotEmpty++
			}
		}
		col.Calc.Result = &Value{Number: &ValueNumber{Content: float64(countNotEmpty)}}
	case CalcOperatorPercentEmpty:
		countEmpty := 0
		for _, row := range table.Rows {
			if nil == row.Cells[colIndex] || nil == row.Cells[colIndex].Value || nil == row.Cells[colIndex].Value.MSelect || 0 == len(row.Cells[colIndex].Value.MSelect) {
				countEmpty++
			}
		}
		col.Calc.Result = &Value{Number: &ValueNumber{Content: float64(countEmpty) / float64(len(table.Rows))}}
	case CalcOperatorPercentNotEmpty:
		countNotEmpty := 0
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.MSelect && 0 < len(row.Cells[colIndex].Value.MSelect) {
				countNotEmpty++
			}
		}
		col.Calc.Result = &Value{Number: &ValueNumber{Content: float64(countNotEmpty) / float64(len(table.Rows))}}
	}
}

func (table *Table) calcColSelect(col *TableColumn, colIndex int) {
	switch col.Calc.Operator {
	case CalcOperatorCountAll:
		col.Calc.Result = &Value{Number: &ValueNumber{Content: float64(len(table.Rows))}}
	case CalcOperatorCountValues:
		countValues := 0
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.MSelect && 0 < len(row.Cells[colIndex].Value.MSelect) && nil != row.Cells[colIndex].Value.MSelect[0] && "" != row.Cells[colIndex].Value.MSelect[0].Content {
				countValues++
			}
		}
		col.Calc.Result = &Value{Number: &ValueNumber{Content: float64(countValues)}}
	case CalcOperatorCountUniqueValues:
		countUniqueValues := 0
		uniqueValues := map[string]bool{}
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.MSelect && 0 < len(row.Cells[colIndex].Value.MSelect) && nil != row.Cells[colIndex].Value.MSelect[0] && "" != row.Cells[colIndex].Value.MSelect[0].Content {
				uniqueValues[row.Cells[colIndex].Value.MSelect[0].Content] = true
				countUniqueValues++
			}
		}
		col.Calc.Result = &Value{Number: &ValueNumber{Content: float64(countUniqueValues)}}
	case CalcOperatorCountEmpty:
		countEmpty := 0
		for _, row := range table.Rows {
			if nil == row.Cells[colIndex] || nil == row.Cells[colIndex].Value || nil == row.Cells[colIndex].Value.MSelect || 1 > len(row.Cells[colIndex].Value.MSelect) || nil == row.Cells[colIndex].Value.MSelect[0] || "" == row.Cells[colIndex].Value.MSelect[0].Content {
				countEmpty++
			}
		}
		col.Calc.Result = &Value{Number: &ValueNumber{Content: float64(countEmpty)}}
	case CalcOperatorCountNotEmpty:
		countNotEmpty := 0
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.MSelect && 0 < len(row.Cells[colIndex].Value.MSelect) && nil != row.Cells[colIndex].Value.MSelect[0] && "" != row.Cells[colIndex].Value.MSelect[0].Content {
				countNotEmpty++
			}
		}
		col.Calc.Result = &Value{Number: &ValueNumber{Content: float64(countNotEmpty)}}
	case CalcOperatorPercentEmpty:
		countEmpty := 0
		for _, row := range table.Rows {
			if nil == row.Cells[colIndex] || nil == row.Cells[colIndex].Value || nil == row.Cells[colIndex].Value.MSelect || 1 > len(row.Cells[colIndex].Value.MSelect) || nil == row.Cells[colIndex].Value.MSelect[0] || "" == row.Cells[colIndex].Value.MSelect[0].Content {
				countEmpty++
			}
		}
		col.Calc.Result = &Value{Number: &ValueNumber{Content: float64(countEmpty) / float64(len(table.Rows))}}
	case CalcOperatorPercentNotEmpty:
		countNotEmpty := 0
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.MSelect && 0 < len(row.Cells[colIndex].Value.MSelect) && nil != row.Cells[colIndex].Value.MSelect[0] && "" != row.Cells[colIndex].Value.MSelect[0].Content {
				countNotEmpty++
			}
		}
		col.Calc.Result = &Value{Number: &ValueNumber{Content: float64(countNotEmpty) / float64(len(table.Rows))}}
	}
}

func (table *Table) calcColDate(col *TableColumn, colIndex int) {
	switch col.Calc.Operator {
	case CalcOperatorCountAll:
		col.Calc.Result = &Value{Number: &ValueNumber{Content: float64(len(table.Rows))}}
	case CalcOperatorCountValues:
		countValues := 0
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Date && 0 != row.Cells[colIndex].Value.Date.Content {
				countValues++
			}
		}
		col.Calc.Result = &Value{Number: &ValueNumber{Content: float64(countValues)}}
	case CalcOperatorCountUniqueValues:
		countUniqueValues := 0
		uniqueValues := map[int64]bool{}
		for _, row := range table.Rows {
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
		for _, row := range table.Rows {
			if nil == row.Cells[colIndex] || nil == row.Cells[colIndex].Value || nil == row.Cells[colIndex].Value.Date || 0 == row.Cells[colIndex].Value.Date.Content {
				countEmpty++
			}
		}
		col.Calc.Result = &Value{Number: &ValueNumber{Content: float64(countEmpty)}}
	case CalcOperatorCountNotEmpty:
		countNotEmpty := 0
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Date && 0 != row.Cells[colIndex].Value.Date.Content {
				countNotEmpty++
			}
		}
		col.Calc.Result = &Value{Number: &ValueNumber{Content: float64(countNotEmpty)}}
	case CalcOperatorPercentEmpty:
		countEmpty := 0
		for _, row := range table.Rows {
			if nil == row.Cells[colIndex] || nil == row.Cells[colIndex].Value || nil == row.Cells[colIndex].Value.Date || 0 == row.Cells[colIndex].Value.Date.Content {
				countEmpty++
			}
		}
		col.Calc.Result = &Value{Number: &ValueNumber{Content: float64(countEmpty) / float64(len(table.Rows))}}
	case CalcOperatorPercentNotEmpty:
		countNotEmpty := 0
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Date && 0 != row.Cells[colIndex].Value.Date.Content {
				countNotEmpty++
			}
		}
		col.Calc.Result = &Value{Number: &ValueNumber{Content: float64(countNotEmpty) / float64(len(table.Rows))}}
	case CalcOperatorEarliest:
		earliest := int64(0)
		for _, row := range table.Rows {
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
		for _, row := range table.Rows {
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
		for _, row := range table.Rows {
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

func (table *Table) calcColNumber(col *TableColumn, colIndex int) {
	switch col.Calc.Operator {
	case CalcOperatorCountAll:
		col.Calc.Result = &Value{Number: &ValueNumber{Content: float64(len(table.Rows))}}
	case CalcOperatorCountValues:
		countValues := 0
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Number {
				countValues++
			}
		}
		col.Calc.Result = &Value{Number: &ValueNumber{Content: float64(countValues)}}
	case CalcOperatorCountUniqueValues:
		countUniqueValues := 0
		uniqueValues := map[float64]bool{}
		for _, row := range table.Rows {
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
		for _, row := range table.Rows {
			if nil == row.Cells[colIndex] || nil == row.Cells[colIndex].Value || nil == row.Cells[colIndex].Value.Number && !row.Cells[colIndex].Value.Number.IsNotEmpty {
				countEmpty++
			}
		}
		col.Calc.Result = &Value{Number: &ValueNumber{Content: float64(countEmpty)}}
	case CalcOperatorCountNotEmpty:
		countNotEmpty := 0
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Number && row.Cells[colIndex].Value.Number.IsNotEmpty {
				countNotEmpty++
			}
		}
		col.Calc.Result = &Value{Number: &ValueNumber{Content: float64(countNotEmpty)}}
	case CalcOperatorPercentEmpty:
		countEmpty := 0
		for _, row := range table.Rows {
			if nil == row.Cells[colIndex] || nil == row.Cells[colIndex].Value || nil == row.Cells[colIndex].Value.Number && !row.Cells[colIndex].Value.Number.IsNotEmpty {
				countEmpty++
			}
		}
		col.Calc.Result = &Value{Number: &ValueNumber{Content: float64(countEmpty) / float64(len(table.Rows))}}
	case CalcOperatorPercentNotEmpty:
		countNotEmpty := 0
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Number && row.Cells[colIndex].Value.Number.IsNotEmpty {
				countNotEmpty++
			}
		}
		col.Calc.Result = &Value{Number: &ValueNumber{Content: float64(countNotEmpty) / float64(len(table.Rows))}}
	case CalcOperatorSum:
		sum := 0.0
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Number && row.Cells[colIndex].Value.Number.IsNotEmpty {
				sum += row.Cells[colIndex].Value.Number.Content
			}
		}
		col.Calc.Result = &Value{Number: &ValueNumber{Content: sum}}
	case CalcOperatorAverage:
		sum := 0.0
		count := 0
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Number && row.Cells[colIndex].Value.Number.IsNotEmpty {
				sum += row.Cells[colIndex].Value.Number.Content
				count++
			}
		}
		col.Calc.Result = &Value{Number: &ValueNumber{Content: sum / float64(count)}}
	case CalcOperatorMedian:
		values := []float64{}
		for _, row := range table.Rows {
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
		for _, row := range table.Rows {
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
		for _, row := range table.Rows {
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
		for _, row := range table.Rows {
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

func (table *Table) calcColText(col *TableColumn, colIndex int) {
	switch col.Calc.Operator {
	case CalcOperatorCountAll:
		col.Calc.Result = &Value{Number: &ValueNumber{Content: float64(len(table.Rows))}}
	case CalcOperatorCountValues:
		countValues := 0
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Text && "" != row.Cells[colIndex].Value.Text.Content {
				countValues++
			}
		}
		col.Calc.Result = &Value{Number: &ValueNumber{Content: float64(countValues)}}
	case CalcOperatorCountUniqueValues:
		countUniqueValues := 0
		uniqueValues := map[string]bool{}
		for _, row := range table.Rows {
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
		for _, row := range table.Rows {
			if nil == row.Cells[colIndex] || nil == row.Cells[colIndex].Value || nil == row.Cells[colIndex].Value.Text || "" == row.Cells[colIndex].Value.Text.Content {
				countEmpty++
			}
		}
		col.Calc.Result = &Value{Number: &ValueNumber{Content: float64(countEmpty)}}
	case CalcOperatorCountNotEmpty:
		countNotEmpty := 0
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Text && "" != row.Cells[colIndex].Value.Text.Content {
				countNotEmpty++
			}
		}
		col.Calc.Result = &Value{Number: &ValueNumber{Content: float64(countNotEmpty)}}
	case CalcOperatorPercentEmpty:
		countEmpty := 0
		for _, row := range table.Rows {
			if nil == row.Cells[colIndex] || nil == row.Cells[colIndex].Value || nil == row.Cells[colIndex].Value.Text || "" == row.Cells[colIndex].Value.Text.Content {
				countEmpty++
			}
		}
		col.Calc.Result = &Value{Number: &ValueNumber{Content: float64(countEmpty) / float64(len(table.Rows))}}
	case CalcOperatorPercentNotEmpty:
		countNotEmpty := 0
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Text && "" != row.Cells[colIndex].Value.Text.Content {
				countNotEmpty++
			}
		}
		col.Calc.Result = &Value{Number: &ValueNumber{Content: float64(countNotEmpty) / float64(len(table.Rows))}}
	}
}
