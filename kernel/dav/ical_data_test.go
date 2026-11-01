// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package dav

import (
	"strings"
	"testing"
	"time"
)

func testCalendarData(t *testing.T, inner string) *CalendarDataRequest {
	t.Helper()
	node, err := ParseXML(strings.NewReader(`<C:calendar-data xmlns:C="urn:ietf:params:xml:ns:caldav">` + inner + `</C:calendar-data>`))
	if err != nil {
		t.Fatal(err)
	}
	request, err := ParseCalendarDataRequest(node)
	if err != nil {
		t.Fatal(err)
	}
	return request
}

// TestCalendarDataPartialRetrieval 验证 comp/prop 选择和 novalue，结果缺少必需属性时仍能输出（RFC 4791 §9.6）。
func TestCalendarDataPartialRetrieval(t *testing.T) {
	calendar := testCalendar(t, "BEGIN:VEVENT", "UID:p", "DTSTAMP:20261101T000000Z", "DTSTART:20261102T090000Z", "SUMMARY:Secret",
		"DESCRIPTION:Long text", "BEGIN:VALARM", "ACTION:DISPLAY", "TRIGGER:-PT5M", "END:VALARM", "END:VEVENT")
	request := testCalendarData(t, `<C:comp name="VCALENDAR"><C:prop name="VERSION"/><C:comp name="VEVENT"><C:prop name="SUMMARY" novalue="yes"/><C:prop name="UID"/></C:comp></C:comp>`)
	got := request.Render(calendar, time.UTC)
	want := "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nSUMMARY:\r\nUID:p\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n"
	if got != want {
		t.Fatalf("partial retrieval:\n%q\nwant\n%q", got, want)
	}
	if !testCalendarData(t, "").Full() || request.Full() {
		t.Fatal("Full() must only report requests without comp, expand or limits")
	}
	node, _ := ParseXML(strings.NewReader(`<C:calendar-data xmlns:C="urn:ietf:params:xml:ns:caldav" content-type="text/calendar" version="3.0"/>`))
	if _, err := ParseCalendarDataRequest(node); ConditionErrorName(err) != CalDAVName("supported-calendar-data") {
		t.Fatalf("unsupported version: %v", err)
	}
}

// TestCalendarDataExpand 验证展开后的实例不含重复属性和 VTIMEZONE，时间换算为 UTC，非首个实例带 RECURRENCE-ID（RFC 4791 §9.6.5）。
func TestCalendarDataExpand(t *testing.T) {
	calendar := testCalendar(t, "BEGIN:VTIMEZONE", "TZID:Europe/Berlin", "BEGIN:STANDARD", "DTSTART:19701025T030000", "TZOFFSETFROM:+0200",
		"TZOFFSETTO:+0100", "END:STANDARD", "END:VTIMEZONE",
		"BEGIN:VEVENT", "UID:x", "DTSTAMP:20261101T000000Z", "DTSTART;TZID=Europe/Berlin:20261102T090000", "DTEND;TZID=Europe/Berlin:20261102T100000",
		"RRULE:FREQ=DAILY;COUNT=4", "EXDATE;TZID=Europe/Berlin:20261103T090000", "SUMMARY:Daily", "END:VEVENT",
		"BEGIN:VEVENT", "UID:x", "DTSTAMP:20261101T000000Z", "RECURRENCE-ID;TZID=Europe/Berlin:20261104T090000",
		"DTSTART;TZID=Europe/Berlin:20261104T120000", "DTEND;TZID=Europe/Berlin:20261104T130000", "SUMMARY:Moved", "END:VEVENT")
	got := testCalendarData(t, `<C:expand start="20261101T000000Z" end="20261105T000000Z"/>`).Render(calendar, time.UTC)
	for _, unwanted := range []string{"RRULE", "EXDATE", "VTIMEZONE", "TZID", "20261103T080000Z"} {
		if strings.Contains(got, unwanted) {
			t.Fatalf("expanded data contains %s:\n%s", unwanted, got)
		}
	}
	for _, wanted := range []string{"DTSTART:20261102T080000Z", "DTEND:20261102T090000Z", "SUMMARY:Daily", "RECURRENCE-ID:20261104T080000Z", "DTSTART:20261104T110000Z"} {
		if !strings.Contains(got, wanted) {
			t.Fatalf("expanded data lacks %s:\n%s", wanted, got)
		}
	}
	if count := strings.Count(got, "BEGIN:VEVENT"); 2 != count {
		t.Fatalf("expanded %d instances, want the first and the moved one:\n%s", count, got)
	}
	if first := got[strings.Index(got, "BEGIN:VEVENT"):strings.Index(got, "END:VEVENT")]; strings.Contains(first, "RECURRENCE-ID") {
		t.Fatalf("the first instance must not carry RECURRENCE-ID:\n%s", first)
	}
}

