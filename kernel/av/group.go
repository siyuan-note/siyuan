// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package av

// ViewGroup 描述了视图分组规则的结构。
type ViewGroup struct {
	Field       string      `json:"field"`                 // 分组字段 ID
	ValueSource ValueSource `json:"valueSource,omitempty"` // 值来源
	Method      GroupMethod `json:"method"`                // 分组方式
	Range       *GroupRange `json:"range,omitempty"`       // 分组范围
	Order       GroupOrder  `json:"order"`                 // 分组排序规则
	HideEmpty   bool        `json:"hideEmpty"`             // 是否隐藏空分组
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
