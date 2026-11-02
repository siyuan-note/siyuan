// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package dav

import (
	"strings"
	"time"

	"github.com/emersion/go-ical"
)

// CompFilter 是 CALDAV:comp-filter（RFC 4791 §9.7.1）。
type CompFilter struct {
	Name         string
	IsNotDefined bool
	TimeRange    *TimeRange
	Props        []*PropFilter
	Comps        []*CompFilter
}

// PropFilter 是 CALDAV:prop-filter（RFC 4791 §9.7.2）。
type PropFilter struct {
	Name         string
	IsNotDefined bool
	TimeRange    *TimeRange
	TextMatch    *TextMatch
	Params       []*ParamFilter
}

var (
	// time-range 只对这些组件和属性有定义（RFC 4791 §9.9），用在其他位置时过滤器无效
	timeRangeComponents = map[string]bool{ical.CompEvent: true, ical.CompToDo: true, ical.CompJournal: true, ical.CompFreeBusy: true, ical.CompAlarm: true}
	timeRangeProperties = map[string]bool{ical.PropCompleted: true, ical.PropCreated: true, ical.PropDateTimeEnd: true, ical.PropDateTimeStamp: true,
		ical.PropDateTimeStart: true, ical.PropDue: true, ical.PropLastModified: true}
)

// ParseCalendarFilter 解析 CALDAV:filter，它必须恰好包含一个作用于 VCALENDAR 的 comp-filter；返回的错误带 CALDAV:valid-filter 等前置条件。
func ParseCalendarFilter(n *Node) (*CompFilter, error) {
	if nil == n {
		return nil, calDAVTextMatch.filterError("calendar-query requires a filter")
	}
	children := n.Children()
	if 1 != len(children) || !children[0].Is(CalDAVName("comp-filter")) {
		return nil, calDAVTextMatch.filterError("filter must contain exactly one comp-filter")
	}
	filter, err := parseCompFilter(children[0])
	if err != nil {
		return nil, err
	}
	if ical.CompCalendar != filter.Name {
		return nil, calDAVTextMatch.filterError("the top-level comp-filter must target VCALENDAR")
	}
	return filter, nil
}

func parseCompFilter(n *Node) (*CompFilter, error) {
	name, _ := n.Attr("name")
	if "" == name {
		return nil, calDAVTextMatch.filterError("comp-filter requires a name")
	}
	filter := &CompFilter{Name: strings.ToUpper(name)}
	for _, child := range n.Children() {
		switch child.XMLName {
		case CalDAVName("is-not-defined"):
			filter.IsNotDefined = true
		case CalDAVName("time-range"):
			if nil != filter.TimeRange || !timeRangeComponents[filter.Name] {
				return nil, calDAVTextMatch.filterError("time-range is not allowed in comp-filter " + filter.Name)
			}
			timeRange, err := ParseTimeRange(child, false)
			if err != nil {
				return nil, calDAVTextMatch.filterError(err.Error())
			}
			filter.TimeRange = timeRange
		case CalDAVName("prop-filter"):
			propFilter, err := parsePropFilter(child)
			if err != nil {
				return nil, err
			}
			filter.Props = append(filter.Props, propFilter)
		case CalDAVName("comp-filter"):
			compFilter, err := parseCompFilter(child)
			if err != nil {
				return nil, err
			}
			filter.Comps = append(filter.Comps, compFilter)
		default:
			return nil, calDAVTextMatch.filterError("unexpected element in comp-filter")
		}
	}
	if filter.IsNotDefined && (nil != filter.TimeRange || 0 < len(filter.Props) || 0 < len(filter.Comps)) {
		return nil, calDAVTextMatch.filterError("is-not-defined cannot be combined with other conditions")
	}
	return filter, nil
}

