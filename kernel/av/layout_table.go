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
)

// LayoutTable 描述了表格布局的结构。
type LayoutTable struct {
	*BaseLayout

	Columns []*ViewTableColumn `json:"columns"` // 表格列

	// TODO RowIDs 字段已经废弃，计划于 2026 年 6 月 30 日后删除 https://github.com/siyuan-note/siyuan/issues/15194
	//Deprecated
	RowIDs []string `json:"rowIds"` // 行 ID，用于自定义排序
}

func NewLayoutTable() *LayoutTable {
	return &LayoutTable{
		BaseLayout: &BaseLayout{
			Spec:     0,
			ID:       ast.NewNodeID(),
			ShowIcon: true,
		},
	}
}

// ViewTableColumn 描述了表格列的结构。
type ViewTableColumn struct {
	*BaseField

	Pin   bool       `json:"pin"`            // 是否固定
	Width string     `json:"width"`          // 列宽度
	Calc  *FieldCalc `json:"calc,omitempty"` // 计算规则
}

// Table 描述了表格视图实例的结构。
type Table struct {
	*BaseInstance

	Columns  []*TableColumn `json:"columns"`  // 表格列
	Rows     []*TableRow    `json:"rows"`     // 表格行
	RowCount int            `json:"rowCount"` // 表格总行数
}

// TableColumn 描述了表格实例列的结构。
type TableColumn struct {
	*BaseInstanceField

	Pin   bool   `json:"pin"`   // 是否固定
	Width string `json:"width"` // 列宽度
}

// TableRow 描述了表格实例行的结构。
type TableRow struct {
	ID    string       `json:"id"`    // 行 ID
	Cells []*TableCell `json:"cells"` // 行单元格
}

// TableCell 描述了表格实例单元格的结构。
type TableCell struct {
	*BaseValue

	Color   string `json:"color"`   // 单元格颜色
	BgColor string `json:"bgColor"` // 单元格背景颜色
}

func (table *Table) GetColumn(id string) *TableColumn {
	for _, column := range table.Columns {
		if column.ID == id {
			return column
		}
	}
	return nil
}

func (row *TableRow) GetID() string {
	return row.ID
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

func (row *TableRow) GetValues() (ret []*Value) {
	ret = []*Value{}
	for _, cell := range row.Cells {
		if nil != cell.Value {
			ret = append(ret, cell.Value)
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

func (table *Table) GetItems() (ret []Item) {
	ret = []Item{}
	for _, row := range table.Rows {
		if nil != row {
			ret = append(ret, row)
		}
	}
	return
}

func (table *Table) SetItems(items []Item) {
	table.Rows = []*TableRow{}
	for _, item := range items {
		table.Rows = append(table.Rows, item.(*TableRow))
	}
}

func (table *Table) CountItems() int {
	return len(table.Rows)
}

func (table *Table) GetFields() (ret []Field) {
	ret = []Field{}
	for _, column := range table.Columns {
		ret = append(ret, column)
	}
	return ret
}

func (table *Table) GetField(id string) (ret Field, fieldIndex int) {
	for _, column := range table.Columns {
		if column.ID == id {
			return column, fieldIndex
		}
	}
	return nil, -1
}

func (table *Table) GetValue(itemID, keyID string) (ret *Value) {
	for _, row := range table.Rows {
		if row.ID == itemID {
			return row.GetValue(keyID)
		}
	}
	return nil
}

func (*Table) GetType() LayoutType {
	return LayoutTypeTable
}
