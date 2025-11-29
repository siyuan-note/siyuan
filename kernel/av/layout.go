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
	ID     string     `json:"id"`             // 字段 ID
	Wrap   bool       `json:"wrap"`           // 是否换行
	Hidden bool       `json:"hidden"`         // 是否隐藏
	Desc   string     `json:"desc,omitempty"` // 字段描述
	Calc   *FieldCalc `json:"calc,omitempty"` // 计算规则
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

	GroupKey    *Key       `json:"groupKey,omitempty"`   // 分组字段
	GroupValue  *Value     `json:"groupValue,omitempty"` // 分组值
	Groups      []Viewable `json:"groups,omitempty"`     // 分组实例列表
	GroupCalc   *GroupCalc `json:"groupCalc,omitempty"`  // 分组计算规则和结果
	GroupFolded bool       `json:"groupFolded"`          // 分组是否折叠
	GroupHidden int        `json:"groupHidden"`          // 分组是否隐藏，0：显示，1：空白隐藏，2：手动隐藏
}

func NewViewBaseInstance(view *View) *BaseInstance {
	showIcon, wrapField := true, false
	switch view.LayoutType {
	case LayoutTypeTable:
		showIcon = view.Table.ShowIcon
		wrapField = view.Table.WrapField
	case LayoutTypeGallery:
		showIcon = view.Gallery.ShowIcon
		wrapField = view.Gallery.WrapField
	case LayoutTypeKanban:
		showIcon = view.Kanban.ShowIcon
		wrapField = view.Kanban.WrapField
	}
	return &BaseInstance{
		ID:               view.ID,
		Icon:             view.Icon,
		Name:             view.Name,
		Desc:             view.Desc,
		HideAttrViewName: view.HideAttrViewName,
		Filters:          view.Filters,
		Sorts:            view.Sorts,
		Group:            view.Group,
		GroupKey:         view.GroupKey,
		GroupValue:       view.GroupVal,
		GroupCalc:        view.GroupCalc,
		GroupFolded:      view.GroupFolded,
		GroupHidden:      view.GroupHidden,
		ShowIcon:         showIcon,
		WrapField:        wrapField,
	}
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

func (baseInstance *BaseInstance) SetGroupCalc(group *GroupCalc) {
	baseInstance.GroupCalc = group
}

func (baseInstance *BaseInstance) GetGroupCalc() *GroupCalc {
	return baseInstance.GroupCalc
}

func (baseInstance *BaseInstance) SetGroupFolded(folded bool) {
	baseInstance.GroupFolded = folded
}

func (baseInstance *BaseInstance) GetGroupHidden() int {
	return baseInstance.GroupHidden
}

func (baseInstance *BaseInstance) SetGroupHidden(hidden int) {
	baseInstance.GroupHidden = hidden
}

func (baseInstance *BaseInstance) GetID() string {
	return baseInstance.ID
}

// BaseInstanceField 描述了实例字段的基础结构。
type BaseInstanceField struct {
	ID     string     `json:"id"`     // ID
	Name   string     `json:"name"`   // 名称
	Type   KeyType    `json:"type"`   // 类型
	Icon   string     `json:"icon"`   // 图标
	Wrap   bool       `json:"wrap"`   // 是否换行
	Hidden bool       `json:"hidden"` // 是否隐藏
	Desc   string     `json:"desc"`   // 描述
	Calc   *FieldCalc `json:"calc"`   // 计算规则和结果

	// 以下是某些字段类型的特有属性

	Options      []*SelectOption `json:"options,omitempty"`  // 选项列表
	NumberFormat NumberFormat    `json:"numberFormat"`       // 数字字段格式化
	Template     string          `json:"template"`           // 模板字段内容
	Relation     *Relation       `json:"relation,omitempty"` // 关联字段
	Rollup       *Rollup         `json:"rollup,omitempty"`   // 汇总字段
	Date         *Date           `json:"date,omitempty"`     // 日期设置
	Created      *Created        `json:"created,omitempty"`  // 创建时间设置
	Updated      *Updated        `json:"updated,omitempty"`  // 更新时间设置
}

func (baseInstanceField *BaseInstanceField) GetID() string {
	return baseInstanceField.ID
}

func (baseInstanceField *BaseInstanceField) GetCalc() *FieldCalc {
	return baseInstanceField.Calc
}

func (baseInstanceField *BaseInstanceField) SetCalc(calc *FieldCalc) {
	baseInstanceField.Calc = calc
}

func (baseInstanceField *BaseInstanceField) GetType() KeyType {
	return baseInstanceField.Type
}

func (baseInstanceField *BaseInstanceField) GetNumberFormat() NumberFormat {
	return baseInstanceField.NumberFormat
}

// Collection 描述了一个集合的接口。
// 集合可以是表格、卡片等，包含多个项目。
type Collection interface {

	// GetItems 返回集合中的所有项目。
	GetItems() (ret []Item)

	// SetItems 设置集合中的项目。
	SetItems(items []Item)

	// CountItems 返回集合中的项目数量。
	CountItems() int

	// GetFields 返回集合的所有字段。
	GetFields() []Field

	// GetField 返回指定 ID 的字段。
	GetField(id string) (ret Field, fieldIndex int)

	// GetValue 返回指定项目 ID 和键 ID 的字段值。
	GetValue(itemID, keyID string) (ret *Value)

	// GetSorts 返回集合的排序规则。
	GetSorts() []*ViewSort

	// GetFilters 返回集合的过滤规则。
	GetFilters() []*ViewFilter
}

// Field 描述了一个字段的接口。
type Field interface {

	// GetID 返回字段的 ID。
	GetID() string

	// GetType 返回字段的类型。
	GetType() KeyType

	// GetCalc 返回字段的计算规则和结果。
	GetCalc() *FieldCalc

	// SetCalc 设置字段的计算规则和结果。
	SetCalc(*FieldCalc)

	// GetNumberFormat 返回数字字段的格式化设置。
	GetNumberFormat() NumberFormat
}

// Item 描述了一个项目的接口。
// 项目可以是表格行、卡片等。
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
