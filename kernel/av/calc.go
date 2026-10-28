// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package av

import (
	"math"
	"sort"

	"github.com/siyuan-note/siyuan/kernel/util"
)

// FieldCalc 描述了字段计算操作和结果的结构。
type FieldCalc struct {
	Operator CalcOperator `json:"operator"`           // 计算操作符
	Result   *Value       `json:"result"`             // 计算结果
	Template string       `json:"template,omitempty"` // 自定义模板统计内容，仅当 Operator 为 CalcOperatorTemplate 时使用
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
	CalcOperatorTemplate            CalcOperator = "Template"
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
		calcFieldByScalarContent(collection, field, fieldIndex, countBlockValues, countBlockUniqueValues)
	case KeyTypeText:
		calcFieldByScalarContent(collection, field, fieldIndex, countTextValues, countTextUniqueValues)
	case KeyTypeURL:
		calcFieldByScalarContent(collection, field, fieldIndex, countURLValues, countURLUniqueValues)
	case KeyTypeEmail:
		calcFieldByScalarContent(collection, field, fieldIndex, countEmailValues, countEmailUniqueValues)
	case KeyTypePhone:
		calcFieldByScalarContent(collection, field, fieldIndex, countPhoneValues, countPhoneUniqueValues)
	case KeyTypeSelect:
		calcFieldByScalarContent(collection, field, fieldIndex, countSelectValues, countSelectUniqueValues)
	case KeyTypeNumber:
		calcFieldNumber(collection, field, fieldIndex)
	case KeyTypeDate:
		calcFieldDate(collection, field, fieldIndex)
	case KeyTypeMSelect:
		calcFieldMSelect(collection, field, fieldIndex)
	case KeyTypeLocation:
		calcFieldLocation(collection, field, fieldIndex)
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
		var sum decimalSum
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].Template && "" != values[fieldIndex].Template.Content {
				val, _ := util.Convert2Float(values[fieldIndex].Template.Content)
				sum.add(val)
			}
		}
		calc.Result = &Value{Number: NewFormattedValueNumber(sum.float64(), field.GetNumberFormat())}
	case CalcOperatorAverage:
		var sum decimalSum
		count := 0
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].Template && "" != values[fieldIndex].Template.Content {
				val, _ := util.Convert2Float(values[fieldIndex].Template.Content)
				sum.add(val)
				count++
			}
		}
		if 0 != count {
			calc.Result = &Value{Number: NewFormattedValueNumber(sum.average(count), field.GetNumberFormat())}
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
				calc.Result = &Value{Number: NewFormattedValueNumber(numberMean(calcValues[len(calcValues)/2-1], calcValues[len(calcValues)/2]), field.GetNumberFormat())}
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
			calc.Result = &Value{Number: NewFormattedValueNumber(numberDifference(maxVal, minVal), field.GetNumberFormat())}
		}
	case CalcOperatorTemplate:
		calcFieldByTemplate(collection, field, fieldIndex)
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
	case CalcOperatorTemplate:
		calcFieldByTemplate(collection, field, fieldIndex)
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
	case CalcOperatorTemplate:
		calcFieldByTemplate(collection, field, fieldIndex)
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
			date := NewFormattedValueDate(earliest, 0, DateFormatNone, isNotTime, hasEndDate)
			date.FormatDate(field.GetDateFormat())
			calc.Result = &Value{Date: date}
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
			date := NewFormattedValueDate(latest, 0, DateFormatNone, isNotTime, hasEndDate)
			date.FormatDate(field.GetDateFormat())
			calc.Result = &Value{Date: date}
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
	case CalcOperatorTemplate:
		calcFieldByTemplate(collection, field, fieldIndex)
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
		var sum decimalSum
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].Number && values[fieldIndex].Number.IsNotEmpty {
				sum.add(values[fieldIndex].Number.Content)
			}
		}
		calc.Result = &Value{Number: NewFormattedValueNumber(sum.float64(), field.GetNumberFormat())}
	case CalcOperatorAverage:
		var sum decimalSum
		count := 0
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].Number && values[fieldIndex].Number.IsNotEmpty {
				sum.add(values[fieldIndex].Number.Content)
				count++
			}
		}
		if 0 != count {
			calc.Result = &Value{Number: NewFormattedValueNumber(sum.average(count), field.GetNumberFormat())}
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
				calc.Result = &Value{Number: NewFormattedValueNumber(numberMean(calcValues[len(calcValues)/2-1], calcValues[len(calcValues)/2]), field.GetNumberFormat())}
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
			calc.Result = &Value{Number: NewFormattedValueNumber(numberDifference(maxVal, minVal), field.GetNumberFormat())}
		}
	case CalcOperatorTemplate:
		calcFieldByTemplate(collection, field, fieldIndex)
	}
}

