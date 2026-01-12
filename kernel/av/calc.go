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
	"math"
	"sort"

	"github.com/siyuan-note/siyuan/kernel/util"
)

// FieldCalc 描述了字段计算操作和结果的结构。
type FieldCalc struct {
	Operator CalcOperator `json:"operator"` // 计算操作符
	Result   *Value       `json:"result"`   // 计算结果
}

type CalcOperator string

const (
	CalcOperatorNone                CalcOperator = ""
	CalcOperatorUniqueValues        CalcOperator = "Unique values"
	CalcOperatorCountAll            CalcOperator = "Count all"
	CalcOperatorCountValues         CalcOperator = "Count values"
	CalcOperatorCountUniqueValues   CalcOperator = "Count unique values"
	CalcOperatorCountEmpty          CalcOperator = "Count empty"
	CalcOperatorCountNotEmpty       CalcOperator = "Count not empty"
	CalcOperatorPercentEmpty        CalcOperator = "Percent empty"
	CalcOperatorPercentNotEmpty     CalcOperator = "Percent not empty"
	CalcOperatorPercentUniqueValues CalcOperator = "Percent unique values"
	CalcOperatorSum                 CalcOperator = "Sum"
	CalcOperatorAverage             CalcOperator = "Average"
	CalcOperatorMedian              CalcOperator = "Median"
	CalcOperatorMin                 CalcOperator = "Min"
	CalcOperatorMax                 CalcOperator = "Max"
	CalcOperatorRange               CalcOperator = "Range"
	CalcOperatorEarliest            CalcOperator = "Earliest"
	CalcOperatorLatest              CalcOperator = "Latest"
	CalcOperatorChecked             CalcOperator = "Checked"
	CalcOperatorUnchecked           CalcOperator = "Unchecked"
	CalcOperatorPercentChecked      CalcOperator = "Percent checked"
	CalcOperatorPercentUnchecked    CalcOperator = "Percent unchecked"
)

func Calc(viewable Viewable, attrView *AttributeView) {
	collection := viewable.(Collection)

	// 字段计算
	for i, field := range collection.GetFields() {
		calc := field.GetCalc()
		if nil == calc || CalcOperatorNone == calc.Operator {
			continue
		}

		calcField(collection, field, i, attrView)
	}

	// 分组计算
	if groupCalc := viewable.GetGroupCalc(); nil != groupCalc {
		if groupCalcKey, _ := attrView.GetKey(groupCalc.Field); nil != groupCalcKey {
			if field, fieldIndex := collection.GetField(groupCalcKey.ID); nil != field {
				var calcResult *GroupCalc

				if calc := field.GetCalc(); nil != calc && field.GetID() == groupCalcKey.ID {
					// 直接使用字段计算结果
					calcResult = &GroupCalc{Field: groupCalcKey.ID, FieldCalc: calc}
				}

				if nil == calcResult {
					// 在字段上设置计算规则，使用字段结算结果作为分组计算结果，最后再清除字段上的计算规则
					field.SetCalc(groupCalc.FieldCalc)
					calcField(collection, field, fieldIndex, attrView)
					calcResult = &GroupCalc{Field: groupCalcKey.ID, FieldCalc: field.GetCalc()}
					field.SetCalc(nil)
				}

				viewable.SetGroupCalc(calcResult)
			}
		}
	}
}

func calcField(collection Collection, field Field, fieldIndex int, attrView *AttributeView) {
	switch field.GetType() {
	case KeyTypeBlock:
		calcFieldBlock(collection, field, fieldIndex)
	case KeyTypeText:
		calcFieldText(collection, field, fieldIndex)
	case KeyTypeNumber:
		calcFieldNumber(collection, field, fieldIndex)
	case KeyTypeDate:
		calcFieldDate(collection, field, fieldIndex)
	case KeyTypeSelect:
		calcFieldSelect(collection, field, fieldIndex)
	case KeyTypeMSelect:
		calcFieldMSelect(collection, field, fieldIndex)
	case KeyTypeURL:
		calcFieldURL(collection, field, fieldIndex)
	case KeyTypeEmail:
		calcFieldEmail(collection, field, fieldIndex)
	case KeyTypePhone:
		calcFieldPhone(collection, field, fieldIndex)
	case KeyTypeMAsset:
		calcFieldMAsset(collection, field, fieldIndex)
	case KeyTypeTemplate:
		calcFieldTemplate(collection, field, fieldIndex)
	case KeyTypeCreated:
		calcFieldCreated(collection, field, fieldIndex, attrView)
	case KeyTypeUpdated:
		calcFieldUpdated(collection, field, fieldIndex, attrView)
	case KeyTypeCheckbox:
		calcFieldCheckbox(collection, field, fieldIndex)
	case KeyTypeRelation:
		calcFieldRelation(collection, field, fieldIndex)
	case KeyTypeRollup:
		calcFieldRollup(collection, field, fieldIndex)
	}
}

func calcFieldTemplate(collection Collection, field Field, fieldIndex int) {
	calc := field.GetCalc()
	switch calc.Operator {
	case CalcOperatorCountAll:
		calc.Result = &Value{Number: NewFormattedValueNumber(float64(len(collection.GetItems())), NumberFormatNone)}
	case CalcOperatorCountValues:
		countValues := 0
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].Template && "" != values[fieldIndex].Template.Content {
				countValues++
			}
		}
		calc.Result = &Value{Number: NewFormattedValueNumber(float64(countValues), NumberFormatNone)}
	case CalcOperatorCountUniqueValues:
		countUniqueValues := 0
		uniqueValues := map[string]bool{}
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].Template && "" != values[fieldIndex].Template.Content {
				if !uniqueValues[values[fieldIndex].Template.Content] {
					uniqueValues[values[fieldIndex].Template.Content] = true
					countUniqueValues++
				}
			}
		}
		calc.Result = &Value{Number: NewFormattedValueNumber(float64(countUniqueValues), NumberFormatNone)}
	case CalcOperatorCountEmpty:
		countEmpty := 0
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil == values[fieldIndex] || nil == values[fieldIndex].Template || "" == values[fieldIndex].Template.Content {
				countEmpty++
			}
		}
		calc.Result = &Value{Number: NewFormattedValueNumber(float64(countEmpty), NumberFormatNone)}
	case CalcOperatorCountNotEmpty:
		countNotEmpty := 0
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].Template && "" != values[fieldIndex].Template.Content {
				countNotEmpty++
			}
		}
		calc.Result = &Value{Number: NewFormattedValueNumber(float64(countNotEmpty), NumberFormatNone)}
	case CalcOperatorPercentEmpty:
		countEmpty := 0
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil == values[fieldIndex] || nil == values[fieldIndex].Template || "" == values[fieldIndex].Template.Content {
				countEmpty++
			}
		}
		if 0 < len(collection.GetItems()) {
			calc.Result = &Value{Number: NewFormattedValueNumber(float64(countEmpty)/float64(len(collection.GetItems())), NumberFormatPercent)}
		}
	case CalcOperatorPercentNotEmpty:
		countNotEmpty := 0
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].Template && "" != values[fieldIndex].Template.Content {
				countNotEmpty++
			}
		}
		if 0 < len(collection.GetItems()) {
			calc.Result = &Value{Number: NewFormattedValueNumber(float64(countNotEmpty)/float64(len(collection.GetItems())), NumberFormatPercent)}
		}
	case CalcOperatorPercentUniqueValues:
		countUniqueValues := 0
		uniqueValues := map[string]bool{}
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].Template && "" != values[fieldIndex].Template.Content {
				if !uniqueValues[values[fieldIndex].Template.Content] {
					uniqueValues[values[fieldIndex].Template.Content] = true
					countUniqueValues++
				}
			}
		}
		if 0 < len(collection.GetItems()) {
			calc.Result = &Value{Number: NewFormattedValueNumber(float64(countUniqueValues)/float64(len(collection.GetItems())), NumberFormatPercent)}
		}
	case CalcOperatorSum:
		sum := 0.0
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].Template && "" != values[fieldIndex].Template.Content {
				val, _ := util.Convert2Float(values[fieldIndex].Template.Content)
				sum += val
			}
		}
		calc.Result = &Value{Number: NewFormattedValueNumber(sum, field.GetNumberFormat())}
	case CalcOperatorAverage:
		sum := 0.0
		count := 0
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].Template && "" != values[fieldIndex].Template.Content {
				val, _ := util.Convert2Float(values[fieldIndex].Template.Content)
				sum += val
				count++
			}
		}
		if 0 != count {
			calc.Result = &Value{Number: NewFormattedValueNumber(sum/float64(count), field.GetNumberFormat())}
		}
	case CalcOperatorMedian:
		calcValues := []float64{}
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].Template && "" != values[fieldIndex].Template.Content {
				val, _ := util.Convert2Float(values[fieldIndex].Template.Content)
				calcValues = append(calcValues, val)
			}
		}
		sort.Float64s(calcValues)
		if len(calcValues) > 0 {
			if len(calcValues)%2 == 0 {
				calc.Result = &Value{Number: NewFormattedValueNumber((calcValues[len(calcValues)/2-1]+calcValues[len(calcValues)/2])/2, field.GetNumberFormat())}
			} else {
				calc.Result = &Value{Number: NewFormattedValueNumber(calcValues[len(calcValues)/2], field.GetNumberFormat())}
			}
		}
	case CalcOperatorMin:
		minVal := math.MaxFloat64
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].Template && "" != values[fieldIndex].Template.Content {
				val, _ := util.Convert2Float(values[fieldIndex].Template.Content)
				if val < minVal {
					minVal = val
				}
			}
		}
		if math.MaxFloat64 != minVal {
			calc.Result = &Value{Number: NewFormattedValueNumber(minVal, field.GetNumberFormat())}
		}
	case CalcOperatorMax:
		maxVal := -math.MaxFloat64
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].Template && "" != values[fieldIndex].Template.Content {
				val, _ := util.Convert2Float(values[fieldIndex].Template.Content)
				if val > maxVal {
					maxVal = val
				}
			}
		}
		if -math.MaxFloat64 != maxVal {
			calc.Result = &Value{Number: NewFormattedValueNumber(maxVal, field.GetNumberFormat())}
		}
	case CalcOperatorRange:
		minVal := math.MaxFloat64
		maxVal := -math.MaxFloat64
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].Template && "" != values[fieldIndex].Template.Content {
				val, _ := util.Convert2Float(values[fieldIndex].Template.Content)
				if val < minVal {
					minVal = val
				}
				if val > maxVal {
					maxVal = val
				}
			}
		}
		if math.MaxFloat64 != minVal && -math.MaxFloat64 != maxVal {
			calc.Result = &Value{Number: NewFormattedValueNumber(maxVal-minVal, field.GetNumberFormat())}
		}
	}
}

