// SiYuan - Build Your Eternal Digital Garden
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

import "github.com/88250/lute/ast"

type ColumnType string

const (
	ColumnTypeBlock    ColumnType = "block"
	ColumnTypeDate     ColumnType = "date"
	ColumnTypeNumber   ColumnType = "number"
	ColumnTypeRelation ColumnType = "relation"
	ColumnTypeRollup   ColumnType = "rollup"
	ColumnTypeSelect   ColumnType = "select"
	ColumnTypeText     ColumnType = "text"
)

// Column 描述了属性视图的基础结构。
type Column struct {
	ID     string     `json:"id"`     // 列 ID
	Name   string     `json:"name"`   // 列名
	Type   ColumnType `json:"type"`   // 列类型
	Icon   string     `json:"icon"`   // 列图标
	Wrap   bool       `json:"wrap"`   // 是否换行
	Hidden bool       `json:"hidden"` // 是否隐藏

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
