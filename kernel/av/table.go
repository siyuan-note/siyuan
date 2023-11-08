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
	"strconv"
	"strings"
)

// LayoutTable 描述了表格布局的结构。
type LayoutTable struct {
	Spec int    `json:"spec"` // 布局格式版本
	ID   string `json:"id"`   // 布局 ID

	Columns []*ViewTableColumn `json:"columns"` // 表格列
	RowIDs  []string           `json:"rowIds"`  // 行 ID，用于自定义排序
	Filters []*ViewFilter      `json:"filters"` // 过滤规则
	Sorts   []*ViewSort        `json:"sorts"`   // 排序规则
}

type ViewTableColumn struct {
	ID string `json:"id"` // 列 ID

	Wrap   bool        `json:"wrap"`           // 是否换行
	Hidden bool        `json:"hidden"`         // 是否隐藏
	Width  string      `json:"width"`          // 列宽度
	Calc   *ColumnCalc `json:"calc,omitempty"` // 计算
}

type Calculable interface {
	CalcCols()
}

type ColumnCalc struct {
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

func (value *Value) Compare(other *Value) int {
	if nil == value {
		return -1
	}
	if nil == other {
		return 1
	}

	switch value.Type {
	case KeyTypeBlock:
		if nil != value.Block && nil != other.Block {
			return strings.Compare(value.Block.Content, other.Block.Content)
		}
	case KeyTypeText:
		if nil != value.Text && nil != other.Text {
			return strings.Compare(value.Text.Content, other.Text.Content)
		}
	case KeyTypeNumber:
		if nil != value.Number && nil != other.Number {
			if value.Number.Content > other.Number.Content {
				return 1
			} else if value.Number.Content < other.Number.Content {
				return -1
			} else {
				return 0
			}
		}
	case KeyTypeDate:
		if nil != value.Date && nil != other.Date {
			if value.Date.Content > other.Date.Content {
				return 1
			} else if value.Date.Content < other.Date.Content {
				return -1
			} else {
				return 0
			}
		}
	case KeyTypeCreated:
		if nil != value.Created && nil != other.Created {
			if value.Created.Content > other.Created.Content {
				return 1
			} else if value.Created.Content < other.Created.Content {
				return -1
			} else {
				return 0
			}
		}
	case KeyTypeUpdated:
		if nil != value.Updated && nil != other.Updated {
			if value.Updated.Content > other.Updated.Content {
				return 1
			} else if value.Updated.Content < other.Updated.Content {
				return -1
			} else {
				return 0
			}
		}
	case KeyTypeSelect, KeyTypeMSelect:
		if nil != value.MSelect && nil != other.MSelect {
			var v1 string
			for _, v := range value.MSelect {
				v1 += v.Content
			}
			var v2 string
			for _, v := range other.MSelect {
				v2 += v.Content
			}
			return strings.Compare(v1, v2)
		}
	case KeyTypeURL:
		if nil != value.URL && nil != other.URL {
			return strings.Compare(value.URL.Content, other.URL.Content)
		}
	case KeyTypeEmail:
		if nil != value.Email && nil != other.Email {
			return strings.Compare(value.Email.Content, other.Email.Content)
		}
	case KeyTypePhone:
		if nil != value.Phone && nil != other.Phone {
			return strings.Compare(value.Phone.Content, other.Phone.Content)
		}
	case KeyTypeMAsset:
		if nil != value.MAsset && nil != other.MAsset {
			var v1 string
			for _, v := range value.MAsset {
				v1 += v.Content
			}
			var v2 string
			for _, v := range other.MAsset {
				v2 += v.Content
			}
			return strings.Compare(v1, v2)
		}
	case KeyTypeTemplate:
		if nil != value.Template && nil != other.Template {
			return strings.Compare(value.Template.Content, other.Template.Content)
		}
	}
	return 0
}

func (value *Value) CompareOperator(other *Value, operator FilterOperator) bool {
	if nil == other {
		return true
	}

	if nil != value.Block && nil != other.Block {
		switch operator {
		case FilterOperatorIsEqual:
			return value.Block.Content == other.Block.Content
		case FilterOperatorIsNotEqual:
			return value.Block.Content != other.Block.Content
		case FilterOperatorContains:
			return strings.Contains(value.Block.Content, other.Block.Content)
		case FilterOperatorDoesNotContain:
			return !strings.Contains(value.Block.Content, other.Block.Content)
		case FilterOperatorStartsWith:
			return strings.HasPrefix(value.Block.Content, other.Block.Content)
		case FilterOperatorEndsWith:
			return strings.HasSuffix(value.Block.Content, other.Block.Content)
		case FilterOperatorIsEmpty:
			return "" == strings.TrimSpace(value.Block.Content)
		case FilterOperatorIsNotEmpty:
			return "" != strings.TrimSpace(value.Block.Content)
		}
	}

	if nil != value.Text && nil != other.Text {
		switch operator {
		case FilterOperatorIsEqual:
			if "" == strings.TrimSpace(other.Text.Content) {
				return true
			}
			return value.Text.Content == other.Text.Content
		case FilterOperatorIsNotEqual:
			if "" == strings.TrimSpace(other.Text.Content) {
				return true
			}
			return value.Text.Content != other.Text.Content
		case FilterOperatorContains:
			if "" == strings.TrimSpace(other.Text.Content) {
				return true
			}
			return strings.Contains(value.Text.Content, other.Text.Content)
		case FilterOperatorDoesNotContain:
			if "" == strings.TrimSpace(other.Text.Content) {
				return true
			}
			return !strings.Contains(value.Text.Content, other.Text.Content)
		case FilterOperatorStartsWith:
			if "" == strings.TrimSpace(other.Text.Content) {
				return true
			}
			return strings.HasPrefix(value.Text.Content, other.Text.Content)
		case FilterOperatorEndsWith:
			if "" == strings.TrimSpace(other.Text.Content) {
				return true
			}
			return strings.HasSuffix(value.Text.Content, other.Text.Content)
		case FilterOperatorIsEmpty:
			return "" == strings.TrimSpace(value.Text.Content)
		case FilterOperatorIsNotEmpty:
			return "" != strings.TrimSpace(value.Text.Content)
		}
	}

	if nil != value.Number && nil != other.Number {
		switch operator {
		case FilterOperatorIsEqual:
			if !other.Number.IsNotEmpty {
				return true
			}
			return value.Number.Content == other.Number.Content
		case FilterOperatorIsNotEqual:
			if !other.Number.IsNotEmpty {
				return true
			}
			return value.Number.Content != other.Number.Content
		case FilterOperatorIsGreater:
			return value.Number.Content > other.Number.Content
		case FilterOperatorIsGreaterOrEqual:
			return value.Number.Content >= other.Number.Content
		case FilterOperatorIsLess:
			return value.Number.Content < other.Number.Content
		case FilterOperatorIsLessOrEqual:
			return value.Number.Content <= other.Number.Content
		case FilterOperatorIsEmpty:
			return !value.Number.IsNotEmpty
		case FilterOperatorIsNotEmpty:
			return value.Number.IsNotEmpty
		}
	}

	if nil != value.Date && nil != other.Date {
		switch operator {
		case FilterOperatorIsEqual:
			if !other.Date.IsNotEmpty {
				return true
			}
			return value.Date.Content == other.Date.Content
		case FilterOperatorIsNotEqual:
			if !other.Date.IsNotEmpty {
				return true
			}
			return value.Date.Content != other.Date.Content
		case FilterOperatorIsGreater:
			return value.Date.Content > other.Date.Content
		case FilterOperatorIsGreaterOrEqual:
			return value.Date.Content >= other.Date.Content
		case FilterOperatorIsLess:
			return value.Date.Content < other.Date.Content
		case FilterOperatorIsLessOrEqual:
			return value.Date.Content <= other.Date.Content
		case FilterOperatorIsBetween:
			start := value.Date.Content >= other.Date.Content
			end := value.Date.Content <= other.Date.Content2
			if value.Date.HasEndDate {
				end = value.Date.Content2 <= other.Date.Content2
			}
			return start && end
		case FilterOperatorIsEmpty:
			return !value.Date.IsNotEmpty
		case FilterOperatorIsNotEmpty:
			return value.Date.IsNotEmpty
		case FilterOperatorIsRelativeToToday:
			// TODO: date filter (relative to today)
			return value.Date.Content >= other.Date.Content && value.Date.Content <= other.Date.Content2
		}
	}

	if nil != value.Created && nil != other.Created {
		switch operator {
		case FilterOperatorIsEqual:
			return value.Created.Content == other.Created.Content
		case FilterOperatorIsNotEqual:
			return value.Created.Content != other.Created.Content
		case FilterOperatorIsGreater:
			return value.Created.Content > other.Created.Content
		case FilterOperatorIsGreaterOrEqual:
			return value.Created.Content >= other.Created.Content
		case FilterOperatorIsLess:
			return value.Created.Content < other.Created.Content
		case FilterOperatorIsLessOrEqual:
			return value.Created.Content <= other.Created.Content
		case FilterOperatorIsBetween:
			start := value.Created.Content >= other.Created.Content
			end := value.Created.Content <= other.Created.Content2
			return start && end
		case FilterOperatorIsEmpty:
			return !value.Created.IsNotEmpty
		case FilterOperatorIsNotEmpty:
			return value.Created.IsNotEmpty
		case FilterOperatorIsRelativeToToday:
			// TODO: date filter (relative to today)
			return value.Date.Content >= other.Date.Content && value.Date.Content <= other.Date.Content2
		}
	}

	if nil != value.Updated && nil != other.Updated {
		switch operator {
		case FilterOperatorIsEqual:
			return value.Updated.Content == other.Updated.Content
		case FilterOperatorIsNotEqual:
			return value.Updated.Content != other.Updated.Content
		case FilterOperatorIsGreater:
			return value.Updated.Content > other.Updated.Content
		case FilterOperatorIsGreaterOrEqual:
			return value.Updated.Content >= other.Updated.Content
		case FilterOperatorIsLess:
			return value.Updated.Content < other.Updated.Content
		case FilterOperatorIsLessOrEqual:
			return value.Updated.Content <= other.Updated.Content
		case FilterOperatorIsBetween:
			start := value.Updated.Content >= other.Updated.Content
			end := value.Updated.Content <= other.Updated.Content2
			return start && end
		case FilterOperatorIsEmpty:
			return !value.Updated.IsNotEmpty
		case FilterOperatorIsNotEmpty:
			return value.Updated.IsNotEmpty
		case FilterOperatorIsRelativeToToday:
			// TODO: date filter (relative to today)
			return value.Date.Content >= other.Date.Content && value.Date.Content <= other.Date.Content2
		}
	}

	if nil != value.MSelect && nil != other.MSelect && 0 < len(value.MSelect) && 0 < len(other.MSelect) {
		switch operator {
		case FilterOperatorIsEqual, FilterOperatorContains:
			contains := false
			for _, v := range value.MSelect {
				for _, v2 := range other.MSelect {
					if v.Content == v2.Content {
						contains = true
						break
					}
				}
			}
			return contains
		case FilterOperatorIsNotEqual, FilterOperatorDoesNotContain:
			contains := false
			for _, v := range value.MSelect {
				for _, v2 := range other.MSelect {
					if v.Content == v2.Content {
						contains = true
						break
					}
				}
			}
			return !contains
		case FilterOperatorIsEmpty:
			return 0 == len(value.MSelect) || 1 == len(value.MSelect) && "" == value.MSelect[0].Content
		case FilterOperatorIsNotEmpty:
			return 0 != len(value.MSelect) && !(1 == len(value.MSelect) && "" == value.MSelect[0].Content)
		}
	}

	if nil != value.URL && nil != other.URL {
		switch operator {
		case FilterOperatorIsEqual:
			return value.URL.Content == other.URL.Content
		case FilterOperatorIsNotEqual:
			return value.URL.Content != other.URL.Content
		case FilterOperatorContains:
			return strings.Contains(value.URL.Content, other.URL.Content)
		case FilterOperatorDoesNotContain:
			return !strings.Contains(value.URL.Content, other.URL.Content)
		case FilterOperatorStartsWith:
			return strings.HasPrefix(value.URL.Content, other.URL.Content)
		case FilterOperatorEndsWith:
			return strings.HasSuffix(value.URL.Content, other.URL.Content)
		case FilterOperatorIsEmpty:
			return "" == strings.TrimSpace(value.URL.Content)
		case FilterOperatorIsNotEmpty:
			return "" != strings.TrimSpace(value.URL.Content)
		}
	}

	if nil != value.Email && nil != other.Email {
		switch operator {
		case FilterOperatorIsEqual:
			return value.Email.Content == other.Email.Content
		case FilterOperatorIsNotEqual:
			return value.Email.Content != other.Email.Content
		case FilterOperatorContains:
			return strings.Contains(value.Email.Content, other.Email.Content)
		case FilterOperatorDoesNotContain:
			return !strings.Contains(value.Email.Content, other.Email.Content)
		case FilterOperatorStartsWith:
			return strings.HasPrefix(value.Email.Content, other.Email.Content)
		case FilterOperatorEndsWith:
			return strings.HasSuffix(value.Email.Content, other.Email.Content)
		case FilterOperatorIsEmpty:
			return "" == strings.TrimSpace(value.Email.Content)
		case FilterOperatorIsNotEmpty:
			return "" != strings.TrimSpace(value.Email.Content)
		}
	}

	if nil != value.Phone && nil != other.Phone {
		switch operator {
		case FilterOperatorIsEqual:
			return value.Phone.Content == other.Phone.Content
		case FilterOperatorIsNotEqual:
			return value.Phone.Content != other.Phone.Content
		case FilterOperatorContains:
			return strings.Contains(value.Phone.Content, other.Phone.Content)
		case FilterOperatorDoesNotContain:
			return !strings.Contains(value.Phone.Content, other.Phone.Content)
		case FilterOperatorStartsWith:
			return strings.HasPrefix(value.Phone.Content, other.Phone.Content)
		case FilterOperatorEndsWith:
			return strings.HasSuffix(value.Phone.Content, other.Phone.Content)
		case FilterOperatorIsEmpty:
			return "" == strings.TrimSpace(value.Phone.Content)
		case FilterOperatorIsNotEmpty:
			return "" != strings.TrimSpace(value.Phone.Content)
		}
	}

	if nil != value.MAsset && nil != other.MAsset && 0 < len(value.MAsset) && 0 < len(other.MAsset) {
		switch operator {
		case FilterOperatorIsEqual, FilterOperatorContains:
			contains := false
			for _, v := range value.MAsset {
				for _, v2 := range other.MAsset {
					if v.Content == v2.Content {
						contains = true
						break
					}
				}
			}
			return contains
		case FilterOperatorIsNotEqual, FilterOperatorDoesNotContain:
			contains := false
			for _, v := range value.MAsset {
				for _, v2 := range other.MAsset {
					if v.Content == v2.Content {
						contains = true
						break
					}
				}
			}
			return !contains
		case FilterOperatorIsEmpty:
			return 0 == len(value.MAsset) || 1 == len(value.MAsset) && "" == value.MAsset[0].Content
		case FilterOperatorIsNotEmpty:
			return 0 != len(value.MAsset) && !(1 == len(value.MAsset) && "" == value.MAsset[0].Content)
		}
	}

	if nil != value.Template && nil != other.Template {
		switch operator {
		case FilterOperatorIsEqual:
			if "" == strings.TrimSpace(other.Template.Content) {
				return true
			}
			return value.Template.Content == other.Template.Content
		case FilterOperatorIsNotEqual:
			if "" == strings.TrimSpace(other.Template.Content) {
				return true
			}
			return value.Template.Content != other.Template.Content
		case FilterOperatorIsGreater:
			if "" == strings.TrimSpace(other.Template.Content) {
				return true
			}
			return value.Template.Content > other.Template.Content
		case FilterOperatorIsGreaterOrEqual:
			if "" == strings.TrimSpace(other.Template.Content) {
				return true
			}
			return value.Template.Content >= other.Template.Content
		case FilterOperatorIsLess:
			if "" == strings.TrimSpace(other.Template.Content) {
				return true
			}
			return value.Template.Content < other.Template.Content
		case FilterOperatorIsLessOrEqual:
			if "" == strings.TrimSpace(other.Template.Content) {
				return true
			}
			return value.Template.Content <= other.Template.Content
		case FilterOperatorContains:
			if "" == strings.TrimSpace(other.Template.Content) {
				return true
			}
			return strings.Contains(value.Template.Content, other.Template.Content)
		case FilterOperatorDoesNotContain:
			if "" == strings.TrimSpace(other.Template.Content) {
				return true
			}
			return !strings.Contains(value.Template.Content, other.Template.Content)
		case FilterOperatorStartsWith:
			if "" == strings.TrimSpace(other.Template.Content) {
				return true
			}
			return strings.HasPrefix(value.Template.Content, other.Template.Content)
		case FilterOperatorEndsWith:
			if "" == strings.TrimSpace(other.Template.Content) {
				return true
			}
			return strings.HasSuffix(value.Template.Content, other.Template.Content)
		case FilterOperatorIsEmpty:
			return "" == strings.TrimSpace(value.Template.Content)
		case FilterOperatorIsNotEmpty:
			return "" != strings.TrimSpace(value.Template.Content)
		}
	}
	return true
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

type TableColumn struct {
	ID     string      `json:"id"`     // 列 ID
	Name   string      `json:"name"`   // 列名
	Type   KeyType     `json:"type"`   // 列类型
	Icon   string      `json:"icon"`   // 列图标
	Wrap   bool        `json:"wrap"`   // 是否换行
	Hidden bool        `json:"hidden"` // 是否隐藏
	Width  string      `json:"width"`  // 列宽度
	Calc   *ColumnCalc `json:"calc"`   // 计算

	// 以下是某些列类型的特有属性

	Options      []*KeySelectOption `json:"options,omitempty"` // 选项列表
	NumberFormat NumberFormat       `json:"numberFormat"`      // 列数字格式化
	Template     string             `json:"template"`          // 模板内容
}

type TableCell struct {
	ID        string  `json:"id"`
	Value     *Value  `json:"value"`
	ValueType KeyType `json:"valueType"`
	Color     string  `json:"color"`
	BgColor   string  `json:"bgColor"`
}

type TableRow struct {
	ID    string       `json:"id"`
	Cells []*TableCell `json:"cells"`
}

func (row *TableRow) GetBlockValue() (ret *Value) {
	for _, cell := range row.Cells {
		if KeyTypeBlock == cell.ValueType {
			ret = cell.Value
			break
		}
	}
	return
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
		block := table.Rows[i].GetBlockValue()
		if !block.IsInitialized && nil != block.Block && "" == block.Block.Content && block.IsDetached {
			return false
		}

		for _, colIndexSort := range colIndexSorts {
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
		block := row.GetBlockValue()
		if !block.IsInitialized && nil != block.Block && "" == block.Block.Content && block.IsDetached {
			rows = append(rows, row)
			continue
		}

		pass := true
		for j, index := range colIndexes {
			operator := table.Filters[j].Operator

			if nil == row.Cells[index].Value {
				if FilterOperatorIsNotEmpty == operator {
					pass = false
				} else if FilterOperatorIsEmpty == operator {
					pass = true
					break
				}

				if KeyTypeText != row.Cells[index].ValueType {
					pass = false
				}
				break
			}

			if !row.Cells[index].Value.CompareOperator(table.Filters[j].Value, operator) {
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
		case KeyTypeBlock:
			table.calcColBlock(col, i)
		case KeyTypeText:
			table.calcColText(col, i)
		case KeyTypeNumber:
			table.calcColNumber(col, i)
		case KeyTypeDate:
			table.calcColDate(col, i)
		case KeyTypeSelect:
			table.calcColSelect(col, i)
		case KeyTypeMSelect:
			table.calcColMSelect(col, i)
		case KeyTypeURL:
			table.calcColURL(col, i)
		case KeyTypeEmail:
			table.calcColEmail(col, i)
		case KeyTypePhone:
			table.calcColPhone(col, i)
		case KeyTypeMAsset:
			table.calcColMAsset(col, i)
		case KeyTypeTemplate:
			table.calcColTemplate(col, i)
		case KeyTypeCreated:
			table.calcColCreated(col, i)
		case KeyTypeUpdated:
			table.calcColUpdated(col, i)
		}
	}
}

func (table *Table) calcColTemplate(col *TableColumn, colIndex int) {
	switch col.Calc.Operator {
	case CalcOperatorCountAll:
		col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(len(table.Rows)), NumberFormatNone)}
	case CalcOperatorCountValues:
		countValues := 0
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Template && "" != row.Cells[colIndex].Value.Template.Content {
				countValues++
			}
		}
		col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(countValues), NumberFormatNone)}
	case CalcOperatorCountUniqueValues:
		countUniqueValues := 0
		uniqueValues := map[string]bool{}
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Template && "" != row.Cells[colIndex].Value.Template.Content {
				if !uniqueValues[row.Cells[colIndex].Value.Template.Content] {
					uniqueValues[row.Cells[colIndex].Value.Template.Content] = true
					countUniqueValues++
				}
			}
		}
		col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(countUniqueValues), NumberFormatNone)}
	case CalcOperatorCountEmpty:
		countEmpty := 0
		for _, row := range table.Rows {
			if nil == row.Cells[colIndex] || nil == row.Cells[colIndex].Value || nil == row.Cells[colIndex].Value.Template || "" == row.Cells[colIndex].Value.Template.Content {
				countEmpty++
			}
		}
		col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(countEmpty), NumberFormatNone)}
	case CalcOperatorCountNotEmpty:
		countNotEmpty := 0
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Template && "" != row.Cells[colIndex].Value.Template.Content {
				countNotEmpty++
			}
		}
		col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(countNotEmpty), NumberFormatNone)}
	case CalcOperatorPercentEmpty:
		countEmpty := 0
		for _, row := range table.Rows {
			if nil == row.Cells[colIndex] || nil == row.Cells[colIndex].Value || nil == row.Cells[colIndex].Value.Template || "" == row.Cells[colIndex].Value.Template.Content {
				countEmpty++
			}
		}
		if 0 < len(table.Rows) {
			col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(countEmpty)/float64(len(table.Rows)), NumberFormatPercent)}
		}
	case CalcOperatorPercentNotEmpty:
		countNotEmpty := 0
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Template && "" != row.Cells[colIndex].Value.Template.Content {
				countNotEmpty++
			}
		}
		if 0 < len(table.Rows) {
			col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(countNotEmpty)/float64(len(table.Rows)), NumberFormatPercent)}
		}
	case CalcOperatorSum:
		sum := 0.0
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Template && "" != row.Cells[colIndex].Value.Template.Content {
				val, _ := strconv.ParseFloat(row.Cells[colIndex].Value.Template.Content, 64)
				sum += val
			}
		}
		col.Calc.Result = &Value{Number: NewFormattedValueNumber(sum, col.NumberFormat)}
	case CalcOperatorAverage:
		sum := 0.0
		count := 0
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Template && "" != row.Cells[colIndex].Value.Template.Content {
				val, _ := strconv.ParseFloat(row.Cells[colIndex].Value.Template.Content, 64)
				sum += val
				count++
			}
		}
		if 0 != count {
			col.Calc.Result = &Value{Number: NewFormattedValueNumber(sum/float64(count), col.NumberFormat)}
		}
	case CalcOperatorMedian:
		values := []float64{}
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Template && "" != row.Cells[colIndex].Value.Template.Content {
				val, _ := strconv.ParseFloat(row.Cells[colIndex].Value.Template.Content, 64)
				values = append(values, val)
			}
		}
		sort.Float64s(values)
		if len(values) > 0 {
			if len(values)%2 == 0 {
				col.Calc.Result = &Value{Number: NewFormattedValueNumber((values[len(values)/2-1]+values[len(values)/2])/2, col.NumberFormat)}
			} else {
				col.Calc.Result = &Value{Number: NewFormattedValueNumber(values[len(values)/2], col.NumberFormat)}
			}
		}
	case CalcOperatorMin:
		minVal := math.MaxFloat64
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Template && "" != row.Cells[colIndex].Value.Template.Content {
				val, _ := strconv.ParseFloat(row.Cells[colIndex].Value.Template.Content, 64)
				if val < minVal {
					minVal = val
				}
			}
		}
		if math.MaxFloat64 != minVal {
			col.Calc.Result = &Value{Number: NewFormattedValueNumber(minVal, col.NumberFormat)}
		}
	case CalcOperatorMax:
		maxVal := -math.MaxFloat64
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Template && "" != row.Cells[colIndex].Value.Template.Content {
				val, _ := strconv.ParseFloat(row.Cells[colIndex].Value.Template.Content, 64)
				if val > maxVal {
					maxVal = val
				}
			}
		}
		if -math.MaxFloat64 != maxVal {
			col.Calc.Result = &Value{Number: NewFormattedValueNumber(maxVal, col.NumberFormat)}
		}
	case CalcOperatorRange:
		minVal := math.MaxFloat64
		maxVal := -math.MaxFloat64
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Template && "" != row.Cells[colIndex].Value.Template.Content {
				val, _ := strconv.ParseFloat(row.Cells[colIndex].Value.Template.Content, 64)
				if val < minVal {
					minVal = val
				}
				if val > maxVal {
					maxVal = val
				}
			}
		}
		if math.MaxFloat64 != minVal && -math.MaxFloat64 != maxVal {
			col.Calc.Result = &Value{Number: NewFormattedValueNumber(maxVal-minVal, col.NumberFormat)}
		}
	}
}