func calcFieldMAsset(collection Collection, field Field, fieldIndex int) {
	calc := field.GetCalc()
	switch calc.Operator {
	case CalcOperatorCountAll:
		calc.Result = &Value{Number: NewFormattedValueNumber(float64(len(collection.GetItems())), NumberFormatNone)}
	case CalcOperatorCountValues:
		countValues := 0
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].MAsset && 0 < len(values[fieldIndex].MAsset) {
				countValues += len(values[fieldIndex].MAsset)
			}
		}
		calc.Result = &Value{Number: NewFormattedValueNumber(float64(countValues), NumberFormatNone)}
	case CalcOperatorCountUniqueValues:
		countUniqueValues := 0
		uniqueValues := map[string]bool{}
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].MAsset && 0 < len(values[fieldIndex].MAsset) {
				for _, sel := range values[fieldIndex].MAsset {
					if _, ok := uniqueValues[sel.Content]; !ok {
						uniqueValues[sel.Content] = true
						countUniqueValues++
					}
				}
			}
		}
		calc.Result = &Value{Number: NewFormattedValueNumber(float64(countUniqueValues), NumberFormatNone)}
	case CalcOperatorCountEmpty:
		countEmpty := 0
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil == values[fieldIndex] || nil == values[fieldIndex].MAsset || 0 == len(values[fieldIndex].MAsset) {
				countEmpty++
			}
		}
		calc.Result = &Value{Number: NewFormattedValueNumber(float64(countEmpty), NumberFormatNone)}
	case CalcOperatorCountNotEmpty:
		countNotEmpty := 0
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].MAsset && 0 < len(values[fieldIndex].MAsset) {
				countNotEmpty++
			}
		}
		calc.Result = &Value{Number: NewFormattedValueNumber(float64(countNotEmpty), NumberFormatNone)}
	case CalcOperatorPercentEmpty:
		countEmpty := 0
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil == values[fieldIndex] || nil == values[fieldIndex].MAsset || 0 == len(values[fieldIndex].MAsset) {
				countEmpty++
			}
		}
		if 0 < len(collection.GetItems()) {
			calc.Result = &Value{Number: NewFormattedValueNumber(float64(countEmpty)/float64(len(collection.GetItems())), NumberFormatPercent)}
		}
	case CalcOperatorPercentNotEmpty:
		countNotEmpty := 0
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].MAsset && 0 < len(values[fieldIndex].MAsset) {
				countNotEmpty++
			}
		}
		if 0 < len(collection.GetItems()) {
			calc.Result = &Value{Number: NewFormattedValueNumber(float64(countNotEmpty)/float64(len(collection.GetItems())), NumberFormatPercent)}
		}
	case CalcOperatorPercentUniqueValues:
		countUniqueValues := 0
		uniqueValues := map[string]bool{}
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].MAsset && 0 < len(values[fieldIndex].MAsset) {
				for _, sel := range values[fieldIndex].MAsset {
					if _, ok := uniqueValues[sel.Content]; !ok {
						uniqueValues[sel.Content] = true
						countUniqueValues++
					}
				}
			}
		}
		if 0 < len(collection.GetItems()) {
			calc.Result = &Value{Number: NewFormattedValueNumber(float64(countUniqueValues)/float64(len(collection.GetItems())), NumberFormatPercent)}
		}
	}
}

func calcFieldMSelect(collection Collection, field Field, fieldIndex int) {
	calc := field.GetCalc()
	switch calc.Operator {
	case CalcOperatorCountAll:
		calc.Result = &Value{Number: NewFormattedValueNumber(float64(len(collection.GetItems())), NumberFormatNone)}
	case CalcOperatorCountValues:
		countValues := 0
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].MSelect && 0 < len(values[fieldIndex].MSelect) {
				countValues += len(values[fieldIndex].MSelect)
			}
		}
		calc.Result = &Value{Number: NewFormattedValueNumber(float64(countValues), NumberFormatNone)}
	case CalcOperatorCountUniqueValues:
		countUniqueValues := 0
		uniqueValues := map[string]bool{}
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].MSelect && 0 < len(values[fieldIndex].MSelect) {
				for _, sel := range values[fieldIndex].MSelect {
					if _, ok := uniqueValues[sel.Content]; !ok {
						uniqueValues[sel.Content] = true
						countUniqueValues++
					}
				}
			}
		}
		calc.Result = &Value{Number: NewFormattedValueNumber(float64(countUniqueValues), NumberFormatNone)}
	case CalcOperatorCountEmpty:
		countEmpty := 0
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil == values[fieldIndex] || nil == values[fieldIndex].MSelect || 0 == len(values[fieldIndex].MSelect) {
				countEmpty++
			}
		}
		calc.Result = &Value{Number: NewFormattedValueNumber(float64(countEmpty), NumberFormatNone)}
	case CalcOperatorCountNotEmpty:
		countNotEmpty := 0
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].MSelect && 0 < len(values[fieldIndex].MSelect) {
				countNotEmpty++
			}
		}
		calc.Result = &Value{Number: NewFormattedValueNumber(float64(countNotEmpty), NumberFormatNone)}
	case CalcOperatorPercentEmpty:
		countEmpty := 0
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil == values[fieldIndex] || nil == values[fieldIndex].MSelect || 0 == len(values[fieldIndex].MSelect) {
				countEmpty++
			}
		}
		if 0 < len(collection.GetItems()) {
			calc.Result = &Value{Number: NewFormattedValueNumber(float64(countEmpty)/float64(len(collection.GetItems())), NumberFormatPercent)}
		}
	case CalcOperatorPercentNotEmpty:
		countNotEmpty := 0
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].MSelect && 0 < len(values[fieldIndex].MSelect) {
				countNotEmpty++
			}
		}
		if 0 < len(collection.GetItems()) {
			calc.Result = &Value{Number: NewFormattedValueNumber(float64(countNotEmpty)/float64(len(collection.GetItems())), NumberFormatPercent)}
		}
	case CalcOperatorPercentUniqueValues:
		countUniqueValues := 0
		uniqueValues := map[string]bool{}
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].MSelect && 0 < len(values[fieldIndex].MSelect) {
				for _, sel := range values[fieldIndex].MSelect {
					if _, ok := uniqueValues[sel.Content]; !ok {
						uniqueValues[sel.Content] = true
						countUniqueValues++
					}
				}
			}
		}
		if 0 < len(collection.GetItems()) {
			calc.Result = &Value{Number: NewFormattedValueNumber(float64(countUniqueValues)/float64(len(collection.GetItems())), NumberFormatPercent)}
		}
	}
}

