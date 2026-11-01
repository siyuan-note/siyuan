// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package dav

import (
	"errors"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/emersion/go-ical"
)

// CalendarDataRequest 是 REPORT 中 CALDAV:calendar-data 指定的返回内容（RFC 4791 §9.6）。
type CalendarDataRequest struct {
	Comp               *CompRequest
	Expand             *TimeRange
	LimitRecurrenceSet *TimeRange
	LimitFreeBusySet   *TimeRange
}

// CompRequest 是 CALDAV:comp，选择返回的属性和子组件。
type CompRequest struct {
	Name     string
	AllProps bool
	Props    []PropRequest
	AllComps bool
	Comps    []*CompRequest
}

// PropRequest 是 CALDAV:prop 或 CARDDAV:prop；NoValue 为 true 时只返回属性名和参数。
type PropRequest struct {
	Name    string
	NoValue bool
}

// ParseCalendarDataRequest 解析 REPORT 请求中的 CALDAV:calendar-data。
func ParseCalendarDataRequest(n *Node) (*CalendarDataRequest, error) {
	contentType, _ := n.Attr("content-type")
	version, _ := n.Attr("version")
	if ("" != contentType && !strings.EqualFold(ical.MIMEType, contentType)) || ("" != version && "2.0" != version) {
		return nil, NewConditionError(http.StatusForbidden, NewElement(CalDAVName("supported-calendar-data")))
	}
	request := &CalendarDataRequest{}
	for _, child := range n.Children() {
		var target **TimeRange
		switch child.XMLName {
		case CalDAVName("comp"):
			comp, err := parseCompRequest(child)
			if err != nil {
				return nil, err
			}
			request.Comp = comp
			continue
		case CalDAVName("expand"):
			target = &request.Expand
		case CalDAVName("limit-recurrence-set"):
			target = &request.LimitRecurrenceSet
		case CalDAVName("limit-freebusy-set"):
			target = &request.LimitFreeBusySet
		default:
			return nil, NewError(http.StatusBadRequest, errors.New("unexpected element in calendar-data"))
		}
		timeRange, err := ParseTimeRange(child, true)
		if err != nil {
			return nil, NewError(http.StatusBadRequest, err)
		}
		*target = timeRange
	}
	if nil != request.Expand && nil != request.LimitRecurrenceSet {
		return nil, NewError(http.StatusBadRequest, errors.New("expand and limit-recurrence-set are mutually exclusive"))
	}
	return request, nil
}

func parseCompRequest(n *Node) (*CompRequest, error) {
	name, _ := n.Attr("name")
	if "" == name {
		return nil, NewError(http.StatusBadRequest, errors.New("comp requires a name"))
	}
	comp := &CompRequest{Name: strings.ToUpper(name)}
	for _, child := range n.Children() {
		switch child.XMLName {
		case CalDAVName("allprop"):
			comp.AllProps = true
		case CalDAVName("prop"):
			prop, err := parsePropRequest(child)
			if err != nil {
				return nil, err
			}
			comp.Props = append(comp.Props, prop)
		case CalDAVName("allcomp"):
			comp.AllComps = true
		case CalDAVName("comp"):
			sub, err := parseCompRequest(child)
			if err != nil {
				return nil, err
			}
			comp.Comps = append(comp.Comps, sub)
		default:
			return nil, NewError(http.StatusBadRequest, errors.New("unexpected element in comp"))
		}
	}
	return comp, nil
}

func parsePropRequest(n *Node) (PropRequest, error) {
	name, _ := n.Attr("name")
	if "" == name {
		return PropRequest{}, NewError(http.StatusBadRequest, errors.New("prop requires a name"))
	}
	noValue, _ := n.Attr("novalue")
	return PropRequest{Name: strings.ToUpper(name), NoValue: "yes" == noValue}, nil
}

// Full 判断请求是否要求返回完整、未经改动的日历对象。
func (r *CalendarDataRequest) Full() bool {
	return nil == r || (nil == r.Comp && nil == r.Expand && nil == r.LimitRecurrenceSet && nil == r.LimitFreeBusySet)
}

// Render 返回按请求裁剪、展开后的 iCalendar 文本。结果可能缺少 UID、DTSTAMP 等必需属性（RFC 4791 §9.6），
// 因此不用会校验组件的 go-ical 编码器。
func (r *CalendarDataRequest) Render(calendar *ical.Calendar, floating *time.Location) string {
	ctx := newICalContext(calendar.Component, floating)
	data := cloneComponent(calendar.Component)
	switch {
	case nil != r.Expand:
		data = ctx.expand(data, r.Expand)
	case nil != r.LimitRecurrenceSet:
		data = ctx.limitRecurrenceSet(data, r.LimitRecurrenceSet)
	}
	if nil != r.LimitFreeBusySet {
		ctx.limitFreeBusySet(data, r.LimitFreeBusySet)
	}
	if nil != r.Comp {
		if data = selectComponent(data, r.Comp); nil == data {
			return ""
		}
	}
	var buf strings.Builder
	encodeComponent(&buf, data)
	return buf.String()
}