func (table *Table) calcColMAsset(col *TableColumn, colIndex int) {
	switch col.Calc.Operator {
	case CalcOperatorCountAll:
		col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(len(table.Rows)), NumberFormatNone)}
	case CalcOperatorCountValues:
		countValues := 0
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.MAsset && 0 < len(row.Cells[colIndex].Value.MAsset) {
				countValues += len(row.Cells[colIndex].Value.MAsset)
			}
		}
		col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(countValues), NumberFormatNone)}
	case CalcOperatorCountUniqueValues:
		countUniqueValues := 0
		uniqueValues := map[string]bool{}
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.MAsset && 0 < len(row.Cells[colIndex].Value.MAsset) {
				for _, sel := range row.Cells[colIndex].Value.MAsset {
					if _, ok := uniqueValues[sel.Content]; !ok {
						uniqueValues[sel.Content] = true
						countUniqueValues++
					}
				}
			}
		}
		col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(countUniqueValues), NumberFormatNone)}
	case CalcOperatorCountEmpty:
		countEmpty := 0
		for _, row := range table.Rows {
			if nil == row.Cells[colIndex] || nil == row.Cells[colIndex].Value || nil == row.Cells[colIndex].Value.MAsset || 0 == len(row.Cells[colIndex].Value.MAsset) {
				countEmpty++
			}
		}
		col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(countEmpty), NumberFormatNone)}
	case CalcOperatorCountNotEmpty:
		countNotEmpty := 0
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.MAsset && 0 < len(row.Cells[colIndex].Value.MAsset) {
				countNotEmpty++
			}
		}
		col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(countNotEmpty), NumberFormatNone)}
	case CalcOperatorPercentEmpty:
		countEmpty := 0
		for _, row := range table.Rows {
			if nil == row.Cells[colIndex] || nil == row.Cells[colIndex].Value || nil == row.Cells[colIndex].Value.MAsset || 0 == len(row.Cells[colIndex].Value.MAsset) {
				countEmpty++
			}
		}
		if 0 < len(table.Rows) {
			col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(countEmpty)/float64(len(table.Rows)), NumberFormatPercent)}
		}
	case CalcOperatorPercentNotEmpty:
		countNotEmpty := 0
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.MAsset && 0 < len(row.Cells[colIndex].Value.MAsset) {
				countNotEmpty++
			}
		}
		if 0 < len(table.Rows) {
			col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(countNotEmpty)/float64(len(table.Rows)), NumberFormatPercent)}
		}
	}
}

