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
	"github.com/siyuan-note/siyuan/kernel/util"
	"math"
	"sort"
)

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
		case KeyTypeCheckbox:
			table.calcColCheckbox(col, i)
		case KeyTypeRelation:
			table.calcColRelation(col, i)
		case KeyTypeRollup:
			table.calcColRollup(col, i)
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
				val, _ := util.Convert2Float(row.Cells[colIndex].Value.Template.Content)
				sum += val
			}
		}
		col.Calc.Result = &Value{Number: NewFormattedValueNumber(sum, col.NumberFormat)}
	case CalcOperatorAverage:
		sum := 0.0
		count := 0
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Template && "" != row.Cells[colIndex].Value.Template.Content {
				val, _ := util.Convert2Float(row.Cells[colIndex].Value.Template.Content)
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
				val, _ := util.Convert2Float(row.Cells[colIndex].Value.Template.Content)
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
				val, _ := util.Convert2Float(row.Cells[colIndex].Value.Template.Content)
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
				val, _ := util.Convert2Float(row.Cells[colIndex].Value.Template.Content)
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
				val, _ := util.Convert2Float(row.Cells[colIndex].Value.Template.Content)
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
		var isNotTime, hasEndDate bool
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Date && row.Cells[colIndex].Value.Date.IsNotEmpty {
				if 0 == earliest || earliest > row.Cells[colIndex].Value.Date.Content {
					earliest = row.Cells[colIndex].Value.Date.Content
					isNotTime = row.Cells[colIndex].Value.Date.IsNotTime
					hasEndDate = row.Cells[colIndex].Value.Date.HasEndDate
				}
			}
		}
		if 0 != earliest {
			col.Calc.Result = &Value{Date: NewFormattedValueDate(earliest, 0, DateFormatNone, isNotTime, hasEndDate)}
		}
	case CalcOperatorLatest:
		latest := int64(0)
		var isNotTime, hasEndDate bool
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Date && row.Cells[colIndex].Value.Date.IsNotEmpty {
				if 0 == latest || latest < row.Cells[colIndex].Value.Date.Content {
					latest = row.Cells[colIndex].Value.Date.Content
					isNotTime = row.Cells[colIndex].Value.Date.IsNotTime
					hasEndDate = row.Cells[colIndex].Value.Date.HasEndDate
				}
			}
		}
		if 0 != latest {
			col.Calc.Result = &Value{Date: NewFormattedValueDate(latest, 0, DateFormatNone, isNotTime, hasEndDate)}
		}
	case CalcOperatorRange:
		earliest := int64(0)
		latest := int64(0)
		var isNotTime, hasEndDate bool
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Date && row.Cells[colIndex].Value.Date.IsNotEmpty {
				if 0 == earliest || earliest > row.Cells[colIndex].Value.Date.Content {
					earliest = row.Cells[colIndex].Value.Date.Content
					isNotTime = row.Cells[colIndex].Value.Date.IsNotTime
					hasEndDate = row.Cells[colIndex].Value.Date.HasEndDate
				}
				if 0 == latest || latest < row.Cells[colIndex].Value.Date.Content {
					latest = row.Cells[colIndex].Value.Date.Content
					isNotTime = row.Cells[colIndex].Value.Date.IsNotTime
					hasEndDate = row.Cells[colIndex].Value.Date.HasEndDate
				}
			}
		}
		if 0 != earliest && 0 != latest {
			col.Calc.Result = &Value{Date: NewFormattedValueDate(earliest, latest, DateFormatDuration, isNotTime, hasEndDate)}
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

func (table *Table) calcColCheckbox(col *TableColumn, colIndex int) {
	switch col.Calc.Operator {
	case CalcOperatorCountAll:
		col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(len(table.Rows)), NumberFormatNone)}
	case CalcOperatorChecked:
		countChecked := 0
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Checkbox && row.Cells[colIndex].Value.Checkbox.Checked {
				countChecked++
			}
		}
		col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(countChecked), NumberFormatNone)}
	case CalcOperatorUnchecked:
		countUnchecked := 0
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Checkbox && !row.Cells[colIndex].Value.Checkbox.Checked {
				countUnchecked++
			}
		}
		col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(countUnchecked), NumberFormatNone)}
	case CalcOperatorPercentChecked:
		countChecked := 0
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Checkbox && row.Cells[colIndex].Value.Checkbox.Checked {
				countChecked++
			}
		}
		if 0 < len(table.Rows) {
			col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(countChecked)/float64(len(table.Rows)), NumberFormatPercent)}
		}
	case CalcOperatorPercentUnchecked:
		countUnchecked := 0
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Checkbox && !row.Cells[colIndex].Value.Checkbox.Checked {
				countUnchecked++
			}
		}
		if 0 < len(table.Rows) {
			col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(countUnchecked)/float64(len(table.Rows)), NumberFormatPercent)}
		}
	}
}