func cloneProps(props ical.Props) ical.Props {
	clone := make(ical.Props, len(props))
	for name, values := range props {
		for _, prop := range values {
			clone[name] = append(clone[name], cloneProp(prop))
		}
	}
	return clone
}

func cloneProp(prop ical.Prop) ical.Prop {
	params := make(ical.Params, len(prop.Params))
	for name, values := range prop.Params {
		params[name] = append([]string(nil), values...)
	}
	prop.Params = params
	return prop
}

func cloneComponent(comp *ical.Component) *ical.Component {
	clone := &ical.Component{Name: comp.Name, Props: cloneProps(comp.Props)}
	for _, child := range comp.Children {
		clone.Children = append(clone.Children, cloneComponent(child))
	}
	return clone
}

// expand 把重复组件展开为与区间重叠的单个实例：去掉重复属性和 VTIMEZONE，带时区的时间换算为 UTC，
// 第一个实例之外的实例带 RECURRENCE-ID（RFC 4791 §9.6.5）。
func (c *icalContext) expand(calendar *ical.Component, r *TimeRange) *ical.Component {
	expanded := &ical.Component{Name: calendar.Name, Props: calendar.Props}
	for _, child := range calendar.Children {
		switch child.Name {
		case ical.CompTimezone:
			continue
		case ical.CompEvent, ical.CompToDo, ical.CompJournal:
		default:
			expanded.Children = append(expanded.Children, child)
			continue
		}
		if !isRecurring(child) {
			if r.overlaps(child.Name, c.componentTimes(child)) {
				expanded.Children = append(expanded.Children, c.toUTC(cloneComponent(child)))
			}
			continue
		}
		master := c.componentTimes(child)
		c.eachInstance(child, calendar.Children, r.End, func(t componentTimes) bool {
			if !r.overlaps(child.Name, t) {
				return false
			}
			instance := cloneComponent(child)
			for _, name := range []string{ical.PropRecurrenceRule, ical.PropRecurrenceDates, ical.PropExceptionDates, "EXRULE"} {
				instance.Props.Del(name)
			}
			c.setInstanceTime(instance, ical.PropDateTimeStart, t.start)
			if t.hasEnd {
				c.setInstanceTime(instance, ical.PropDateTimeEnd, t.end)
			}
			if t.hasDue {
				c.setInstanceTime(instance, ical.PropDue, t.due)
			}
			if !t.start.Equal(master.start) {
				instance.Props.Set(&ical.Prop{Name: ical.PropRecurrenceID, Params: ical.Params{}, Value: instance.Props.Get(ical.PropDateTimeStart).Value})
				if isDateValue(instance.Props.Get(ical.PropDateTimeStart)) {
					instance.Props.Get(ical.PropRecurrenceID).Params.Set(ical.ParamValue, string(ical.ValueDate))
				}
			}
			expanded.Children = append(expanded.Children, c.toUTC(instance))
			return false
		})
	}
	return expanded
}

// setInstanceTime 用实例时间替换属性值：DATE 值仍为 DATE，浮动时间仍为浮动时间，其余换算为 UTC。
func (c *icalContext) setInstanceTime(comp *ical.Component, name string, t time.Time) {
	prop := comp.Props.Get(name)
	if nil == prop {
		return
	}
	switch {
	case isDateValue(prop):
		prop.Value = t.In(c.floating).Format(icalDateFormat)
	case !strings.HasSuffix(prop.Value, "Z") && "" == prop.Params.Get(ical.PropTimezoneID):
		prop.Value = t.In(c.floating).Format(icalDateTimeFormat)
	default:
		prop.Params.Del(ical.PropTimezoneID)
		prop.Value = t.UTC().Format(icalDateTimeUTCFormat)
	}
}

// toUTC 把组件及其子组件中引用时区的 DATE-TIME 值换算为 UTC。
func (c *icalContext) toUTC(comp *ical.Component) *ical.Component {
	for name, props := range comp.Props {
		for i := range props {
			prop := &props[i]
			tzid := prop.Params.Get(ical.PropTimezoneID)
			if "" == tzid || isDateValue(prop) {
				continue
			}
			var values []string
			for _, value := range strings.Split(prop.Value, ",") {
				start, end, isPeriod := strings.Cut(value, "/")
				t, err := c.parseValue(start, tzid, false)
				if err != nil {
					values = nil
					break
				}
				value = t.UTC().Format(icalDateTimeUTCFormat)
				if isPeriod {
					if endTime, endErr := c.parseValue(end, tzid, false); endErr == nil {
						end = endTime.UTC().Format(icalDateTimeUTCFormat)
					}
					value += "/" + end
				}
				values = append(values, value)
			}
			if nil != values {
				prop.Params.Del(ical.PropTimezoneID)
				prop.Value = strings.Join(values, ",")
			}
		}
		comp.Props[name] = props
	}
	for _, child := range comp.Children {
		c.toUTC(child)
	}
	return comp
}

