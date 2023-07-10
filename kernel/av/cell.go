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
	"strings"
)

type Cell struct {
	ID        string     `json:"id"`
	Value     *Value     `json:"value"`
	ValueType ColumnType `json:"valueType"`
	Color     string     `json:"color"`
	BgColor   string     `json:"bgColor"`
}

type Value struct {
	Block   *ValueBlock    `json:"block,omitempty"`
	Text    *ValueText     `json:"text,omitempty"`
	Number  *ValueNumber   `json:"number,omitempty"`
	Date    *ValueDate     `json:"date,omitempty"`
	MSelect []*ValueSelect `json:"mSelect,omitempty"`
}

func (value *Value) ToJSONString() string {
	data, err := gulu.JSON.MarshalJSON(value)
	if nil != err {
		return ""
	}
	return string(data)
}

func (value *Value) Compare(other *Value) int {
	if nil == value {
		return -1
	}
	if nil == other {
		return 1
	}
	if nil != value.Block && nil != other.Block {
		return strings.Compare(value.Block.Content, other.Block.Content)
	}
	if nil != value.Text && nil != other.Text {
		return strings.Compare(value.Text.Content, other.Text.Content)
	}
	if nil != value.Number && nil != other.Number {
		if value.Number.Content > other.Number.Content {
			return 1
		} else if value.Number.Content < other.Number.Content {
			return -1
		} else {
			return 0
		}
	}
	if nil != value.Date && nil != other.Date {
		if value.Date.Content > other.Date.Content {
			return 1
		} else if value.Date.Content < other.Date.Content {
			return -1
		} else {
			return 0
		}
	}

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
	return 0
}

func (value *Value) CompareOperator(other *Value, operator FilterOperator) bool {
	if nil == value || nil == other {
		return false
	}

	if nil != value.Block && nil != other.Block {
		return strings.Contains(value.Block.Content, other.Block.Content)
	}

	if nil != value.Text && nil != other.Text {
		switch operator {
		case FilterOperatorIsEqual:
			return value.Text.Content == other.Text.Content
		case FilterOperatorIsNotEqual:
			return value.Text.Content != other.Text.Content
		case FilterOperatorContains:
			return strings.Contains(value.Text.Content, other.Text.Content)
		case FilterOperatorDoesNotContain:
			return !strings.Contains(value.Text.Content, other.Text.Content)
		case FilterOperatorStartsWith:
			return strings.HasPrefix(value.Text.Content, other.Text.Content)
		case FilterOperatorEndsWith:
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
			return value.Number.Content == other.Number.Content
		case FilterOperatorIsNotEqual:
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
			return value.Date.Content == other.Date.Content
		case FilterOperatorIsNotEqual:
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
			return value.Date.Content >= other.Date.Content && value.Date.Content <= other.Date.Content2
		case FilterOperatorIsEmpty:
			return 0 == value.Date.Content
		case FilterOperatorIsNotEmpty:
			return 0 != value.Date.Content
		case FilterOperatorIsRelativeToToday:
			// TODO: date filter (relative to today)
			return value.Date.Content >= other.Date.Content && value.Date.Content <= other.Date.Content2
		}
	}

	if nil != value.MSelect && nil != other.MSelect && 0 < len(value.MSelect) && 0 < len(other.MSelect) {
		switch operator {
		case FilterOperatorIsEqual:
			return value.MSelect[0].Content == other.MSelect[0].Content
		case FilterOperatorIsNotEqual:
			return value.MSelect[0].Content != other.MSelect[0].Content
		case FilterOperatorContains:
			for _, v := range value.MSelect {
				if v.Content == other.MSelect[0].Content {
					return true
				}
			}
		case FilterOperatorDoesNotContain:
			for _, v := range value.MSelect {
				if v.Content == other.MSelect[0].Content {
					return false
				}
			}
			return true
		case FilterOperatorIsEmpty:
			return 0 == len(value.MSelect)
		case FilterOperatorIsNotEmpty:
			return 0 != len(value.MSelect)
		}
	}
	return false
}

func NewCellBlock(blockID, blockContent string) *Cell {
	return &Cell{
		ID:        ast.NewNodeID(),
		Value:     &Value{Block: &ValueBlock{ID: blockID, Content: blockContent}},
		ValueType: ColumnTypeBlock,
	}
}

func NewCell(valueType ColumnType) *Cell {
	return &Cell{
		ID:        ast.NewNodeID(),
		ValueType: valueType,
	}
}

type ValueBlock struct {
	ID      string `json:"id"`
	Content string `json:"content"`
}

type ValueText struct {
	Content string `json:"content"`
}

type ValueNumber struct {
	Content    float64 `json:"content"`
	IsNotEmpty bool    `json:"isNotEmpty"`
}

type ValueDate struct {
	Content  int64 `json:"content"`
	Content2 int64 `json:"content2"`
}

type ValueSelect struct {
	Content string `json:"content"`
	Color   string `json:"color"`
}