func (table *Table) calcColMSelect(col *TableColumn, colIndex int) {
	switch col.Calc.Operator {
	case CalcOperatorCountAll:
		col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(len(table.Rows)), NumberFormatNone)}
	case CalcOperatorCountValues:
		countValues := 0
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.MSelect && 0 < len(row.Cells[colIndex].Value.MSelect) {
				countValues += len(row.Cells[colIndex].Value.MSelect)
			}
		}
		col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(countValues), NumberFormatNone)}
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
		col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(countUniqueValues), NumberFormatNone)}
	case CalcOperatorCountEmpty:
		countEmpty := 0
		for _, row := range table.Rows {
			if nil == row.Cells[colIndex] || nil == row.Cells[colIndex].Value || nil == row.Cells[colIndex].Value.MSelect || 0 == len(row.Cells[colIndex].Value.MSelect) {
				countEmpty++
			}
		}
		col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(countEmpty), NumberFormatNone)}
	case CalcOperatorCountNotEmpty:
		countNotEmpty := 0
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.MSelect && 0 < len(row.Cells[colIndex].Value.MSelect) {
				countNotEmpty++
			}
		}
		col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(countNotEmpty), NumberFormatNone)}
	case CalcOperatorPercentEmpty:
		countEmpty := 0
		for _, row := range table.Rows {
			if nil == row.Cells[colIndex] || nil == row.Cells[colIndex].Value || nil == row.Cells[colIndex].Value.MSelect || 0 == len(row.Cells[colIndex].Value.MSelect) {
				countEmpty++
			}
		}
		if 0 < len(table.Rows) {
			col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(countEmpty)/float64(len(table.Rows)), NumberFormatPercent)}
		}
	case CalcOperatorPercentNotEmpty:
		countNotEmpty := 0
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.MSelect && 0 < len(row.Cells[colIndex].Value.MSelect) {
				countNotEmpty++
			}
		}
		if 0 < len(table.Rows) {
			col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(countNotEmpty)/float64(len(table.Rows)), NumberFormatPercent)}
		}
	}
}

