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
	"sort"
)

// LayoutTable 描述了表格布局的结构。
type LayoutTable struct {
	Spec int    `json:"spec"` // 布局格式版本
	ID   string `json:"id"`   // 布局 ID

	Columns  []*ViewTableColumn `json:"columns"`  // 表格列
	RowIDs   []string           `json:"rowIds"`   // 行 ID，用于自定义排序
	Filters  []*ViewFilter      `json:"filters"`  // 过滤规则
	Sorts    []*ViewSort        `json:"sorts"`    // 排序规则
	PageSize int                `json:"pageSize"` // 每页行数
}

type ViewTableColumn struct {
	ID string `json:"id"` // 列 ID

	Wrap   bool        `json:"wrap"`           // 是否换行
	Hidden bool        `json:"hidden"`         // 是否隐藏
	Pin    bool        `json:"pin"`            // 是否固定
	Width  string      `json:"width"`          // 列宽度
	Calc   *ColumnCalc `json:"calc,omitempty"` // 计算
}

// Table 描述了表格实例的结构。
type Table struct {
	ID               string         `json:"id"`               // 表格布局 ID
	Icon             string         `json:"icon"`             // 表格图标
	Name             string         `json:"name"`             // 表格名称
	HideAttrViewName bool           `json:"hideAttrViewName"` // 是否隐藏属性视图名称
	Filters          []*ViewFilter  `json:"filters"`          // 过滤规则
	Sorts            []*ViewSort    `json:"sorts"`            // 排序规则
	Columns          []*TableColumn `json:"columns"`          // 表格列
	Rows             []*TableRow    `json:"rows"`             // 表格行
	RowCount         int            `json:"rowCount"`         // 表格总行数
	PageSize         int            `json:"pageSize"`         // 每页行数
}

type TableColumn struct {
	ID     string      `json:"id"`     // 列 ID
	Name   string      `json:"name"`   // 列名
	Type   KeyType     `json:"type"`   // 列类型
	Icon   string      `json:"icon"`   // 列图标
	Wrap   bool        `json:"wrap"`   // 是否换行
	Hidden bool        `json:"hidden"` // 是否隐藏
	Pin    bool        `json:"pin"`    // 是否固定
	Width  string      `json:"width"`  // 列宽度
	Calc   *ColumnCalc `json:"calc"`   // 计算

	// 以下是某些列类型的特有属性

	Options      []*SelectOption `json:"options,omitempty"`  // 选项列表
	NumberFormat NumberFormat    `json:"numberFormat"`       // 数字列格式化
	Template     string          `json:"template"`           // 模板列内容
	Relation     *Relation       `json:"relation,omitempty"` // 关联列
	Rollup       *Rollup         `json:"rollup,omitempty"`   // 汇总列
	Date         *Date           `json:"date,omitempty"`     // 日期设置
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

func (row *TableRow) GetValue(keyID string) (ret *Value) {
	for _, cell := range row.Cells {
		if nil != cell.Value && keyID == cell.Value.KeyID {
			ret = cell.Value
			break
		}
	}
	return
}

func (table *Table) GetColumn(id string) *TableColumn {
	for _, column := range table.Columns {
		if column.ID == id {
			return column
		}
	}
	return nil
}

func (table *Table) GetType() LayoutType {
	return LayoutTypeTable
}

func (table *Table) GetID() string {
	return table.ID
}

func (table *Table) SortRows(attrView *AttributeView) {
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

	editedValRows := map[string]bool{}
	for i, row := range table.Rows {
		for _, colIndexSort := range colIndexSorts {
			val := table.Rows[i].Cells[colIndexSort.Index].Value
			if KeyTypeCheckbox == val.Type {
				if block := row.GetBlockValue(); nil != block && block.IsEdited() {
					// 如果主键编辑过，则勾选框也算作编辑过，参与排序 https://github.com/siyuan-note/siyuan/issues/11016
					editedValRows[row.ID] = true
					break
				}
			}

			if val.IsEdited() {
				// 如果该行某列的值已经编辑过，则该行可参与排序
				editedValRows[row.ID] = true
				break
			}
		}
	}

	// 将未编辑的行和已编辑的行分开排序
	var uneditedRows, editedRows []*TableRow
	for _, row := range table.Rows {
		if _, ok := editedValRows[row.ID]; ok {
			editedRows = append(editedRows, row)
		} else {
			uneditedRows = append(uneditedRows, row)
		}
	}

	sort.Slice(uneditedRows, func(i, j int) bool {
		val1 := uneditedRows[i].GetBlockValue()
		if nil == val1 {
			return true
		}
		val2 := uneditedRows[j].GetBlockValue()
		if nil == val2 {
			return false
		}
		return val1.CreatedAt < val2.CreatedAt
	})

	sort.Slice(editedRows, func(i, j int) bool {
		sorted := true
		for _, colIndexSort := range colIndexSorts {
			val1 := editedRows[i].Cells[colIndexSort.Index].Value
			val2 := editedRows[j].Cells[colIndexSort.Index].Value
			if nil == val1 || val1.IsEmpty() {
				if nil != val2 && !val2.IsEmpty() {
					return false
				}
				sorted = false
				continue
			} else {
				if nil == val2 || val2.IsEmpty() {
					return true
				}
			}

			result := val1.Compare(val2, attrView)
			if 0 == result {
				sorted = false
				continue
			}
			sorted = true

			if colIndexSort.Order == SortOrderAsc {
				return 0 > result
			}
			return 0 < result
		}

		if !sorted {
			key1 := editedRows[i].GetBlockValue()
			if nil == key1 {
				return false
			}
			key2 := editedRows[j].GetBlockValue()
			if nil == key2 {
				return false
			}
			return key1.CreatedAt < key2.CreatedAt
		}
		return false
	})

	// 将包含未编辑的行放在最后
	table.Rows = append(editedRows, uneditedRows...)
	if 1 > len(table.Rows) {
		table.Rows = []*TableRow{}
	}
}

func (table *Table) FilterRows(attrView *AttributeView) {
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

			if !row.Cells[index].Value.Filter(table.Filters[j], attrView, row.ID) {
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