// limitRecurrenceSet 保留主组件，只保留当前或原定时间与区间重叠的覆盖组件（RFC 4791 §9.6.6）。
func (c *icalContext) limitRecurrenceSet(calendar *ical.Component, r *TimeRange) *ical.Component {
	limited := &ical.Component{Name: calendar.Name, Props: calendar.Props}
	for _, child := range calendar.Children {
		rid := child.Props.Get(ical.PropRecurrenceID)
		if nil == rid || "" != rid.Params.Get(ical.ParamRange) || r.overlaps(child.Name, c.componentTimes(child)) {
			limited.Children = append(limited.Children, child)
			continue
		}
		original, _, err := c.propTime(rid)
		if err != nil {
			limited.Children = append(limited.Children, child)
			continue
		}
		times := c.componentTimes(child)
		if master := findMaster(child, calendar.Children); nil != master {
			times = c.componentTimes(master)
		}
		if times.hasStart && r.overlaps(child.Name, times.shift(original.Sub(times.start))) {
			limited.Children = append(limited.Children, child)
		}
	}
	return limited
}

func findMaster(override *ical.Component, siblings []*ical.Component) *ical.Component {
	uid, _ := override.Props.Text(ical.PropUID)
	for _, sibling := range siblings {
		if sibling.Name != override.Name || nil != sibling.Props.Get(ical.PropRecurrenceID) {
			continue
		}
		if siblingUID, _ := sibling.Props.Text(ical.PropUID); siblingUID == uid {
			return sibling
		}
	}
	return nil
}

// limitFreeBusySet 只保留与区间重叠的 FREEBUSY 时段（RFC 4791 §9.6.7）。
func (c *icalContext) limitFreeBusySet(calendar *ical.Component, r *TimeRange) {
	for _, child := range calendar.Children {
		if ical.CompFreeBusy != child.Name {
			continue
		}
		var kept []ical.Prop
		for _, prop := range child.Props[ical.PropFreeBusy] {
			var values []string
			for _, value := range strings.Split(prop.Value, ",") {
				if start, end, err := c.parsePeriod(value, prop.Params.Get(ical.PropTimezoneID)); err == nil && r.overlapsPeriod(start, end) {
					values = append(values, value)
				}
			}
			if 0 < len(values) {
				prop.Value = strings.Join(values, ",")
				kept = append(kept, prop)
			}
		}
		if 0 < len(kept) {
			child.Props[ical.PropFreeBusy] = kept
		} else {
			delete(child.Props, ical.PropFreeBusy)
		}
	}
}

// selectComponent 按 CALDAV:comp 选择属性和子组件；组件名不符时返回 nil。
func selectComponent(comp *ical.Component, request *CompRequest) *ical.Component {
	if comp.Name != request.Name {
		return nil
	}
	selected := &ical.Component{Name: comp.Name, Props: ical.Props{}}
	if request.AllProps {
		selected.Props = comp.Props
	} else {
		for _, prop := range request.Props {
			for _, value := range comp.Props[prop.Name] {
				if prop.NoValue {
					value.Value = ""
				}
				selected.Props[prop.Name] = append(selected.Props[prop.Name], value)
			}
		}
	}
	for _, child := range comp.Children {
		if request.AllComps {
			selected.Children = append(selected.Children, child)
			continue
		}
		for _, sub := range request.Comps {
			if sub.Name == child.Name {
				selected.Children = append(selected.Children, selectComponent(child, sub))
				break
			}
		}
	}
	return selected
}

// encodeComponent 按 go-ical 编码器的格式写出组件（属性名、参数名排序，CRLF 换行），但不校验组件结构。
func encodeComponent(buf *strings.Builder, comp *ical.Component) {
	buf.WriteString("BEGIN:" + comp.Name + "\r\n")
	names := make([]string, 0, len(comp.Props))
	for name := range comp.Props {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		for _, prop := range comp.Props[name] {
			encodeProp(buf, name, &prop)
		}
	}
	for _, child := range comp.Children {
		encodeComponent(buf, child)
	}
	buf.WriteString("END:" + comp.Name + "\r\n")
}