func (table *Table) calcColRelation(col *TableColumn, colIndex int) {
	switch col.Calc.Operator {
	case CalcOperatorCountAll:
		col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(len(table.Rows)), NumberFormatNone)}
	case CalcOperatorCountValues:
		countValues := 0
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Relation {
				countValues++
			}
		}
		col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(countValues), NumberFormatNone)}
	case CalcOperatorCountUniqueValues:
		countUniqueValues := 0
		uniqueValues := map[string]bool{}
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Relation {
				for _, id := range row.Cells[colIndex].Value.Relation.BlockIDs {
					if !uniqueValues[id] {
						uniqueValues[id] = true
						countUniqueValues++
					}
				}
			}
		}
		col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(countUniqueValues), NumberFormatNone)}
	case CalcOperatorCountEmpty:
		countEmpty := 0
		for _, row := range table.Rows {
			if nil == row.Cells[colIndex] || nil == row.Cells[colIndex].Value || nil == row.Cells[colIndex].Value.Relation || 0 == len(row.Cells[colIndex].Value.Relation.BlockIDs) {
				countEmpty++
			}
		}
		col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(countEmpty), NumberFormatNone)}
	case CalcOperatorCountNotEmpty:
		countNotEmpty := 0
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Relation && 0 < len(row.Cells[colIndex].Value.Relation.BlockIDs) {
				countNotEmpty++
			}
		}
		col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(countNotEmpty), NumberFormatNone)}
	case CalcOperatorPercentEmpty:
		countEmpty := 0
		for _, row := range table.Rows {
			if nil == row.Cells[colIndex] || nil == row.Cells[colIndex].Value || nil == row.Cells[colIndex].Value.Relation || 0 == len(row.Cells[colIndex].Value.Relation.BlockIDs) {
				countEmpty++
			}
		}
		if 0 < len(table.Rows) {
			col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(countEmpty)/float64(len(table.Rows)), NumberFormatPercent)}
		}
	case CalcOperatorPercentNotEmpty:
		countNotEmpty := 0
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Relation && 0 < len(row.Cells[colIndex].Value.Relation.BlockIDs) {
				countNotEmpty++
			}
		}
		if 0 < len(table.Rows) {
			col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(countNotEmpty)/float64(len(table.Rows)), NumberFormatPercent)}
		}
	}
}

