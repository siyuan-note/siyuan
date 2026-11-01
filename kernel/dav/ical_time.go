// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package dav

import (
	"errors"
	"strings"
	"time"
	_ "time/tzdata"

	"github.com/emersion/go-ical"
	"github.com/teambition/rrule-go"
)

const (
	icalDateFormat        = "20060102"
	icalDateTimeFormat    = "20060102T150405"
	icalDateTimeUTCFormat = "20060102T150405Z"
)

// maxRecurrenceInstances 限制单个组件展开的重复次数，防止高频且没有终止条件的重复规则耗尽 CPU。
// 达到上限仍无法判定时按匹配处理：多返回一个对象只增加流量，漏掉对象会让客户端丢失数据。
const maxRecurrenceInstances = 100000

// TimeRange 是 CALDAV:time-range 等元素描述的区间 [Start, End)；零值表示该端无界。
type TimeRange struct {
	Start, End time.Time
}

// ParseTimeRange 解析带 start、end 属性的元素，取值必须是 UTC 时间（RFC 4791 §9.9）。
// required 为 true 时两端都必须给出（expand 等元素），否则至少给出一端（time-range）。
func ParseTimeRange(n *Node, required bool) (*TimeRange, error) {
	r := &TimeRange{}
	for _, bound := range []struct {
		name   string
		target *time.Time
	}{{"start", &r.Start}, {"end", &r.End}} {
		value, ok := n.Attr(bound.name)
		if !ok {
			if required {
				return nil, errors.New(n.XMLName.Local + " requires start and end")
			}
			continue
		}
		t, err := time.ParseInLocation(icalDateTimeUTCFormat, strings.TrimSpace(value), time.UTC)
		if err != nil {
			return nil, errors.New(n.XMLName.Local + " " + bound.name + " must be a UTC date-time")
		}
		*bound.target = t
	}
	if r.Start.IsZero() && r.End.IsZero() {
		return nil, errors.New(n.XMLName.Local + " requires start or end")
	}
	if !r.Start.IsZero() && !r.End.IsZero() && !r.End.After(r.Start) {
		return nil, errors.New(n.XMLName.Local + " end must be later than start")
	}
	return r, nil
}

func (r *TimeRange) startBefore(t time.Time) bool   { return r.Start.IsZero() || r.Start.Before(t) }
func (r *TimeRange) startNotAfter(t time.Time) bool { return r.Start.IsZero() || !r.Start.After(t) }
func (r *TimeRange) endAfter(t time.Time) bool      { return r.End.IsZero() || r.End.After(t) }
func (r *TimeRange) endNotBefore(t time.Time) bool  { return r.End.IsZero() || !r.End.Before(t) }

// containsInstant 判断时间点是否落在区间内：start <= t AND end > t。
func (r *TimeRange) containsInstant(t time.Time) bool {
	return r.startNotAfter(t) && r.endAfter(t)
}

// overlapsPeriod 判断时段 [start, end) 是否与区间相交：start < end' AND end > start'。
func (r *TimeRange) overlapsPeriod(start, end time.Time) bool {
	return r.startBefore(end) && r.endAfter(start)
}

// ResolveTimeZone 把 iCalendar 的 TZID 解析为 IANA 时区。客户端常在 IANA 名称前加厂商前缀
// （例如 "/mozilla.org/20050126_1/Europe/Berlin"），因此依次尝试去掉前缀后的名称；无法识别时返回 nil。
func ResolveTimeZone(tzid string) *time.Location {
	name := strings.Trim(strings.TrimSpace(tzid), `"`)
	if "" == name || "Local" == name {
		return nil
	}
	for {
		if loc, err := time.LoadLocation(name); err == nil {
			return loc
		}
		i := strings.IndexByte(name, '/')
		if i < 0 {
			return nil
		}
		name = name[i+1:]
	}
}

// icalContext 解析一个日历对象中的日期时间。floating 用于 DATE 值、浮动时间和无法识别的 TZID（RFC 4791 §7.3）。
type icalContext struct {
	floating *time.Location
	zones    map[string]*time.Location
}

func newICalContext(calendar *ical.Component, floating *time.Location) *icalContext {
	if nil == floating {
		floating = time.UTC
	}
	ctx := &icalContext{floating: floating, zones: map[string]*time.Location{}}
	for _, child := range calendar.Children {
		if ical.CompTimezone != child.Name {
			continue
		}
		tzid, _ := child.Props.Text(ical.PropTimezoneID)
		loc := ResolveTimeZone(tzid)
		if nil == loc {
			// Lightning 等客户端在 VTIMEZONE 中用 X-LIC-LOCATION 给出 IANA 名称
			if location, _ := child.Props.Text("X-LIC-LOCATION"); "" != location {
				loc = ResolveTimeZone(location)
			}
		}
		if nil != loc {
			ctx.zones[tzid] = loc
		}
	}
	return ctx
}

