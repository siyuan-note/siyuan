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

// Column 描述了属性视图的列。
type Column interface {

	// ID 用于获取列 ID。
	ID() string

	// Name 用于获取列名。
	Name() string

	// Type 用于获取列类型。
	Type() ColumnType
}

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

// BaseColumn 描述了属性视图的基础结构。
type BaseColumn struct {
	BaseID   string     `json:"id"`   // 列 ID
	BaseName string     `json:"name"` // 列名
	BaseType ColumnType `json:"type"` // 列类型
}

func (c *BaseColumn) ID() string {
	return c.BaseID
}

func (c *BaseColumn) Name() string {
	return c.BaseName
}

func (c *BaseColumn) Type() ColumnType {
	return c.BaseType
}
