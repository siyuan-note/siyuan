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

type AttributeViewFilter struct {
	Column   string         `json:"column"`
	Operator FilterOperator `json:"operator"`
	Value    *Value         `json:"value"`
}

type FilterOperator string

const (
	FilterOperatorIsEqual           FilterOperator = "="
	FilterOperatorIsNotEqual        FilterOperator = "!="
	FilterOperatorIsGreater         FilterOperator = ">"
	FilterOperatorIsGreaterOrEqual  FilterOperator = ">="
	FilterOperatorIsLess            FilterOperator = "<"
	FilterOperatorIsLessOrEqual     FilterOperator = "<="
	FilterOperatorContains          FilterOperator = "Contains"
	FilterOperatorDoesNotContain    FilterOperator = "Does not contains"
	FilterOperatorIsEmpty           FilterOperator = "Is empty"
	FilterOperatorIsNotEmpty        FilterOperator = "Is not empty"
	FilterOperatorStartsWith        FilterOperator = "Starts with"
	FilterOperatorEndsWith          FilterOperator = "Ends with"
	FilterOperatorIsBetween         FilterOperator = "Is between"
	FilterOperatorIsRelativeToToday FilterOperator = "Is relative to today"
)

func (av *AttributeView) FilterRows() {
	if 1 > len(av.Filters) {
		return
	}

	var colIndexes []int
	for _, f := range av.Filters {
		for i, c := range av.Columns {
			if c.ID == f.Column {
				colIndexes = append(colIndexes, i)
				break
			}
		}
	}

	rows := []*Row{}
	for _, row := range av.Rows {
		pass := true
		for j, index := range colIndexes {
			c := av.Columns[index]
			if c.Type == ColumnTypeBlock {
				continue
			}

			if !row.Cells[index].Value.CompareOperator(av.Filters[j].Value, av.Filters[j].Operator) {
				pass = false
				break
			}
		}
		if pass {
			rows = append(rows, row)
		}
	}
	av.Rows = rows
}