func (c *icalContext) location(tzid string) *time.Location {
	if "" == tzid {
		return c.floating
	}
	if loc, ok := c.zones[tzid]; ok {
		return loc
	}
	loc := ResolveTimeZone(tzid)
	if nil == loc {
		loc = c.floating
	}
	c.zones[tzid] = loc
	return loc
}

func isDateValue(prop *ical.Prop) bool {
	if valueType := prop.Params.Get(ical.ParamValue); "" != valueType {
		return strings.EqualFold(valueType, string(ical.ValueDate))
	}
	return len(icalDateFormat) == len(prop.Value)
}

func (c *icalContext) parseValue(value, tzid string, date bool) (time.Time, error) {
	value = strings.TrimSpace(value)
	if date {
		return time.ParseInLocation(icalDateFormat, value, c.floating)
	}
	if strings.HasSuffix(value, "Z") {
		return time.ParseInLocation(icalDateTimeUTCFormat, value, time.UTC)
	}
	return time.ParseInLocation(icalDateTimeFormat, value, c.location(tzid))
}

// propTime 解析单值的 DATE 或 DATE-TIME 属性。
func (c *icalContext) propTime(prop *ical.Prop) (t time.Time, date bool, err error) {
	date = isDateValue(prop)
	t, err = c.parseValue(prop.Value, prop.Params.Get(ical.PropTimezoneID), date)
	return
}

// propTimes 解析 EXDATE、RDATE 等可含多个逗号分隔值的属性；PERIOD 值取其开始时间。
func (c *icalContext) propTimes(prop *ical.Prop) (times []time.Time, err error) {
	date, tzid := isDateValue(prop), prop.Params.Get(ical.PropTimezoneID)
	for _, value := range strings.Split(prop.Value, ",") {
		if i := strings.IndexByte(value, '/'); 0 <= i {
			value = value[:i]
		}
		t, err := c.parseValue(value, tzid, date)
		if err != nil {
			return nil, err
		}
		times = append(times, t)
	}
	return
}

// parsePeriod 解析 PERIOD 值：start/end 或 start/duration（RFC 5545 §3.3.9）。
func (c *icalContext) parsePeriod(value, tzid string) (start, end time.Time, err error) {
	startValue, endValue, ok := strings.Cut(strings.TrimSpace(value), "/")
	if !ok {
		return start, end, errors.New("invalid period")
	}
	if start, err = c.parseValue(startValue, tzid, false); err != nil {
		return
	}
	if strings.HasPrefix(strings.TrimLeft(endValue, "+-"), "P") {
		duration, durationErr := parseDuration(endValue)
		if durationErr != nil {
			return start, end, durationErr
		}
		return start, start.Add(duration), nil
	}
	end, err = c.parseValue(endValue, tzid, false)
	return
}

func parseDuration(value string) (time.Duration, error) {
	return (&ical.Prop{Value: strings.TrimSpace(value), Params: ical.Params{}}).Duration()
}

// componentTimes 是计算时间区间重叠所需的组件时间属性；无法解析的属性视为不存在。
type componentTimes struct {
	start, end, due, completed, created                             time.Time
	hasStart, hasEnd, hasDue, hasDuration, hasCompleted, hasCreated bool
	startIsDate                                                     bool
	duration                                                        time.Duration
}

func (c *icalContext) componentTimes(comp *ical.Component) (t componentTimes) {
	parse := func(name string, target *time.Time, present *bool) bool {
		prop := comp.Props.Get(name)
		if nil == prop {
			return false
		}
		value, date, err := c.propTime(prop)
		if err != nil {
			return false
		}
		*target, *present = value, true
		return date
	}
	t.startIsDate = parse(ical.PropDateTimeStart, &t.start, &t.hasStart)
	parse(ical.PropDateTimeEnd, &t.end, &t.hasEnd)
	parse(ical.PropDue, &t.due, &t.hasDue)
	parse(ical.PropCompleted, &t.completed, &t.hasCompleted)
	parse(ical.PropCreated, &t.created, &t.hasCreated)
	if prop := comp.Props.Get(ical.PropDuration); nil != prop {
		if duration, err := parseDuration(prop.Value); err == nil {
			t.duration, t.hasDuration = duration, true
		}
	}
	return
}

