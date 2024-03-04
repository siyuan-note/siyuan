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
	"bytes"
	"github.com/siyuan-note/siyuan/kernel/util"
	"math"
	"sort"
	"strconv"
	"strings"
	"time"
)

// LayoutTable 描述了表格布局的结构。
type LayoutTable struct {
	Spec int    `json:"spec"` // 布局格式版本
	ID   string `json:"id"`   // 布局 ID

	Columns  []*ViewTableColumn `json:"columns"`  // 表格列
	RowIDs   []string           `json:"rowIds"`   // 行 ID，用于自定义排序
	Filters  []*ViewFilter      `json:"filters"`  // 过滤规则
	Sorts    []*ViewSort        `json:"sorts"`    // 排序规则
	PageSize int                `json:"pageSize"` // 每页行数
}

type ViewTableColumn struct {
	ID string `json:"id"` // 列 ID

	Wrap   bool        `json:"wrap"`           // 是否换行
	Hidden bool        `json:"hidden"`         // 是否隐藏
	Pin    bool        `json:"pin"`            // 是否固定
	Width  string      `json:"width"`          // 列宽度
	Calc   *ColumnCalc `json:"calc,omitempty"` // 计算
}

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

func (value *Value) Compare(other *Value) int {
	switch value.Type {
	case KeyTypeBlock:
		if nil != value.Block && nil != other.Block {
			return strings.Compare(value.Block.Content, other.Block.Content)
		}
	case KeyTypeText:
		if nil != value.Text && nil != other.Text {
			return strings.Compare(value.Text.Content, other.Text.Content)
		}
	case KeyTypeNumber:
		if nil != value.Number && nil != other.Number {
			if value.Number.IsNotEmpty {
				if !other.Number.IsNotEmpty {
					return 1
				}

				if value.Number.Content > other.Number.Content {
					return 1
				} else if value.Number.Content < other.Number.Content {
					return -1
				} else {
					return 0
				}
			} else {
				if other.Number.IsNotEmpty {
					return -1
				}
				return int(value.CreatedAt - other.CreatedAt)
			}
		}
	case KeyTypeDate:
		if nil != value.Date && nil != other.Date {
			if value.Date.IsNotEmpty {
				if !other.Date.IsNotEmpty {
					return 1
				}
				if value.Date.Content > other.Date.Content {
					return 1
				} else if value.Date.Content < other.Date.Content {
					return -1
				} else {
					return 0
				}
			} else {
				if other.Date.IsNotEmpty {
					return -1
				}
				return int(value.CreatedAt - other.CreatedAt)
			}
		}
	case KeyTypeCreated:
		if nil != value.Created && nil != other.Created {
			if value.Created.Content > other.Created.Content {
				return 1
			} else if value.Created.Content < other.Created.Content {
				return -1
			} else {
				return 0
			}
		}
	case KeyTypeUpdated:
		if nil != value.Updated && nil != other.Updated {
			if value.Updated.Content > other.Updated.Content {
				return 1
			} else if value.Updated.Content < other.Updated.Content {
				return -1
			} else {
				return 0
			}
		}
	case KeyTypeSelect, KeyTypeMSelect:
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
	case KeyTypeURL:
		if nil != value.URL && nil != other.URL {
			return strings.Compare(value.URL.Content, other.URL.Content)
		}
	case KeyTypeEmail:
		if nil != value.Email && nil != other.Email {
			return strings.Compare(value.Email.Content, other.Email.Content)
		}
	case KeyTypePhone:
		if nil != value.Phone && nil != other.Phone {
			return strings.Compare(value.Phone.Content, other.Phone.Content)
		}
	case KeyTypeMAsset:
		if nil != value.MAsset && nil != other.MAsset {
			var v1 string
			for _, v := range value.MAsset {
				v1 += v.Content
			}
			var v2 string
			for _, v := range other.MAsset {
				v2 += v.Content
			}
			return strings.Compare(v1, v2)
		}
	case KeyTypeTemplate:
		if nil != value.Template && nil != other.Template {
			vContent := strings.TrimSpace(value.Template.Content)
			oContent := strings.TrimSpace(other.Template.Content)
			if util.IsNumeric(vContent) && util.IsNumeric(oContent) {
				v1, _ := strconv.ParseFloat(vContent, 64)
				v2, _ := strconv.ParseFloat(oContent, 64)
				if v1 > v2 {
					return 1
				}

				if v1 < v2 {
					return -1
				}
				return 0
			}
			return strings.Compare(value.Template.Content, other.Template.Content)
		}
	case KeyTypeCheckbox:
		if nil != value.Checkbox && nil != other.Checkbox {
			if value.Checkbox.Checked && !other.Checkbox.Checked {
				return 1
			}
			if !value.Checkbox.Checked && other.Checkbox.Checked {
				return -1
			}
			return 0
		}
	case KeyTypeRelation:
		if nil != value.Relation && nil != other.Relation {
			vContent := strings.TrimSpace(strings.Join(value.Relation.Contents, " "))
			oContent := strings.TrimSpace(strings.Join(other.Relation.Contents, " "))
			return strings.Compare(vContent, oContent)
		}
	case KeyTypeRollup:
		if nil != value.Rollup && nil != other.Rollup {
			vContentBuf := bytes.Buffer{}
			for _, c := range value.Rollup.Contents {
				vContentBuf.WriteString(c.String())
				vContentBuf.WriteByte(' ')
			}
			vContent := strings.TrimSpace(vContentBuf.String())
			oContentBuf := bytes.Buffer{}
			for _, c := range other.Rollup.Contents {
				oContentBuf.WriteString(c.String())
				oContentBuf.WriteByte(' ')
			}
			oContent := strings.TrimSpace(oContentBuf.String())

			if util.IsNumeric(vContent) && util.IsNumeric(oContent) {
				v1, _ := strconv.ParseFloat(vContent, 64)
				v2, _ := strconv.ParseFloat(oContent, 64)
				if v1 > v2 {
					return 1
				}

				if v1 < v2 {
					return -1
				}
				return 0
			}
			return strings.Compare(vContent, oContent)
		}
	}
	return int(value.CreatedAt - other.CreatedAt)
}

