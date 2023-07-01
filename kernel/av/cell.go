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
	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
)

type Cell struct {
	ID          string      `json:"id"`
	Value       *Value      `json:"value"`
	ValueType   ColumnType  `json:"valueType"`
	RenderValue interface{} `json:"renderValue"`
	Color       string      `json:"color"`
	BgColor     string      `json:"bgColor"`
}

type Value struct {
	Block   string   `json:"block"`
	Text    string   `json:"text"`
	Number  float64  `json:"number"`
	Date    string   `json:"date"`
	Select  string   `json:"select"`
	MSelect []string `json:"mSelect"`
}

func (value *Value) ToJSONString() string {
	data, err := gulu.JSON.MarshalJSON(value)
	if nil != err {
		return ""
	}
	return string(data)
}

func NewCellBlock(blockID, blockContent string) *Cell {
	return &Cell{
		ID:          ast.NewNodeID(),
		Value:       &Value{Block: blockID},
		ValueType:   ColumnTypeBlock,
		RenderValue: &RenderValueBlock{ID: blockID, Content: blockContent},
	}
}

func NewCell(valueType ColumnType) *Cell {
	return &Cell{
		ID:        ast.NewNodeID(),
		ValueType: valueType,
	}
}

type RenderValueBlock struct {
	ID      string `json:"id"`
	Content string `json:"content"`
}