func encodeProp(buf *strings.Builder, name string, prop *ical.Prop) {
	buf.WriteString(name)
	params := make([]string, 0, len(prop.Params))
	for param := range prop.Params {
		params = append(params, param)
	}
	sort.Strings(params)
	for _, param := range params {
		buf.WriteString(";" + param + "=")
		for i, value := range prop.Params[param] {
			if 0 < i {
				buf.WriteString(",")
			}
			value = strings.ReplaceAll(value, `"`, "")
			if strings.ContainsAny(value, ";:,") {
				value = `"` + value + `"`
			}
			buf.WriteString(value)
		}
	}
	buf.WriteString(":" + strings.NewReplacer("\r", "", "\n", "").Replace(prop.Value) + "\r\n")
}

// FreeBusy 汇总 CALDAV:free-busy-query 的忙碌时段（RFC 4791 §7.10）。
type FreeBusy struct {
	Range   *TimeRange
	periods map[string][]period
}

func NewFreeBusy(r *TimeRange) *FreeBusy {
	return &FreeBusy{Range: r, periods: map[string][]period{}}
}

// Add 加入一个日历对象：不透明且未取消的 VEVENT，以及 VFREEBUSY 中非 FREE 的时段。
func (fb *FreeBusy) Add(calendar *ical.Calendar, floating *time.Location) {
	ctx := newICalContext(calendar.Component, floating)
	for _, child := range calendar.Children {
		switch child.Name {
		case ical.CompEvent:
			if transparency, _ := child.Props.Text(ical.PropTransparency); strings.EqualFold("TRANSPARENT", transparency) {
				continue
			}
			status, _ := child.Props.Text(ical.PropStatus)
			fbType := "BUSY"
			switch strings.ToUpper(status) {
			case "CANCELLED":
				continue
			case "TENTATIVE":
				fbType = "BUSY-TENTATIVE"
			}
			ctx.eachInstance(child, calendar.Children, fb.Range.End, func(t componentTimes) bool {
				if t.hasStart {
					fb.add(fbType, t.start, t.eventEnd())
				}
				return false
			})
		case ical.CompFreeBusy:
			for i := range child.Props[ical.PropFreeBusy] {
				prop := &child.Props[ical.PropFreeBusy][i]
				fbType := strings.ToUpper(prop.Params.Get(ical.ParamFreeBusyType))
				if "" == fbType {
					fbType = "BUSY"
				}
				if "FREE" == fbType {
					continue
				}
				for _, p := range ctx.periods(prop) {
					fb.add(fbType, p.start, p.end)
				}
			}
		}
	}
}

func (fb *FreeBusy) add(fbType string, start, end time.Time) {
	if !end.After(start) || !fb.Range.overlapsPeriod(start, end) {
		return
	}
	if start.Before(fb.Range.Start) {
		start = fb.Range.Start
	}
	if end.After(fb.Range.End) {
		end = fb.Range.End
	}
	fb.periods[fbType] = append(fb.periods[fbType], period{start.UTC(), end.UTC()})
}

// Encode 返回只含一个 VFREEBUSY 的 iCalendar 对象，同类型的相邻或重叠时段已合并。
func (fb *FreeBusy) Encode(now time.Time) string {
	freeBusy := ical.NewComponent(ical.CompFreeBusy)
	freeBusy.Props.SetDateTime(ical.PropDateTimeStamp, now.UTC())
	freeBusy.Props.SetDateTime(ical.PropDateTimeStart, fb.Range.Start.UTC())
	freeBusy.Props.SetDateTime(ical.PropDateTimeEnd, fb.Range.End.UTC())
	var types []string
	for fbType := range fb.periods {
		types = append(types, fbType)
	}
	sort.Strings(types)
	for _, fbType := range types {
		periods := fb.periods[fbType]
		sort.Slice(periods, func(i, j int) bool { return periods[i].start.Before(periods[j].start) })
		var merged []period
		for _, p := range periods {
			if last := len(merged) - 1; 0 <= last && !p.start.After(merged[last].end) {
				if p.end.After(merged[last].end) {
					merged[last].end = p.end
				}
				continue
			}
			merged = append(merged, p)
		}
		var values []string
		for _, p := range merged {
			values = append(values, p.start.Format(icalDateTimeUTCFormat)+"/"+p.end.Format(icalDateTimeUTCFormat))
		}
		prop := ical.NewProp(ical.PropFreeBusy)
		prop.Params.Set(ical.ParamFreeBusyType, fbType)
		prop.Value = strings.Join(values, ",")
		freeBusy.Props.Add(prop)
	}
	calendar := ical.NewCalendar()
	calendar.Props.SetText(ical.PropVersion, "2.0")
	calendar.Props.SetText(ical.PropProductID, "-//SiYuan//CalDAV//EN")
	calendar.Children = append(calendar.Children, freeBusy)
	var buf strings.Builder
	encodeComponent(&buf, calendar.Component)
	return buf.String()
}
