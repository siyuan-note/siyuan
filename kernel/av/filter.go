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
	Direction RelativeDateDirection `json:"direction"` // 方向：-1 前、0 这、1 后
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