func calcFieldSelect(collection Collection, field Field, fieldIndex int) {
	calc := field.GetCalc()
	switch calc.Operator {
	case CalcOperatorCountAll:
		calc.Result = &Value{Number: NewFormattedValueNumber(float64(len(collection.GetItems())), NumberFormatNone)}
	case CalcOperatorCountValues:
		countValues := 0
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].MSelect && 0 < len(values[fieldIndex].MSelect) && nil != values[fieldIndex].MSelect[0] && "" != values[fieldIndex].MSelect[0].Content {
				countValues++
			}
		}
		calc.Result = &Value{Number: NewFormattedValueNumber(float64(countValues), NumberFormatNone)}
	case CalcOperatorCountUniqueValues:
		countUniqueValues := 0
		uniqueValues := map[string]bool{}
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].MSelect && 0 < len(values[fieldIndex].MSelect) && nil != values[fieldIndex].MSelect[0] && "" != values[fieldIndex].MSelect[0].Content {
				if _, ok := uniqueValues[values[fieldIndex].MSelect[0].Content]; !ok {
					uniqueValues[values[fieldIndex].MSelect[0].Content] = true
					countUniqueValues++
				}
			}
		}
		calc.Result = &Value{Number: NewFormattedValueNumber(float64(countUniqueValues), NumberFormatNone)}
	case CalcOperatorCountEmpty:
		countEmpty := 0
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil == values[fieldIndex] || nil == values[fieldIndex].MSelect || 1 > len(values[fieldIndex].MSelect) || nil == values[fieldIndex].MSelect[0] || "" == values[fieldIndex].MSelect[0].Content {
				countEmpty++
			}
		}
		calc.Result = &Value{Number: NewFormattedValueNumber(float64(countEmpty), NumberFormatNone)}
	case CalcOperatorCountNotEmpty:
		countNotEmpty := 0
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].MSelect && 0 < len(values[fieldIndex].MSelect) && nil != values[fieldIndex].MSelect[0] && "" != values[fieldIndex].MSelect[0].Content {
				countNotEmpty++
			}
		}
		calc.Result = &Value{Number: NewFormattedValueNumber(float64(countNotEmpty), NumberFormatNone)}
	case CalcOperatorPercentEmpty:
		countEmpty := 0
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil == values[fieldIndex] || nil == values[fieldIndex].MSelect || 1 > len(values[fieldIndex].MSelect) || nil == values[fieldIndex].MSelect[0] || "" == values[fieldIndex].MSelect[0].Content {
				countEmpty++
			}
		}
		if 0 < len(collection.GetItems()) {
			calc.Result = &Value{Number: NewFormattedValueNumber(float64(countEmpty)/float64(len(collection.GetItems())), NumberFormatPercent)}
		}
	case CalcOperatorPercentNotEmpty:
		countNotEmpty := 0
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].MSelect && 0 < len(values[fieldIndex].MSelect) && nil != values[fieldIndex].MSelect[0] && "" != values[fieldIndex].MSelect[0].Content {
				countNotEmpty++
			}
		}
		if 0 < len(collection.GetItems()) {
			calc.Result = &Value{Number: NewFormattedValueNumber(float64(countNotEmpty)/float64(len(collection.GetItems())), NumberFormatPercent)}
		}
	case CalcOperatorPercentUniqueValues:
		countUniqueValues := 0
		uniqueValues := map[string]bool{}
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].MSelect && 0 < len(values[fieldIndex].MSelect) && nil != values[fieldIndex].MSelect[0] && "" != values[fieldIndex].MSelect[0].Content {
				if _, ok := uniqueValues[values[fieldIndex].MSelect[0].Content]; !ok {
					uniqueValues[values[fieldIndex].MSelect[0].Content] = true
					countUniqueValues++
				}
			}
		}
		if 0 < len(collection.GetItems()) {
			calc.Result = &Value{Number: NewFormattedValueNumber(float64(countUniqueValues)/float64(len(collection.GetItems())), NumberFormatPercent)}
		}
	}
}

func calcFieldDate(collection Collection, field Field, fieldIndex int) {
	calc := field.GetCalc()
	switch calc.Operator {
	case CalcOperatorCountAll:
		calc.Result = &Value{Number: NewFormattedValueNumber(float64(len(collection.GetItems())), NumberFormatNone)}
	case CalcOperatorCountValues:
		countValues := 0
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].Date && values[fieldIndex].Date.IsNotEmpty {
				countValues++
			}
		}
		calc.Result = &Value{Number: NewFormattedValueNumber(float64(countValues), NumberFormatNone)}
	case CalcOperatorCountUniqueValues:
		countUniqueValues := 0
		uniqueValues := map[int64]bool{}
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].Date && values[fieldIndex].Date.IsNotEmpty {
				if _, ok := uniqueValues[values[fieldIndex].Date.Content]; !ok {
					countUniqueValues++
					uniqueValues[values[fieldIndex].Date.Content] = true
				}
			}
		}
		calc.Result = &Value{Number: NewFormattedValueNumber(float64(countUniqueValues), NumberFormatNone)}
	case CalcOperatorCountEmpty:
		countEmpty := 0
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil == values[fieldIndex] || nil == values[fieldIndex].Date || !values[fieldIndex].Date.IsNotEmpty {
				countEmpty++
			}
		}
		calc.Result = &Value{Number: NewFormattedValueNumber(float64(countEmpty), NumberFormatNone)}
	case CalcOperatorCountNotEmpty:
		countNotEmpty := 0
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].Date && values[fieldIndex].Date.IsNotEmpty {
				countNotEmpty++
			}
		}
		calc.Result = &Value{Number: NewFormattedValueNumber(float64(countNotEmpty), NumberFormatNone)}
	case CalcOperatorPercentEmpty:
		countEmpty := 0
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil == values[fieldIndex] || nil == values[fieldIndex].Date || !values[fieldIndex].Date.IsNotEmpty {
				countEmpty++
			}
		}
		if 0 < len(collection.GetItems()) {
			calc.Result = &Value{Number: NewFormattedValueNumber(float64(countEmpty)/float64(len(collection.GetItems())), NumberFormatPercent)}
		}
	case CalcOperatorPercentNotEmpty:
		countNotEmpty := 0
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].Date && values[fieldIndex].Date.IsNotEmpty {
				countNotEmpty++
			}
		}
		if 0 < len(collection.GetItems()) {
			calc.Result = &Value{Number: NewFormattedValueNumber(float64(countNotEmpty)/float64(len(collection.GetItems())), NumberFormatPercent)}
		}
	case CalcOperatorPercentUniqueValues:
		countUniqueValues := 0
		uniqueValues := map[int64]bool{}
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].Date && values[fieldIndex].Date.IsNotEmpty {
				if _, ok := uniqueValues[values[fieldIndex].Date.Content]; !ok {
					countUniqueValues++
					uniqueValues[values[fieldIndex].Date.Content] = true
				}
			}
		}
		if 0 < len(collection.GetItems()) {
			calc.Result = &Value{Number: NewFormattedValueNumber(float64(countUniqueValues)/float64(len(collection.GetItems())), NumberFormatPercent)}
		}
	case CalcOperatorEarliest:
		earliest := int64(0)
		var isNotTime, hasEndDate bool
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].Date && values[fieldIndex].Date.IsNotEmpty {
				if 0 == earliest || earliest > values[fieldIndex].Date.Content {
					earliest = values[fieldIndex].Date.Content
					isNotTime = values[fieldIndex].Date.IsNotTime
					hasEndDate = values[fieldIndex].Date.HasEndDate
				}
			}
		}
		if 0 != earliest {
			calc.Result = &Value{Date: NewFormattedValueDate(earliest, 0, DateFormatNone, isNotTime, hasEndDate)}
		}
	case CalcOperatorLatest:
		latest := int64(0)
		var isNotTime, hasEndDate bool
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].Date && values[fieldIndex].Date.IsNotEmpty {
				if 0 == latest || latest < values[fieldIndex].Date.Content {
					latest = values[fieldIndex].Date.Content
					isNotTime = values[fieldIndex].Date.IsNotTime
					hasEndDate = values[fieldIndex].Date.HasEndDate
				}
			}
		}
		if 0 != latest {
			calc.Result = &Value{Date: NewFormattedValueDate(latest, 0, DateFormatNone, isNotTime, hasEndDate)}
		}
	case CalcOperatorRange:
		earliest := int64(0)
		latest := int64(0)
		var isNotTime, hasEndDate bool
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].Date && values[fieldIndex].Date.IsNotEmpty {
				if 0 == earliest || earliest > values[fieldIndex].Date.Content {
					earliest = values[fieldIndex].Date.Content
					isNotTime = values[fieldIndex].Date.IsNotTime
					hasEndDate = values[fieldIndex].Date.HasEndDate
				}
				if 0 == latest || latest < values[fieldIndex].Date.Content {
					latest = values[fieldIndex].Date.Content
					isNotTime = values[fieldIndex].Date.IsNotTime
					hasEndDate = values[fieldIndex].Date.HasEndDate
				}
			}
		}
		if 0 != earliest && 0 != latest {
			calc.Result = &Value{Date: NewFormattedValueDate(earliest, latest, DateFormatDuration, isNotTime, hasEndDate)}
		}
	}
}