func (table *Table) calcColSelect(col *TableColumn, colIndex int) {
	switch col.Calc.Operator {
	case CalcOperatorCountAll:
		col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(len(table.Rows)), NumberFormatNone)}
	case CalcOperatorCountValues:
		countValues := 0
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.MSelect && 0 < len(row.Cells[colIndex].Value.MSelect) && nil != row.Cells[colIndex].Value.MSelect[0] && "" != row.Cells[colIndex].Value.MSelect[0].Content {
				countValues++
			}
		}
		col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(countValues), NumberFormatNone)}
	case CalcOperatorCountUniqueValues:
		countUniqueValues := 0
		uniqueValues := map[string]bool{}
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.MSelect && 0 < len(row.Cells[colIndex].Value.MSelect) && nil != row.Cells[colIndex].Value.MSelect[0] && "" != row.Cells[colIndex].Value.MSelect[0].Content {
				if _, ok := uniqueValues[row.Cells[colIndex].Value.MSelect[0].Content]; !ok {
					uniqueValues[row.Cells[colIndex].Value.MSelect[0].Content] = true
					countUniqueValues++
				}
			}
		}
		col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(countUniqueValues), NumberFormatNone)}
	case CalcOperatorCountEmpty:
		countEmpty := 0
		for _, row := range table.Rows {
			if nil == row.Cells[colIndex] || nil == row.Cells[colIndex].Value || nil == row.Cells[colIndex].Value.MSelect || 1 > len(row.Cells[colIndex].Value.MSelect) || nil == row.Cells[colIndex].Value.MSelect[0] || "" == row.Cells[colIndex].Value.MSelect[0].Content {
				countEmpty++
			}
		}
		col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(countEmpty), NumberFormatNone)}
	case CalcOperatorCountNotEmpty:
		countNotEmpty := 0
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.MSelect && 0 < len(row.Cells[colIndex].Value.MSelect) && nil != row.Cells[colIndex].Value.MSelect[0] && "" != row.Cells[colIndex].Value.MSelect[0].Content {
				countNotEmpty++
			}
		}
		col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(countNotEmpty), NumberFormatNone)}
	case CalcOperatorPercentEmpty:
		countEmpty := 0
		for _, row := range table.Rows {
			if nil == row.Cells[colIndex] || nil == row.Cells[colIndex].Value || nil == row.Cells[colIndex].Value.MSelect || 1 > len(row.Cells[colIndex].Value.MSelect) || nil == row.Cells[colIndex].Value.MSelect[0] || "" == row.Cells[colIndex].Value.MSelect[0].Content {
				countEmpty++
			}
		}
		if 0 < len(table.Rows) {
			col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(countEmpty)/float64(len(table.Rows)), NumberFormatPercent)}
		}
	case CalcOperatorPercentNotEmpty:
		countNotEmpty := 0
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.MSelect && 0 < len(row.Cells[colIndex].Value.MSelect) && nil != row.Cells[colIndex].Value.MSelect[0] && "" != row.Cells[colIndex].Value.MSelect[0].Content {
				countNotEmpty++
			}
		}
		if 0 < len(table.Rows) {
			col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(countNotEmpty)/float64(len(table.Rows)), NumberFormatPercent)}
		}
	}
}