func (value *Value) CompareOperator(filter *ViewFilter, attrView *AttributeView, rowID string) bool {
	if nil != value.Rollup && KeyTypeRollup == filter.Value.Type {
		rollupKey, _ := attrView.GetKey(value.KeyID)
		if nil == rollupKey {
			return false
		}
		relKey, _ := attrView.GetKey(rollupKey.Rollup.RelationKeyID)
		if nil == relKey {
			return false
		}

		relVal := attrView.GetValue(relKey.ID, rowID)
		if nil == relVal || nil == relVal.Relation {
			return false
		}

		destAv, _ := ParseAttributeView(relKey.Relation.AvID)
		if nil == destAv {
			return false
		}

		for _, blockID := range relVal.Relation.BlockIDs {
			destVal := destAv.GetValue(rollupKey.Rollup.KeyID, blockID)
			if nil == destVal {
				continue
			}

			if destVal.compareOperator(filter) {
				return true
			}
		}
		return false
	}

	return value.compareOperator(filter)
}

func (value *Value) compareOperator(filter *ViewFilter) bool {
	if nil == filter || (nil == filter.Value && nil == filter.RelativeDate) {
		return true
	}

	operator := filter.Operator

	if nil != value.Block && nil != filter.Value.Block {
		switch operator {
		case FilterOperatorIsEqual:
			return value.Block.Content == filter.Value.Block.Content
		case FilterOperatorIsNotEqual:
			return value.Block.Content != filter.Value.Block.Content
		case FilterOperatorContains:
			return strings.Contains(value.Block.Content, filter.Value.Block.Content)
		case FilterOperatorDoesNotContain:
			return !strings.Contains(value.Block.Content, filter.Value.Block.Content)
		case FilterOperatorStartsWith:
			return strings.HasPrefix(value.Block.Content, filter.Value.Block.Content)
		case FilterOperatorEndsWith:
			return strings.HasSuffix(value.Block.Content, filter.Value.Block.Content)
		case FilterOperatorIsEmpty:
			return "" == strings.TrimSpace(value.Block.Content)
		case FilterOperatorIsNotEmpty:
			return "" != strings.TrimSpace(value.Block.Content)
		}
	}

	if nil != value.Text && nil != filter.Value.Text {
		switch operator {
		case FilterOperatorIsEqual:
			if "" == strings.TrimSpace(filter.Value.Text.Content) {
				return true
			}
			return value.Text.Content == filter.Value.Text.Content
		case FilterOperatorIsNotEqual:
			if "" == strings.TrimSpace(filter.Value.Text.Content) {
				return true
			}
			return value.Text.Content != filter.Value.Text.Content
		case FilterOperatorContains:
			if "" == strings.TrimSpace(filter.Value.Text.Content) {
				return true
			}
			return strings.Contains(value.Text.Content, filter.Value.Text.Content)
		case FilterOperatorDoesNotContain:
			if "" == strings.TrimSpace(filter.Value.Text.Content) {
				return true
			}
			return !strings.Contains(value.Text.Content, filter.Value.Text.Content)
		case FilterOperatorStartsWith:
			if "" == strings.TrimSpace(filter.Value.Text.Content) {
				return true
			}
			return strings.HasPrefix(value.Text.Content, filter.Value.Text.Content)
		case FilterOperatorEndsWith:
			if "" == strings.TrimSpace(filter.Value.Text.Content) {
				return true
			}
			return strings.HasSuffix(value.Text.Content, filter.Value.Text.Content)
		case FilterOperatorIsEmpty:
			return "" == strings.TrimSpace(value.Text.Content)
		case FilterOperatorIsNotEmpty:
			return "" != strings.TrimSpace(value.Text.Content)
		}
	}

	if nil != value.Number && nil != filter.Value.Number {
		switch operator {
		case FilterOperatorIsEqual:
			if !filter.Value.Number.IsNotEmpty {
				return true
			}
			return value.Number.Content == filter.Value.Number.Content
		case FilterOperatorIsNotEqual:
			if !filter.Value.Number.IsNotEmpty {
				return true
			}
			return value.Number.Content != filter.Value.Number.Content
		case FilterOperatorIsGreater:
			return value.Number.Content > filter.Value.Number.Content
		case FilterOperatorIsGreaterOrEqual:
			return value.Number.Content >= filter.Value.Number.Content
		case FilterOperatorIsLess:
			return value.Number.Content < filter.Value.Number.Content
		case FilterOperatorIsLessOrEqual:
			return value.Number.Content <= filter.Value.Number.Content
		case FilterOperatorIsEmpty:
			return !value.Number.IsNotEmpty
		case FilterOperatorIsNotEmpty:
			return value.Number.IsNotEmpty
		}
	}

	if nil != value.Date {
		if nil != filter.RelativeDate {
			// 使用相对时间比较

			count := filter.RelativeDate.Count
			unit := filter.RelativeDate.Unit
			direction := filter.RelativeDate.Direction
			valueTime := time.UnixMilli(value.Date.Content)
			relativeTimeStart, relativeTimeEnd := calcRelativeTimeRegion(count, unit, direction)
			switch operator {
			case FilterOperatorIsEqual:
				return (valueTime.After(relativeTimeStart) || valueTime.Equal(relativeTimeStart)) && (valueTime.Before(relativeTimeEnd) || valueTime.Equal(relativeTimeEnd))
			case FilterOperatorIsNotEqual:
				return !(valueTime.After(relativeTimeStart) || valueTime.Equal(relativeTimeStart)) || !(valueTime.Before(relativeTimeEnd) || valueTime.Equal(relativeTimeEnd))
			case FilterOperatorIsGreater:
				return valueTime.After(relativeTimeEnd)
			case FilterOperatorIsGreaterOrEqual:
				return valueTime.After(relativeTimeEnd) || valueTime.Equal(relativeTimeEnd)
			case FilterOperatorIsLess:
				return valueTime.Before(relativeTimeStart)
			case FilterOperatorIsLessOrEqual:
				return valueTime.Before(relativeTimeStart) || valueTime.Equal(relativeTimeStart)
			case FilterOperatorIsBetween:
				_, relativeTime2End := calcRelativeTimeRegion(filter.RelativeDate2.Count, filter.RelativeDate2.Unit, filter.RelativeDate2.Direction)
				return (valueTime.After(relativeTimeStart) || valueTime.Equal(relativeTimeStart)) && (valueTime.Before(relativeTime2End) || valueTime.Equal(relativeTime2End))
			}
		} else { // 使用具体时间比较
			if nil != filter.Value.Date {
				return true
			}

			switch operator {
			case FilterOperatorIsEqual:
				if !filter.Value.Date.IsNotEmpty {
					return true
				}
				return value.Date.Content == filter.Value.Date.Content
			case FilterOperatorIsNotEqual:
				if !filter.Value.Date.IsNotEmpty {
					return true
				}
				return value.Date.Content != filter.Value.Date.Content
			case FilterOperatorIsGreater:
				return value.Date.Content > filter.Value.Date.Content
			case FilterOperatorIsGreaterOrEqual:
				return value.Date.Content >= filter.Value.Date.Content
			case FilterOperatorIsLess:
				return value.Date.Content < filter.Value.Date.Content
			case FilterOperatorIsLessOrEqual:
				return value.Date.Content <= filter.Value.Date.Content
			case FilterOperatorIsBetween:
				start := value.Date.Content >= filter.Value.Date.Content
				end := value.Date.Content <= filter.Value.Date.Content2
				if value.Date.HasEndDate {
					end = value.Date.Content2 <= filter.Value.Date.Content2
				}
				return start && end
			case FilterOperatorIsEmpty:
				return !value.Date.IsNotEmpty
			case FilterOperatorIsNotEmpty:
				return value.Date.IsNotEmpty
			}
		}
	}

	if nil != value.Created && nil != filter.Value.Created {
		switch operator {
		case FilterOperatorIsEqual:
			return value.Created.Content == filter.Value.Created.Content
		case FilterOperatorIsNotEqual:
			return value.Created.Content != filter.Value.Created.Content
		case FilterOperatorIsGreater:
			return value.Created.Content > filter.Value.Created.Content
		case FilterOperatorIsGreaterOrEqual:
			return value.Created.Content >= filter.Value.Created.Content
		case FilterOperatorIsLess:
			return value.Created.Content < filter.Value.Created.Content
		case FilterOperatorIsLessOrEqual:
			return value.Created.Content <= filter.Value.Created.Content
		case FilterOperatorIsBetween:
			start := value.Created.Content >= filter.Value.Created.Content
			end := value.Created.Content <= filter.Value.Created.Content2
			return start && end
		case FilterOperatorIsEmpty:
			return !value.Created.IsNotEmpty
		case FilterOperatorIsNotEmpty:
			return value.Created.IsNotEmpty
		}
	}

	if nil != value.Updated && nil != filter.Value.Updated {
		switch operator {
		case FilterOperatorIsEqual:
			return value.Updated.Content == filter.Value.Updated.Content
		case FilterOperatorIsNotEqual:
			return value.Updated.Content != filter.Value.Updated.Content
		case FilterOperatorIsGreater:
			return value.Updated.Content > filter.Value.Updated.Content
		case FilterOperatorIsGreaterOrEqual:
			return value.Updated.Content >= filter.Value.Updated.Content
		case FilterOperatorIsLess:
			return value.Updated.Content < filter.Value.Updated.Content
		case FilterOperatorIsLessOrEqual:
			return value.Updated.Content <= filter.Value.Updated.Content
		case FilterOperatorIsBetween:
			start := value.Updated.Content >= filter.Value.Updated.Content
			end := value.Updated.Content <= filter.Value.Updated.Content2
			return start && end
		case FilterOperatorIsEmpty:
			return !value.Updated.IsNotEmpty
		case FilterOperatorIsNotEmpty:
			return value.Updated.IsNotEmpty
		}
	}

	if nil != value.MSelect {
		if nil != filter.Value.MSelect {
			switch operator {
			case FilterOperatorIsEqual, FilterOperatorContains:
				contains := false
				for _, v := range value.MSelect {
					for _, v2 := range filter.Value.MSelect {
						if v.Content == v2.Content {
							contains = true
							break
						}
					}
				}
				return contains
			case FilterOperatorIsNotEqual, FilterOperatorDoesNotContain:
				contains := false
				for _, v := range value.MSelect {
					for _, v2 := range filter.Value.MSelect {
						if v.Content == v2.Content {
							contains = true
							break
						}
					}
				}
				return !contains
			case FilterOperatorIsEmpty:
				return 0 == len(value.MSelect) || 1 == len(value.MSelect) && "" == value.MSelect[0].Content
			case FilterOperatorIsNotEmpty:
				return 0 != len(value.MSelect) && !(1 == len(value.MSelect) && "" == value.MSelect[0].Content)
			}
			return false
		}

		// 没有设置比较值

		switch operator {
		case FilterOperatorIsEqual, FilterOperatorIsNotEqual, FilterOperatorContains, FilterOperatorDoesNotContain:
			return true
		case FilterOperatorIsEmpty:
			return 0 == len(value.MSelect) || 1 == len(value.MSelect) && "" == value.MSelect[0].Content
		case FilterOperatorIsNotEmpty:
			return 0 != len(value.MSelect) && !(1 == len(value.MSelect) && "" == value.MSelect[0].Content)
		}
	}

	if nil != value.URL && nil != filter.Value.URL {
		switch operator {
		case FilterOperatorIsEqual:
			return value.URL.Content == filter.Value.URL.Content
		case FilterOperatorIsNotEqual:
			return value.URL.Content != filter.Value.URL.Content
		case FilterOperatorContains:
			return strings.Contains(value.URL.Content, filter.Value.URL.Content)
		case FilterOperatorDoesNotContain:
			return !strings.Contains(value.URL.Content, filter.Value.URL.Content)
		case FilterOperatorStartsWith:
			return strings.HasPrefix(value.URL.Content, filter.Value.URL.Content)
		case FilterOperatorEndsWith:
			return strings.HasSuffix(value.URL.Content, filter.Value.URL.Content)
		case FilterOperatorIsEmpty:
			return "" == strings.TrimSpace(value.URL.Content)
		case FilterOperatorIsNotEmpty:
			return "" != strings.TrimSpace(value.URL.Content)
		}
	}

	if nil != value.Email && nil != filter.Value.Email {
		switch operator {
		case FilterOperatorIsEqual:
			return value.Email.Content == filter.Value.Email.Content
		case FilterOperatorIsNotEqual:
			return value.Email.Content != filter.Value.Email.Content
		case FilterOperatorContains:
			return strings.Contains(value.Email.Content, filter.Value.Email.Content)
		case FilterOperatorDoesNotContain:
			return !strings.Contains(value.Email.Content, filter.Value.Email.Content)
		case FilterOperatorStartsWith:
			return strings.HasPrefix(value.Email.Content, filter.Value.Email.Content)
		case FilterOperatorEndsWith:
			return strings.HasSuffix(value.Email.Content, filter.Value.Email.Content)
		case FilterOperatorIsEmpty:
			return "" == strings.TrimSpace(value.Email.Content)
		case FilterOperatorIsNotEmpty:
			return "" != strings.TrimSpace(value.Email.Content)
		}
	}

	if nil != value.Phone && nil != filter.Value.Phone {
		switch operator {
		case FilterOperatorIsEqual:
			return value.Phone.Content == filter.Value.Phone.Content
		case FilterOperatorIsNotEqual:
			return value.Phone.Content != filter.Value.Phone.Content
		case FilterOperatorContains:
			return strings.Contains(value.Phone.Content, filter.Value.Phone.Content)
		case FilterOperatorDoesNotContain:
			return !strings.Contains(value.Phone.Content, filter.Value.Phone.Content)
		case FilterOperatorStartsWith:
			return strings.HasPrefix(value.Phone.Content, filter.Value.Phone.Content)
		case FilterOperatorEndsWith:
			return strings.HasSuffix(value.Phone.Content, filter.Value.Phone.Content)
		case FilterOperatorIsEmpty:
			return "" == strings.TrimSpace(value.Phone.Content)
		case FilterOperatorIsNotEmpty:
			return "" != strings.TrimSpace(value.Phone.Content)
		}
	}

	if nil != value.MAsset && nil != filter.Value.MAsset && 0 < len(value.MAsset) && 0 < len(filter.Value.MAsset) {
		switch operator {
		case FilterOperatorIsEqual, FilterOperatorContains:
			contains := false
			for _, v := range value.MAsset {
				for _, v2 := range filter.Value.MAsset {
					if v.Content == v2.Content {
						contains = true
						break
					}
				}
			}
			return contains
		case FilterOperatorIsNotEqual, FilterOperatorDoesNotContain:
			contains := false
			for _, v := range value.MAsset {
				for _, v2 := range filter.Value.MAsset {
					if v.Content == v2.Content {
						contains = true
						break
					}
				}
			}
			return !contains
		case FilterOperatorIsEmpty:
			return 0 == len(value.MAsset) || 1 == len(value.MAsset) && "" == value.MAsset[0].Content
		case FilterOperatorIsNotEmpty:
			return 0 != len(value.MAsset) && !(1 == len(value.MAsset) && "" == value.MAsset[0].Content)
		}
	}

	if nil != value.Template && nil != filter.Value.Template {
		switch operator {
		case FilterOperatorIsEqual:
			if "" == strings.TrimSpace(filter.Value.Template.Content) {
				return true
			}
			return value.Template.Content == filter.Value.Template.Content
		case FilterOperatorIsNotEqual:
			if "" == strings.TrimSpace(filter.Value.Template.Content) {
				return true
			}
			return value.Template.Content != filter.Value.Template.Content
		case FilterOperatorIsGreater:
			if "" == strings.TrimSpace(filter.Value.Template.Content) {
				return true
			}
			return value.Template.Content > filter.Value.Template.Content
		case FilterOperatorIsGreaterOrEqual:
			if "" == strings.TrimSpace(filter.Value.Template.Content) {
				return true
			}
			return value.Template.Content >= filter.Value.Template.Content
		case FilterOperatorIsLess:
			if "" == strings.TrimSpace(filter.Value.Template.Content) {
				return true
			}
			return value.Template.Content < filter.Value.Template.Content
		case FilterOperatorIsLessOrEqual:
			if "" == strings.TrimSpace(filter.Value.Template.Content) {
				return true
			}
			return value.Template.Content <= filter.Value.Template.Content
		case FilterOperatorContains:
			if "" == strings.TrimSpace(filter.Value.Template.Content) {
				return true
			}
			return strings.Contains(value.Template.Content, filter.Value.Template.Content)
		case FilterOperatorDoesNotContain:
			if "" == strings.TrimSpace(filter.Value.Template.Content) {
				return true
			}
			return !strings.Contains(value.Template.Content, filter.Value.Template.Content)
		case FilterOperatorStartsWith:
			if "" == strings.TrimSpace(filter.Value.Template.Content) {
				return true
			}
			return strings.HasPrefix(value.Template.Content, filter.Value.Template.Content)
		case FilterOperatorEndsWith:
			if "" == strings.TrimSpace(filter.Value.Template.Content) {
				return true
			}
			return strings.HasSuffix(value.Template.Content, filter.Value.Template.Content)
		case FilterOperatorIsEmpty:
			return "" == strings.TrimSpace(value.Template.Content)
		case FilterOperatorIsNotEmpty:
			return "" != strings.TrimSpace(value.Template.Content)
		}
	}

	if nil != value.Checkbox {
		switch operator {
		case FilterOperatorIsTrue:
			return value.Checkbox.Checked
		case FilterOperatorIsFalse:
			return !value.Checkbox.Checked
		}
	}

	if nil != value.Relation && nil != filter.Value.Relation {
		switch operator {
		case FilterOperatorContains:
			contains := false
			for _, c := range value.Relation.Contents {
				for _, c1 := range filter.Value.Relation.Contents {
					if strings.Contains(c, c1) {
						contains = true
						break
					}
				}
			}
			return contains
		case FilterOperatorDoesNotContain:
			contains := false
			for _, c := range value.Relation.Contents {
				for _, c1 := range filter.Value.Relation.Contents {
					if strings.Contains(c, c1) {
						contains = true
						break
					}
				}
			}
			return !contains
		case FilterOperatorIsEmpty:
			return 0 == len(value.Relation.Contents) || 1 == len(value.Relation.Contents) && "" == value.Relation.Contents[0]
		case FilterOperatorIsNotEmpty:
			return 0 != len(value.Relation.Contents) && !(1 == len(value.Relation.Contents) && "" == value.Relation.Contents[0])
		}
	}
	return false
}

