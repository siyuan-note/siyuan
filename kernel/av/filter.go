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
	"reflect"
	"strings"
	"time"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// ViewFilter 描述了视图过滤规则的结构。
type ViewFilter struct {
	Column        string           `json:"column"`                  // 字段（列）ID
	Qualifier     FilterQuantifier `json:"quantifier,omitempty"`    // 量词
	Operator      FilterOperator   `json:"operator"`                // 操作符
	Value         *Value           `json:"value"`                   // 过滤值
	RelativeDate  *RelativeDate    `json:"relativeDate,omitempty"`  // 相对时间
	RelativeDate2 *RelativeDate    `json:"relativeDate2,omitempty"` // 第二个相对时间，用于某些操作符，比如 FilterOperatorIsBetween
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

type FilterQuantifier string

const (
	FilterQuantifierUndefined FilterQuantifier = "" // 等同于 Any
	FilterQuantifierAny       FilterQuantifier = "Any"
	FilterQuantifierAll       FilterQuantifier = "All"
	FilterQuantifierNone      FilterQuantifier = "None"
)

func Filter(viewable Viewable, attrView *AttributeView, rollupFurtherCollections map[string]Collection, cachedAttrViews map[string]*AttributeView) {
	collection := viewable.(Collection)
	filters := collection.GetFilters()
	if 1 > len(filters) {
		return
	}

	var colIndexes []int
	for _, f := range filters {
		for i, c := range collection.GetFields() {
			if c.GetID() == f.Column {
				colIndexes = append(colIndexes, i)
				break
			}
		}
	}

	var items []Item
	for _, item := range collection.GetItems() {
		pass := true
		values := item.GetValues()
		for j, index := range colIndexes {
			operator := filters[j].Operator

			if nil == values[index] {
				if FilterOperatorIsNotEmpty == operator {
					pass = false
				} else if FilterOperatorIsEmpty == operator {
					pass = true
					break
				}

				if KeyTypeText != values[index].Type {
					pass = false
				}
				break
			}

			if !values[index].Filter(filters[j], attrView, item.GetID(), rollupFurtherCollections, cachedAttrViews) {
				pass = false
				break
			}
		}
		if pass {
			items = append(items, item)
		}
	}
	collection.SetItems(items)
}

func (value *Value) Filter(filter *ViewFilter, attrView *AttributeView, itemID string, rollupFurtherCollections map[string]Collection, cachedAttrViews map[string]*AttributeView) bool {
	if nil == filter || (nil == filter.Value && nil == filter.RelativeDate) {
		return true
	}

	if nil != filter.Value && value.Type != filter.Value.Type {
		// 由于字段类型被用户编辑过导致和过滤规则值类型不匹配，该情况下不过滤
		return true
	}

	if "" == filter.Qualifier {
		switch filter.Operator {
		case FilterOperatorIsEmpty:
			return value.IsEmpty()
		case FilterOperatorIsNotEmpty:
			return !value.IsEmpty()
		}
	}

	// 单独处理汇总
	if nil != value.Rollup && KeyTypeRollup == value.Type && nil != filter.Value && KeyTypeRollup == filter.Value.Type && nil != filter.Value.Rollup {
		key, _ := attrView.GetKey(value.KeyID)
		if nil == key {
			return false
		}

		relKey, _ := attrView.GetKey(key.Rollup.RelationKeyID)
		if nil == relKey {
			return false
		}

		relVal := attrView.GetValue(relKey.ID, itemID)
		if nil == relVal || nil == relVal.Relation {
			return false
		}

		destAv := cachedAttrViews[relKey.Relation.AvID]
		if nil == destAv {
			destAv, _ = ParseAttributeView(relKey.Relation.AvID)
			if nil != destAv {
				cachedAttrViews[relKey.Relation.AvID] = destAv
			}
		}
		if nil == destAv {
			return false
		}

		destKey, _ := destAv.GetKey(key.Rollup.KeyID)
		if nil == destKey {
			return false
		}

		value.Rollup.BuildContents(destAv.KeyValues, destKey, relVal, key.Rollup.Calc, rollupFurtherCollections[key.ID])

		switch filter.Qualifier {
		case FilterQuantifierUndefined, FilterQuantifierAny:
			if FilterOperatorIsEmpty == filter.Operator {
				if 1 > len(value.Rollup.Contents) {
					return true
				}

				if len(value.Rollup.Contents) < len(relVal.Relation.Contents) { // 说明汇总的目标字段存在空值
					return true
				}

				for _, c := range value.Rollup.Contents {
					if v := c.GetValByType(c.Type); nil == v || reflect.ValueOf(v).IsNil() {
						return true
					}
				}
				return false
			} else if FilterOperatorIsNotEmpty == filter.Operator {
				if 1 > len(value.Rollup.Contents) {
					return false
				}

				for _, c := range value.Rollup.Contents {
					if v := c.GetValByType(c.Type); nil != v && !reflect.ValueOf(v).IsNil() {
						return true
					}
				}
				return false
			}

			if 1 > len(filter.Value.Rollup.Contents) {
				return true
			}

			if v := filter.Value.GetValByType(filter.Value.Rollup.Contents[0].Type); nil == v || reflect.ValueOf(v).IsNil() {
				return true
			}

			for _, content := range value.Rollup.Contents {
				if content.filter(filter.Value.Rollup.Contents[0], filter.RelativeDate, filter.RelativeDate2, filter.Operator) {
					return true
				}
			}
		case FilterQuantifierAll:
			if FilterOperatorIsEmpty == filter.Operator {
				if 1 > len(value.Rollup.Contents) {
					return true
				}

				if len(value.Rollup.Contents) < len(relVal.Relation.Contents) {
					return false
				}

				for _, c := range value.Rollup.Contents {
					if v := c.GetValByType(c.Type); nil != v && !reflect.ValueOf(v).IsNil() {
						return false
					}
				}
				return true
			} else if FilterOperatorIsNotEmpty == filter.Operator {
				if 1 > len(value.Rollup.Contents) {
					return false
				}

				if len(value.Rollup.Contents) < len(relVal.Relation.Contents) {
					return false
				}

				for _, c := range value.Rollup.Contents {
					if v := c.GetValByType(c.Type); nil == v || reflect.ValueOf(v).IsNil() {
						return false
					}
				}
				return true
			}

			if 1 > len(filter.Value.Rollup.Contents) {
				return true
			}

			if v := filter.Value.GetValByType(filter.Value.Rollup.Contents[0].Type); nil == v || reflect.ValueOf(v).IsNil() {
				return true
			}

			for _, content := range value.Rollup.Contents {
				if !content.filter(filter.Value.Rollup.Contents[0], filter.RelativeDate, filter.RelativeDate2, filter.Operator) {
					return false
				}
			}
			return true
		case FilterQuantifierNone:
			if FilterOperatorIsEmpty == filter.Operator {
				if 1 > len(value.Rollup.Contents) {
					return false
				}

				if len(value.Rollup.Contents) < len(relVal.Relation.Contents) {
					return true
				}

				for _, c := range value.Rollup.Contents {
					if v := c.GetValByType(c.Type); nil == v || reflect.ValueOf(v).IsNil() {
						return false
					}
				}
				return true
			} else if FilterOperatorIsNotEmpty == filter.Operator {
				if 1 > len(value.Rollup.Contents) {
					return true
				}

				for _, c := range value.Rollup.Contents {
					if v := c.GetValByType(c.Type); nil != v && !reflect.ValueOf(v).IsNil() {
						return false
					}
				}
				return true
			}

			if 1 > len(filter.Value.Rollup.Contents) {
				return true
			}

			if v := filter.Value.GetValByType(filter.Value.Rollup.Contents[0].Type); nil == v || reflect.ValueOf(v).IsNil() {
				return true
			}

			for _, content := range value.Rollup.Contents {
				if content.filter(filter.Value.Rollup.Contents[0], filter.RelativeDate, filter.RelativeDate2, filter.Operator) {
					return false
				}
			}
			return true
		}
	}

	// 单独处理关联
	if nil != value.Relation && KeyTypeRelation == value.Type && nil != filter.Value && KeyTypeRelation == filter.Value.Type && nil != filter.Value.Relation {
		if 1 > len(filter.Value.Relation.BlockIDs) {
			return true
		}

		for _, relationValue := range value.Relation.Contents {
			filterValue := &Value{Type: KeyTypeBlock, Block: &ValueBlock{Content: filter.Value.Relation.BlockIDs[0]}}

			switch filter.Operator {
			case FilterOperatorContains:
				if relationValue.filter(filterValue, filter.RelativeDate, filter.RelativeDate2, filter.Operator) {
					return true
				}
			case FilterOperatorDoesNotContain:
				ret := relationValue.filter(filterValue, filter.RelativeDate, filter.RelativeDate2, filter.Operator)
				if !ret {
					return false
				}
			default:
				if relationValue.filter(filterValue, filter.RelativeDate, filter.RelativeDate2, filter.Operator) {
					return true
				}
			}
		}

		switch filter.Operator {
		case FilterOperatorContains:
			return false
		case FilterOperatorDoesNotContain:
			return true
		default:
			return false
		}
	}

	// 单独处理资源
	if nil != value.MAsset && KeyTypeMAsset == value.Type && nil != filter.Value && KeyTypeMAsset == filter.Value.Type {
		key, _ := attrView.GetKey(value.KeyID)
		if nil == key {
			return false
		}

		var filterContent string
		if 1 <= len(filter.Value.MAsset) {
			filterContent = filter.Value.MAsset[0].Content
		}

		switch filter.Qualifier {
		case FilterQuantifierUndefined, FilterQuantifierAny:
			if FilterOperatorIsEmpty == filter.Operator {
				if 1 > len(value.MAsset) {
					return true
				}

				for _, asset := range value.MAsset {
					if "" == strings.TrimSpace(asset.Name) && "" == strings.TrimSpace(asset.Content) {
						return true
					}
				}
				return false
			} else if FilterOperatorIsNotEmpty == filter.Operator {
				if 1 > len(value.MAsset) {
					return false
				}

				for _, asset := range value.MAsset {
					if "" != strings.TrimSpace(asset.Name) || "" != strings.TrimSpace(asset.Content) {
						return true
					}
				}
				return false
			}

			if nil == filter.Value || 1 > len(filter.Value.MAsset) {
				return true
			}

			for _, asset := range value.MAsset {
				switch asset.Type {
				case AssetTypeFile:
					if filterTextContent(filter.Operator, asset.Name, filterContent) ||
						filterTextContent(filter.Operator, asset.Content, filterContent) {
						return true
					}
				case AssetTypeImage:
					if filterTextContent(filter.Operator, asset.Content, filterContent) {
						return true
					}
				}
			}
		case FilterQuantifierAll:
			if FilterOperatorIsEmpty == filter.Operator {
				if 1 > len(value.MAsset) {
					return true
				}

				for _, asset := range value.MAsset {
					if "" != strings.TrimSpace(asset.Name) || "" != strings.TrimSpace(asset.Content) {
						return false
					}
				}
				return true
			} else if FilterOperatorIsNotEmpty == filter.Operator {
				if 1 > len(value.MAsset) {
					return false
				}

				for _, asset := range value.MAsset {
					if "" == strings.TrimSpace(asset.Name) && "" == strings.TrimSpace(asset.Content) {
						return false
					}
				}
				return true
			}

			if nil == filter.Value || 1 > len(filter.Value.MAsset) {
				return true
			}

			for _, asset := range value.MAsset {
				switch asset.Type {
				case AssetTypeFile:
					if !filterTextContent(filter.Operator, asset.Name, filterContent) &&
						!filterTextContent(filter.Operator, asset.Content, filterContent) {
						return false
					}
				case AssetTypeImage:
					if !filterTextContent(filter.Operator, asset.Content, filterContent) {
						return false
					}
				}
			}
			return true
		case FilterQuantifierNone:
			if FilterOperatorIsEmpty == filter.Operator {
				if 1 > len(value.MAsset) {
					return false
				}

				for _, asset := range value.MAsset {
					if "" == strings.TrimSpace(asset.Name) && "" == strings.TrimSpace(asset.Content) {
						return false
					}
				}
				return true
			} else if FilterOperatorIsNotEmpty == filter.Operator {
				if 1 > len(value.MAsset) {
					return true
				}

				for _, asset := range value.MAsset {
					if "" != strings.TrimSpace(asset.Name) || "" != strings.TrimSpace(asset.Content) {
						return false
					}
				}
				return true
			}

			if nil == filter.Value || 1 > len(filter.Value.MAsset) {
				return true
			}

			for _, asset := range value.MAsset {
				switch asset.Type {
				case AssetTypeFile:
					if filterTextContent(filter.Operator, asset.Name, filterContent) {
						return false
					}
					if filterTextContent(filter.Operator, asset.Content, filterContent) {
						return false
					}
				case AssetTypeImage:
					if filterTextContent(filter.Operator, asset.Content, filterContent) {
						return false
					}
				}
			}
			return true
		}
	}
	return value.filter(filter.Value, filter.RelativeDate, filter.RelativeDate2, filter.Operator)
}

func (value *Value) filter(other *Value, relativeDate, relativeDate2 *RelativeDate, operator FilterOperator) bool {
	switch operator {
	case FilterOperatorIsEmpty:
		return value.IsEmpty()
	case FilterOperatorIsNotEmpty:
		return !value.IsEmpty()
	}

	switch value.Type {
	case KeyTypeBlock:
		if nil != value.Block && nil != other && nil != other.Block {
			return filterTextContent(operator, value.Block.Content, other.Block.Content)
		}
	case KeyTypeText:
		if nil != value.Text && nil != other && nil != other.Text {
			return filterTextContent(operator, value.Text.Content, other.Text.Content)
		}
	case KeyTypeNumber:
		if nil != value.Number && nil != other && nil != other.Number {
			if !other.Number.IsNotEmpty {
				return true
			}

			switch operator {
			case FilterOperatorIsEqual:
				return value.Number.Content == other.Number.Content && value.Number.IsNotEmpty == other.Number.IsNotEmpty
			case FilterOperatorIsNotEqual:
				return value.Number.Content != other.Number.Content || value.Number.IsNotEmpty != other.Number.IsNotEmpty
			case FilterOperatorIsGreater:
				return value.Number.Content > other.Number.Content
			case FilterOperatorIsGreaterOrEqual:
				return value.Number.Content >= other.Number.Content
			case FilterOperatorIsLess:
				return value.Number.Content < other.Number.Content
			case FilterOperatorIsLessOrEqual:
				return value.Number.Content <= other.Number.Content
			}
		}
	case KeyTypeDate:
		if nil != value.Date && nil != other && nil != other.Date && nil == relativeDate && !other.Date.IsNotEmpty {
			return true
		}

		if nil != value.Date {
			if !value.Date.IsNotEmpty {
				// 空值不进行比较，直接排除
				// Database date filter excludes empty values https://github.com/siyuan-note/siyuan/issues/11061
				return false
			}

			if nil != relativeDate { // 使用相对时间比较
				relativeTimeStart, relativeTimeEnd := calcRelativeTimeRegion(relativeDate.Count, relativeDate.Unit, relativeDate.Direction)
				relativeTimeStart2, relativeTimeEnd2 := calcRelativeTimeRegion(relativeDate2.Count, relativeDate2.Unit, relativeDate2.Direction)
				return filterRelativeTime(value.Date.Content, value.Date.IsNotEmpty, operator, relativeTimeStart, relativeTimeEnd, relativeDate.Direction, relativeTimeStart2, relativeTimeEnd2, relativeDate2.Direction)
			} else { // 使用具体时间比较
				if nil == other.Date {
					return true
				}
				return filterTime(value.Date.Content, value.Date.IsNotEmpty, other.Date.Content, other.Date.Content2, operator)
			}
		}
	case KeyTypeCreated:
		if nil != value.Created {
			if nil != relativeDate { // 使用相对时间比较
				relativeTimeStart, relativeTimeEnd := calcRelativeTimeRegion(relativeDate.Count, relativeDate.Unit, relativeDate.Direction)
				relativeTimeStart2, relativeTimeEnd2 := calcRelativeTimeRegion(relativeDate2.Count, relativeDate2.Unit, relativeDate2.Direction)
				return filterRelativeTime(value.Created.Content, true, operator, relativeTimeStart, relativeTimeEnd, relativeDate.Direction, relativeTimeStart2, relativeTimeEnd2, relativeDate2.Direction)
			} else { // 使用具体时间比较
				if nil == other.Created {
					return true
				}
				return filterTime(value.Created.Content, value.Created.IsNotEmpty, other.Created.Content, other.Created.Content2, operator)
			}
		}
	case KeyTypeUpdated:
		if nil != value.Updated {
			if nil != relativeDate { // 使用相对时间比较
				relativeTimeStart, relativeTimeEnd := calcRelativeTimeRegion(relativeDate.Count, relativeDate.Unit, relativeDate.Direction)
				relativeTimeStart2, relativeTimeEnd2 := calcRelativeTimeRegion(relativeDate2.Count, relativeDate2.Unit, relativeDate2.Direction)
				return filterRelativeTime(value.Updated.Content, true, operator, relativeTimeStart, relativeTimeEnd, relativeDate.Direction, relativeTimeStart2, relativeTimeEnd2, relativeDate2.Direction)
			} else { // 使用具体时间比较
				if nil == other.Updated {
					return true
				}

				return filterTime(value.Updated.Content, value.Updated.IsNotEmpty, other.Updated.Content, other.Updated.Content2, operator)
			}
		}
	case KeyTypeSelect, KeyTypeMSelect:
		if nil != value.MSelect {
			if 1 > len(other.MSelect) {
				return true
			}

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
			}
		}
	case KeyTypeURL:
		if nil != value.URL && nil != other && nil != other.URL {
			return filterTextContent(operator, value.URL.Content, other.URL.Content)
		}
	case KeyTypeEmail:
		if nil != value.Email && nil != other && nil != other.Email {
			return filterTextContent(operator, value.Email.Content, other.Email.Content)
		}
	case KeyTypePhone:
		if nil != value.Phone && nil != other && nil != other.Phone {
			return filterTextContent(operator, value.Phone.Content, other.Phone.Content)
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
	case KeyTypeRelation: // 过滤汇总字段，并且汇总目标是关联字段时才会进入该分支
		if nil != value.Relation && 0 < len(value.Relation.Contents) && nil != value.Relation.Contents[0].Block &&
			nil != other && nil != other.Relation && 0 < len(other.Relation.BlockIDs) {
			filterValue := &Value{Type: KeyTypeBlock, Block: &ValueBlock{Content: other.Relation.BlockIDs[0]}}
			return filterTextContent(operator, value.Relation.Contents[0].Block.Content, filterValue.Block.Content)
		}
	}
	return false
}

func filterTextContent(operator FilterOperator, valueContent, otherValueContent string) bool {
	switch operator {
	case FilterOperatorIsEqual:
		if "" == strings.TrimSpace(otherValueContent) {
			return true
		}
		if util.SearchCaseSensitive {
			return valueContent == otherValueContent
		}
		return strings.EqualFold(valueContent, otherValueContent)
	case FilterOperatorIsNotEqual:
		if "" == strings.TrimSpace(otherValueContent) {
			return true
		}
		if util.SearchCaseSensitive {
			return valueContent != otherValueContent
		}
		return !strings.EqualFold(valueContent, otherValueContent)
	case FilterOperatorContains:
		if "" == strings.TrimSpace(otherValueContent) {
			return true
		}
		if util.SearchCaseSensitive {
			return strings.Contains(valueContent, otherValueContent)
		}
		return strings.Contains(strings.ToLower(valueContent), strings.ToLower(otherValueContent))
	case FilterOperatorDoesNotContain:
		if "" == strings.TrimSpace(otherValueContent) {
			return true
		}
		if util.SearchCaseSensitive {
			return !strings.Contains(valueContent, otherValueContent)
		}
		return !strings.Contains(strings.ToLower(valueContent), strings.ToLower(otherValueContent))
	case FilterOperatorStartsWith:
		if "" == strings.TrimSpace(otherValueContent) {
			return true
		}
		if util.SearchCaseSensitive {
			return strings.HasPrefix(valueContent, otherValueContent)
		}
		return strings.HasPrefix(strings.ToLower(valueContent), strings.ToLower(otherValueContent))
	case FilterOperatorEndsWith:
		if "" == strings.TrimSpace(otherValueContent) {
			return true
		}
		if util.SearchCaseSensitive {
			return strings.HasSuffix(valueContent, otherValueContent)
		}
		return strings.HasSuffix(strings.ToLower(valueContent), strings.ToLower(otherValueContent))
	case FilterOperatorIsEmpty:
		return "" == strings.TrimSpace(valueContent)
	case FilterOperatorIsNotEmpty:
		return "" != strings.TrimSpace(valueContent)
	}
	return false
}

func filterRelativeTime(valueMills int64, valueIsNotEmpty bool, operator FilterOperator, otherValueStart, otherValueEnd time.Time, direction RelativeDateDirection, otherValueStart2, otherValueEnd2 time.Time, direction2 RelativeDateDirection) bool {
	valueTime := time.UnixMilli(valueMills)

	if otherValueStart.After(otherValueStart2) && FilterOperatorIsBetween == operator {
		tmpStart, tmpEnd := otherValueStart2, otherValueEnd2
		otherValueStart2, otherValueEnd2 = otherValueStart, otherValueEnd
		otherValueStart, otherValueEnd = tmpStart, tmpEnd
	}

	switch operator {
	case FilterOperatorIsEqual:
		return (valueTime.After(otherValueStart) || valueTime.Equal(otherValueStart)) && (valueTime.Before(otherValueEnd) || valueTime.Equal(otherValueEnd))
	case FilterOperatorIsNotEqual:
		return valueTime.Before(otherValueStart) || valueTime.After(otherValueEnd)
	case FilterOperatorIsGreater:
		return valueTime.After(otherValueEnd)
	case FilterOperatorIsGreaterOrEqual:
		return valueTime.After(otherValueStart) || valueTime.Equal(otherValueStart)
	case FilterOperatorIsLess:
		return valueTime.Before(otherValueStart)
	case FilterOperatorIsLessOrEqual:
		return valueTime.Before(otherValueEnd) || valueTime.Equal(otherValueEnd)
	case FilterOperatorIsBetween:
		if RelativeDateDirectionBefore == direction {
			if RelativeDateDirectionBefore == direction2 {
				var leftStart, rightEnd time.Time
				if otherValueStart.Before(otherValueStart2) {
					leftStart = otherValueStart
				} else {
					leftStart = otherValueStart2
				}
				if otherValueEnd.Before(otherValueStart2) {
					rightEnd = otherValueEnd
				} else {
					rightEnd = otherValueStart2
				}
				return (valueTime.After(leftStart) || valueTime.Equal(leftStart)) && (valueTime.Before(rightEnd) || valueTime.Equal(rightEnd))
			} else if RelativeDateDirectionThis == direction2 {
				return ((valueTime.After(otherValueStart) || valueTime.Equal(otherValueStart)) && (valueTime.Before(otherValueEnd) || valueTime.Equal(otherValueEnd))) ||
					((valueTime.After(otherValueStart2) || valueTime.Equal(otherValueStart2)) && (valueTime.Before(otherValueEnd2) || valueTime.Equal(otherValueEnd2)))
			} else if RelativeDateDirectionAfter == direction2 {
				var leftStart, rightEnd time.Time
				if otherValueStart.Before(otherValueStart2) {
					leftStart = otherValueStart
				} else {
					leftStart = otherValueStart2
				}
				if otherValueEnd.Before(otherValueEnd2) {
					rightEnd = otherValueEnd2
				} else {
					rightEnd = otherValueEnd
				}
				return (valueTime.After(leftStart) || valueTime.Equal(leftStart)) && (valueTime.Before(rightEnd) || valueTime.Equal(rightEnd))
			}
		} else if RelativeDateDirectionThis == direction {
			return ((valueTime.After(otherValueStart) || valueTime.Equal(otherValueStart)) && (valueTime.Before(otherValueEnd) || valueTime.Equal(otherValueEnd))) ||
				((valueTime.After(otherValueStart2) || valueTime.Equal(otherValueStart2)) && (valueTime.Before(otherValueEnd2) || valueTime.Equal(otherValueEnd2)))
		} else if RelativeDateDirectionAfter == direction {
			if RelativeDateDirectionBefore == direction2 {
				var leftStart, rightEnd time.Time
				if otherValueStart.Before(otherValueStart2) {
					leftStart = otherValueStart
				} else {
					leftStart = otherValueStart2
				}
				if otherValueEnd.Before(otherValueEnd2) {
					rightEnd = otherValueEnd2
				} else {
					rightEnd = otherValueEnd
				}
				return (valueTime.After(leftStart) || valueTime.Equal(leftStart)) && (valueTime.Before(rightEnd) || valueTime.Equal(rightEnd))
			} else if RelativeDateDirectionThis == direction2 {
				return ((valueTime.After(otherValueStart) || valueTime.Equal(otherValueStart)) && (valueTime.Before(otherValueEnd) || valueTime.Equal(otherValueEnd))) ||
					((valueTime.After(otherValueStart2) || valueTime.Equal(otherValueStart2)) && (valueTime.Before(otherValueEnd2) || valueTime.Equal(otherValueEnd2)))
			} else if RelativeDateDirectionAfter == direction2 {
				var leftStart, rightEnd time.Time
				if otherValueStart.Before(otherValueStart2) {
					leftStart = otherValueStart
				} else {
					leftStart = otherValueStart2
				}
				if otherValueEnd.After(otherValueEnd2) {
					rightEnd = otherValueEnd
				} else {
					rightEnd = otherValueEnd2
				}
				return (valueTime.After(leftStart) || valueTime.Equal(leftStart)) && (valueTime.Before(rightEnd) || valueTime.Equal(rightEnd))
			}
		}
		return false
	case FilterOperatorIsEmpty:
		return !valueIsNotEmpty
	case FilterOperatorIsNotEmpty:
		return valueIsNotEmpty
	}
	return false
}

func filterTime(valueMills int64, valueIsNotEmpty bool, otherValueMills, otherValueMills2 int64, operator FilterOperator) bool {
	valueTime := time.UnixMilli(valueMills)

	if 0 != otherValueMills2 && otherValueMills > otherValueMills2 && FilterOperatorIsBetween == operator {
		tmp := otherValueMills2
		otherValueMills2 = otherValueMills
		otherValueMills = tmp
	}

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
		if 0 == otherValueMills || 0 == otherValueMills2 {
			return true
		}
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

func (filter *ViewFilter) IsValid() bool {
	if nil == filter || nil == filter.Value {
		return false
	}

	if FilterOperatorIsEmpty != filter.Operator && FilterOperatorIsNotEmpty != filter.Operator {
		if filter.Value.IsEmpty() && nil == filter.RelativeDate {
			return false
		}
	}
	return true
}

func (filter *ViewFilter) GetAffectValue(key *Key, addingBlockID string) (ret *Value) {
	if nil != filter.Value {
		if KeyTypeRelation == filter.Value.Type || KeyTypeTemplate == filter.Value.Type || KeyTypeRollup == filter.Value.Type || KeyTypeUpdated == filter.Value.Type || KeyTypeCreated == filter.Value.Type {
			// 所有生成的数据都不设置默认值
			return nil
		}
	}

	if nil == filter.Value {
		return nil
	}

	if FilterOperatorIsEmpty != filter.Operator && FilterOperatorIsNotEmpty != filter.Operator {
		if filter.Value.IsEmpty() && nil == filter.RelativeDate {
			// 在不是过滤空值和非空值的情况下，空值不设置默认值 https://github.com/siyuan-note/siyuan/issues/11297
			return nil
		}
	}

	ret = filter.Value.Clone()
	ret.ID = ast.NewNodeID()
	ret.KeyID = key.ID
	ret.BlockID = addingBlockID
	ret.CreatedAt = util.CurrentTimeMillis()
	ret.UpdatedAt = ret.CreatedAt + 1000

	switch filter.Value.Type {
	case KeyTypeBlock:
		switch filter.Operator {
		case FilterOperatorIsEqual:
			ret.Block = &ValueBlock{Content: filter.Value.Block.Content, Created: ret.CreatedAt, Updated: ret.UpdatedAt}
		case FilterOperatorIsNotEqual:
			ret.Block = &ValueBlock{Content: "", Created: ret.CreatedAt, Updated: ret.UpdatedAt}
		case FilterOperatorContains:
			ret.Block = &ValueBlock{Content: filter.Value.Block.Content, Created: ret.CreatedAt, Updated: ret.UpdatedAt}
		case FilterOperatorDoesNotContain:
			ret.Block = &ValueBlock{Content: "", Created: ret.CreatedAt, Updated: ret.UpdatedAt}
		case FilterOperatorStartsWith:
			ret.Block = &ValueBlock{Content: filter.Value.Block.Content, Created: ret.CreatedAt, Updated: ret.UpdatedAt}
		case FilterOperatorEndsWith:
			ret.Block = &ValueBlock{Content: filter.Value.Block.Content, Created: ret.CreatedAt, Updated: ret.UpdatedAt}
		case FilterOperatorIsEmpty:
			ret.Block = &ValueBlock{Content: "", Created: ret.CreatedAt, Updated: ret.UpdatedAt}
		case FilterOperatorIsNotEmpty:
			return nil
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
			return nil
		}
	case KeyTypeNumber:
		switch filter.Operator {
		case FilterOperatorIsEqual:
			ret.Number = &ValueNumber{Content: filter.Value.Number.Content, IsNotEmpty: true}
		case FilterOperatorIsNotEqual:
			ret.Number = &ValueNumber{Content: 0, IsNotEmpty: false}
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
		start := time.Now()
		end := start
		if nil != filter.Value.Date {
			start = time.UnixMilli(filter.Value.Date.Content)
			end = time.UnixMilli(filter.Value.Date.Content2)
		}
		if nil != filter.RelativeDate {
			start, end = calcRelativeTimeRegion(filter.RelativeDate.Count, filter.RelativeDate.Unit, filter.RelativeDate.Direction)
		}

		switch filter.Operator {
		case FilterOperatorIsEqual:
			ret.Date = &ValueDate{Content: start.UnixMilli(), IsNotEmpty: true}
		case FilterOperatorIsGreater:
			ret.Date = &ValueDate{Content: end.Add(24 * time.Hour).UnixMilli(), IsNotEmpty: true}
		case FilterOperatorIsGreaterOrEqual:
			ret.Date = &ValueDate{Content: start.UnixMilli(), IsNotEmpty: true}
		case FilterOperatorIsLess:
			ret.Date = &ValueDate{Content: start.Add(-24 * time.Hour).UnixMilli(), IsNotEmpty: true}
		case FilterOperatorIsLessOrEqual:
			ret.Date = &ValueDate{Content: start.UnixMilli(), IsNotEmpty: true}
		case FilterOperatorIsBetween:
			start2, end2 := start, end
			if nil != filter.RelativeDate2 {
				start2, end2 = calcRelativeTimeRegion(filter.RelativeDate2.Count, filter.RelativeDate2.Unit, filter.RelativeDate2.Direction)
				if start.After(start2) {
					tmp := start
					start = start2
					start2 = tmp
				}
				if end.Before(end2) {
					tmp := end
					end = end2
					end2 = tmp
				}
			} else {
				if start.After(end) {
					tmp := start
					start = end
					end = tmp
				}
			}

			now := time.Now()
			if start.Before(now) && now.Before(end) {
				ret.Date = &ValueDate{Content: now.UnixMilli(), IsNotEmpty: true}
				return
			}
			ret.Date = &ValueDate{Content: start.UnixMilli(), IsNotEmpty: true}
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
			return nil
		case FilterOperatorContains:
			if 0 < len(filter.Value.MSelect) {
				ret.MSelect = []*ValueSelect{{Content: filter.Value.MSelect[0].Content, Color: filter.Value.MSelect[0].Color}}
			}
		case FilterOperatorDoesNotContain:
			return nil
		case FilterOperatorIsEmpty:
			ret.MSelect = []*ValueSelect{}
		case FilterOperatorIsNotEmpty:
			if 0 < len(key.Options) {
				ret.MSelect = []*ValueSelect{{Content: key.Options[0].Name, Color: key.Options[0].Color}}
			} else {
				return nil
			}
		}
	case KeyTypeURL:
		switch filter.Operator {
		case FilterOperatorIsEqual:
			ret.URL = &ValueURL{Content: filter.Value.URL.Content}
		case FilterOperatorIsNotEqual:
			ret.URL = &ValueURL{Content: ""}
		case FilterOperatorContains:
			ret.URL = &ValueURL{Content: filter.Value.URL.Content}
		case FilterOperatorDoesNotContain:
			ret.URL = &ValueURL{Content: ""}
		case FilterOperatorStartsWith:
			ret.URL = &ValueURL{Content: filter.Value.URL.Content}
		case FilterOperatorEndsWith:
			ret.URL = &ValueURL{Content: filter.Value.URL.Content}
		case FilterOperatorIsEmpty:
			ret.URL = &ValueURL{Content: ""}
		case FilterOperatorIsNotEmpty:
			return nil
		}
	case KeyTypeEmail:
		switch filter.Operator {
		case FilterOperatorIsEqual:
			ret.Email = &ValueEmail{Content: filter.Value.Email.Content}
		case FilterOperatorIsNotEqual:
			ret.Email = &ValueEmail{Content: ""}
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
			return nil
		}
	case KeyTypePhone:
		switch filter.Operator {
		case FilterOperatorIsEqual:
			ret.Phone = &ValuePhone{Content: filter.Value.Phone.Content}
		case FilterOperatorIsNotEqual:
			ret.Phone = &ValuePhone{Content: ""}
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
			return nil
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