func (table *Table) calcColDate(col *TableColumn, colIndex int) {
	switch col.Calc.Operator {
	case CalcOperatorCountAll:
		col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(len(table.Rows)), NumberFormatNone)}
	case CalcOperatorCountValues:
		countValues := 0
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Date && row.Cells[colIndex].Value.Date.IsNotEmpty {
				countValues++
			}
		}
		col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(countValues), NumberFormatNone)}
	case CalcOperatorCountUniqueValues:
		countUniqueValues := 0
		uniqueValues := map[int64]bool{}
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Date && row.Cells[colIndex].Value.Date.IsNotEmpty {
				if _, ok := uniqueValues[row.Cells[colIndex].Value.Date.Content]; !ok {
					countUniqueValues++
					uniqueValues[row.Cells[colIndex].Value.Date.Content] = true
				}
			}
		}
		col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(countUniqueValues), NumberFormatNone)}
	case CalcOperatorCountEmpty:
		countEmpty := 0
		for _, row := range table.Rows {
			if nil == row.Cells[colIndex] || nil == row.Cells[colIndex].Value || nil == row.Cells[colIndex].Value.Date || !row.Cells[colIndex].Value.Date.IsNotEmpty {
				countEmpty++
			}
		}
		col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(countEmpty), NumberFormatNone)}
	case CalcOperatorCountNotEmpty:
		countNotEmpty := 0
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Date && row.Cells[colIndex].Value.Date.IsNotEmpty {
				countNotEmpty++
			}
		}
		col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(countNotEmpty), NumberFormatNone)}
	case CalcOperatorPercentEmpty:
		countEmpty := 0
		for _, row := range table.Rows {
			if nil == row.Cells[colIndex] || nil == row.Cells[colIndex].Value || nil == row.Cells[colIndex].Value.Date || !row.Cells[colIndex].Value.Date.IsNotEmpty {
				countEmpty++
			}
		}
		if 0 < len(table.Rows) {
			col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(countEmpty)/float64(len(table.Rows)), NumberFormatPercent)}
		}
	case CalcOperatorPercentNotEmpty:
		countNotEmpty := 0
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Date && row.Cells[colIndex].Value.Date.IsNotEmpty {
				countNotEmpty++
			}
		}
		if 0 < len(table.Rows) {
			col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(countNotEmpty)/float64(len(table.Rows)), NumberFormatPercent)}
		}
	case CalcOperatorEarliest:
		earliest := int64(0)
		var isNotTime bool
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Date && row.Cells[colIndex].Value.Date.IsNotEmpty {
				if 0 == earliest || earliest > row.Cells[colIndex].Value.Date.Content {
					earliest = row.Cells[colIndex].Value.Date.Content
					isNotTime = row.Cells[colIndex].Value.Date.IsNotTime
				}
			}
		}
		if 0 != earliest {
			col.Calc.Result = &Value{Date: NewFormattedValueDate(earliest, 0, DateFormatNone, isNotTime)}
		}
	case CalcOperatorLatest:
		latest := int64(0)
		var isNotTime bool
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Date && row.Cells[colIndex].Value.Date.IsNotEmpty {
				if 0 == latest || latest < row.Cells[colIndex].Value.Date.Content {
					latest = row.Cells[colIndex].Value.Date.Content
					isNotTime = row.Cells[colIndex].Value.Date.IsNotTime
				}
			}
		}
		if 0 != latest {
			col.Calc.Result = &Value{Date: NewFormattedValueDate(latest, 0, DateFormatNone, isNotTime)}
		}
	case CalcOperatorRange:
		earliest := int64(0)
		latest := int64(0)
		var isNotTime bool
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Date && row.Cells[colIndex].Value.Date.IsNotEmpty {
				if 0 == earliest || earliest > row.Cells[colIndex].Value.Date.Content {
					earliest = row.Cells[colIndex].Value.Date.Content
					isNotTime = row.Cells[colIndex].Value.Date.IsNotTime
				}
				if 0 == latest || latest < row.Cells[colIndex].Value.Date.Content {
					latest = row.Cells[colIndex].Value.Date.Content
					isNotTime = row.Cells[colIndex].Value.Date.IsNotTime
				}
			}
		}
		if 0 != earliest && 0 != latest {
			col.Calc.Result = &Value{Date: NewFormattedValueDate(earliest, latest, DateFormatDuration, isNotTime)}
		}
	}
}