// 根据 Count、Unit 和 Direction 计算相对当前时间的开始时间和结束时间
func calcRelativeTimeRegion(count int, unit RelativeDateUnit, direction RelativeDateDirection) (start, end time.Time) {
	now := time.Now()
	switch unit {
	case RelativeDateUnitDay:
		switch direction {
		case RelativeDateDirectionBefore:
			// 结束时间使用今天的开始时间
			end = time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
			// 开始时间使用结束时间减去 count 天
			start = end.AddDate(0, 0, -count)
		case RelativeDateDirectionThis:
			// 开始时间使用今天的开始时间
			start = time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
			// 结束时间使用开始时间加上 count 天
			end = start.AddDate(0, 0, count)
		case RelativeDateDirectionAfter:
			// 开始时间使用今天的结束时间
			start = time.Date(now.Year(), now.Month(), now.Day(), 23, 59, 59, 999999999, now.Location())
			// 结束时间使用开始时间加上 count 天
			end = start.AddDate(0, 0, count)
		}
	case RelativeDateUnitWeek:
		weekday := int(now.Weekday())
		if 0 == weekday {
			weekday = 7
		}
		switch direction {
		case RelativeDateDirectionBefore:
			// 结束时间使用本周的开始时间
			end = time.Date(now.Year(), now.Month(), now.Day()-weekday, 0, 0, 0, 0, now.Location())
			// 开始时间使用结束时间减去 count*7 天
			start = end.AddDate(0, 0, -count*7)
		case RelativeDateDirectionThis:
			// 开始时间使用本周的开始时间
			start = time.Date(now.Year(), now.Month(), now.Day()-weekday, 0, 0, 0, 0, now.Location())
			// 结束时间使用开始时间加上 count*7 天
			end = start.AddDate(0, 0, count*7)
		case RelativeDateDirectionAfter:
			//  开始时间使用本周的结束时间
			start = time.Date(now.Year(), now.Month(), now.Day()-weekday+7, 23, 59, 59, 999999999, now.Location())
			// 结束时间使用开始时间加上 count*7 天
			end = start.AddDate(0, 0, count*7)
		}
	case RelativeDateUnitMonth:
		switch direction {
		case RelativeDateDirectionBefore:
			// 结束时间使用本月的开始时间
			end = time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location())
			// 开始时间使用结束时间减去 count 个月
			start = end.AddDate(0, -count, 0)
		case RelativeDateDirectionThis:
			// 开始时间使用本月的开始时间
			start = time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location())
			// 结束时间使用开始时间加上 count 个月
			end = start.AddDate(0, count, 0)
		case RelativeDateDirectionAfter:
			// 开始时间使用本月的结束时间
			start = time.Date(now.Year(), now.Month()+1, 1, 0, 0, 0, 0, now.Location()).Add(-time.Nanosecond)
			// 结束时间使用开始时间加上 count 个月
			end = start.AddDate(0, count, 0)
		}
	case RelativeDateUnitYear:
		switch direction {
		case RelativeDateDirectionBefore:
			// 结束时间使用今年的开始时间
			end = time.Date(now.Year(), 1, 1, 0, 0, 0, 0, now.Location())
			// 开始时间使用结束时间减去 count 年
			start = end.AddDate(-count, 0, 0)
		case RelativeDateDirectionThis:
			// 开始时间使用今年的开始时间
			start = time.Date(now.Year(), 1, 1, 0, 0, 0, 0, now.Location())
			// 结束时间使用开始时间加上 count 年
			end = start.AddDate(count, 0, 0)
		case RelativeDateDirectionAfter:
			// 开始时间使用今年的结束时间
			start = time.Date(now.Year()+1, 1, 1, 0, 0, 0, 0, now.Location()).Add(-time.Nanosecond)
			// 结束时间使用开始时间加上 count 年
			end = start.AddDate(count, 0, 0)
		}
	}
	return
}