func parsePropFilter(n *Node) (*PropFilter, error) {
	name, _ := n.Attr("name")
	if "" == name {
		return nil, calDAVTextMatch.filterError("prop-filter requires a name")
	}
	filter := &PropFilter{Name: strings.ToUpper(name)}
	for _, child := range n.Children() {
		switch child.XMLName {
		case CalDAVName("is-not-defined"):
			filter.IsNotDefined = true
		case CalDAVName("time-range"):
			if nil != filter.TimeRange || nil != filter.TextMatch || !timeRangeProperties[filter.Name] {
				return nil, calDAVTextMatch.filterError("time-range is not allowed in prop-filter " + filter.Name)
			}
			timeRange, err := ParseTimeRange(child, false)
			if err != nil {
				return nil, calDAVTextMatch.filterError(err.Error())
			}
			filter.TimeRange = timeRange
		case CalDAVName("text-match"):
			if nil != filter.TimeRange || nil != filter.TextMatch {
				return nil, calDAVTextMatch.filterError("prop-filter allows one time-range or text-match")
			}
			match, err := calDAVTextMatch.parse(child)
			if err != nil {
				return nil, err
			}
			filter.TextMatch = match
		case CalDAVName("param-filter"):
			paramFilter, err := calDAVTextMatch.parseParamFilter(child)
			if err != nil {
				return nil, err
			}
			filter.Params = append(filter.Params, paramFilter)
		default:
			return nil, calDAVTextMatch.filterError("unexpected element in prop-filter")
		}
	}
	if filter.IsNotDefined && (nil != filter.TimeRange || nil != filter.TextMatch || 0 < len(filter.Params)) {
		return nil, calDAVTextMatch.filterError("is-not-defined cannot be combined with other conditions")
	}
	return filter, nil
}

// Match 判断日历对象是否匹配过滤器；floating 用于把 DATE 值、浮动时间和无法识别的 TZID 换算为 UTC。
func (f *CompFilter) Match(calendar *ical.Calendar, floating *time.Location) bool {
	ctx := newICalContext(calendar.Component, floating)
	scope := &ical.Component{Children: []*ical.Component{calendar.Component}}
	return ctx.matchChildFilter(f, scope, nil)
}

// matchChildFilter 判断 parent 的子组件中是否有满足 comp-filter 的组件；grandparent 用于查找 parent 的覆盖实例。
func (c *icalContext) matchChildFilter(f *CompFilter, parent, grandparent *ical.Component) bool {
	var named []*ical.Component
	for _, child := range parent.Children {
		if child.Name == f.Name {
			named = append(named, child)
		}
	}
	if f.IsNotDefined {
		return 0 == len(named)
	}
	for _, comp := range named {
		if nil != f.TimeRange && !c.componentOverlaps(comp, parent, grandparent, f.TimeRange) {
			continue
		}
		if c.matchComponent(f, comp, parent) {
			return true
		}
	}
	return false
}

func (c *icalContext) matchComponent(f *CompFilter, comp, parent *ical.Component) bool {
	for _, propFilter := range f.Props {
		if !c.matchPropFilter(propFilter, comp, parent.Children) {
			return false
		}
	}
	for _, compFilter := range f.Comps {
		if !c.matchChildFilter(compFilter, comp, parent) {
			return false
		}
	}
	return true
}

// componentOverlaps 判断组件是否有实例与区间重叠；VALARM 按父组件每次实例的触发时间判断。
func (c *icalContext) componentOverlaps(comp, parent, grandparent *ical.Component, r *TimeRange) bool {
	switch comp.Name {
	case ical.CompFreeBusy:
		return c.freeBusyOverlaps(comp, r)
	case ical.CompAlarm:
		return c.alarmOverlaps(comp, parent, grandparent, r)
	}
	return c.eachInstance(comp, parent.Children, r.End, func(t componentTimes) bool {
		return r.overlaps(comp.Name, t)
	})
}

