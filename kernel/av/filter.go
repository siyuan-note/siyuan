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

type Filterable interface {
	FilterRows()
}

type ViewFilter struct {
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
