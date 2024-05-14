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
	CalcOperatorChecked           CalcOperator = "Checked"
	CalcOperatorUnchecked         CalcOperator = "Unchecked"
	CalcOperatorPercentChecked    CalcOperator = "Percent checked"
	CalcOperatorPercentUnchecked  CalcOperator = "Percent unchecked"
)