func TestCalendarDataLimitRecurrenceSet(t *testing.T) {
	calendar := testCalendar(t, "BEGIN:VEVENT", "UID:x", "DTSTAMP:20261101T000000Z", "DTSTART:20261102T090000Z", "DTEND:20261102T100000Z",
		"RRULE:FREQ=DAILY;COUNT=10", "END:VEVENT",
		"BEGIN:VEVENT", "UID:x", "DTSTAMP:20261101T000000Z", "RECURRENCE-ID:20261103T090000Z", "DTSTART:20261103T120000Z", "DTEND:20261103T130000Z", "SUMMARY:near", "END:VEVENT",
		"BEGIN:VEVENT", "UID:x", "DTSTAMP:20261101T000000Z", "RECURRENCE-ID:20261108T090000Z", "DTSTART:20261108T120000Z", "DTEND:20261108T130000Z", "SUMMARY:far", "END:VEVENT",
		"BEGIN:VEVENT", "UID:x", "DTSTAMP:20261101T000000Z", "RECURRENCE-ID:20261109T090000Z", "DTSTART:20261103T150000Z", "DTEND:20261103T160000Z", "SUMMARY:pulled", "END:VEVENT")
	got := testCalendarData(t, `<C:limit-recurrence-set start="20261103T000000Z" end="20261104T000000Z"/>`).Render(calendar, time.UTC)
	if !strings.Contains(got, "RRULE") || !strings.Contains(got, "SUMMARY:near") || !strings.Contains(got, "SUMMARY:pulled") || strings.Contains(got, "SUMMARY:far") {
		t.Fatalf("limit-recurrence-set kept the wrong overrides:\n%s", got)
	}
}

// TestFreeBusy 验证只统计不透明、未取消的事件，同类型时段合并并裁剪到查询区间（RFC 4791 §7.10）。
func TestFreeBusy(t *testing.T) {
	event := func(uid, start, end string, extra ...string) []string {
		return append(append([]string{"BEGIN:VEVENT", "UID:" + uid, "DTSTAMP:20261101T000000Z", "DTSTART:" + start, "DTEND:" + end}, extra...), "END:VEVENT")
	}
	r := &TimeRange{Start: time.Date(2026, 11, 2, 0, 0, 0, 0, time.UTC), End: time.Date(2026, 11, 3, 0, 0, 0, 0, time.UTC)}
	freeBusy := NewFreeBusy(r)
	for _, lines := range [][]string{
		event("a", "20261102T090000Z", "20261102T100000Z"),
		event("b", "20261102T093000Z", "20261102T110000Z"),
		event("c", "20261102T130000Z", "20261102T140000Z", "STATUS:TENTATIVE"),
		event("d", "20261102T150000Z", "20261102T160000Z", "TRANSP:TRANSPARENT"),
		event("e", "20261102T170000Z", "20261102T180000Z", "STATUS:CANCELLED"),
		event("f", "20261102T230000Z", "20261103T010000Z"),
		event("g", "20261101T090000Z", "20261101T100000Z", "RRULE:FREQ=DAILY;COUNT=3"),
		{"BEGIN:VFREEBUSY", "UID:h", "DTSTAMP:20261101T000000Z", "FREEBUSY;FBTYPE=BUSY-UNAVAILABLE:20261102T200000Z/PT1H", "FREEBUSY;FBTYPE=FREE:20261102T210000Z/PT1H", "END:VFREEBUSY"},
	} {
		freeBusy.Add(testCalendar(t, lines...), time.UTC)
	}
	got := freeBusy.Encode(time.Date(2026, 11, 1, 0, 0, 0, 0, time.UTC))
	for _, wanted := range []string{
		"FREEBUSY;FBTYPE=BUSY:20261102T090000Z/20261102T110000Z,20261102T230000Z/20261103T000000Z\r\n",
		"FREEBUSY;FBTYPE=BUSY-TENTATIVE:20261102T130000Z/20261102T140000Z\r\n",
		"FREEBUSY;FBTYPE=BUSY-UNAVAILABLE:20261102T200000Z/20261102T210000Z\r\n",
		"DTSTART:20261102T000000Z\r\n", "DTEND:20261103T000000Z\r\n",
	} {
		if !strings.Contains(got, wanted) {
			t.Fatalf("free-busy lacks %q:\n%s", wanted, got)
		}
	}
	if strings.Contains(got, "150000Z") || strings.Contains(got, "170000Z") || strings.Contains(got, "FBTYPE=FREE") {
		t.Fatalf("free-busy contains transparent, cancelled or free time:\n%s", got)
	}
}