func (table *Table) calcColNumber(col *TableColumn, colIndex int) {
	switch col.Calc.Operator {
	case CalcOperatorCountAll:
		col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(len(table.Rows)), NumberFormatNone)}
	case CalcOperatorCountValues:
		countValues := 0
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Number && row.Cells[colIndex].Value.Number.IsNotEmpty {
				countValues++
			}
		}
		col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(countValues), NumberFormatNone)}
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
		col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(countUniqueValues), NumberFormatNone)}
	case CalcOperatorCountEmpty:
		countEmpty := 0
		for _, row := range table.Rows {
			if nil == row.Cells[colIndex] || nil == row.Cells[colIndex].Value || nil == row.Cells[colIndex].Value.Number || !row.Cells[colIndex].Value.Number.IsNotEmpty {
				countEmpty++
			}
		}
		col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(countEmpty), NumberFormatNone)}
	case CalcOperatorCountNotEmpty:
		countNotEmpty := 0
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Number && row.Cells[colIndex].Value.Number.IsNotEmpty {
				countNotEmpty++
			}
		}
		col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(countNotEmpty), NumberFormatNone)}
	case CalcOperatorPercentEmpty:
		countEmpty := 0
		for _, row := range table.Rows {
			if nil == row.Cells[colIndex] || nil == row.Cells[colIndex].Value || nil == row.Cells[colIndex].Value.Number || !row.Cells[colIndex].Value.Number.IsNotEmpty {
				countEmpty++
			}
		}
		if 0 < len(table.Rows) {
			col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(countEmpty)/float64(len(table.Rows)), NumberFormatPercent)}
		}
	case CalcOperatorPercentNotEmpty:
		countNotEmpty := 0
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Number && row.Cells[colIndex].Value.Number.IsNotEmpty {
				countNotEmpty++
			}
		}
		if 0 < len(table.Rows) {
			col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(countNotEmpty)/float64(len(table.Rows)), NumberFormatPercent)}
		}
	case CalcOperatorSum:
		sum := 0.0
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Number && row.Cells[colIndex].Value.Number.IsNotEmpty {
				sum += row.Cells[colIndex].Value.Number.Content
			}
		}
		col.Calc.Result = &Value{Number: NewFormattedValueNumber(sum, col.NumberFormat)}
	case CalcOperatorAverage:
		sum := 0.0
		count := 0
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Number && row.Cells[colIndex].Value.Number.IsNotEmpty {
				sum += row.Cells[colIndex].Value.Number.Content
				count++
			}
		}
		if 0 != count {
			col.Calc.Result = &Value{Number: NewFormattedValueNumber(sum/float64(count), col.NumberFormat)}
		}
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
				col.Calc.Result = &Value{Number: NewFormattedValueNumber((values[len(values)/2-1]+values[len(values)/2])/2, col.NumberFormat)}
			} else {
				col.Calc.Result = &Value{Number: NewFormattedValueNumber(values[len(values)/2], col.NumberFormat)}
			}
		}
	case CalcOperatorMin:
		minVal := math.MaxFloat64
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Number && row.Cells[colIndex].Value.Number.IsNotEmpty {
				if row.Cells[colIndex].Value.Number.Content < minVal {
					minVal = row.Cells[colIndex].Value.Number.Content
				}
			}
		}
		if math.MaxFloat64 != minVal {
			col.Calc.Result = &Value{Number: NewFormattedValueNumber(minVal, col.NumberFormat)}
		}
	case CalcOperatorMax:
		maxVal := -math.MaxFloat64
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Number && row.Cells[colIndex].Value.Number.IsNotEmpty {
				if row.Cells[colIndex].Value.Number.Content > maxVal {
					maxVal = row.Cells[colIndex].Value.Number.Content
				}
			}
		}
		if -math.MaxFloat64 != maxVal {
			col.Calc.Result = &Value{Number: NewFormattedValueNumber(maxVal, col.NumberFormat)}
		}
	case CalcOperatorRange:
		minVal := math.MaxFloat64
		maxVal := -math.MaxFloat64
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Number && row.Cells[colIndex].Value.Number.IsNotEmpty {
				if row.Cells[colIndex].Value.Number.Content < minVal {
					minVal = row.Cells[colIndex].Value.Number.Content
				}
				if row.Cells[colIndex].Value.Number.Content > maxVal {
					maxVal = row.Cells[colIndex].Value.Number.Content
				}
			}
		}
		if math.MaxFloat64 != minVal && -math.MaxFloat64 != maxVal {
			col.Calc.Result = &Value{Number: NewFormattedValueNumber(maxVal-minVal, col.NumberFormat)}
		}
	}
}

func (table *Table) calcColText(col *TableColumn, colIndex int) {
	switch col.Calc.Operator {
	case CalcOperatorCountAll:
		col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(len(table.Rows)), NumberFormatNone)}
	case CalcOperatorCountValues:
		countValues := 0
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Text && "" != row.Cells[colIndex].Value.Text.Content {
				countValues++
			}
		}
		col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(countValues), NumberFormatNone)}
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
		col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(countUniqueValues), NumberFormatNone)}
	case CalcOperatorCountEmpty:
		countEmpty := 0
		for _, row := range table.Rows {
			if nil == row.Cells[colIndex] || nil == row.Cells[colIndex].Value || nil == row.Cells[colIndex].Value.Text || "" == row.Cells[colIndex].Value.Text.Content {
				countEmpty++
			}
		}
		col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(countEmpty), NumberFormatNone)}
	case CalcOperatorCountNotEmpty:
		countNotEmpty := 0
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Text && "" != row.Cells[colIndex].Value.Text.Content {
				countNotEmpty++
			}
		}
		col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(countNotEmpty), NumberFormatNone)}
	case CalcOperatorPercentEmpty:
		countEmpty := 0
		for _, row := range table.Rows {
			if nil == row.Cells[colIndex] || nil == row.Cells[colIndex].Value || nil == row.Cells[colIndex].Value.Text || "" == row.Cells[colIndex].Value.Text.Content {
				countEmpty++
			}
		}
		if 0 < len(table.Rows) {
			col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(countEmpty)/float64(len(table.Rows)), NumberFormatPercent)}
		}
	case CalcOperatorPercentNotEmpty:
		countNotEmpty := 0
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Text && "" != row.Cells[colIndex].Value.Text.Content {
				countNotEmpty++
			}
		}
		if 0 < len(table.Rows) {
			col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(countNotEmpty)/float64(len(table.Rows)), NumberFormatPercent)}
		}
	}
}

func (table *Table) calcColURL(col *TableColumn, colIndex int) {
	switch col.Calc.Operator {
	case CalcOperatorCountAll:
		col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(len(table.Rows)), NumberFormatNone)}
	case CalcOperatorCountValues:
		countValues := 0
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.URL && "" != row.Cells[colIndex].Value.URL.Content {
				countValues++
			}
		}
		col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(countValues), NumberFormatNone)}
	case CalcOperatorCountUniqueValues:
		countUniqueValues := 0
		uniqueValues := map[string]bool{}
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.URL && "" != row.Cells[colIndex].Value.URL.Content {
				if !uniqueValues[row.Cells[colIndex].Value.URL.Content] {
					uniqueValues[row.Cells[colIndex].Value.URL.Content] = true
					countUniqueValues++
				}
			}
		}
		col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(countUniqueValues), NumberFormatNone)}
	case CalcOperatorCountEmpty:
		countEmpty := 0
		for _, row := range table.Rows {
			if nil == row.Cells[colIndex] || nil == row.Cells[colIndex].Value || nil == row.Cells[colIndex].Value.URL || "" == row.Cells[colIndex].Value.URL.Content {
				countEmpty++
			}
		}
		col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(countEmpty), NumberFormatNone)}
	case CalcOperatorCountNotEmpty:
		countNotEmpty := 0
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.URL && "" != row.Cells[colIndex].Value.URL.Content {
				countNotEmpty++
			}
		}
		col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(countNotEmpty), NumberFormatNone)}
	case CalcOperatorPercentEmpty:
		countEmpty := 0
		for _, row := range table.Rows {
			if nil == row.Cells[colIndex] || nil == row.Cells[colIndex].Value || nil == row.Cells[colIndex].Value.URL || "" == row.Cells[colIndex].Value.URL.Content {
				countEmpty++
			}
		}
		if 0 < len(table.Rows) {
			col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(countEmpty)/float64(len(table.Rows)), NumberFormatPercent)}
		}
	case CalcOperatorPercentNotEmpty:
		countNotEmpty := 0
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.URL && "" != row.Cells[colIndex].Value.URL.Content {
				countNotEmpty++
			}
		}
		if 0 < len(table.Rows) {
			col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(countNotEmpty)/float64(len(table.Rows)), NumberFormatPercent)}
		}
	}
}

