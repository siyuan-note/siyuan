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

import "sort"

// BaseLayout 描述了布局的基础结构。
type BaseLayout struct {
	Spec int    `json:"spec"` // 布局格式版本
	ID   string `json:"id"`   // 布局 ID

	ShowIcon  bool `json:"showIcon"`  // 是否显示字段图标
	WrapField bool `json:"wrapField"` // 是否换行字段内容

	// TODO 以下三个字段已经废弃，计划于 2026 年 6 月 30 日后删除 https://github.com/siyuan-note/siyuan/issues/15162

	//Deprecated
	Filters []*ViewFilter `json:"filters,omitempty"` // 过滤规则
	//Deprecated
	Sorts []*ViewSort `json:"sorts,omitempty"` // 排序规则
	//Deprecated
	PageSize int `json:"pageSize,omitempty"` // 每页条目数
}

// BaseField 描述了字段的基础结构。
type BaseField struct {
	ID     string `json:"id"`             // 字段 ID
	Wrap   bool   `json:"wrap"`           // 是否换行
	Hidden bool   `json:"hidden"`         // 是否隐藏
	Desc   string `json:"desc,omitempty"` // 字段描述
}

// BaseValue 描述了字段值的基础结构。
type BaseValue struct {
	ID        string  `json:"id"`        // 字段值 ID
	Value     *Value  `json:"value"`     // 字段值
	ValueType KeyType `json:"valueType"` // 字段值类型
}

// BaseInstance 描述了实例的基础结构。
type BaseInstance struct {
	ID               string        `json:"id"`               // ID
	Icon             string        `json:"icon"`             // 图标
	Name             string        `json:"name"`             // 名称
	Desc             string        `json:"desc"`             // 描述
	HideAttrViewName bool          `json:"hideAttrViewName"` // 是否隐藏属性视图名称
	Filters          []*ViewFilter `json:"filters"`          // 过滤规则
	Sorts            []*ViewSort   `json:"sorts"`            // 排序规则
	Group            *ViewGroup    `json:"group"`            // 分组规则
	PageSize         int           `json:"pageSize"`         // 每页项目数
	ShowIcon         bool          `json:"showIcon"`         // 是否显示字段图标
	WrapField        bool          `json:"wrapField"`        // 是否换行字段内容
	Folded           bool          `json:"folded,omitempty"` // 是否折叠
	Hidden           bool          `json:"hidden,omitempty"` // 是否隐藏

	Groups []Viewable `json:"groups,omitempty"` // 分组实例列表
}

func (baseInstance *BaseInstance) GetSorts() []*ViewSort {
	return baseInstance.Sorts
}

func (baseInstance *BaseInstance) GetFilters() []*ViewFilter {
	return baseInstance.Filters
}

func (baseInstance *BaseInstance) SetGroups(viewables []Viewable) {
	baseInstance.Groups = viewables
}

func (baseInstance *BaseInstance) GetID() string {
	return baseInstance.ID
}

// BaseInstanceField 描述了实例字段的基础结构。
type BaseInstanceField struct {
	ID     string  `json:"id"`     // ID
	Name   string  `json:"name"`   // 名称
	Type   KeyType `json:"type"`   // 类型
	Icon   string  `json:"icon"`   // 图标
	Wrap   bool    `json:"wrap"`   // 是否换行
	Hidden bool    `json:"hidden"` // 是否隐藏
	Desc   string  `json:"desc"`   // 描述

	// 以下是某些字段类型的特有属性

	Options      []*SelectOption `json:"options,omitempty"`  // 选项列表
	NumberFormat NumberFormat    `json:"numberFormat"`       // 数字字段格式化
	Template     string          `json:"template"`           // 模板字段内容
	Relation     *Relation       `json:"relation,omitempty"` // 关联字段
	Rollup       *Rollup         `json:"rollup,omitempty"`   // 汇总字段
	Date         *Date           `json:"date,omitempty"`     // 日期设置
}

func (baseInstanceField *BaseInstanceField) GetID() string {
	return baseInstanceField.ID
}