func calcFieldNumber(collection Collection, field Field, fieldIndex int) {
	calc := field.GetCalc()
	switch calc.Operator {
	case CalcOperatorCountAll:
		calc.Result = &Value{Number: NewFormattedValueNumber(float64(len(collection.GetItems())), NumberFormatNone)}
	case CalcOperatorCountValues:
		countValues := 0
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].Number && values[fieldIndex].Number.IsNotEmpty {
				countValues++
			}
		}
		calc.Result = &Value{Number: NewFormattedValueNumber(float64(countValues), NumberFormatNone)}
	case CalcOperatorCountUniqueValues:
		countUniqueValues := 0
		uniqueValues := map[float64]bool{}
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].Number && values[fieldIndex].Number.IsNotEmpty {
				if !uniqueValues[values[fieldIndex].Number.Content] {
					uniqueValues[values[fieldIndex].Number.Content] = true
					countUniqueValues++
				}
			}
		}
		calc.Result = &Value{Number: NewFormattedValueNumber(float64(countUniqueValues), NumberFormatNone)}
	case CalcOperatorCountEmpty:
		countEmpty := 0
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil == values[fieldIndex] || nil == values[fieldIndex].Number || !values[fieldIndex].Number.IsNotEmpty {
				countEmpty++
			}
		}
		calc.Result = &Value{Number: NewFormattedValueNumber(float64(countEmpty), NumberFormatNone)}
	case CalcOperatorCountNotEmpty:
		countNotEmpty := 0
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].Number && values[fieldIndex].Number.IsNotEmpty {
				countNotEmpty++
			}
		}
		calc.Result = &Value{Number: NewFormattedValueNumber(float64(countNotEmpty), NumberFormatNone)}
	case CalcOperatorPercentEmpty:
		countEmpty := 0
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil == values[fieldIndex] || nil == values[fieldIndex].Number || !values[fieldIndex].Number.IsNotEmpty {
				countEmpty++
			}
		}
		if 0 < len(collection.GetItems()) {
			calc.Result = &Value{Number: NewFormattedValueNumber(float64(countEmpty)/float64(len(collection.GetItems())), NumberFormatPercent)}
		}
	case CalcOperatorPercentNotEmpty:
		countNotEmpty := 0
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].Number && values[fieldIndex].Number.IsNotEmpty {
				countNotEmpty++
			}
		}
		if 0 < len(collection.GetItems()) {
			calc.Result = &Value{Number: NewFormattedValueNumber(float64(countNotEmpty)/float64(len(collection.GetItems())), NumberFormatPercent)}
		}
	case CalcOperatorPercentUniqueValues:
		countUniqueValues := 0
		uniqueValues := map[float64]bool{}
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].Number && values[fieldIndex].Number.IsNotEmpty {
				if !uniqueValues[values[fieldIndex].Number.Content] {
					uniqueValues[values[fieldIndex].Number.Content] = true
					countUniqueValues++
				}
			}
		}
		if 0 < len(collection.GetItems()) {
			calc.Result = &Value{Number: NewFormattedValueNumber(float64(countUniqueValues)/float64(len(collection.GetItems())), NumberFormatPercent)}
		}
	case CalcOperatorSum:
		sum := 0.0
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].Number && values[fieldIndex].Number.IsNotEmpty {
				sum += values[fieldIndex].Number.Content
			}
		}
		calc.Result = &Value{Number: NewFormattedValueNumber(sum, field.GetNumberFormat())}
	case CalcOperatorAverage:
		sum := 0.0
		count := 0
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].Number && values[fieldIndex].Number.IsNotEmpty {
				sum += values[fieldIndex].Number.Content
				count++
			}
		}
		if 0 != count {
			calc.Result = &Value{Number: NewFormattedValueNumber(sum/float64(count), field.GetNumberFormat())}
		}
	case CalcOperatorMedian:
		calcValues := []float64{}
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].Number && values[fieldIndex].Number.IsNotEmpty {
				calcValues = append(calcValues, values[fieldIndex].Number.Content)
			}
		}
		sort.Float64s(calcValues)
		if len(calcValues) > 0 {
			if len(calcValues)%2 == 0 {
				calc.Result = &Value{Number: NewFormattedValueNumber((calcValues[len(calcValues)/2-1]+calcValues[len(calcValues)/2])/2, field.GetNumberFormat())}
			} else {
				calc.Result = &Value{Number: NewFormattedValueNumber(calcValues[len(calcValues)/2], field.GetNumberFormat())}
			}
		}
	case CalcOperatorMin:
		minVal := math.MaxFloat64
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].Number && values[fieldIndex].Number.IsNotEmpty {
				if values[fieldIndex].Number.Content < minVal {
					minVal = values[fieldIndex].Number.Content
				}
			}
		}
		if math.MaxFloat64 != minVal {
			calc.Result = &Value{Number: NewFormattedValueNumber(minVal, field.GetNumberFormat())}
		}
	case CalcOperatorMax:
		maxVal := -math.MaxFloat64
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].Number && values[fieldIndex].Number.IsNotEmpty {
				if values[fieldIndex].Number.Content > maxVal {
					maxVal = values[fieldIndex].Number.Content
				}
			}
		}
		if -math.MaxFloat64 != maxVal {
			calc.Result = &Value{Number: NewFormattedValueNumber(maxVal, field.GetNumberFormat())}
		}
	case CalcOperatorRange:
		minVal := math.MaxFloat64
		maxVal := -math.MaxFloat64
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].Number && values[fieldIndex].Number.IsNotEmpty {
				if values[fieldIndex].Number.Content < minVal {
					minVal = values[fieldIndex].Number.Content
				}
				if values[fieldIndex].Number.Content > maxVal {
					maxVal = values[fieldIndex].Number.Content
				}
			}
		}
		if math.MaxFloat64 != minVal && -math.MaxFloat64 != maxVal {
			calc.Result = &Value{Number: NewFormattedValueNumber(maxVal-minVal, field.GetNumberFormat())}
		}
	}
}

func calcFieldText(collection Collection, field Field, fieldIndex int) {
	calc := field.GetCalc()
	switch calc.Operator {
	case CalcOperatorCountAll:
		calc.Result = &Value{Number: NewFormattedValueNumber(float64(len(collection.GetItems())), NumberFormatNone)}
	case CalcOperatorCountValues:
		countValues := 0
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].Text && "" != values[fieldIndex].Text.Content {
				countValues++
			}
		}
		calc.Result = &Value{Number: NewFormattedValueNumber(float64(countValues), NumberFormatNone)}
	case CalcOperatorCountUniqueValues:
		countUniqueValues := 0
		uniqueValues := map[string]bool{}
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].Text && "" != values[fieldIndex].Text.Content {
				if !uniqueValues[values[fieldIndex].Text.Content] {
					uniqueValues[values[fieldIndex].Text.Content] = true
					countUniqueValues++
				}
			}
		}
		calc.Result = &Value{Number: NewFormattedValueNumber(float64(countUniqueValues), NumberFormatNone)}
	case CalcOperatorCountEmpty:
		countEmpty := 0
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil == values[fieldIndex] || nil == values[fieldIndex].Text || "" == values[fieldIndex].Text.Content {
				countEmpty++
			}
		}
		calc.Result = &Value{Number: NewFormattedValueNumber(float64(countEmpty), NumberFormatNone)}
	case CalcOperatorCountNotEmpty:
		countNotEmpty := 0
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].Text && "" != values[fieldIndex].Text.Content {
				countNotEmpty++
			}
		}
		calc.Result = &Value{Number: NewFormattedValueNumber(float64(countNotEmpty), NumberFormatNone)}
	case CalcOperatorPercentEmpty:
		countEmpty := 0
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil == values[fieldIndex] || nil == values[fieldIndex].Text || "" == values[fieldIndex].Text.Content {
				countEmpty++
			}
		}
		if 0 < len(collection.GetItems()) {
			calc.Result = &Value{Number: NewFormattedValueNumber(float64(countEmpty)/float64(len(collection.GetItems())), NumberFormatPercent)}
		}
	case CalcOperatorPercentNotEmpty:
		countNotEmpty := 0
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].Text && "" != values[fieldIndex].Text.Content {
				countNotEmpty++
			}
		}
		if 0 < len(collection.GetItems()) {
			calc.Result = &Value{Number: NewFormattedValueNumber(float64(countNotEmpty)/float64(len(collection.GetItems())), NumberFormatPercent)}
		}
	case CalcOperatorPercentUniqueValues:
		countUniqueValues := 0
		uniqueValues := map[string]bool{}
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].Text && "" != values[fieldIndex].Text.Content {
				if !uniqueValues[values[fieldIndex].Text.Content] {
					uniqueValues[values[fieldIndex].Text.Content] = true
					countUniqueValues++
				}
			}
		}
		if 0 < len(collection.GetItems()) {
			calc.Result = &Value{Number: NewFormattedValueNumber(float64(countUniqueValues)/float64(len(collection.GetItems())), NumberFormatPercent)}
		}
	}
}