// calcScalarContent 返回单值字段用于统计的内容，空串表示该条目没有值。
// 单值内容字段都只有一处内容来源，集中在这里分派，新增类型只需要在这里登记。
// countBlockValues 统计块引用字段有内容的条目数。
func countBlockValues(items []Item, fieldIndex int) int {
	count := 0
	for _, item := range items {
		values := item.GetValues()
		if fieldIndex < len(values) && nil != values[fieldIndex] && nil != values[fieldIndex].Block && "" != values[fieldIndex].Block.Content {
			count++
		}
	}
	return count
}

// countBlockUniqueValues 统计块引用字段不同内容的个数。
func countBlockUniqueValues(items []Item, fieldIndex int) int {
	unique := map[string]struct{}{}
	for _, item := range items {
		values := item.GetValues()
		if fieldIndex < len(values) && nil != values[fieldIndex] && nil != values[fieldIndex].Block && "" != values[fieldIndex].Block.Content {
			unique[values[fieldIndex].Block.Content] = struct{}{}
		}
	}
	return len(unique)
}

// countTextValues 统计文本字段有内容的条目数。
func countTextValues(items []Item, fieldIndex int) int {
	count := 0
	for _, item := range items {
		values := item.GetValues()
		if fieldIndex < len(values) && nil != values[fieldIndex] && nil != values[fieldIndex].Text && "" != values[fieldIndex].Text.Content {
			count++
		}
	}
	return count
}

// countTextUniqueValues 统计文本字段不同内容的个数。
func countTextUniqueValues(items []Item, fieldIndex int) int {
	unique := map[string]struct{}{}
	for _, item := range items {
		values := item.GetValues()
		if fieldIndex < len(values) && nil != values[fieldIndex] && nil != values[fieldIndex].Text && "" != values[fieldIndex].Text.Content {
			unique[values[fieldIndex].Text.Content] = struct{}{}
		}
	}
	return len(unique)
}

// countURLValues 统计链接字段有内容的条目数。
func countURLValues(items []Item, fieldIndex int) int {
	count := 0
	for _, item := range items {
		values := item.GetValues()
		if fieldIndex < len(values) && nil != values[fieldIndex] && nil != values[fieldIndex].URL && "" != values[fieldIndex].URL.Content {
			count++
		}
	}
	return count
}

// countURLUniqueValues 统计链接字段不同内容的个数。
func countURLUniqueValues(items []Item, fieldIndex int) int {
	unique := map[string]struct{}{}
	for _, item := range items {
		values := item.GetValues()
		if fieldIndex < len(values) && nil != values[fieldIndex] && nil != values[fieldIndex].URL && "" != values[fieldIndex].URL.Content {
			unique[values[fieldIndex].URL.Content] = struct{}{}
		}
	}
	return len(unique)
}

// countEmailValues 统计邮箱字段有内容的条目数。
func countEmailValues(items []Item, fieldIndex int) int {
	count := 0
	for _, item := range items {
		values := item.GetValues()
		if fieldIndex < len(values) && nil != values[fieldIndex] && nil != values[fieldIndex].Email && "" != values[fieldIndex].Email.Content {
			count++
		}
	}
	return count
}

// countEmailUniqueValues 统计邮箱字段不同内容的个数。
func countEmailUniqueValues(items []Item, fieldIndex int) int {
	unique := map[string]struct{}{}
	for _, item := range items {
		values := item.GetValues()
		if fieldIndex < len(values) && nil != values[fieldIndex] && nil != values[fieldIndex].Email && "" != values[fieldIndex].Email.Content {
			unique[values[fieldIndex].Email.Content] = struct{}{}
		}
	}
	return len(unique)
}

