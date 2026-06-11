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

// ViewGroup 描述了视图分组规则的结构。
type ViewGroup struct {
	Field     string      `json:"field"`           // 分组字段 ID
	Method    GroupMethod `json:"method"`          // 分组方式
	Range     *GroupRange `json:"range,omitempty"` // 分组范围
	Order     GroupOrder  `json:"order"`           // 分组排序规则
	HideEmpty bool        `json:"hideEmpty"`       // 是否隐藏空分组
}

// GroupMethod 描述了分组方式。
type GroupMethod int

const (
	GroupMethodValue        GroupMethod = iota // 按值分组
	GroupMethodRangeNum                        // 按数字范围分组
	GroupMethodDateRelative                    // 按相对日期分组
	GroupMethodDateDay                         // 按天日期分组
	GroupMethodDateWeek                        // 按周日期分组
	GroupMethodDateMonth                       // 按月日期分组
	GroupMethodDateYear                        // 按年日期分组
)

// GroupRange 描述了分组范围的结构。
type GroupRange struct {
	NumStart float64 `json:"numStart"` // 数字范围起始值
	NumEnd   float64 `json:"numEnd"`   // 数字范围结束值
	NumStep  float64 `json:"numStep"`  // 数字范围步长
}

// GroupOrder 描述了分组排序规则。
type GroupOrder int

const (
	GroupOrderAsc          = iota // 升序
	GroupOrderDesc                // 降序
	GroupOrderMan                 // 手动排序
	GroupOrderSelectOption        // 同选择的选项排序（仅单选和多选字段适用） https://github.com/siyuan-note/siyuan/issues/15500
)
