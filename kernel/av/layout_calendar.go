// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package av

import (
	"fmt"
	"time"
	_ "time/tzdata"
)

// CalendarSettings 保存日历的字段绑定；浏览日期和月周切换由各编辑器独立维护。
type CalendarSettings struct {
	DateKeyID  string `json:"dateKeyID"`
	ColorKeyID string `json:"colorKeyID"`
	WeekStart  int    `json:"weekStart"`
	RowLimit   int    `json:"rowLimit,omitempty"`
}

// ValidRowLimit 保留旧设置的零值默认值，负一表示展开全部条目行。
func (s CalendarSettings) ValidRowLimit() bool {
	return s.RowLimit == 0 || s.RowLimit == -1 || s.RowLimit == 3 || s.RowLimit == 5 || s.RowLimit == 10
}

type LayoutCalendar struct {
	*LayoutTable
	Settings CalendarSettings `json:"settings"`
}

type Calendar struct {
	*Table
}

func (*Calendar) GetType() LayoutType { return LayoutTypeCalendar }

func NewCalendarView() *View {
	view := NewTableView()
	view.Name = GetAttributeViewI18n("calendar")
	view.LayoutType = LayoutTypeCalendar
	view.Calendar = &LayoutCalendar{LayoutTable: view.Table, Settings: CalendarSettings{WeekStart: 1}}
	view.Table = nil
	return view
}

// CalendarRange 使用客户端时区的半开日期区间，不写入数据库或共享视图设置。
type CalendarRange struct {
	Start    int64  `json:"start"`
	End      int64  `json:"end"`
	TimeZone string `json:"timeZone"`
}

func (r *CalendarRange) Location() (*time.Location, error) {
	if nil == r {
		return time.Local, nil
	}
	// 年界附近的月网格可包含上一年或下一年的日期。
	if r.Start >= r.End || r.Start < time.Date(0, 12, 1, 0, 0, 0, 0, time.UTC).UnixMilli() ||
		r.End > time.Date(10000, 2, 1, 0, 0, 0, 0, time.UTC).UnixMilli() ||
		r.End-r.Start > int64(63*24*time.Hour/time.Millisecond) || r.TimeZone == "" {
		return nil, fmt.Errorf("invalid calendar range")
	}
	return time.LoadLocation(r.TimeZone)
}

func IsCalendarDateType(keyType KeyType) bool {
	return KeyTypeDate == keyType || KeyTypeCreated == keyType || KeyTypeUpdated == keyType
}

// CalendarInterval 保留源值，按本地日历日解释全天结束日期；缺失端点作为单点显示。
func CalendarInterval(value *Value, location *time.Location) (start, end int64, ok bool) {
	if nil == value {
		return
	}
	switch value.Type {
	case KeyTypeDate:
		date := value.Date
		if nil == date {
			return
		}
		if date.IsNotEmpty {
			start, end, ok = date.Content, date.Content, true
			if date.HasEndDate && date.IsNotEmpty2 && date.Content2 >= start {
				end = date.Content2
			}
		} else if date.HasEndDate && date.IsNotEmpty2 {
			start, end, ok = date.Content2, date.Content2, true
		}
		if ok && date.IsNotTime {
			first, last := time.UnixMilli(start).In(location), time.UnixMilli(end).In(location)
			start = time.Date(first.Year(), first.Month(), first.Day(), 0, 0, 0, 0, location).UnixMilli()
			end = time.Date(last.Year(), last.Month(), last.Day()+1, 0, 0, 0, 0, location).UnixMilli()
		}
	case KeyTypeCreated:
		if nil != value.Created && value.Created.IsNotEmpty {
			start, end, ok = value.Created.Content, value.Created.Content, true
		}
	case KeyTypeUpdated:
		if nil != value.Updated && value.Updated.IsNotEmpty {
			start, end, ok = value.Updated.Content, value.Updated.Content, true
		}
	}
	return
}

// FilterCalendarRows 在筛选和排序之后按区间交集取条目，不受表格页大小影响。
func FilterCalendarRows(calendar *Calendar, dateRange *CalendarRange, targetItemID string) error {
	location, err := dateRange.Location()
	if nil != err {
		return err
	}
	calendar.CalendarRange = dateRange
	calendar.CalendarTargetDate = nil
	key := calendar.GetColumn(calendar.Calendar.DateKeyID)
	if nil == key || !IsCalendarDateType(key.Type) {
		calendar.Rows = []*TableRow{}
		calendar.RowCount = 0
		return nil
	}
	rows := make([]*TableRow, 0, len(calendar.Rows))
	for _, row := range calendar.Rows {
		start, end, ok := CalendarInterval(row.GetValue(key.ID), location)
		if !ok {
			continue
		}
		target := targetItemID != "" && row.ID == targetItemID
		if target {
			calendar.CalendarTargetDate = &start
		}
		if nil == dateRange || target || start < dateRange.End &&
			(end > dateRange.Start || start == end && start >= dateRange.Start) {
			rows = append(rows, row)
		}
	}
	calendar.Rows = rows
	calendar.RowCount = len(rows)
	return nil
}

// TableLayouts 枚举所有暂存的行列布局，确保字段删除、颜色和模板更新覆盖未激活布局。
func (view *View) TableLayouts() []*LayoutTable {
	ret := []*LayoutTable{view.Table, view.List}
	if nil != view.Calendar {
		ret = append(ret, view.Calendar.LayoutTable)
	}
	return ret
}

func (attrView *AttributeView) ValidateCalendarLayouts() error {
	var validate func(*View) error
	validate = func(view *View) error {
		if nil == view {
			return nil
		}
		if LayoutTypeCalendar == view.LayoutType && nil == view.Calendar {
			return fmt.Errorf("calendar layout missing in view [%s]", view.ID)
		}
		if layout := view.Calendar; nil != layout {
			if nil == layout.LayoutTable || nil == layout.BaseLayout || layout.Settings.WeekStart < 0 ||
				layout.Settings.WeekStart > 6 || !layout.Settings.ValidRowLimit() || layout.Spec != 0 {
				return fmt.Errorf("invalid calendar layout in view [%s]", view.ID)
			}
			for _, column := range layout.Columns {
				if nil == column || nil == column.BaseField {
					return fmt.Errorf("invalid calendar field in view [%s]", view.ID)
				}
			}
		}
		for _, group := range view.Groups {
			if err := validate(group); nil != err {
				return err
			}
		}
		return nil
	}
	for _, view := range attrView.Views {
		if err := validate(view); nil != err {
			return err
		}
	}
	return nil
}