// countPhoneValues 统计电话字段有内容的条目数。
func countPhoneValues(items []Item, fieldIndex int) int {
	count := 0
	for _, item := range items {
		values := item.GetValues()
		if fieldIndex < len(values) && nil != values[fieldIndex] && nil != values[fieldIndex].Phone && "" != values[fieldIndex].Phone.Content {
			count++
		}
	}
	return count
}

// countPhoneUniqueValues 统计电话字段不同内容的个数。
func countPhoneUniqueValues(items []Item, fieldIndex int) int {
	unique := map[string]struct{}{}
	for _, item := range items {
		values := item.GetValues()
		if fieldIndex < len(values) && nil != values[fieldIndex] && nil != values[fieldIndex].Phone && "" != values[fieldIndex].Phone.Content {
			unique[values[fieldIndex].Phone.Content] = struct{}{}
		}
	}
	return len(unique)
}

// countSelectValues 统计单选字段有内容的条目数，内容取第一个选项。
func countSelectValues(items []Item, fieldIndex int) int {
	count := 0
	for _, item := range items {
		values := item.GetValues()
		if 0 < len(values) && fieldIndex < len(values) && nil != values[fieldIndex] && 0 < len(values[fieldIndex].MSelect) &&
			nil != values[fieldIndex].MSelect[0] && "" != values[fieldIndex].MSelect[0].Content {
			count++
		}
	}
	return count
}

// countSelectUniqueValues 统计单选字段不同内容的个数，内容取第一个选项。
func countSelectUniqueValues(items []Item, fieldIndex int) int {
	unique := map[string]struct{}{}
	for _, item := range items {
		values := item.GetValues()
		if 0 < len(values) && fieldIndex < len(values) && nil != values[fieldIndex] && 0 < len(values[fieldIndex].MSelect) &&
			nil != values[fieldIndex].MSelect[0] && "" != values[fieldIndex].MSelect[0].Content {
			unique[values[fieldIndex].MSelect[0].Content] = struct{}{}
		}
	}
	return len(unique)
}

