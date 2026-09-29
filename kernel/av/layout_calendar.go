// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package av

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
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
	// 无日期条目只供独立的待安排列表读取，不进入常规日历响应。
	UndatedRows []*TableRow `json:"-"`
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

var calendarTemplateTimePattern = regexp.MustCompile(`[ T](\d{2}):(\d{2})(?::(\d{2}))?$`)

// newCalendarTemplateDateParser 复用字段日期格式和当前语言的月份、日期模板，每次日历渲染只编译一次。
func newCalendarTemplateDateParser(format DateDisplayFormat) func(string, *time.Location) *ValueDate {
	layouts := []string{"2006-1-2"}
	switch format {
	case DateDisplayFormatMonthDayYear:
		layouts = append(layouts, "1/2/2006")
	case DateDisplayFormatDayMonthYear:
		layouts = append(layouts, "2/1/2006")
	case DateDisplayFormatYearMonthDay:
		layouts = append(layouts, "2006/1/2")
	}
	months := strings.Split(GetAttributeViewI18n("dateMonths"), "|")
	monthPatterns := make([]string, len(months))
	for i, month := range months {
		monthPatterns[i] = regexp.QuoteMeta(month)
	}
	pattern := regexp.QuoteMeta(GetAttributeViewI18n("dateFormatFullTemplate"))
	for token, replacement := range map[string]string{
		"${year}": `(?P<year>\d{4})`, "${day}": `(?P<day>\d{1,2})`,
		"${month}": "(?P<month>" + strings.Join(monthPatterns, "|") + ")",
	} {
		pattern = strings.ReplaceAll(pattern, regexp.QuoteMeta(token), replacement)
	}
	fullDate := regexp.MustCompile("(?i)^" + pattern + "$")
	return func(content string, location *time.Location) *ValueDate {
		content = strings.TrimSpace(content)
		hour, minute, second := 0, 0, 0
		timeParts := calendarTemplateTimePattern.FindStringSubmatch(content)
		if timeParts != nil {
			hour, _ = strconv.Atoi(timeParts[1])
			minute, _ = strconv.Atoi(timeParts[2])
			second, _ = strconv.Atoi(timeParts[3])
			content = strings.TrimSpace(content[:len(content)-len(timeParts[0])])
		}
		var date time.Time
		found := false
		for _, layout := range layouts {
			if parsed, err := time.ParseInLocation(layout, content, location); err == nil {
				date = parsed
				found = true
				break
			}
		}
		if !found {
			parts := fullDate.FindStringSubmatch(content)
			if parts == nil || fullDate.SubexpIndex("year") < 0 || fullDate.SubexpIndex("day") < 0 || fullDate.SubexpIndex("month") < 0 {
				return nil
			}
			year, _ := strconv.Atoi(parts[fullDate.SubexpIndex("year")])
			day, _ := strconv.Atoi(parts[fullDate.SubexpIndex("day")])
			month := 0
			for i, name := range months {
				if strings.EqualFold(name, parts[fullDate.SubexpIndex("month")]) {
					month = i + 1
					break
				}
			}
			date = time.Date(year, time.Month(month), day, 0, 0, 0, 0, location)
			if int(date.Month()) != month || date.Day() != day {
				return nil
			}
		}
		parsed := time.Date(date.Year(), date.Month(), date.Day(), hour, minute, second, 0, location)
		if date.Year() < 1 || parsed.Day() != date.Day() || parsed.Hour() != hour || parsed.Minute() != minute || parsed.Second() != second {
			return nil
		}
		return &ValueDate{Content: parsed.UnixMilli(), IsNotEmpty: true, IsNotTime: timeParts == nil}
	}
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
	calendar.UndatedRows = nil
	key := calendar.GetColumn(calendar.Calendar.DateKeyID)
	if nil == key || !IsCalendarDateType(key.Type) {
		calendar.Rows = []*TableRow{}
		calendar.RowCount = 0
		return nil
	}
	rows := make([]*TableRow, 0, len(calendar.Rows))
	computed := key.Type == KeyTypeDate && strings.TrimSpace(key.RenderTemplate) != ""
	var parseDate func(string, *time.Location) *ValueDate
	if computed {
		parseDate = newCalendarTemplateDateParser(key.DateFormat)
	}
	for _, row := range calendar.Rows {
		value := row.GetValue(key.ID)
		if computed {
			var date *ValueDate
			if value != nil && value.HasRenderTemplate {
				date = parseDate(value.RenderedContent, location)
			}
			value = &Value{Type: KeyTypeDate, Date: date}
		}
		start, end, ok := CalendarInterval(value, location)
		if !ok {
			if key.Type == KeyTypeDate && !computed {
				calendar.UndatedRows = append(calendar.UndatedRows, row)
			}
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