// Table 描述了表格实例的结构。
type Table struct {
	ID               string         `json:"id"`               // 表格布局 ID
	Icon             string         `json:"icon"`             // 表格图标
	Name             string         `json:"name"`             // 表格名称
	HideAttrViewName bool           `json:"hideAttrViewName"` // 是否隐藏属性视图名称
	Filters          []*ViewFilter  `json:"filters"`          // 过滤规则
	Sorts            []*ViewSort    `json:"sorts"`            // 排序规则
	Columns          []*TableColumn `json:"columns"`          // 表格列
	Rows             []*TableRow    `json:"rows"`             // 表格行
	RowCount         int            `json:"rowCount"`         // 表格总行数
	PageSize         int            `json:"pageSize"`         // 每页行数
}

type TableColumn struct {
	ID     string      `json:"id"`     // 列 ID
	Name   string      `json:"name"`   // 列名
	Type   KeyType     `json:"type"`   // 列类型
	Icon   string      `json:"icon"`   // 列图标
	Wrap   bool        `json:"wrap"`   // 是否换行
	Hidden bool        `json:"hidden"` // 是否隐藏
	Pin    bool        `json:"pin"`    // 是否固定
	Width  string      `json:"width"`  // 列宽度
	Calc   *ColumnCalc `json:"calc"`   // 计算

	// 以下是某些列类型的特有属性

	Options      []*SelectOption `json:"options,omitempty"`  // 选项列表
	NumberFormat NumberFormat    `json:"numberFormat"`       // 列数字格式化
	Template     string          `json:"template"`           // 模板内容
	Relation     *Relation       `json:"relation,omitempty"` // 关联列
	Rollup       *Rollup         `json:"rollup,omitempty"`   // 汇总列
}