func (table *Table) calcColEmail(col *TableColumn, colIndex int) {
	switch col.Calc.Operator {
	case CalcOperatorCountAll:
		col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(len(table.Rows)), NumberFormatNone)}
	case CalcOperatorCountValues:
		countValues := 0
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Email && "" != row.Cells[colIndex].Value.Email.Content {
				countValues++
			}
		}
		col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(countValues), NumberFormatNone)}
	case CalcOperatorCountUniqueValues:
		countUniqueValues := 0
		uniqueValues := map[string]bool{}
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Email && "" != row.Cells[colIndex].Value.Email.Content {
				if !uniqueValues[row.Cells[colIndex].Value.Email.Content] {
					uniqueValues[row.Cells[colIndex].Value.Email.Content] = true
					countUniqueValues++
				}
			}
		}
		col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(countUniqueValues), NumberFormatNone)}
	case CalcOperatorCountEmpty:
		countEmpty := 0
		for _, row := range table.Rows {
			if nil == row.Cells[colIndex] || nil == row.Cells[colIndex].Value || nil == row.Cells[colIndex].Value.Email || "" == row.Cells[colIndex].Value.Email.Content {
				countEmpty++
			}
		}
		col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(countEmpty), NumberFormatNone)}
	case CalcOperatorCountNotEmpty:
		countNotEmpty := 0
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Email && "" != row.Cells[colIndex].Value.Email.Content {
				countNotEmpty++
			}
		}
		col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(countNotEmpty), NumberFormatNone)}
	case CalcOperatorPercentEmpty:
		countEmpty := 0
		for _, row := range table.Rows {
			if nil == row.Cells[colIndex] || nil == row.Cells[colIndex].Value || nil == row.Cells[colIndex].Value.Email || "" == row.Cells[colIndex].Value.Email.Content {
				countEmpty++
			}
		}
		if 0 < len(table.Rows) {
			col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(countEmpty)/float64(len(table.Rows)), NumberFormatPercent)}
		}
	case CalcOperatorPercentNotEmpty:
		countNotEmpty := 0
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Email && "" != row.Cells[colIndex].Value.Email.Content {
				countNotEmpty++
			}
		}
		if 0 < len(table.Rows) {
			col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(countNotEmpty)/float64(len(table.Rows)), NumberFormatPercent)}
		}
	}
}

func (table *Table) calcColPhone(col *TableColumn, colIndex int) {
	switch col.Calc.Operator {
	case CalcOperatorCountAll:
		col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(len(table.Rows)), NumberFormatNone)}
	case CalcOperatorCountValues:
		countValues := 0
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Phone && "" != row.Cells[colIndex].Value.Phone.Content {
				countValues++
			}
		}
		col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(countValues), NumberFormatNone)}
	case CalcOperatorCountUniqueValues:
		countUniqueValues := 0
		uniqueValues := map[string]bool{}
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Phone && "" != row.Cells[colIndex].Value.Phone.Content {
				if !uniqueValues[row.Cells[colIndex].Value.Phone.Content] {
					uniqueValues[row.Cells[colIndex].Value.Phone.Content] = true
					countUniqueValues++
				}
			}
		}
		col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(countUniqueValues), NumberFormatNone)}
	case CalcOperatorCountEmpty:
		countEmpty := 0
		for _, row := range table.Rows {
			if nil == row.Cells[colIndex] || nil == row.Cells[colIndex].Value || nil == row.Cells[colIndex].Value.Phone || "" == row.Cells[colIndex].Value.Phone.Content {
				countEmpty++
			}
		}
		col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(countEmpty), NumberFormatNone)}
	case CalcOperatorCountNotEmpty:
		countNotEmpty := 0
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Phone && "" != row.Cells[colIndex].Value.Phone.Content {
				countNotEmpty++
			}
		}
		col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(countNotEmpty), NumberFormatNone)}
	case CalcOperatorPercentEmpty:
		countEmpty := 0
		for _, row := range table.Rows {
			if nil == row.Cells[colIndex] || nil == row.Cells[colIndex].Value || nil == row.Cells[colIndex].Value.Phone || "" == row.Cells[colIndex].Value.Phone.Content {
				countEmpty++
			}
		}
		if 0 < len(table.Rows) {
			col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(countEmpty)/float64(len(table.Rows)), NumberFormatPercent)}
		}
	case CalcOperatorPercentNotEmpty:
		countNotEmpty := 0
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Phone && "" != row.Cells[colIndex].Value.Phone.Content {
				countNotEmpty++
			}
		}
		if 0 < len(table.Rows) {
			col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(countNotEmpty)/float64(len(table.Rows)), NumberFormatPercent)}
		}
	}
}

func (table *Table) calcColBlock(col *TableColumn, colIndex int) {
	switch col.Calc.Operator {
	case CalcOperatorCountAll:
		col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(len(table.Rows)), NumberFormatNone)}
	case CalcOperatorCountValues:
		countValues := 0
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Block && "" != row.Cells[colIndex].Value.Block.Content {
				countValues++
			}
		}
		col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(countValues), NumberFormatNone)}
	case CalcOperatorCountUniqueValues:
		countUniqueValues := 0
		uniqueValues := map[string]bool{}
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Block && "" != row.Cells[colIndex].Value.Block.Content {
				if !uniqueValues[row.Cells[colIndex].Value.Block.Content] {
					uniqueValues[row.Cells[colIndex].Value.Block.Content] = true
					countUniqueValues++
				}
			}
		}
		col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(countUniqueValues), NumberFormatNone)}
	case CalcOperatorCountEmpty:
		countEmpty := 0
		for _, row := range table.Rows {
			if nil == row.Cells[colIndex] || nil == row.Cells[colIndex].Value || nil == row.Cells[colIndex].Value.Block || "" == row.Cells[colIndex].Value.Block.Content {
				countEmpty++
			}
		}
		col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(countEmpty), NumberFormatNone)}
	case CalcOperatorCountNotEmpty:
		countNotEmpty := 0
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Block && "" != row.Cells[colIndex].Value.Block.Content {
				countNotEmpty++
			}
		}
		col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(countNotEmpty), NumberFormatNone)}
	case CalcOperatorPercentEmpty:
		countEmpty := 0
		for _, row := range table.Rows {
			if nil == row.Cells[colIndex] || nil == row.Cells[colIndex].Value || nil == row.Cells[colIndex].Value.Block || "" == row.Cells[colIndex].Value.Block.Content {
				countEmpty++
			}
		}
		if 0 < len(table.Rows) {
			col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(countEmpty)/float64(len(table.Rows)), NumberFormatPercent)}
		}
	case CalcOperatorPercentNotEmpty:
		countNotEmpty := 0
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Block && "" != row.Cells[colIndex].Value.Block.Content {
				countNotEmpty++
			}
		}
		if 0 < len(table.Rows) {
			col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(countNotEmpty)/float64(len(table.Rows)), NumberFormatPercent)}
		}
	}
}