// shift 返回把开始、结束和到期时间平移 d 后的实例时间。
func (t componentTimes) shift(d time.Duration) componentTimes {
	if t.hasStart {
		t.start = t.start.Add(d)
	}
	if t.hasEnd {
		t.end = t.end.Add(d)
	}
	if t.hasDue {
		t.due = t.due.Add(d)
	}
	return t
}

// eventEnd 返回 VEVENT 的有效结束时间：DTEND，或 DTSTART+DURATION；两者都没有时 DATE 开始持续一天，DATE-TIME 开始持续 0 秒。
func (t componentTimes) eventEnd() time.Time {
	switch {
	case t.hasEnd:
		return t.end
	case t.hasDuration:
		return t.start.Add(t.duration)
	case t.startIsDate:
		return t.start.AddDate(0, 0, 1)
	}
	return t.start
}

// effectiveDue 返回 VTODO 的有效到期时间：DUE，或 DTSTART+DURATION。
func (t componentTimes) effectiveDue() (time.Time, bool) {
	if t.hasDue {
		return t.due, true
	}
	if t.hasStart && t.hasDuration {
		return t.start.Add(t.duration), true
	}
	return time.Time{}, false
}

// overlaps 按 RFC 4791 §9.9 的表格判断 VEVENT、VTODO、VJOURNAL 的一次实例是否与区间重叠。
func (r *TimeRange) overlaps(name string, t componentTimes) bool {
	switch name {
	case ical.CompEvent:
		if !t.hasStart {
			return false
		}
		switch {
		case t.hasEnd:
			return r.startBefore(t.end) && r.endAfter(t.start)
		case t.hasDuration && 0 < t.duration:
			return r.startBefore(t.start.Add(t.duration)) && r.endAfter(t.start)
		case t.hasDuration || !t.startIsDate:
			return r.startNotAfter(t.start) && r.endAfter(t.start)
		}
		return r.startBefore(t.start.AddDate(0, 0, 1)) && r.endAfter(t.start)
	case ical.CompToDo:
		switch {
		case t.hasStart && t.hasDuration:
			end := t.start.Add(t.duration)
			return r.startNotAfter(end) && (r.endAfter(t.start) || r.endNotBefore(end))
		case t.hasStart && t.hasDue:
			return (r.startBefore(t.due) || r.startNotAfter(t.start)) && (r.endAfter(t.start) || r.endNotBefore(t.due))
		case t.hasStart:
			return r.startNotAfter(t.start) && r.endAfter(t.start)
		case t.hasDue:
			return r.startBefore(t.due) && r.endNotBefore(t.due)
		case t.hasCompleted && t.hasCreated:
			return (r.startNotAfter(t.created) || r.startNotAfter(t.completed)) && (r.endNotBefore(t.created) || r.endNotBefore(t.completed))
		case t.hasCompleted:
			return r.startNotAfter(t.completed) && r.endNotBefore(t.completed)
		case t.hasCreated:
			return r.endAfter(t.created)
		}
		return true
	case ical.CompJournal:
		if !t.hasStart {
			return false
		}
		if t.startIsDate {
			return r.startBefore(t.start.AddDate(0, 0, 1)) && r.endAfter(t.start)
		}
		return r.startNotAfter(t.start) && r.endAfter(t.start)
	}
	return false
}

// isRecurring 判断组件是否定义了重复集合；带 RECURRENCE-ID 的覆盖组件只代表一个实例。
func isRecurring(comp *ical.Component) bool {
	if nil != comp.Props.Get(ical.PropRecurrenceID) {
		return false
	}
	return nil != comp.Props.Get(ical.PropRecurrenceRule) || nil != comp.Props.Get(ical.PropRecurrenceDates)
}

func (c *icalContext) recurrence(comp *ical.Component, start time.Time) (func() (time.Time, bool), error) {
	set := &rrule.Set{}
	if prop := comp.Props.Get(ical.PropRecurrenceRule); nil != prop {
		option, err := rrule.StrToROptionInLocation(prop.Value, start.Location())
		if err != nil {
			return nil, err
		}
		option.Dtstart = start
		rule, err := rrule.NewRRule(*option)
		if err != nil {
			return nil, err
		}
		set.RRule(rule)
	}
	set.DTStart(start)
	// DTSTART 总是重复集合的第一个实例（RFC 5545 §3.8.5.3），即使它不符合 RRULE
	set.RDate(start)
	for i := range comp.Props[ical.PropRecurrenceDates] {
		times, err := c.propTimes(&comp.Props[ical.PropRecurrenceDates][i])
		if err != nil {
			return nil, err
		}
		for _, t := range times {
			set.RDate(t)
		}
	}
	for i := range comp.Props[ical.PropExceptionDates] {
		times, err := c.propTimes(&comp.Props[ical.PropExceptionDates][i])
		if err != nil {
			return nil, err
		}
		for _, t := range times {
			set.ExDate(t)
		}
	}
	return set.Iterator(), nil
}

