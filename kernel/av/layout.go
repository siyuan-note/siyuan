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
	Hidden bool    `json:"hidden"` // 是否隐藏
	Desc   string  `json:"desc"`   // 字段描述
}
