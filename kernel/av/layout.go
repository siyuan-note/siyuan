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
	Spec     int           `json:"spec"`     // 布局格式版本
	ID       string        `json:"id"`       // 布局 ID
	Filters  []*ViewFilter `json:"filters"`  // 过滤规则
	Sorts    []*ViewSort   `json:"sorts"`    // 排序规则
	PageSize int           `json:"pageSize"` // 每页行数
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
	PageSize         int           `json:"pageSize"`         // 每页项目
}

// BaseInstanceField 描述了实例字段的基础结构。
type BaseInstanceField struct {
	ID     string  `json:"id"`     // ID
	Name   string  `json:"name"`   // 字段名
	Type   KeyType `json:"type"`   // 字段类型
	Icon   string  `json:"icon"`   // 字段图标
	Wrap   bool    `json:"wrap"`   // 是否换行
	Hidden bool    `json:"hidden"` // 是否隐藏
	Desc   string  `json:"desc"`   // 字段描述

	// 以下是某些字段类型的特有属性

	Options      []*SelectOption `json:"options,omitempty"`  // 选项列表
	NumberFormat NumberFormat    `json:"numberFormat"`       // 数字字段格式化
	Template     string          `json:"template"`           // 模板字段内容
	Relation     *Relation       `json:"relation,omitempty"` // 关联字段
	Rollup       *Rollup         `json:"rollup,omitempty"`   // 汇总字段
	Date         *Date           `json:"date,omitempty"`     // 日期设置
}