// overriddenInstances 返回被同 UID 覆盖组件替换的实例开始时间（Unix 秒）。
func (c *icalContext) overriddenInstances(master *ical.Component, siblings []*ical.Component) map[int64]bool {
	overridden := map[int64]bool{}
	uid, _ := master.Props.Text(ical.PropUID)
	for _, sibling := range siblings {
		if sibling == master || sibling.Name != master.Name {
			continue
		}
		prop := sibling.Props.Get(ical.PropRecurrenceID)
		if nil == prop {
			continue
		}
		if siblingUID, _ := sibling.Props.Text(ical.PropUID); siblingUID != uid {
			continue
		}
		if t, _, err := c.propTime(prop); err == nil {
			overridden[t.Unix()] = true
		}
	}
	return overridden
}

// eachInstance 依次以组件每次实例的有效时间调用 fn，fn 返回 true 时停止并返回 true。
// 被覆盖组件替换的实例会跳过，覆盖组件由调用方作为独立组件处理；stopAfter 非零时，实例开始时间晚于它即停止。
func (c *icalContext) eachInstance(comp *ical.Component, siblings []*ical.Component, stopAfter time.Time, fn func(componentTimes) bool) bool {
	times := c.componentTimes(comp)
	if !times.hasStart || !isRecurring(comp) {
		return fn(times)
	}
	next, err := c.recurrence(comp, times.start)
	if err != nil {
		return fn(times)
	}
	overridden := c.overriddenInstances(comp, siblings)
	for count := 0; ; count++ {
		start, ok := next()
		if !ok {
			return false
		}
		if maxRecurrenceInstances <= count {
			return true
		}
		if !stopAfter.IsZero() && start.After(stopAfter) {
			return false
		}
		if overridden[start.Unix()] {
			continue
		}
		if fn(times.shift(start.Sub(times.start))) {
			return true
		}
	}
}

// alarmTrigger 解析 VALARM 的 TRIGGER：absolute 为 true 时 at 是绝对时间，否则 offset 相对于 related 指定的父组件开始或结束。
type alarmTrigger struct {
	absolute bool
	at       time.Time
	offset   time.Duration
	relEnd   bool
	repeat   int
	interval time.Duration
}

func (c *icalContext) parseAlarmTrigger(alarm *ical.Component) (trigger alarmTrigger, ok bool) {
	prop := alarm.Props.Get(ical.PropTrigger)
	if nil == prop {
		return trigger, false
	}
	if strings.EqualFold(prop.Params.Get(ical.ParamValue), string(ical.ValueDateTime)) {
		at, err := c.parseValue(prop.Value, "", false)
		if err != nil {
			return trigger, false
		}
		trigger.absolute, trigger.at = true, at
	} else {
		offset, err := parseDuration(prop.Value)
		if err != nil {
			return trigger, false
		}
		trigger.offset = offset
		trigger.relEnd = strings.EqualFold(prop.Params.Get(ical.ParamRelated), "END")
	}
	if repeat := alarm.Props.Get(ical.PropRepeat); nil != repeat {
		if count, err := repeat.Int(); err == nil && 0 < count {
			if interval := alarm.Props.Get(ical.PropDuration); nil != interval {
				if duration, err := parseDuration(interval.Value); err == nil && 0 < duration {
					trigger.repeat, trigger.interval = count, duration
				}
			}
		}
	}
	return trigger, true
}

// times 返回提醒在父组件一次实例下的全部触发时间（RFC 5545 §3.8.6.3、§3.8.6.2）。
func (trigger alarmTrigger) times(parentName string, parent componentTimes) (times []time.Time) {
	base := trigger.at
	if !trigger.absolute {
		switch {
		case trigger.relEnd && ical.CompEvent == parentName:
			base = parent.eventEnd()
		case trigger.relEnd:
			due, ok := parent.effectiveDue()
			if !ok {
				return nil
			}
			base = due
		case parent.hasStart:
			base = parent.start
		default:
			// 没有 DTSTART 的待办只能相对于到期时间计算
			due, ok := parent.effectiveDue()
			if !ok {
				return nil
			}
			base = due
		}
		base = base.Add(trigger.offset)
	}
	for i := 0; i <= trigger.repeat; i++ {
		times = append(times, base.Add(time.Duration(i)*trigger.interval))
	}
	return
}