func calcFieldURL(collection Collection, field Field, fieldIndex int) {
	calc := field.GetCalc()
	switch calc.Operator {
	case CalcOperatorCountAll:
		calc.Result = &Value{Number: NewFormattedValueNumber(float64(len(collection.GetItems())), NumberFormatNone)}
	case CalcOperatorCountValues:
		countValues := 0
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].URL && "" != values[fieldIndex].URL.Content {
				countValues++
			}
		}
		calc.Result = &Value{Number: NewFormattedValueNumber(float64(countValues), NumberFormatNone)}
	case CalcOperatorCountUniqueValues:
		countUniqueValues := 0
		uniqueValues := map[string]bool{}
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].URL && "" != values[fieldIndex].URL.Content {
				if !uniqueValues[values[fieldIndex].URL.Content] {
					uniqueValues[values[fieldIndex].URL.Content] = true
					countUniqueValues++
				}
			}
		}
		calc.Result = &Value{Number: NewFormattedValueNumber(float64(countUniqueValues), NumberFormatNone)}
	case CalcOperatorCountEmpty:
		countEmpty := 0
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil == values[fieldIndex] || nil == values[fieldIndex].URL || "" == values[fieldIndex].URL.Content {
				countEmpty++
			}
		}
		calc.Result = &Value{Number: NewFormattedValueNumber(float64(countEmpty), NumberFormatNone)}
	case CalcOperatorCountNotEmpty:
		countNotEmpty := 0
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].URL && "" != values[fieldIndex].URL.Content {
				countNotEmpty++
			}
		}
		calc.Result = &Value{Number: NewFormattedValueNumber(float64(countNotEmpty), NumberFormatNone)}
	case CalcOperatorPercentEmpty:
		countEmpty := 0
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil == values[fieldIndex] || nil == values[fieldIndex].URL || "" == values[fieldIndex].URL.Content {
				countEmpty++
			}
		}
		if 0 < len(collection.GetItems()) {
			calc.Result = &Value{Number: NewFormattedValueNumber(float64(countEmpty)/float64(len(collection.GetItems())), NumberFormatPercent)}
		}
	case CalcOperatorPercentNotEmpty:
		countNotEmpty := 0
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].URL && "" != values[fieldIndex].URL.Content {
				countNotEmpty++
			}
		}
		if 0 < len(collection.GetItems()) {
			calc.Result = &Value{Number: NewFormattedValueNumber(float64(countNotEmpty)/float64(len(collection.GetItems())), NumberFormatPercent)}
		}
	case CalcOperatorPercentUniqueValues:
		countUniqueValues := 0
		uniqueValues := map[string]bool{}
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].URL && "" != values[fieldIndex].URL.Content {
				if !uniqueValues[values[fieldIndex].URL.Content] {
					uniqueValues[values[fieldIndex].URL.Content] = true
					countUniqueValues++
				}
			}
		}
		if 0 < len(collection.GetItems()) {
			calc.Result = &Value{Number: NewFormattedValueNumber(float64(countUniqueValues)/float64(len(collection.GetItems())), NumberFormatPercent)}
		}
	}
}

func calcFieldEmail(collection Collection, field Field, fieldIndex int) {
	calc := field.GetCalc()
	switch calc.Operator {
	case CalcOperatorCountAll:
		calc.Result = &Value{Number: NewFormattedValueNumber(float64(len(collection.GetItems())), NumberFormatNone)}
	case CalcOperatorCountValues:
		countValues := 0
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].Email && "" != values[fieldIndex].Email.Content {
				countValues++
			}
		}
		calc.Result = &Value{Number: NewFormattedValueNumber(float64(countValues), NumberFormatNone)}
	case CalcOperatorCountUniqueValues:
		countUniqueValues := 0
		uniqueValues := map[string]bool{}
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].Email && "" != values[fieldIndex].Email.Content {
				if !uniqueValues[values[fieldIndex].Email.Content] {
					uniqueValues[values[fieldIndex].Email.Content] = true
					countUniqueValues++
				}
			}
		}
		calc.Result = &Value{Number: NewFormattedValueNumber(float64(countUniqueValues), NumberFormatNone)}
	case CalcOperatorCountEmpty:
		countEmpty := 0
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil == values[fieldIndex] || nil == values[fieldIndex].Email || "" == values[fieldIndex].Email.Content {
				countEmpty++
			}
		}
		calc.Result = &Value{Number: NewFormattedValueNumber(float64(countEmpty), NumberFormatNone)}
	case CalcOperatorCountNotEmpty:
		countNotEmpty := 0
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].Email && "" != values[fieldIndex].Email.Content {
				countNotEmpty++
			}
		}
		calc.Result = &Value{Number: NewFormattedValueNumber(float64(countNotEmpty), NumberFormatNone)}
	case CalcOperatorPercentEmpty:
		countEmpty := 0
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil == values[fieldIndex] || nil == values[fieldIndex].Email || "" == values[fieldIndex].Email.Content {
				countEmpty++
			}
		}
		if 0 < len(collection.GetItems()) {
			calc.Result = &Value{Number: NewFormattedValueNumber(float64(countEmpty)/float64(len(collection.GetItems())), NumberFormatPercent)}
		}
	case CalcOperatorPercentNotEmpty:
		countNotEmpty := 0
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].Email && "" != values[fieldIndex].Email.Content {
				countNotEmpty++
			}
		}
		if 0 < len(collection.GetItems()) {
			calc.Result = &Value{Number: NewFormattedValueNumber(float64(countNotEmpty)/float64(len(collection.GetItems())), NumberFormatPercent)}
		}
	case CalcOperatorPercentUniqueValues:
		countUniqueValues := 0
		uniqueValues := map[string]bool{}
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].Email && "" != values[fieldIndex].Email.Content {
				if !uniqueValues[values[fieldIndex].Email.Content] {
					uniqueValues[values[fieldIndex].Email.Content] = true
					countUniqueValues++
				}
			}
		}
		if 0 < len(collection.GetItems()) {
			calc.Result = &Value{Number: NewFormattedValueNumber(float64(countUniqueValues)/float64(len(collection.GetItems())), NumberFormatPercent)}
		}
	}
}

func calcFieldPhone(collection Collection, field Field, fieldIndex int) {
	calc := field.GetCalc()
	switch calc.Operator {
	case CalcOperatorCountAll:
		calc.Result = &Value{Number: NewFormattedValueNumber(float64(len(collection.GetItems())), NumberFormatNone)}
	case CalcOperatorCountValues:
		countValues := 0
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].Phone && "" != values[fieldIndex].Phone.Content {
				countValues++
			}
		}
		calc.Result = &Value{Number: NewFormattedValueNumber(float64(countValues), NumberFormatNone)}
	case CalcOperatorCountUniqueValues:
		countUniqueValues := 0
		uniqueValues := map[string]bool{}
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].Phone && "" != values[fieldIndex].Phone.Content {
				if !uniqueValues[values[fieldIndex].Phone.Content] {
					uniqueValues[values[fieldIndex].Phone.Content] = true
					countUniqueValues++
				}
			}
		}
		calc.Result = &Value{Number: NewFormattedValueNumber(float64(countUniqueValues), NumberFormatNone)}
	case CalcOperatorCountEmpty:
		countEmpty := 0
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil == values[fieldIndex] || nil == values[fieldIndex].Phone || "" == values[fieldIndex].Phone.Content {
				countEmpty++
			}
		}
		calc.Result = &Value{Number: NewFormattedValueNumber(float64(countEmpty), NumberFormatNone)}
	case CalcOperatorCountNotEmpty:
		countNotEmpty := 0
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].Phone && "" != values[fieldIndex].Phone.Content {
				countNotEmpty++
			}
		}
		calc.Result = &Value{Number: NewFormattedValueNumber(float64(countNotEmpty), NumberFormatNone)}
	case CalcOperatorPercentEmpty:
		countEmpty := 0
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil == values[fieldIndex] || nil == values[fieldIndex].Phone || "" == values[fieldIndex].Phone.Content {
				countEmpty++
			}
		}
		if 0 < len(collection.GetItems()) {
			calc.Result = &Value{Number: NewFormattedValueNumber(float64(countEmpty)/float64(len(collection.GetItems())), NumberFormatPercent)}
		}
	case CalcOperatorPercentNotEmpty:
		countNotEmpty := 0
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].Phone && "" != values[fieldIndex].Phone.Content {
				countNotEmpty++
			}
		}
		if 0 < len(collection.GetItems()) {
			calc.Result = &Value{Number: NewFormattedValueNumber(float64(countNotEmpty)/float64(len(collection.GetItems())), NumberFormatPercent)}
		}
	case CalcOperatorPercentUniqueValues:
		countUniqueValues := 0
		uniqueValues := map[string]bool{}
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].Phone && "" != values[fieldIndex].Phone.Content {
				if !uniqueValues[values[fieldIndex].Phone.Content] {
					uniqueValues[values[fieldIndex].Phone.Content] = true
					countUniqueValues++
				}
			}
		}
		if 0 < len(collection.GetItems()) {
			calc.Result = &Value{Number: NewFormattedValueNumber(float64(countUniqueValues)/float64(len(collection.GetItems())), NumberFormatPercent)}
		}
	}
}

