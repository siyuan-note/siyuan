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
	"strings"
	"time"

	"github.com/siyuan-note/siyuan/kernel/util"
)

type Filterable interface {
	FilterRows(attrView *AttributeView)
}

type ViewFilter struct {
	Column        string         `json:"column"`
	Operator      FilterOperator `json:"operator"`
	Value         *Value         `json:"value"`
	RelativeDate  *RelativeDate  `json:"relativeDate"`
	RelativeDate2 *RelativeDate  `json:"relativeDate2"`
}

type RelativeDateUnit int

const (
	RelativeDateUnitDay = iota
	RelativeDateUnitWeek
	RelativeDateUnitMonth
	RelativeDateUnitYear
)

type RelativeDateDirection int

const (
	RelativeDateDirectionBefore = -1
	RelativeDateDirectionThis   = 0
	RelativeDateDirectionAfter  = 1
)

type RelativeDate struct {
	Count     int                   `json:"count"`     // 数量
	Unit      RelativeDateUnit      `json:"unit"`      // 单位：0 天、1 周、2 月、3 年
	Direction RelativeDateDirection `json:"direction"` // 方向：-1 前、0 当前、1 后
}

type FilterOperator string

const (
	FilterOperatorIsEqual          FilterOperator = "="
	FilterOperatorIsNotEqual       FilterOperator = "!="
	FilterOperatorIsGreater        FilterOperator = ">"
	FilterOperatorIsGreaterOrEqual FilterOperator = ">="
	FilterOperatorIsLess           FilterOperator = "<"
	FilterOperatorIsLessOrEqual    FilterOperator = "<="
	FilterOperatorContains         FilterOperator = "Contains"
	FilterOperatorDoesNotContain   FilterOperator = "Does not contains"
	FilterOperatorIsEmpty          FilterOperator = "Is empty"
	FilterOperatorIsNotEmpty       FilterOperator = "Is not empty"
	FilterOperatorStartsWith       FilterOperator = "Starts with"
	FilterOperatorEndsWith         FilterOperator = "Ends with"
	FilterOperatorIsBetween        FilterOperator = "Is between"
	FilterOperatorIsTrue           FilterOperator = "Is true"
	FilterOperatorIsFalse          FilterOperator = "Is false"
)

func (value *Value) Filter(filter *ViewFilter, attrView *AttributeView, rowID string) bool {
	if nil == filter || (nil == filter.Value && nil == filter.RelativeDate) {
		return true
	}

	if nil != filter.Value && value.Type != filter.Value.Type {
		// 由于字段类型被用户编辑过导致和过滤器值类型不匹配，该情况下不过滤
		return true
	}

	if nil != value.Rollup && KeyTypeRollup == value.Type && nil != filter && nil != filter.Value && KeyTypeRollup == filter.Value.Type &&
		nil != filter.Value.Rollup && 0 < len(filter.Value.Rollup.Contents) {
		// 单独处理汇总类型的比较

		// 处理为空和不为空
		switch filter.Operator {
		case FilterOperatorIsEmpty:
			return 0 == len(value.Rollup.Contents)
		case FilterOperatorIsNotEmpty:
			return 0 != len(value.Rollup.Contents)
		}

		// 处理值比较
		key, _ := attrView.GetKey(value.KeyID)
		if nil == key {
			return false
		}

		relKey, _ := attrView.GetKey(key.Rollup.RelationKeyID)
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
			destVal := destAv.GetValue(key.Rollup.KeyID, blockID)
			if nil == destVal {
				continue
			}

			if destVal.filter(filter.Value.Rollup.Contents[0], filter.RelativeDate, filter.RelativeDate2, filter.Operator) {
				return true
			}
		}
		return false
	}

	if nil != value.Relation && KeyTypeRelation == value.Type && 0 < len(value.Relation.Contents) && nil != filter && nil != filter.Value && KeyTypeRelation == filter.Value.Type &&
		nil != filter.Value.Relation && 0 < len(filter.Value.Relation.BlockIDs) {
		// 单独处理关联类型的比较

		for _, relationValue := range value.Relation.Contents {
			filterValue := &Value{Type: KeyTypeBlock, Block: &ValueBlock{Content: filter.Value.Relation.BlockIDs[0]}}
			if relationValue.filter(filterValue, filter.RelativeDate, filter.RelativeDate2, filter.Operator) {
				return true
			}
		}
		return false
	}
	return value.filter(filter.Value, filter.RelativeDate, filter.RelativeDate2, filter.Operator)
}