func (table *Table) calcColRollup(col *TableColumn, colIndex int) {
	switch col.Calc.Operator {
	case CalcOperatorCountAll:
		col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(len(table.Rows)), NumberFormatNone)}
	case CalcOperatorCountValues:
		countValues := 0
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Rollup {
				countValues++
			}
		}
		col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(countValues), NumberFormatNone)}
	case CalcOperatorCountUniqueValues:
		countUniqueValues := 0
		uniqueValues := map[string]bool{}
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Rollup {
				for _, content := range row.Cells[colIndex].Value.Rollup.Contents {
					if !uniqueValues[content.String(true)] {
						uniqueValues[content.String(true)] = true
						countUniqueValues++
					}
				}
			}
		}
		col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(countUniqueValues), NumberFormatNone)}
	case CalcOperatorCountEmpty:
		countEmpty := 0
		for _, row := range table.Rows {
			if nil == row.Cells[colIndex] || nil == row.Cells[colIndex].Value || nil == row.Cells[colIndex].Value.Rollup || 0 == len(row.Cells[colIndex].Value.Rollup.Contents) {
				countEmpty++
			}
		}
		col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(countEmpty), NumberFormatNone)}
	case CalcOperatorCountNotEmpty:
		countNotEmpty := 0
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Rollup && 0 < len(row.Cells[colIndex].Value.Rollup.Contents) {
				countNotEmpty++
			}
		}
		col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(countNotEmpty), NumberFormatNone)}
	case CalcOperatorPercentEmpty:
		countEmpty := 0
		for _, row := range table.Rows {
			if nil == row.Cells[colIndex] || nil == row.Cells[colIndex].Value || nil == row.Cells[colIndex].Value.Rollup || 0 == len(row.Cells[colIndex].Value.Rollup.Contents) {
				countEmpty++
			}
		}
		if 0 < len(table.Rows) {
			col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(countEmpty)/float64(len(table.Rows)), NumberFormatPercent)}
		}
	case CalcOperatorPercentNotEmpty:
		countNotEmpty := 0
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Rollup && 0 < len(row.Cells[colIndex].Value.Rollup.Contents) {
				countNotEmpty++
			}
		}
		if 0 < len(table.Rows) {
			col.Calc.Result = &Value{Number: NewFormattedValueNumber(float64(countNotEmpty)/float64(len(table.Rows)), NumberFormatPercent)}
		}
	case CalcOperatorSum:
		sum := 0.0
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Rollup && 0 < len(row.Cells[colIndex].Value.Rollup.Contents) {
				for _, content := range row.Cells[colIndex].Value.Rollup.Contents {
					val, _ := util.Convert2Float(content.String(false))
					sum += val
				}
			}
		}
		col.Calc.Result = &Value{Number: NewFormattedValueNumber(sum, col.NumberFormat)}
	case CalcOperatorAverage:
		sum := 0.0
		count := 0
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Rollup && 0 < len(row.Cells[colIndex].Value.Rollup.Contents) {
				for _, content := range row.Cells[colIndex].Value.Rollup.Contents {
					val, _ := util.Convert2Float(content.String(false))
					sum += val
					count++
				}
			}
		}
		if 0 != count {
			col.Calc.Result = &Value{Number: NewFormattedValueNumber(sum/float64(count), col.NumberFormat)}
		}
	case CalcOperatorMedian:
		values := []float64{}
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Rollup && 0 < len(row.Cells[colIndex].Value.Rollup.Contents) {
				for _, content := range row.Cells[colIndex].Value.Rollup.Contents {
					val, _ := util.Convert2Float(content.String(false))
					values = append(values, val)
				}
			}
		}
		sort.Float64s(values)
		if 0 < len(values) {
			if 0 == len(values)%2 {
				col.Calc.Result = &Value{Number: NewFormattedValueNumber((values[len(values)/2-1]+values[len(values)/2])/2, col.NumberFormat)}
			} else {
				col.Calc.Result = &Value{Number: NewFormattedValueNumber(values[len(values)/2], col.NumberFormat)}
			}
		}
	case CalcOperatorMin:
		minVal := math.MaxFloat64
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Rollup && 0 < len(row.Cells[colIndex].Value.Rollup.Contents) {
				for _, content := range row.Cells[colIndex].Value.Rollup.Contents {
					val, _ := util.Convert2Float(content.String(false))
					if val < minVal {
						minVal = val
					}
				}
			}
		}
		if math.MaxFloat64 != minVal {
			col.Calc.Result = &Value{Number: NewFormattedValueNumber(minVal, col.NumberFormat)}
		}
	case CalcOperatorMax:
		maxVal := -math.MaxFloat64
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Rollup && 0 < len(row.Cells[colIndex].Value.Rollup.Contents) {
				for _, content := range row.Cells[colIndex].Value.Rollup.Contents {
					val, _ := util.Convert2Float(content.String(false))
					if val > maxVal {
						maxVal = val
					}
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
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Rollup && 0 < len(row.Cells[colIndex].Value.Rollup.Contents) {
				for _, content := range row.Cells[colIndex].Value.Rollup.Contents {
					val, _ := util.Convert2Float(content.String(false))
					if val < minVal {
						minVal = val
					}
					if val > maxVal {
						maxVal = val
					}
				}
			}
		}
		if math.MaxFloat64 != minVal && -math.MaxFloat64 != maxVal {
			col.Calc.Result = &Value{Number: NewFormattedValueNumber(maxVal-minVal, col.NumberFormat)}
		}
	}
}