func calcFieldBlock(collection Collection, field Field, fieldIndex int) {
	calc := field.GetCalc()
	switch calc.Operator {
	case CalcOperatorCountAll:
		calc.Result = &Value{Number: NewFormattedValueNumber(float64(len(collection.GetItems())), NumberFormatNone)}
	case CalcOperatorCountValues:
		countValues := 0
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].Block && "" != values[fieldIndex].Block.Content {
				countValues++
			}
		}
		calc.Result = &Value{Number: NewFormattedValueNumber(float64(countValues), NumberFormatNone)}
	case CalcOperatorCountUniqueValues:
		countUniqueValues := 0
		uniqueValues := map[string]bool{}
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].Block && "" != values[fieldIndex].Block.Content {
				if !uniqueValues[values[fieldIndex].Block.Content] {
					uniqueValues[values[fieldIndex].Block.Content] = true
					countUniqueValues++
				}
			}
		}
		calc.Result = &Value{Number: NewFormattedValueNumber(float64(countUniqueValues), NumberFormatNone)}
	case CalcOperatorCountEmpty:
		countEmpty := 0
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil == values[fieldIndex] || nil == values[fieldIndex].Block || "" == values[fieldIndex].Block.Content {
				countEmpty++
			}
		}
		calc.Result = &Value{Number: NewFormattedValueNumber(float64(countEmpty), NumberFormatNone)}
	case CalcOperatorCountNotEmpty:
		countNotEmpty := 0
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].Block && "" != values[fieldIndex].Block.Content {
				countNotEmpty++
			}
		}
		calc.Result = &Value{Number: NewFormattedValueNumber(float64(countNotEmpty), NumberFormatNone)}
	case CalcOperatorPercentEmpty:
		countEmpty := 0
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil == values[fieldIndex] || nil == values[fieldIndex].Block || "" == values[fieldIndex].Block.Content {
				countEmpty++
			}
		}
		if 0 < len(collection.GetItems()) {
			calc.Result = &Value{Number: NewFormattedValueNumber(float64(countEmpty)/float64(len(collection.GetItems())), NumberFormatPercent)}
		}
	case CalcOperatorPercentNotEmpty:
		countNotEmpty := 0
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].Block && "" != values[fieldIndex].Block.Content {
				countNotEmpty++
			}
		}
		if 0 < len(collection.GetItems()) {
			calc.Result = &Value{Number: NewFormattedValueNumber(float64(countNotEmpty)/float64(len(collection.GetItems())), NumberFormatPercent)}
		}
	case CalcOperatorPercentUniqueValues:
		countUniqueValues := 0
		uniqueValues := map[string]bool{}
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].Block && "" != values[fieldIndex].Block.Content {
				if !uniqueValues[values[fieldIndex].Block.Content] {
					uniqueValues[values[fieldIndex].Block.Content] = true
					countUniqueValues++
				}
			}
		}
		if 0 < len(collection.GetItems()) {
			calc.Result = &Value{Number: NewFormattedValueNumber(float64(countUniqueValues)/float64(len(collection.GetItems())), NumberFormatPercent)}
		}
	}
}

func calcFieldCreated(collection Collection, field Field, fieldIndex int, attrView *AttributeView) {
	calc := field.GetCalc()
	switch calc.Operator {
	case CalcOperatorCountAll:
		calc.Result = &Value{Number: NewFormattedValueNumber(float64(len(collection.GetItems())), NumberFormatNone)}
	case CalcOperatorCountValues:
		countValues := 0
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].Created {
				countValues++
			}
		}
		calc.Result = &Value{Number: NewFormattedValueNumber(float64(countValues), NumberFormatNone)}
	case CalcOperatorCountUniqueValues:
		countUniqueValues := 0
		uniqueValues := map[int64]bool{}
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].Created {
				if _, ok := uniqueValues[values[fieldIndex].Created.Content]; !ok {
					countUniqueValues++
					uniqueValues[values[fieldIndex].Created.Content] = true
				}
			}
		}
		calc.Result = &Value{Number: NewFormattedValueNumber(float64(countUniqueValues), NumberFormatNone)}
	case CalcOperatorCountEmpty:
		countEmpty := 0
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil == values[fieldIndex] || nil == values[fieldIndex].Created {
				countEmpty++
			}
		}
		calc.Result = &Value{Number: NewFormattedValueNumber(float64(countEmpty), NumberFormatNone)}
	case CalcOperatorCountNotEmpty:
		countNotEmpty := 0
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].Created {
				countNotEmpty++
			}
		}
		calc.Result = &Value{Number: NewFormattedValueNumber(float64(countNotEmpty), NumberFormatNone)}
	case CalcOperatorPercentEmpty:
		countEmpty := 0
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil == values[fieldIndex] || nil == values[fieldIndex].Created {
				countEmpty++
			}
		}
		if 0 < len(collection.GetItems()) {
			calc.Result = &Value{Number: NewFormattedValueNumber(float64(countEmpty)/float64(len(collection.GetItems())), NumberFormatPercent)}
		}
	case CalcOperatorPercentNotEmpty:
		countNotEmpty := 0
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].Created {
				countNotEmpty++
			}
		}
		if 0 < len(collection.GetItems()) {
			calc.Result = &Value{Number: NewFormattedValueNumber(float64(countNotEmpty)/float64(len(collection.GetItems())), NumberFormatPercent)}
		}
	case CalcOperatorPercentUniqueValues:
		countUniqueValues := 0
		uniqueValues := map[int64]bool{}
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].Created {
				if _, ok := uniqueValues[values[fieldIndex].Created.Content]; !ok {
					countUniqueValues++
					uniqueValues[values[fieldIndex].Created.Content] = true
				}
			}
		}
		if 0 < len(collection.GetItems()) {
			calc.Result = &Value{Number: NewFormattedValueNumber(float64(countUniqueValues)/float64(len(collection.GetItems())), NumberFormatPercent)}
		}
	case CalcOperatorEarliest:
		earliest := int64(0)
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].Created {
				if 0 == earliest || earliest > values[fieldIndex].Created.Content {
					earliest = values[fieldIndex].Created.Content
				}
			}
		}
		if 0 != earliest {
			key, _ := attrView.GetKey(field.GetID())
			isNotTime := false
			if nil != key && nil != key.Created {
				isNotTime = !key.Created.IncludeTime
			}

			calc.Result = &Value{Created: NewFormattedValueCreated(earliest, 0, CreatedFormatNone, isNotTime)}
		}
	case CalcOperatorLatest:
		latest := int64(0)
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].Created {
				if 0 == latest || latest < values[fieldIndex].Created.Content {
					latest = values[fieldIndex].Created.Content
				}
			}
		}
		if 0 != latest {
			key, _ := attrView.GetKey(field.GetID())
			isNotTime := false
			if nil != key && nil != key.Created {
				isNotTime = !key.Created.IncludeTime
			}

			calc.Result = &Value{Created: NewFormattedValueCreated(latest, 0, CreatedFormatNone, isNotTime)}
		}
	case CalcOperatorRange:
		earliest := int64(0)
		latest := int64(0)
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].Created {
				if 0 == earliest || earliest > values[fieldIndex].Created.Content {
					earliest = values[fieldIndex].Created.Content
				}
				if 0 == latest || latest < values[fieldIndex].Created.Content {
					latest = values[fieldIndex].Created.Content
				}
			}
		}
		if 0 != earliest && 0 != latest {
			key, _ := attrView.GetKey(field.GetID())
			isNotTime := false
			if nil != key && nil != key.Created {
				isNotTime = !key.Created.IncludeTime
			}

			calc.Result = &Value{Created: NewFormattedValueCreated(earliest, latest, CreatedFormatDuration, isNotTime)}
		}
	}
}