func (table *Table) calcColCreated(col *TableColumn, colIndex int) {
	switch col.Calc.Operator {
	case CalcOperatorCountAll:
		col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(len(table.Rows)), NumberFormatNone)}
	case CalcOperatorCountValues:
		countValues := 0
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Created {
				countValues++
			}
		}
		col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(countValues), NumberFormatNone)}
	case CalcOperatorCountUniqueValues:
		countUniqueValues := 0
		uniqueValues := map[int64]bool{}
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Created {
				if _, ok := uniqueValues[row.Cells[colIndex].Value.Created.Content]; !ok {
					countUniqueValues++
					uniqueValues[row.Cells[colIndex].Value.Created.Content] = true
				}
			}
		}
		col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(countUniqueValues), NumberFormatNone)}
	case CalcOperatorCountEmpty:
		countEmpty := 0
		for _, row := range table.Rows {
			if nil == row.Cells[colIndex] || nil == row.Cells[colIndex].Value || nil == row.Cells[colIndex].Value.Created {
				countEmpty++
			}
		}
		col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(countEmpty), NumberFormatNone)}
	case CalcOperatorCountNotEmpty:
		countNotEmpty := 0
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Created {
				countNotEmpty++
			}
		}
		col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(countNotEmpty), NumberFormatNone)}
	case CalcOperatorPercentEmpty:
		countEmpty := 0
		for _, row := range table.Rows {
			if nil == row.Cells[colIndex] || nil == row.Cells[colIndex].Value || nil == row.Cells[colIndex].Value.Created {
				countEmpty++
			}
		}
		if 0 < len(table.Rows) {
			col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(countEmpty)/float64(len(table.Rows)), NumberFormatPercent)}
		}
	case CalcOperatorPercentNotEmpty:
		countNotEmpty := 0
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Created {
				countNotEmpty++
			}
		}
		if 0 < len(table.Rows) {
			col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(countNotEmpty)/float64(len(table.Rows)), NumberFormatPercent)}
		}
	case CalcOperatorEarliest:
		earliest := int64(0)
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Created {
				if 0 == earliest || earliest > row.Cells[colIndex].Value.Created.Content {
					earliest = row.Cells[colIndex].Value.Created.Content
				}
			}
		}
		if 0 != earliest {
			col.Calc.Result = &Value{Created: NewFormattedValueCreated(earliest, 0, CreatedFormatNone)}
		}
	case CalcOperatorLatest:
		latest := int64(0)
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Created {
				if 0 == latest || latest < row.Cells[colIndex].Value.Created.Content {
					latest = row.Cells[colIndex].Value.Created.Content
				}
			}
		}
		if 0 != latest {
			col.Calc.Result = &Value{Created: NewFormattedValueCreated(latest, 0, CreatedFormatNone)}
		}
	case CalcOperatorRange:
		earliest := int64(0)
		latest := int64(0)
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Created {
				if 0 == earliest || earliest > row.Cells[colIndex].Value.Created.Content {
					earliest = row.Cells[colIndex].Value.Created.Content
				}
				if 0 == latest || latest < row.Cells[colIndex].Value.Created.Content {
					latest = row.Cells[colIndex].Value.Created.Content
				}
			}
		}
		if 0 != earliest && 0 != latest {
			col.Calc.Result = &Value{Created: NewFormattedValueCreated(earliest, latest, CreatedFormatDuration)}
		}
	}
}

func (table *Table) calcColUpdated(col *TableColumn, colIndex int) {
	switch col.Calc.Operator {
	case CalcOperatorCountAll:
		col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(len(table.Rows)), NumberFormatNone)}
	case CalcOperatorCountValues:
		countValues := 0
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Updated && row.Cells[colIndex].Value.Updated.IsNotEmpty {
				countValues++
			}
		}
		col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(countValues), NumberFormatNone)}
	case CalcOperatorCountUniqueValues:
		countUniqueValues := 0
		uniqueValues := map[int64]bool{}
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Updated && row.Cells[colIndex].Value.Updated.IsNotEmpty {
				if _, ok := uniqueValues[row.Cells[colIndex].Value.Updated.Content]; !ok {
					countUniqueValues++
					uniqueValues[row.Cells[colIndex].Value.Updated.Content] = true
				}
			}
		}
		col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(countUniqueValues), NumberFormatNone)}
	case CalcOperatorCountEmpty:
		countEmpty := 0
		for _, row := range table.Rows {
			if nil == row.Cells[colIndex] || nil == row.Cells[colIndex].Value || nil == row.Cells[colIndex].Value.Updated || !row.Cells[colIndex].Value.Updated.IsNotEmpty {
				countEmpty++
			}
		}
		col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(countEmpty), NumberFormatNone)}
	case CalcOperatorCountNotEmpty:
		countNotEmpty := 0
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Updated && row.Cells[colIndex].Value.Updated.IsNotEmpty {
				countNotEmpty++
			}
		}
		col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(countNotEmpty), NumberFormatNone)}
	case CalcOperatorPercentEmpty:
		countEmpty := 0
		for _, row := range table.Rows {
			if nil == row.Cells[colIndex] || nil == row.Cells[colIndex].Value || nil == row.Cells[colIndex].Value.Updated || !row.Cells[colIndex].Value.Updated.IsNotEmpty {
				countEmpty++
			}
		}
		if 0 < len(table.Rows) {
			col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(countEmpty)/float64(len(table.Rows)), NumberFormatPercent)}
		}
	case CalcOperatorPercentNotEmpty:
		countNotEmpty := 0
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Updated && row.Cells[colIndex].Value.Updated.IsNotEmpty {
				countNotEmpty++
			}
		}
		if 0 < len(table.Rows) {
			col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(countNotEmpty)/float64(len(table.Rows)), NumberFormatPercent)}
		}
	case CalcOperatorEarliest:
		earliest := int64(0)
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Updated && row.Cells[colIndex].Value.Updated.IsNotEmpty {
				if 0 == earliest || earliest > row.Cells[colIndex].Value.Updated.Content {
					earliest = row.Cells[colIndex].Value.Updated.Content
				}
			}
		}
		if 0 != earliest {
			col.Calc.Result = &Value{Updated: NewFormattedValueUpdated(earliest, 0, UpdatedFormatNone)}
		}
	case CalcOperatorLatest:
		latest := int64(0)
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Updated && row.Cells[colIndex].Value.Updated.IsNotEmpty {
				if 0 == latest || latest < row.Cells[colIndex].Value.Updated.Content {
					latest = row.Cells[colIndex].Value.Updated.Content
				}
			}
		}
		if 0 != latest {
			col.Calc.Result = &Value{Updated: NewFormattedValueUpdated(latest, 0, UpdatedFormatNone)}
		}
	case CalcOperatorRange:
		earliest := int64(0)
		latest := int64(0)
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Updated && row.Cells[colIndex].Value.Updated.IsNotEmpty {
				if 0 == earliest || earliest > row.Cells[colIndex].Value.Updated.Content {
					earliest = row.Cells[colIndex].Value.Updated.Content
				}
				if 0 == latest || latest < row.Cells[colIndex].Value.Updated.Content {
					latest = row.Cells[colIndex].Value.Updated.Content
				}
			}
		}
		if 0 != earliest && 0 != latest {
			col.Calc.Result = &Value{Updated: NewFormattedValueUpdated(earliest, latest, UpdatedFormatDuration)}
		}
	}
}