func (value *Value) filter(other *Value, relativeDate, relativeDate2 *RelativeDate, operator FilterOperator) bool {
	switch value.Type {
	case KeyTypeBlock:
		if nil != value.Block && nil != other && nil != other.Block {
			switch operator {
			case FilterOperatorIsEqual:
				return value.Block.Content == other.Block.Content
			case FilterOperatorIsNotEqual:
				return value.Block.Content != other.Block.Content
			case FilterOperatorContains:
				return strings.Contains(value.Block.Content, other.Block.Content)
			case FilterOperatorDoesNotContain:
				return !strings.Contains(value.Block.Content, other.Block.Content)
			case FilterOperatorStartsWith:
				return strings.HasPrefix(value.Block.Content, other.Block.Content)
			case FilterOperatorEndsWith:
				return strings.HasSuffix(value.Block.Content, other.Block.Content)
			case FilterOperatorIsEmpty:
				return "" == strings.TrimSpace(value.Block.Content)
			case FilterOperatorIsNotEmpty:
				return "" != strings.TrimSpace(value.Block.Content)
			}
		}
	case KeyTypeText:
		if nil != value.Text && nil != other && nil != other.Text {
			switch operator {
			case FilterOperatorIsEqual:
				if "" == strings.TrimSpace(other.Text.Content) {
					return true
				}
				return value.Text.Content == other.Text.Content
			case FilterOperatorIsNotEqual:
				if "" == strings.TrimSpace(other.Text.Content) {
					return true
				}
				return value.Text.Content != other.Text.Content
			case FilterOperatorContains:
				if "" == strings.TrimSpace(other.Text.Content) {
					return true
				}
				return strings.Contains(value.Text.Content, other.Text.Content)
			case FilterOperatorDoesNotContain:
				if "" == strings.TrimSpace(other.Text.Content) {
					return true
				}
				return !strings.Contains(value.Text.Content, other.Text.Content)
			case FilterOperatorStartsWith:
				if "" == strings.TrimSpace(other.Text.Content) {
					return true
				}
				return strings.HasPrefix(value.Text.Content, other.Text.Content)
			case FilterOperatorEndsWith:
				if "" == strings.TrimSpace(other.Text.Content) {
					return true
				}
				return strings.HasSuffix(value.Text.Content, other.Text.Content)
			case FilterOperatorIsEmpty:
				return "" == strings.TrimSpace(value.Text.Content)
			case FilterOperatorIsNotEmpty:
				return "" != strings.TrimSpace(value.Text.Content)
			}
		}
	case KeyTypeNumber:
		if nil != value.Number && nil != other && nil != other.Number {
			switch operator {
			case FilterOperatorIsEqual:
				if !other.Number.IsNotEmpty {
					return true
				}
				return value.Number.Content == other.Number.Content
			case FilterOperatorIsNotEqual:
				if !other.Number.IsNotEmpty {
					return true
				}
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
	case KeyTypeDate:
		if nil != value.Date {
			if nil != relativeDate {
				// 使用相对时间比较

				count := relativeDate.Count
				unit := relativeDate.Unit
				direction := relativeDate.Direction
				relativeTimeStart, relativeTimeEnd := calcRelativeTimeRegion(count, unit, direction)
				_, relativeTimeEnd2 := calcRelativeTimeRegion(relativeDate2.Count, relativeDate2.Unit, relativeDate2.Direction)
				return filterRelativeTime(value.Date.Content, value.Date.IsNotEmpty, relativeTimeStart, relativeTimeEnd, relativeTimeEnd2, operator)
			} else { // 使用具体时间比较
				if nil == other.Date {
					return true
				}
				return filterTime(value.Date.Content, value.Date.IsNotEmpty, other.Date.Content, other.Date.Content2, operator)
			}
		}
	case KeyTypeCreated:
		if nil != value.Created {
			if nil != relativeDate {
				// 使用相对时间比较

				count := relativeDate.Count
				unit := relativeDate.Unit
				direction := relativeDate.Direction
				relativeTimeStart, relativeTimeEnd := calcRelativeTimeRegion(count, unit, direction)
				return filterRelativeTime(value.Created.Content, true, relativeTimeStart, relativeTimeEnd, time.Now(), operator)
			} else { // 使用具体时间比较
				if nil == other.Created {
					return true
				}
				return filterTime(value.Created.Content, value.Created.IsNotEmpty, other.Created.Content, other.Created.Content2, operator)
			}
		}
	case KeyTypeUpdated:
		if nil != value.Updated {
			if nil != relativeDate {
				// 使用相对时间比较

				count := relativeDate.Count
				unit := relativeDate.Unit
				direction := relativeDate.Direction
				relativeTimeStart, relativeTimeEnd := calcRelativeTimeRegion(count, unit, direction)
				return filterRelativeTime(value.Updated.Content, true, relativeTimeStart, relativeTimeEnd, time.Now(), operator)
			} else { // 使用具体时间比较
				if nil == other.Updated {
					return true
				}

				return filterTime(value.Updated.Content, value.Updated.IsNotEmpty, other.Updated.Content, other.Updated.Content2, operator)
			}
		}
	case KeyTypeSelect, KeyTypeMSelect:
		if nil != value.MSelect {
			if nil != other && nil != other.MSelect {
				switch operator {
				case FilterOperatorIsEqual, FilterOperatorContains:
					contains := false
					for _, v := range value.MSelect {
						for _, v2 := range other.MSelect {
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
						for _, v2 := range other.MSelect {
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
	case KeyTypeURL:
		if nil != value.URL && nil != other && nil != other.URL {
			switch operator {
			case FilterOperatorIsEqual:
				return value.URL.Content == other.URL.Content
			case FilterOperatorIsNotEqual:
				return value.URL.Content != other.URL.Content
			case FilterOperatorContains:
				return strings.Contains(value.URL.Content, other.URL.Content)
			case FilterOperatorDoesNotContain:
				return !strings.Contains(value.URL.Content, other.URL.Content)
			case FilterOperatorStartsWith:
				return strings.HasPrefix(value.URL.Content, other.URL.Content)
			case FilterOperatorEndsWith:
				return strings.HasSuffix(value.URL.Content, other.URL.Content)
			case FilterOperatorIsEmpty:
				return "" == strings.TrimSpace(value.URL.Content)
			case FilterOperatorIsNotEmpty:
				return "" != strings.TrimSpace(value.URL.Content)
			}
		}
	case KeyTypeEmail:
		if nil != value.Email && nil != other && nil != other.Email {
			switch operator {
			case FilterOperatorIsEqual:
				return value.Email.Content == other.Email.Content
			case FilterOperatorIsNotEqual:
				return value.Email.Content != other.Email.Content
			case FilterOperatorContains:
				return strings.Contains(value.Email.Content, other.Email.Content)
			case FilterOperatorDoesNotContain:
				return !strings.Contains(value.Email.Content, other.Email.Content)
			case FilterOperatorStartsWith:
				return strings.HasPrefix(value.Email.Content, other.Email.Content)
			case FilterOperatorEndsWith:
				return strings.HasSuffix(value.Email.Content, other.Email.Content)
			case FilterOperatorIsEmpty:
				return "" == strings.TrimSpace(value.Email.Content)
			case FilterOperatorIsNotEmpty:
				return "" != strings.TrimSpace(value.Email.Content)
			}
		}
	case KeyTypePhone:
		if nil != value.Phone && nil != other && nil != other.Phone {
			switch operator {
			case FilterOperatorIsEqual:
				return value.Phone.Content == other.Phone.Content
			case FilterOperatorIsNotEqual:
				return value.Phone.Content != other.Phone.Content
			case FilterOperatorContains:
				return strings.Contains(value.Phone.Content, other.Phone.Content)
			case FilterOperatorDoesNotContain:
				return !strings.Contains(value.Phone.Content, other.Phone.Content)
			case FilterOperatorStartsWith:
				return strings.HasPrefix(value.Phone.Content, other.Phone.Content)
			case FilterOperatorEndsWith:
				return strings.HasSuffix(value.Phone.Content, other.Phone.Content)
			case FilterOperatorIsEmpty:
				return "" == strings.TrimSpace(value.Phone.Content)
			case FilterOperatorIsNotEmpty:
				return "" != strings.TrimSpace(value.Phone.Content)
			}
		}
	case KeyTypeMAsset:
		if nil != value.MAsset && nil != other && nil != other.MAsset && 0 < len(value.MAsset) && 0 < len(other.MAsset) {
			switch operator {
			case FilterOperatorIsEqual, FilterOperatorContains:
				contains := false
				for _, v := range value.MAsset {
					for _, v2 := range other.MAsset {
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
					for _, v2 := range other.MAsset {
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
	case KeyTypeTemplate:
		if nil != value.Template && nil != other && nil != other.Template {
			switch operator {
			case FilterOperatorIsEqual:
				if "" == strings.TrimSpace(other.Template.Content) {
					return true
				}
				return value.Template.Content == other.Template.Content
			case FilterOperatorIsNotEqual:
				if "" == strings.TrimSpace(other.Template.Content) {
					return true
				}
				return value.Template.Content != other.Template.Content
			case FilterOperatorIsGreater:
				if "" == strings.TrimSpace(other.Template.Content) {
					return true
				}
				return value.Template.Content > other.Template.Content
			case FilterOperatorIsGreaterOrEqual:
				if "" == strings.TrimSpace(other.Template.Content) {
					return true
				}
				return value.Template.Content >= other.Template.Content
			case FilterOperatorIsLess:
				if "" == strings.TrimSpace(other.Template.Content) {
					return true
				}
				return value.Template.Content < other.Template.Content
			case FilterOperatorIsLessOrEqual:
				if "" == strings.TrimSpace(other.Template.Content) {
					return true
				}
				return value.Template.Content <= other.Template.Content
			case FilterOperatorContains:
				if "" == strings.TrimSpace(other.Template.Content) {
					return true
				}
				return strings.Contains(value.Template.Content, other.Template.Content)
			case FilterOperatorDoesNotContain:
				if "" == strings.TrimSpace(other.Template.Content) {
					return true
				}
				return !strings.Contains(value.Template.Content, other.Template.Content)
			case FilterOperatorStartsWith:
				if "" == strings.TrimSpace(other.Template.Content) {
					return true
				}
				return strings.HasPrefix(value.Template.Content, other.Template.Content)
			case FilterOperatorEndsWith:
				if "" == strings.TrimSpace(other.Template.Content) {
					return true
				}
				return strings.HasSuffix(value.Template.Content, other.Template.Content)
			case FilterOperatorIsEmpty:
				return "" == strings.TrimSpace(value.Template.Content)
			case FilterOperatorIsNotEmpty:
				return "" != strings.TrimSpace(value.Template.Content)
			}
		}
	case KeyTypeCheckbox:
		if nil != value.Checkbox {
			switch operator {
			case FilterOperatorIsTrue:
				return value.Checkbox.Checked
			case FilterOperatorIsFalse:
				return !value.Checkbox.Checked
			}
		}
	}

	switch operator {
	case FilterOperatorIsEmpty:
		return value.IsEmpty()
	case FilterOperatorIsNotEmpty:
		return !value.IsEmpty()
	}
	return false
}

func filterRelativeTime(valueMills int64, valueIsNotEmpty bool, otherValueStart, otherValueEnd, otherValueEnd2 time.Time, operator FilterOperator) bool {
	valueTime := time.UnixMilli(valueMills)
	switch operator {
	case FilterOperatorIsEqual:
		return (valueTime.After(otherValueStart) || valueTime.Equal(otherValueStart)) && valueTime.Before(otherValueEnd)
	case FilterOperatorIsNotEqual:
		return valueTime.Before(otherValueStart) || valueTime.After(otherValueEnd)
	case FilterOperatorIsGreater:
		return valueTime.After(otherValueEnd) || valueTime.Equal(otherValueEnd)
	case FilterOperatorIsGreaterOrEqual:
		return valueTime.After(otherValueStart) || valueTime.Equal(otherValueStart)
	case FilterOperatorIsLess:
		return valueTime.Before(otherValueStart)
	case FilterOperatorIsLessOrEqual:
		return valueTime.Before(otherValueEnd) || valueTime.Equal(otherValueEnd)
	case FilterOperatorIsBetween:
		return (valueTime.After(otherValueStart) || valueTime.Equal(otherValueStart)) && (valueTime.Before(otherValueEnd2) || valueTime.Equal(otherValueEnd2))
	case FilterOperatorIsEmpty:
		return !valueIsNotEmpty
	case FilterOperatorIsNotEmpty:
		return valueIsNotEmpty
	}
	return false
}

func filterTime(valueMills int64, valueIsNotEmpty bool, otherValueMills, otherValueMills2 int64, operator FilterOperator) bool {
	valueTime := time.UnixMilli(valueMills)
	otherValueTime := time.UnixMilli(otherValueMills)
	otherValueStart := time.Date(otherValueTime.Year(), otherValueTime.Month(), otherValueTime.Day(), 0, 0, 0, 0, otherValueTime.Location())
	otherValueEnd := time.Date(otherValueTime.Year(), otherValueTime.Month(), otherValueTime.Day(), 23, 59, 59, 999999999, otherValueTime.Location())
	switch operator {
	case FilterOperatorIsEqual:
		return (valueTime.After(otherValueStart) || valueTime.Equal(otherValueStart)) && valueTime.Before(otherValueEnd)
	case FilterOperatorIsNotEqual:
		return valueTime.Before(otherValueStart) || valueTime.After(otherValueEnd)
	case FilterOperatorIsGreater:
		return valueTime.After(otherValueEnd) || valueTime.Equal(otherValueEnd)
	case FilterOperatorIsGreaterOrEqual:
		return valueTime.After(otherValueStart) || valueTime.Equal(otherValueStart)
	case FilterOperatorIsLess:
		return valueTime.Before(otherValueStart)
	case FilterOperatorIsLessOrEqual:
		return valueTime.Before(otherValueEnd) || valueTime.Equal(otherValueEnd)
	case FilterOperatorIsBetween:
		otherValueTime2 := time.UnixMilli(otherValueMills2)
		otherValueEnd2 := time.Date(otherValueTime2.Year(), otherValueTime2.Month(), otherValueTime2.Day(), 23, 59, 59, 999999999, otherValueTime2.Location())
		return (valueTime.After(otherValueStart) || valueTime.Equal(otherValueStart)) && (valueTime.Before(otherValueEnd2) || valueTime.Equal(otherValueEnd2))
	case FilterOperatorIsEmpty:
		return !valueIsNotEmpty
	case FilterOperatorIsNotEmpty:
		return valueIsNotEmpty
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
			// 结束时间：今天的 0 点
			end = time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
			// 开始时间：结束时间减去 count 天
			start = end.AddDate(0, 0, -count)
		case RelativeDateDirectionThis:
			// 开始时间：今天的 0 点
			start = time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
			// 结束时间：今天的 23:59:59.999999999
			end = time.Date(now.Year(), now.Month(), now.Day(), 23, 59, 59, 999999999, now.Location())
		case RelativeDateDirectionAfter:
			// 开始时间：今天的 23:59:59.999999999
			start = time.Date(now.Year(), now.Month(), now.Day(), 23, 59, 59, 999999999, now.Location())
			// 结束时间：开始时间加上 count 天
			end = start.AddDate(0, 0, count)
		}
	case RelativeDateUnitWeek:
		weekday := int(now.Weekday())
		if 0 == weekday {
			weekday = 7
		}
		switch direction {
		case RelativeDateDirectionBefore:
			// 结束时间：本周的周一
			end = time.Date(now.Year(), now.Month(), now.Day()-weekday+1, 0, 0, 0, 0, now.Location())
			// 开始时间：结束时间减去 count*7 天
			start = end.AddDate(0, 0, -count*7)
		case RelativeDateDirectionThis:
			// 开始时间：本周的周一
			start = time.Date(now.Year(), now.Month(), now.Day()-weekday+1, 0, 0, 0, 0, now.Location())
			// 结束时间：本周的周日
			end = time.Date(now.Year(), now.Month(), now.Day()-weekday+7, 23, 59, 59, 999999999, now.Location())
		case RelativeDateDirectionAfter:
			//  开始时间：本周的周日
			start = time.Date(now.Year(), now.Month(), now.Day()-weekday+7, 23, 59, 59, 999999999, now.Location())
			// 结束时间：开始时间加上 count*7 天
			end = start.AddDate(0, 0, count*7)
		}
	case RelativeDateUnitMonth:
		switch direction {
		case RelativeDateDirectionBefore:
			// 结束时间：本月的 1 号
			end = time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location())
			// 开始时间：结束时间减去 count 个月
			start = end.AddDate(0, -count, 0)
		case RelativeDateDirectionThis:
			// 开始时间：本月的 1 号
			start = time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location())
			// 结束时间：下个月的 1 号减去 1 纳秒
			end = time.Date(now.Year(), now.Month()+1, 1, 0, 0, 0, 0, now.Location()).Add(-time.Nanosecond)
		case RelativeDateDirectionAfter:
			// 开始时间：下个月的 1 号减去 1 纳秒
			start = time.Date(now.Year(), now.Month()+1, 1, 0, 0, 0, 0, now.Location()).Add(-time.Nanosecond)
			// 结束时间：开始时间加上 count 个月
			end = start.AddDate(0, count, 0)
		}
	case RelativeDateUnitYear:
		switch direction {
		case RelativeDateDirectionBefore:
			// 结束时间：今年的 1 月 1 号
			end = time.Date(now.Year(), 1, 1, 0, 0, 0, 0, now.Location())
			// 开始时间：结束时间减去 count 年
			start = end.AddDate(-count, 0, 0)
		case RelativeDateDirectionThis:
			// 开始时间：今年的 1 月 1 号
			start = time.Date(now.Year(), 1, 1, 0, 0, 0, 0, now.Location())
			// 结束时间：明年的 1 月 1 号减去 1 纳秒
			end = time.Date(now.Year()+1, 1, 1, 0, 0, 0, 0, now.Location()).Add(-time.Nanosecond)
		case RelativeDateDirectionAfter:
			// 开始时间：今年的 12 月 31 号
			start = time.Date(now.Year(), 12, 31, 23, 59, 59, 999999999, now.Location())
			// 结束时间：开始时间加上 count 年
			end = start.AddDate(count, 0, 0)
		}
	}
	return
}

func (filter *ViewFilter) GetAffectValue(key *Key, defaultVal *Value) (ret *Value) {
	if nil != filter.Value {
		if KeyTypeRelation == filter.Value.Type || KeyTypeTemplate == filter.Value.Type || KeyTypeRollup == filter.Value.Type || KeyTypeUpdated == filter.Value.Type || KeyTypeCreated == filter.Value.Type {
			// 所有生成的数据都不设置默认值
			return nil
		}
	}

	if nil == filter.Value {
		if nil != filter.RelativeDate {
			// 相对日期今天的动态日期不设置默认值
			return nil
		}
		// 两个值都空的情况下也不设置默认值
		return nil
	}

	ret = filter.Value.Clone()
	ret.CreatedAt = util.CurrentTimeMillis()
	ret.UpdatedAt = ret.CreatedAt + 1000

	if nil != defaultVal {
		// 如果有默认值则优先使用默认值
		clonedDefaultVal := defaultVal.Clone()
		defaultRawVal := clonedDefaultVal.GetValByType(filter.Value.Type)
		if nil != defaultRawVal {
			ret.SetValByType(filter.Value.Type, defaultRawVal)
			return
		}
	}
	// 没有默认值则使用过滤条件的值

	switch filter.Value.Type {
	case KeyTypeBlock:
		switch filter.Operator {
		case FilterOperatorIsEqual:
			ret.Block = &ValueBlock{ID: filter.Value.Block.ID, Content: filter.Value.Block.Content}
		case FilterOperatorIsNotEqual:
			ret.Block = &ValueBlock{ID: filter.Value.Block.ID, Content: ""}
		case FilterOperatorContains:
			ret.Block = &ValueBlock{ID: filter.Value.Block.ID, Content: filter.Value.Block.Content}
		case FilterOperatorDoesNotContain:
			ret.Block = &ValueBlock{ID: filter.Value.Block.ID, Content: ""}
		case FilterOperatorStartsWith:
			ret.Block = &ValueBlock{ID: filter.Value.Block.ID, Content: filter.Value.Block.Content}
		case FilterOperatorEndsWith:
			ret.Block = &ValueBlock{ID: filter.Value.Block.ID, Content: filter.Value.Block.Content}
		case FilterOperatorIsEmpty:
			ret.Block = &ValueBlock{ID: filter.Value.Block.ID, Content: ""}
		case FilterOperatorIsNotEmpty:
			ret.Block = &ValueBlock{ID: filter.Value.Block.ID, Content: ""}
		}
	case KeyTypeText:
		switch filter.Operator {
		case FilterOperatorIsEqual:
			ret.Text = &ValueText{Content: filter.Value.Text.Content}
		case FilterOperatorIsNotEqual:
			ret.Text = &ValueText{Content: ""}
		case FilterOperatorContains:
			ret.Text = &ValueText{Content: filter.Value.Text.Content}
		case FilterOperatorDoesNotContain:
			ret.Text = &ValueText{Content: ""}
		case FilterOperatorStartsWith:
			ret.Text = &ValueText{Content: filter.Value.Text.Content}
		case FilterOperatorEndsWith:
			ret.Text = &ValueText{Content: filter.Value.Text.Content}
		case FilterOperatorIsEmpty:
			ret.Text = &ValueText{Content: ""}
		case FilterOperatorIsNotEmpty:
			ret.Text = &ValueText{Content: ""}
		}
	case KeyTypeNumber:
		switch filter.Operator {
		case FilterOperatorIsEqual:
			ret.Number = &ValueNumber{Content: filter.Value.Number.Content, IsNotEmpty: false}
		case FilterOperatorIsNotEqual:
			if 0 == filter.Value.Number.Content {
				ret.Number = &ValueNumber{Content: 1, IsNotEmpty: true}
			} else {
				ret.Number = &ValueNumber{Content: 0, IsNotEmpty: true}
			}
		case FilterOperatorIsGreater:
			ret.Number = &ValueNumber{Content: filter.Value.Number.Content + 1, IsNotEmpty: true}
		case FilterOperatorIsGreaterOrEqual:
			ret.Number = &ValueNumber{Content: filter.Value.Number.Content, IsNotEmpty: true}
		case FilterOperatorIsLess:
			ret.Number = &ValueNumber{Content: filter.Value.Number.Content - 1, IsNotEmpty: true}
		case FilterOperatorIsLessOrEqual:
			ret.Number = &ValueNumber{Content: filter.Value.Number.Content, IsNotEmpty: true}
		case FilterOperatorIsEmpty:
			ret.Number = &ValueNumber{Content: 0, IsNotEmpty: false}
		case FilterOperatorIsNotEmpty:
			ret.Number = &ValueNumber{Content: 0, IsNotEmpty: true}
		}
	case KeyTypeDate:
		switch filter.Operator {
		case FilterOperatorIsEqual:
			ret.Date = &ValueDate{Content: filter.Value.Date.Content, IsNotEmpty: true}
		case FilterOperatorIsNotEqual:
			ret.Date = &ValueDate{Content: util.CurrentTimeMillis(), IsNotEmpty: true}
		case FilterOperatorIsGreater:
			ret.Date = &ValueDate{Content: filter.Value.Date.Content + 1000*60, IsNotEmpty: true}
		case FilterOperatorIsGreaterOrEqual:
			ret.Date = &ValueDate{Content: filter.Value.Date.Content, IsNotEmpty: true}
		case FilterOperatorIsLess:
			ret.Date = &ValueDate{Content: filter.Value.Date.Content - 1000*60, IsNotEmpty: true}
		case FilterOperatorIsLessOrEqual:
			ret.Date = &ValueDate{Content: filter.Value.Date.Content, IsNotEmpty: true}
		case FilterOperatorIsBetween:
			ret.Date = &ValueDate{Content: filter.Value.Date.Content - 1000*60, IsNotEmpty: true}
		case FilterOperatorIsEmpty:
			ret.Date = &ValueDate{Content: 0, IsNotEmpty: false}
		case FilterOperatorIsNotEmpty:
			ret.Date = &ValueDate{Content: util.CurrentTimeMillis(), IsNotEmpty: true}
		}
	case KeyTypeSelect, KeyTypeMSelect:
		switch filter.Operator {
		case FilterOperatorIsEqual:
			valueSelect := &ValueSelect{Content: "", Color: "1"}
			if 0 < len(key.Options) {
				valueSelect.Color = key.Options[0].Color
			}
			if 0 < len(filter.Value.MSelect) {
				valueSelect.Content = filter.Value.MSelect[0].Content
				valueSelect.Color = filter.Value.MSelect[0].Color
			}
			ret.MSelect = []*ValueSelect{valueSelect}
		case FilterOperatorIsNotEqual:
			if 0 < len(filter.Value.MSelect) {
				ret.MSelect = []*ValueSelect{}
			}
		case FilterOperatorIsEmpty:
			ret.MSelect = []*ValueSelect{}
		case FilterOperatorIsNotEmpty:
			if 0 < len(key.Options) {
				ret.MSelect = []*ValueSelect{{Content: key.Options[0].Name, Color: key.Options[0].Color}}
			}
		}
	case KeyTypeURL:
		switch filter.Operator {
		case FilterOperatorIsEqual:
			ret.URL = &ValueURL{Content: filter.Value.URL.Content}
		case FilterOperatorIsNotEqual:
			ret.URL = &ValueURL{Content: filter.Value.URL.Content}
		case FilterOperatorContains:
			ret.URL = &ValueURL{Content: filter.Value.URL.Content}
		case FilterOperatorDoesNotContain:
			ret.URL = &ValueURL{Content: ""}
		case FilterOperatorStartsWith:
			ret.URL = &ValueURL{Content: filter.Value.URL.Content}
		case FilterOperatorEndsWith:
			ret.URL = &ValueURL{Content: filter.Value.URL.Content}
		case FilterOperatorIsEmpty:
			ret.URL = &ValueURL{}
		case FilterOperatorIsNotEmpty:
			ret.URL = &ValueURL{}
		}
	case KeyTypeEmail:
		switch filter.Operator {
		case FilterOperatorIsEqual:
			ret.Email = &ValueEmail{Content: filter.Value.Email.Content}
		case FilterOperatorIsNotEqual:
			ret.Email = &ValueEmail{Content: filter.Value.Email.Content}
		case FilterOperatorContains:
			ret.Email = &ValueEmail{Content: filter.Value.Email.Content}
		case FilterOperatorDoesNotContain:
			ret.Email = &ValueEmail{Content: ""}
		case FilterOperatorStartsWith:
			ret.Email = &ValueEmail{Content: filter.Value.Email.Content}
		case FilterOperatorEndsWith:
			ret.Email = &ValueEmail{Content: filter.Value.Email.Content}
		case FilterOperatorIsEmpty:
			ret.Email = &ValueEmail{Content: ""}
		case FilterOperatorIsNotEmpty:
			ret.Email = &ValueEmail{Content: ""}
		}
	case KeyTypePhone:
		switch filter.Operator {
		case FilterOperatorIsEqual:
			ret.Phone = &ValuePhone{Content: filter.Value.Phone.Content}
		case FilterOperatorIsNotEqual:
			ret.Phone = &ValuePhone{Content: filter.Value.Phone.Content + ""}
		case FilterOperatorContains:
			ret.Phone = &ValuePhone{Content: filter.Value.Phone.Content}
		case FilterOperatorDoesNotContain:
			ret.Phone = &ValuePhone{Content: ""}
		case FilterOperatorStartsWith:
			ret.Phone = &ValuePhone{Content: filter.Value.Phone.Content}
		case FilterOperatorEndsWith:
			ret.Phone = &ValuePhone{Content: filter.Value.Phone.Content}
		case FilterOperatorIsEmpty:
			ret.Phone = &ValuePhone{Content: ""}
		case FilterOperatorIsNotEmpty:
			ret.Phone = &ValuePhone{Content: ""}
		}
	case KeyTypeMAsset:
		switch filter.Operator {
		case FilterOperatorIsEqual, FilterOperatorContains:
			if 0 < len(filter.Value.MAsset) {
				ret.MAsset = []*ValueAsset{{Type: filter.Value.MAsset[0].Type, Name: filter.Value.MAsset[0].Name, Content: filter.Value.MAsset[0].Content}}
			}
		case FilterOperatorIsNotEqual, FilterOperatorDoesNotContain:
		case FilterOperatorIsEmpty:
			ret.MAsset = []*ValueAsset{}
		case FilterOperatorIsNotEmpty:
		}
	case KeyTypeCheckbox:
		switch filter.Operator {
		case FilterOperatorIsTrue:
			ret.Checkbox = &ValueCheckbox{Checked: true}
		case FilterOperatorIsFalse:
			ret.Checkbox = &ValueCheckbox{Checked: false}
		}
	case KeyTypeRelation:
		switch filter.Operator {
		case FilterOperatorContains:
			if 0 < len(filter.Value.Relation.Contents) {
				ret.Relation = &ValueRelation{Contents: filter.Value.Relation.Contents}
			}
		case FilterOperatorDoesNotContain:
		case FilterOperatorIsEmpty:
			ret.Relation = &ValueRelation{Contents: []*Value{}}
		case FilterOperatorIsNotEmpty:
		}
	}
	return
}