func calcFieldUpdated(collection Collection, field Field, fieldIndex int, attrView *AttributeView) {
	calc := field.GetCalc()
	switch calc.Operator {
	case CalcOperatorCountAll:
		calc.Result = &Value{Number: NewFormattedValueNumber(float64(len(collection.GetItems())), NumberFormatNone)}
	case CalcOperatorCountValues:
		countValues := 0
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].Updated && values[fieldIndex].Updated.IsNotEmpty {
				countValues++
			}
		}
		calc.Result = &Value{Number: NewFormattedValueNumber(float64(countValues), NumberFormatNone)}
	case CalcOperatorCountUniqueValues:
		countUniqueValues := 0
		uniqueValues := map[int64]bool{}
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].Updated && values[fieldIndex].Updated.IsNotEmpty {
				if _, ok := uniqueValues[values[fieldIndex].Updated.Content]; !ok {
					countUniqueValues++
					uniqueValues[values[fieldIndex].Updated.Content] = true
				}
			}
		}
		calc.Result = &Value{Number: NewFormattedValueNumber(float64(countUniqueValues), NumberFormatNone)}
	case CalcOperatorCountEmpty:
		countEmpty := 0
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil == values[fieldIndex] || nil == values[fieldIndex].Updated || !values[fieldIndex].Updated.IsNotEmpty {
				countEmpty++
			}
		}
		calc.Result = &Value{Number: NewFormattedValueNumber(float64(countEmpty), NumberFormatNone)}
	case CalcOperatorCountNotEmpty:
		countNotEmpty := 0
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].Updated && values[fieldIndex].Updated.IsNotEmpty {
				countNotEmpty++
			}
		}
		calc.Result = &Value{Number: NewFormattedValueNumber(float64(countNotEmpty), NumberFormatNone)}
	case CalcOperatorPercentEmpty:
		countEmpty := 0
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil == values[fieldIndex] || nil == values[fieldIndex].Updated || !values[fieldIndex].Updated.IsNotEmpty {
				countEmpty++
			}
		}
		if 0 < len(collection.GetItems()) {
			calc.Result = &Value{Number: NewFormattedValueNumber(float64(countEmpty)/float64(len(collection.GetItems())), NumberFormatPercent)}
		}
	case CalcOperatorPercentNotEmpty:
		countNotEmpty := 0
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].Updated && values[fieldIndex].Updated.IsNotEmpty {
				countNotEmpty++
			}
		}
		if 0 < len(collection.GetItems()) {
			calc.Result = &Value{Number: NewFormattedValueNumber(float64(countNotEmpty)/float64(len(collection.GetItems())), NumberFormatPercent)}
		}
	case CalcOperatorPercentUniqueValues:
		countUniqueValues := 0
		uniqueValues := map[int64]bool{}
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].Updated && values[fieldIndex].Updated.IsNotEmpty {
				if _, ok := uniqueValues[values[fieldIndex].Updated.Content]; !ok {
					countUniqueValues++
					uniqueValues[values[fieldIndex].Updated.Content] = true
				}
			}
		}
		if 0 < len(collection.GetItems()) {
			calc.Result = &Value{Number: NewFormattedValueNumber(float64(countUniqueValues)/float64(len(collection.GetItems())), NumberFormatPercent)}
		}
	case CalcOperatorEarliest:
		earliest := int64(0)
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].Updated && values[fieldIndex].Updated.IsNotEmpty {
				if 0 == earliest || earliest > values[fieldIndex].Updated.Content {
					earliest = values[fieldIndex].Updated.Content
				}
			}
		}
		if 0 != earliest {
			key, _ := attrView.GetKey(field.GetID())
			isNotTime := false
			if nil != key && nil != key.Updated {
				isNotTime = !key.Updated.IncludeTime
			}

			calc.Result = &Value{Updated: NewFormattedValueUpdated(earliest, 0, UpdatedFormatNone, isNotTime)}
		}
	case CalcOperatorLatest:
		latest := int64(0)
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].Updated && values[fieldIndex].Updated.IsNotEmpty {
				if 0 == latest || latest < values[fieldIndex].Updated.Content {
					latest = values[fieldIndex].Updated.Content
				}
			}
		}
		if 0 != latest {
			key, _ := attrView.GetKey(field.GetID())
			isNotTime := false
			if nil != key && nil != key.Updated {
				isNotTime = !key.Updated.IncludeTime
			}

			calc.Result = &Value{Updated: NewFormattedValueUpdated(latest, 0, UpdatedFormatNone, isNotTime)}
		}
	case CalcOperatorRange:
		earliest := int64(0)
		latest := int64(0)
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].Updated && values[fieldIndex].Updated.IsNotEmpty {
				if 0 == earliest || earliest > values[fieldIndex].Updated.Content {
					earliest = values[fieldIndex].Updated.Content
				}
				if 0 == latest || latest < values[fieldIndex].Updated.Content {
					latest = values[fieldIndex].Updated.Content
				}
			}
		}
		if 0 != earliest && 0 != latest {
			key, _ := attrView.GetKey(field.GetID())
			isNotTime := false
			if nil != key && nil != key.Updated {
				isNotTime = !key.Updated.IncludeTime
			}

			calc.Result = &Value{Updated: NewFormattedValueUpdated(earliest, latest, UpdatedFormatDuration, isNotTime)}
		}
	}
}

func calcFieldCheckbox(collection Collection, field Field, fieldIndex int) {
	calc := field.GetCalc()
	switch calc.Operator {
	case CalcOperatorCountAll:
		calc.Result = &Value{Number: NewFormattedValueNumber(float64(len(collection.GetItems())), NumberFormatNone)}
	case CalcOperatorChecked:
		countChecked := 0
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].Checkbox && values[fieldIndex].Checkbox.Checked {
				countChecked++
			}
		}
		calc.Result = &Value{Number: NewFormattedValueNumber(float64(countChecked), NumberFormatNone)}
	case CalcOperatorUnchecked:
		countUnchecked := 0
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].Checkbox && !values[fieldIndex].Checkbox.Checked {
				countUnchecked++
			}
		}
		calc.Result = &Value{Number: NewFormattedValueNumber(float64(countUnchecked), NumberFormatNone)}
	case CalcOperatorPercentChecked:
		countChecked := 0
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].Checkbox && values[fieldIndex].Checkbox.Checked {
				countChecked++
			}
		}
		if 0 < len(collection.GetItems()) {
			calc.Result = &Value{Number: NewFormattedValueNumber(float64(countChecked)/float64(len(collection.GetItems())), NumberFormatPercent)}
		}
	case CalcOperatorPercentUnchecked:
		countUnchecked := 0
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].Checkbox && !values[fieldIndex].Checkbox.Checked {
				countUnchecked++
			}
		}
		if 0 < len(collection.GetItems()) {
			calc.Result = &Value{Number: NewFormattedValueNumber(float64(countUnchecked)/float64(len(collection.GetItems())), NumberFormatPercent)}
		}
	}
}