type TableCell struct {
	ID        string  `json:"id"`
	Value     *Value  `json:"value"`
	ValueType KeyType `json:"valueType"`
	Color     string  `json:"color"`
	BgColor   string  `json:"bgColor"`
}

type TableRow struct {
	ID    string       `json:"id"`
	Cells []*TableCell `json:"cells"`
}

func (row *TableRow) GetBlockValue() (ret *Value) {
	for _, cell := range row.Cells {
		if KeyTypeBlock == cell.ValueType {
			ret = cell.Value
			break
		}
	}
	return
}

func (table *Table) GetType() LayoutType {
	return LayoutTypeTable
}

func (table *Table) GetID() string {
	return table.ID
}

func (table *Table) SortRows() {
	if 1 > len(table.Sorts) {
		return
	}

	type ColIndexSort struct {
		Index int
		Order SortOrder
	}

	var colIndexSorts []*ColIndexSort
	for _, s := range table.Sorts {
		for i, c := range table.Columns {
			if c.ID == s.Column {
				colIndexSorts = append(colIndexSorts, &ColIndexSort{Index: i, Order: s.Order})
				break
			}
		}
	}

	includeUneditedRows := map[string]bool{}
	for i, row := range table.Rows {
		for _, colIndexSort := range colIndexSorts {
			val := table.Rows[i].Cells[colIndexSort.Index].Value
			if !val.IsEdited() {
				// 如果该行的某个列的值是未编辑的，则该行不参与排序
				includeUneditedRows[row.ID] = true
				break
			}
		}
	}

	// 将包含未编辑的行和全部已编辑的行分开排序
	var uneditedRows, editedRows []*TableRow
	for _, row := range table.Rows {
		if _, ok := includeUneditedRows[row.ID]; ok {
			uneditedRows = append(uneditedRows, row)
		} else {
			editedRows = append(editedRows, row)
		}
	}

	sort.Slice(uneditedRows, func(i, j int) bool {
		val1 := uneditedRows[i].GetBlockValue()
		if nil == val1 {
			return true
		}
		val2 := uneditedRows[j].GetBlockValue()
		if nil == val2 {
			return false
		}
		return val1.CreatedAt < val2.CreatedAt
	})

	sort.Slice(editedRows, func(i, j int) bool {
		for _, colIndexSort := range colIndexSorts {
			val1 := editedRows[i].Cells[colIndexSort.Index].Value
			if nil == val1 {
				return colIndexSort.Order == SortOrderAsc
			}

			val2 := editedRows[j].Cells[colIndexSort.Index].Value
			if nil == val2 {
				return colIndexSort.Order != SortOrderAsc
			}

			result := val1.Compare(val2)
			if 0 == result {
				continue
			}

			if colIndexSort.Order == SortOrderAsc {
				return 0 > result
			}
			return 0 < result
		}
		return false
	})

	// 将包含未编辑的行放在最后
	table.Rows = append(editedRows, uneditedRows...)
	if 1 > len(table.Rows) {
		table.Rows = []*TableRow{}
	}
}