// calcFieldByScalarContent 汇总单值内容字段。各类型的内容来源不同，由调用方给出计数函数，
// 算子分派与占比分母在此统一；条目集合只取一次，避免占比算子重复构造条目列表。
func calcFieldByScalarContent(collection Collection, field Field, fieldIndex int,
	countValues, countUniqueValues func([]Item, int) int) {
	calc := field.GetCalc()
	items := collection.GetItems()
	total := len(items)
	switch calc.Operator {
	case CalcOperatorCountAll:
		calc.Result = &Value{Number: NewFormattedValueNumber(float64(total), NumberFormatNone)}
	case CalcOperatorCountValues, CalcOperatorCountNotEmpty:
		calc.Result = &Value{Number: NewFormattedValueNumber(float64(countValues(items, fieldIndex)), NumberFormatNone)}
	case CalcOperatorCountUniqueValues:
		calc.Result = &Value{Number: NewFormattedValueNumber(float64(countUniqueValues(items, fieldIndex)), NumberFormatNone)}
	case CalcOperatorCountEmpty:
		calc.Result = &Value{Number: NewFormattedValueNumber(float64(total-countValues(items, fieldIndex)), NumberFormatNone)}
	case CalcOperatorPercentEmpty:
		if 0 < total {
			calc.Result = &Value{Number: NewFormattedValueNumber(float64(total-countValues(items, fieldIndex))/float64(total), NumberFormatPercent)}
		}
	case CalcOperatorPercentNotEmpty:
		if 0 < total {
			calc.Result = &Value{Number: NewFormattedValueNumber(float64(countValues(items, fieldIndex))/float64(total), NumberFormatPercent)}
		}
	case CalcOperatorPercentUniqueValues:
		if 0 < total {
			calc.Result = &Value{Number: NewFormattedValueNumber(float64(countUniqueValues(items, fieldIndex))/float64(total), NumberFormatPercent)}
		}
	case CalcOperatorTemplate:
		calcFieldByTemplate(collection, field, fieldIndex)
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

			created := NewFormattedValueCreated(earliest, 0, CreatedFormatNone, isNotTime)
			created.FormatDate(field.GetDateFormat(), isNotTime)
			calc.Result = &Value{Created: created}
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

			created := NewFormattedValueCreated(latest, 0, CreatedFormatNone, isNotTime)
			created.FormatDate(field.GetDateFormat(), isNotTime)
			calc.Result = &Value{Created: created}
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
	case CalcOperatorTemplate:
		calcFieldByTemplate(collection, field, fieldIndex)
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

			updated := NewFormattedValueUpdated(earliest, 0, UpdatedFormatNone, isNotTime)
			updated.FormatDate(field.GetDateFormat(), isNotTime)
			calc.Result = &Value{Updated: updated}
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

			updated := NewFormattedValueUpdated(latest, 0, UpdatedFormatNone, isNotTime)
			updated.FormatDate(field.GetDateFormat(), isNotTime)
			calc.Result = &Value{Updated: updated}
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
	case CalcOperatorTemplate:
		calcFieldByTemplate(collection, field, fieldIndex)
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
	case CalcOperatorTemplate:
		calcFieldByTemplate(collection, field, fieldIndex)
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
				countValues += len(values[fieldIndex].Relation.BlockIDs)
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
	case CalcOperatorTemplate:
		calcFieldByTemplate(collection, field, fieldIndex)
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
				countValues += len(values[fieldIndex].Rollup.Contents)
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
		var sum decimalSum
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].Rollup && 0 < len(values[fieldIndex].Rollup.Contents) {
				for _, content := range values[fieldIndex].Rollup.Contents {
					val := calculationNumber(content)
					sum.add(val)
				}
			}
		}
		calc.Result = &Value{Number: NewFormattedValueNumber(sum.float64(), field.GetNumberFormat())}
	case CalcOperatorAverage:
		var sum decimalSum
		count := 0
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].Rollup && 0 < len(values[fieldIndex].Rollup.Contents) {
				for _, content := range values[fieldIndex].Rollup.Contents {
					val := calculationNumber(content)
					sum.add(val)
					count++
				}
			}
		}
		if 0 != count {
			calc.Result = &Value{Number: NewFormattedValueNumber(sum.average(count), field.GetNumberFormat())}
		}
	case CalcOperatorMedian:
		calcValues := []float64{}
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].Rollup && 0 < len(values[fieldIndex].Rollup.Contents) {
				for _, content := range values[fieldIndex].Rollup.Contents {
					val := calculationNumber(content)
					calcValues = append(calcValues, val)
				}
			}
		}
		sort.Float64s(calcValues)
		if 0 < len(calcValues) {
			if 0 == len(calcValues)%2 {
				calc.Result = &Value{Number: NewFormattedValueNumber(numberMean(calcValues[len(calcValues)/2-1], calcValues[len(calcValues)/2]), field.GetNumberFormat())}
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
					val := calculationNumber(content)
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
					val := calculationNumber(content)
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
					val := calculationNumber(content)
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
			calc.Result = &Value{Number: NewFormattedValueNumber(numberDifference(maxVal, minVal), field.GetNumberFormat())}
		}
	case CalcOperatorTemplate:
		// 自定义模板统计：对整列已汇总的值执行用户编写的 .action{...} 模板
		nums := []float64{}
		strs := []string{}
		raw := []*Value{}
		for _, item := range collection.GetItems() {
			values := item.GetValues()
			if nil != values[fieldIndex] && nil != values[fieldIndex].Rollup && 0 < len(values[fieldIndex].Rollup.Contents) {
				for _, content := range values[fieldIndex].Rollup.Contents {
					val := calculationNumber(content)
					nums = append(nums, val)
					strs = append(strs, content.String(false))
					raw = append(raw, content)
				}
			}
		}
		if 0 == len(nums) {
			return
		}
		ctx := buildRollupTemplateContext(nums, strs, raw)
		rendered, asNumber, isNumber, err := evalRollupTemplate(calc.Template, ctx)
		if nil != err {
			pushRollupTemplateErr(err)
			return
		}
		if isNumber {
			calc.Result = &Value{Number: NewFormattedValueNumber(asNumber, field.GetNumberFormat())}
		} else if "" != rendered {
			calc.Result = &Value{Type: KeyTypeText, Text: &ValueText{Content: rendered}}
		}
	}
}