func calcFieldRelation(collection Collection, field Field, fieldIndex int) {
	calc := field.GetCalc()
	switch calc.Operator {
	case CalcOperatorCountAll:
		calc.Result = &Value{Number: NewFormattedValueNumber(float64(len(collection.GetItems())), NumberFormatNone)}
	case CalcOperatorCountValues:
		countValues := 0
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].Relation {
				countValues++
			}
		}
		calc.Result = &Value{Number: NewFormattedValueNumber(float64(countValues), NumberFormatNone)}
	case CalcOperatorCountUniqueValues:
		countUniqueValues := 0
		uniqueValues := map[string]bool{}
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].Relation {
				for _, id := range values[fieldIndex].Relation.BlockIDs {
					if !uniqueValues[id] {
						uniqueValues[id] = true
						countUniqueValues++
					}
				}
			}
		}
		calc.Result = &Value{Number: NewFormattedValueNumber(float64(countUniqueValues), NumberFormatNone)}
	case CalcOperatorCountEmpty:
		countEmpty := 0
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil == values[fieldIndex] || nil == values[fieldIndex].Relation || 0 == len(values[fieldIndex].Relation.BlockIDs) {
				countEmpty++
			}
		}
		calc.Result = &Value{Number: NewFormattedValueNumber(float64(countEmpty), NumberFormatNone)}
	case CalcOperatorCountNotEmpty:
		countNotEmpty := 0
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].Relation && 0 < len(values[fieldIndex].Relation.BlockIDs) {
				countNotEmpty++
			}
		}
		calc.Result = &Value{Number: NewFormattedValueNumber(float64(countNotEmpty), NumberFormatNone)}
	case CalcOperatorPercentEmpty:
		countEmpty := 0
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil == values[fieldIndex] || nil == values[fieldIndex].Relation || 0 == len(values[fieldIndex].Relation.BlockIDs) {
				countEmpty++
			}
		}
		if 0 < len(collection.GetItems()) {
			calc.Result = &Value{Number: NewFormattedValueNumber(float64(countEmpty)/float64(len(collection.GetItems())), NumberFormatPercent)}
		}
	case CalcOperatorPercentNotEmpty:
		countNotEmpty := 0
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].Relation && 0 < len(values[fieldIndex].Relation.BlockIDs) {
				countNotEmpty++
			}
		}
		if 0 < len(collection.GetItems()) {
			calc.Result = &Value{Number: NewFormattedValueNumber(float64(countNotEmpty)/float64(len(collection.GetItems())), NumberFormatPercent)}
		}
	case CalcOperatorPercentUniqueValues:
		countUniqueValues := 0
		uniqueValues := map[string]bool{}
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].Relation {
				for _, id := range values[fieldIndex].Relation.BlockIDs {
					if !uniqueValues[id] {
						uniqueValues[id] = true
						countUniqueValues++
					}
				}
			}
		}
		if 0 < len(collection.GetItems()) {
			calc.Result = &Value{Number: NewFormattedValueNumber(float64(countUniqueValues)/float64(len(collection.GetItems())), NumberFormatPercent)}
		}
	}
}

func calcFieldRollup(collection Collection, field Field, fieldIndex int) {
	calc := field.GetCalc()
	switch calc.Operator {
	case CalcOperatorCountAll:
		calc.Result = &Value{Number: NewFormattedValueNumber(float64(len(collection.GetItems())), NumberFormatNone)}
	case CalcOperatorCountValues:
		countValues := 0
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].Rollup {
				countValues++
			}
		}
		calc.Result = &Value{Number: NewFormattedValueNumber(float64(countValues), NumberFormatNone)}
	case CalcOperatorCountUniqueValues:
		countUniqueValues := 0
		uniqueValues := map[string]bool{}
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].Rollup {
				for _, content := range values[fieldIndex].Rollup.Contents {
					switch content.Type {
					case KeyTypeRelation:
						for _, relationVal := range content.Relation.Contents {
							key := relationVal.String(true)
							if !uniqueValues[key] {
								uniqueValues[key] = true
								countUniqueValues++
							}
						}
					case KeyTypeMSelect:
						for _, mSelectVal := range content.MSelect {
							if !uniqueValues[mSelectVal.Content] {
								uniqueValues[mSelectVal.Content] = true
								countUniqueValues++
							}
						}
					case KeyTypeMAsset:
						for _, mAssetVal := range content.MAsset {
							if !uniqueValues[mAssetVal.Content] {
								uniqueValues[mAssetVal.Content] = true
								countUniqueValues++
							}
						}
					default:
						key := content.String(true)
						if !uniqueValues[key] {
							uniqueValues[key] = true
							countUniqueValues++
						}
					}
				}
			}
		}
		calc.Result = &Value{Number: NewFormattedValueNumber(float64(countUniqueValues), NumberFormatNone)}
	case CalcOperatorCountEmpty:
		countEmpty := 0
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil == values[fieldIndex] || nil == values[fieldIndex].Rollup || 0 == len(values[fieldIndex].Rollup.Contents) {
				countEmpty++
			}
		}
		calc.Result = &Value{Number: NewFormattedValueNumber(float64(countEmpty), NumberFormatNone)}
	case CalcOperatorCountNotEmpty:
		countNotEmpty := 0
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].Rollup && 0 < len(values[fieldIndex].Rollup.Contents) {
				countNotEmpty++
			}
		}
		calc.Result = &Value{Number: NewFormattedValueNumber(float64(countNotEmpty), NumberFormatNone)}
	case CalcOperatorPercentEmpty:
		countEmpty := 0
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil == values[fieldIndex] || nil == values[fieldIndex].Rollup || 0 == len(values[fieldIndex].Rollup.Contents) {
				countEmpty++
			}
		}
		if 0 < len(collection.GetItems()) {
			calc.Result = &Value{Number: NewFormattedValueNumber(float64(countEmpty)/float64(len(collection.GetItems())), NumberFormatPercent)}
		}
	case CalcOperatorPercentNotEmpty:
		countNotEmpty := 0
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].Rollup && 0 < len(values[fieldIndex].Rollup.Contents) {
				countNotEmpty++
			}
		}
		if 0 < len(collection.GetItems()) {
			calc.Result = &Value{Number: NewFormattedValueNumber(float64(countNotEmpty)/float64(len(collection.GetItems())), NumberFormatPercent)}
		}
	case CalcOperatorPercentUniqueValues:
		countUniqueValues := 0
		uniqueValues := map[string]bool{}
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].Rollup {
				for _, content := range values[fieldIndex].Rollup.Contents {
					if !uniqueValues[content.String(true)] {
						uniqueValues[content.String(true)] = true
						countUniqueValues++
					}
				}
			}
		}
		if 0 < len(collection.GetItems()) {
			calc.Result = &Value{Number: NewFormattedValueNumber(float64(countUniqueValues)/float64(len(collection.GetItems())), NumberFormatPercent)}
		}
	case CalcOperatorSum:
		sum := 0.0
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].Rollup && 0 < len(values[fieldIndex].Rollup.Contents) {
				for _, content := range values[fieldIndex].Rollup.Contents {
					val, _ := util.Convert2Float(content.String(false))
					sum += val
				}
			}
		}
		calc.Result = &Value{Number: NewFormattedValueNumber(sum, field.GetNumberFormat())}
	case CalcOperatorAverage:
		sum := 0.0
		count := 0
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].Rollup && 0 < len(values[fieldIndex].Rollup.Contents) {
				for _, content := range values[fieldIndex].Rollup.Contents {
					val, _ := util.Convert2Float(content.String(false))
					sum += val
					count++
				}
			}
		}
		if 0 != count {
			calc.Result = &Value{Number: NewFormattedValueNumber(sum/float64(count), field.GetNumberFormat())}
		}
	case CalcOperatorMedian:
		calcValues := []float64{}
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].Rollup && 0 < len(values[fieldIndex].Rollup.Contents) {
				for _, content := range values[fieldIndex].Rollup.Contents {
					val, _ := util.Convert2Float(content.String(false))
					calcValues = append(calcValues, val)
				}
			}
		}
		sort.Float64s(calcValues)
		if 0 < len(calcValues) {
			if 0 == len(calcValues)%2 {
				calc.Result = &Value{Number: NewFormattedValueNumber((calcValues[len(calcValues)/2-1]+calcValues[len(calcValues)/2])/2, field.GetNumberFormat())}
			} else {
				calc.Result = &Value{Number: NewFormattedValueNumber(calcValues[len(calcValues)/2], field.GetNumberFormat())}
			}
		}
	case CalcOperatorMin:
		minVal := math.MaxFloat64
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].Rollup && 0 < len(values[fieldIndex].Rollup.Contents) {
				for _, content := range values[fieldIndex].Rollup.Contents {
					val, _ := util.Convert2Float(content.String(false))
					if val < minVal {
						minVal = val
					}
				}
			}
		}
		if math.MaxFloat64 != minVal {
			calc.Result = &Value{Number: NewFormattedValueNumber(minVal, field.GetNumberFormat())}
		}
	case CalcOperatorMax:
		maxVal := -math.MaxFloat64
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].Rollup && 0 < len(values[fieldIndex].Rollup.Contents) {
				for _, content := range values[fieldIndex].Rollup.Contents {
					val, _ := util.Convert2Float(content.String(false))
					if val > maxVal {
						maxVal = val
					}
				}
			}
		}
		if -math.MaxFloat64 != maxVal {
			calc.Result = &Value{Number: NewFormattedValueNumber(maxVal, field.GetNumberFormat())}
		}
	case CalcOperatorRange:
		minVal := math.MaxFloat64
		maxVal := -math.MaxFloat64
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].Rollup && 0 < len(values[fieldIndex].Rollup.Contents) {
				for _, content := range values[fieldIndex].Rollup.Contents {
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
			calc.Result = &Value{Number: NewFormattedValueNumber(maxVal-minVal, field.GetNumberFormat())}
		}
	}
}