func (table *Table) FilterRows(attrView *AttributeView) {
	if 1 > len(table.Filters) {
		return
	}

	var colIndexes []int
	for _, f := range table.Filters {
		for i, c := range table.Columns {
			if c.ID == f.Column {
				colIndexes = append(colIndexes, i)
				break
			}
		}
	}

	rows := []*TableRow{}
	for _, row := range table.Rows {
		pass := true
		for j, index := range colIndexes {
			operator := table.Filters[j].Operator

			if nil == row.Cells[index].Value {
				if FilterOperatorIsNotEmpty == operator {
					pass = false
				} else if FilterOperatorIsEmpty == operator {
					pass = true
					break
				}

				if KeyTypeText != row.Cells[index].ValueType {
					pass = false
				}
				break
			}

			if !row.Cells[index].Value.CompareOperator(table.Filters[j], attrView, row.ID) {
				pass = false
				break
			}
		}
		if pass {
			rows = append(rows, row)
		}
	}
	table.Rows = rows
}

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
				val, _ := strconv.ParseFloat(row.Cells[colIndex].Value.Template.Content, 64)
				sum += val
			}
		}
		col.Calc.Result = &Value{Number: NewFormattedValueNumber(sum, col.NumberFormat)}
	case CalcOperatorAverage:
		sum := 0.0
		count := 0
		for _, row := range table.Rows {
			if nil != row.Cells[colIndex] && nil != row.Cells[colIndex].Value && nil != row.Cells[colIndex].Value.Template && "" != row.Cells[colIndex].Value.Template.Content {
				val, _ := strconv.ParseFloat(row.Cells[colIndex].Value.Template.Content, 64)
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
				val, _ := strconv.ParseFloat(row.Cells[colIndex].Value.Template.Content, 64)
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
				val, _ := strconv.ParseFloat(row.Cells[colIndex].Value.Template.Content, 64)
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
				val, _ := strconv.ParseFloat(row.Cells[colIndex].Value.Template.Content, 64)
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
				val, _ := strconv.ParseFloat(row.Cells[colIndex].Value.Template.Content, 64)
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
					if !uniqueValues[content.String()] {
						uniqueValues[content.String()] = true
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
	}
}