// Collection 描述了一个集合的接口。
// 集合可以是表格、画廊等，包含多个项目。
type Collection interface {

	// GetItems 返回集合中的所有项目。
	GetItems() (ret []Item)

	// SetItems 设置集合中的项目。
	SetItems(items []Item)

	// GetFields 返回集合的所有字段。
	GetFields() []Field

	// GetSorts 返回集合的排序规则。
	GetSorts() []*ViewSort

	// GetFilters 返回集合的过滤规则。
	GetFilters() []*ViewFilter
}

// Field 描述了一个字段的接口。
type Field interface {

	// GetID 返回字段的 ID。
	GetID() string
}

// Item 描述了一个项目的接口。
// 项目可以是表格行、画廊卡片等。
type Item interface {

	// GetBlockValue 返回主键的值。
	GetBlockValue() *Value

	// GetValues 返回项目的所有字段值。
	GetValues() []*Value

	// GetValue 返回指定键 ID 的字段值。
	GetValue(keyID string) (ret *Value)

	// GetID 返回项目的 ID。
	GetID() string
}

func sort0(collection Collection, attrView *AttributeView) {
	sorts := collection.GetSorts()
	if 1 > len(sorts) {
		return
	}

	type FieldIndexSort struct {
		Index int
		Order SortOrder
	}

	var fieldIndexSorts []*FieldIndexSort
	for _, s := range sorts {
		for i, c := range collection.GetFields() {
			if c.GetID() == s.Column {
				fieldIndexSorts = append(fieldIndexSorts, &FieldIndexSort{Index: i, Order: s.Order})
				break
			}
		}
	}

	items := collection.GetItems()
	editedValItems := map[string]bool{}
	for i, item := range items {
		for _, fieldIndexSort := range fieldIndexSorts {
			val := items[i].GetValues()[fieldIndexSort.Index]
			if KeyTypeCheckbox == val.Type {
				if block := item.GetBlockValue(); nil != block && block.IsEdited() {
					// 如果主键编辑过，则勾选框也算作编辑过，参与排序 https://github.com/siyuan-note/siyuan/issues/11016
					editedValItems[item.GetID()] = true
					break
				}
			}

			if val.IsEdited() {
				// 如果该卡片某字段的值已经编辑过，则该卡片可参与排序
				editedValItems[item.GetID()] = true
				break
			}
		}
	}

	// 将未编辑的卡片和已编辑的卡片分开排序
	var uneditedItems, editedItems []Item
	for _, item := range items {
		if _, ok := editedValItems[item.GetID()]; ok {
			editedItems = append(editedItems, item)
		} else {
			uneditedItems = append(uneditedItems, item)
		}
	}

	sort.Slice(uneditedItems, func(i, j int) bool {
		val1 := uneditedItems[i].GetBlockValue()
		if nil == val1 {
			return true
		}
		val2 := uneditedItems[j].GetBlockValue()
		if nil == val2 {
			return false
		}
		return val1.CreatedAt < val2.CreatedAt
	})

	sort.Slice(editedItems, func(i, j int) bool {
		sorted := true
		for _, fieldIndexSort := range fieldIndexSorts {
			val1 := editedItems[i].GetValues()[fieldIndexSort.Index]
			val2 := editedItems[j].GetValues()[fieldIndexSort.Index]
			if nil == val1 || val1.IsEmpty() {
				if nil != val2 && !val2.IsEmpty() {
					return false
				}
				sorted = false
				continue
			} else {
				if nil == val2 || val2.IsEmpty() {
					return true
				}
			}

			result := val1.Compare(val2, attrView)
			if 0 == result {
				sorted = false
				continue
			}
			sorted = true

			if fieldIndexSort.Order == SortOrderAsc {
				return 0 > result
			}
			return 0 < result
		}

		if !sorted {
			key1 := editedItems[i].GetBlockValue()
			if nil == key1 {
				return false
			}
			key2 := editedItems[j].GetBlockValue()
			if nil == key2 {
				return false
			}
			return key1.CreatedAt < key2.CreatedAt
		}
		return false
	})

	// 将包含未编辑的卡片放在最后
	collection.SetItems(append(editedItems, uneditedItems...))
	if 1 > len(collection.GetItems()) {
		collection.SetItems([]Item{})
	}
}

func filter0(collection Collection, attrView *AttributeView) {
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
	attrViewCache := map[string]*AttributeView{}
	attrViewCache[attrView.ID] = attrView
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

			if !values[index].Filter(filters[j], attrView, item.GetID(), &attrViewCache) {
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