func (c *icalContext) alarmOverlaps(alarm, parent, grandparent *ical.Component, r *TimeRange) bool {
	trigger, ok := c.parseAlarmTrigger(alarm)
	if !ok {
		return false
	}
	if trigger.absolute {
		for _, at := range trigger.times(parent.Name, componentTimes{}) {
			if r.containsInstant(at) {
				return true
			}
		}
		return false
	}
	// 触发时间不早于实例开始时间加偏移量，实例开始晚于 End 加提前量后不会再有落在区间内的触发
	var stopAfter time.Time
	if !r.End.IsZero() {
		lead := -trigger.offset
		if lead < 0 {
			lead = 0
		}
		stopAfter = r.End.Add(lead)
	}
	var siblings []*ical.Component
	if nil != grandparent {
		siblings = grandparent.Children
	}
	return c.eachInstance(parent, siblings, stopAfter, func(t componentTimes) bool {
		for _, at := range trigger.times(parent.Name, t) {
			if r.containsInstant(at) {
				return true
			}
		}
		return false
	})
}

type period struct {
	start, end time.Time
}

func (c *icalContext) periods(prop *ical.Prop) (periods []period) {
	tzid := prop.Params.Get(ical.PropTimezoneID)
	for _, value := range strings.Split(prop.Value, ",") {
		if start, end, err := c.parsePeriod(value, tzid); err == nil {
			periods = append(periods, period{start, end})
		}
	}
	return
}

func (c *icalContext) freeBusyOverlaps(comp *ical.Component, r *TimeRange) bool {
	if t := c.componentTimes(comp); t.hasStart && t.hasEnd {
		return r.startNotAfter(t.end) && r.endAfter(t.start)
	}
	for i := range comp.Props[ical.PropFreeBusy] {
		for _, p := range c.periods(&comp.Props[ical.PropFreeBusy][i]) {
			if r.overlapsPeriod(p.start, p.end) {
				return true
			}
		}
	}
	return false
}

func (c *icalContext) matchPropFilter(f *PropFilter, comp *ical.Component, siblings []*ical.Component) bool {
	props := comp.Props[f.Name]
	if f.IsNotDefined {
		return 0 == len(props)
	}
	for i := range props {
		prop := &props[i]
		if nil != f.TimeRange && !c.propOverlaps(f.Name, prop, comp, siblings, f.TimeRange) {
			continue
		}
		if nil != f.TextMatch && !f.TextMatch.Match(propText(prop)) {
			continue
		}
		if matchParamFilters(f.Params, prop.Params) {
			return true
		}
	}
	// VEVENT 没有 DTEND、VTODO 没有 DUE 时，时间区间作用于 DTSTART+DURATION 推算出的有效值（RFC 4791 §9.9）
	effective := (ical.CompEvent == comp.Name && ical.PropDateTimeEnd == f.Name) || (ical.CompToDo == comp.Name && ical.PropDue == f.Name)
	if nil != f.TimeRange && effective && 0 == len(props) && 0 == len(f.Params) {
		return c.eachInstance(comp, siblings, f.TimeRange.End, func(t componentTimes) bool {
			return t.hasStart && t.hasDuration && f.TimeRange.containsInstant(t.start.Add(t.duration))
		})
	}
	return false
}

// propOverlaps 判断日期时间属性是否落在区间内；DTSTART、DTEND、DUE 随重复实例平移，需要考虑每个实例。
func (c *icalContext) propOverlaps(name string, prop *ical.Prop, comp *ical.Component, siblings []*ical.Component, r *TimeRange) bool {
	switch name {
	case ical.PropDateTimeStart, ical.PropDateTimeEnd, ical.PropDue:
		return c.eachInstance(comp, siblings, r.End, func(t componentTimes) bool {
			switch name {
			case ical.PropDateTimeStart:
				return t.hasStart && r.containsInstant(t.start)
			case ical.PropDateTimeEnd:
				return t.hasEnd && r.containsInstant(t.end)
			}
			return t.hasDue && r.containsInstant(t.due)
		})
	}
	t, _, err := c.propTime(prop)
	return err == nil && r.containsInstant(t)
}

// propText 返回用于文本匹配的属性值；TEXT 类型的值先去除转义。
func propText(prop *ical.Prop) string {
	if ical.ValueText == prop.ValueType() {
		if text, err := prop.Text(); err == nil {
			return text
		}
	}
	return prop.Value
}

func matchParamFilters(filters []*ParamFilter, params map[string][]string) bool {
	for _, filter := range filters {
		if !filter.Match(params[filter.Name]) {
			return false
		}
	}
	return true
}
