// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package dav

import (
	"strings"
	"testing"
	"time"

	"github.com/emersion/go-ical"
)

// testOutlookZone 是 Outlook 写出的 Windows 时区定义：没有 IANA 名称，规则从 1601 年开始。
func testOutlookZone(tzid string, observances ...string) []string {
	return append(append([]string{"BEGIN:VTIMEZONE", "TZID:" + tzid}, observances...), "END:VTIMEZONE")
}

// testEuropeanObservances 是 +0100/+0200、三月和十月最后一个星期日切换的规则。
var testEuropeanObservances = []string{
	"BEGIN:STANDARD", "DTSTART:16011028T030000", "RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=10", "TZOFFSETFROM:+0200", "TZOFFSETTO:+0100", "END:STANDARD",
	"BEGIN:DAYLIGHT", "DTSTART:16010325T020000", "RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=3", "TZOFFSETFROM:+0100", "TZOFFSETTO:+0200", "END:DAYLIGHT",
}

func testZonedEvent(tzid, start, end string, extra ...string) []string {
	return append(append([]string{"BEGIN:VEVENT", "UID:z", "DTSTAMP:20261101T000000Z", "DTSTART;TZID=" + tzid + ":" + start, "DTEND;TZID=" + tzid + ":" + end}, extra...), "END:VEVENT")
}

// TestVTimeZoneObservances 验证没有 IANA 名称的 VTIMEZONE 按 STANDARD/DAYLIGHT 的偏移和规则解析（RFC 5545 §3.6.5），
// 展开、过滤和忙碌时间都使用它，而不是把时间当作浮动时间。
func TestVTimeZoneObservances(t *testing.T) {
	expand := func(lines []string, start, end string) []string {
		got := testCalendarData(t, `<C:expand start="`+start+`" end="`+end+`"/>`).Render(testCalendar(t, lines...), time.UTC)
		return testExpandedSummaries(got)
	}
	for _, test := range []struct {
		name       string
		lines      []string
		start, end string
		want       []string
	}{
		{"fixed custom offset", append(testOutlookZone("Custom Plus Two",
			"BEGIN:STANDARD", "DTSTART:19700101T000000", "TZOFFSETFROM:+0200", "TZOFFSETTO:+0200", "END:STANDARD"),
			testZonedEvent("Custom Plus Two", "20261102T090000", "20261102T100000")...),
			"20261102T000000Z", "20261103T000000Z", []string{"DTSTART:20261102T070000Z DTEND:20261102T080000Z"}},
		{"Windows time zone name", append(testOutlookZone("China Standard Time",
			"BEGIN:STANDARD", "DTSTART:16010101T000000", "TZOFFSETFROM:+0800", "TZOFFSETTO:+0800", "END:STANDARD"),
			testZonedEvent("China Standard Time", "20261102T090000", "20261102T100000")...),
			"20261102T000000Z", "20261103T000000Z", []string{"DTSTART:20261102T010000Z DTEND:20261102T020000Z"}},
		{"daylight saving rules", append(testOutlookZone("W. Europe Standard Time", testEuropeanObservances...),
			testZonedEvent("W. Europe Standard Time", "20261019T090000", "20261019T100000", "RRULE:FREQ=WEEKLY;COUNT=2")...),
			"20261001T000000Z", "20261101T000000Z", []string{
				"DTSTART:20261019T070000Z DTEND:20261019T080000Z",
				"DTSTART:20261026T080000Z DTEND:20261026T090000Z RECURRENCE-ID:20261026T080000Z",
			}},
		// 2006 年起标准时间改为十一月第一个星期日；UNTIL 是 UTC 时间，正好等于 2006 年十月的切换时刻
		{"rules ending with UNTIL", append(testOutlookZone("Revised Zone",
			"BEGIN:DAYLIGHT", "DTSTART:19810329T020000", "RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=3", "TZOFFSETFROM:+0100", "TZOFFSETTO:+0200", "END:DAYLIGHT",
			"BEGIN:STANDARD", "DTSTART:19961027T030000", "RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=10;UNTIL=20061029T010000Z", "TZOFFSETFROM:+0200", "TZOFFSETTO:+0100", "END:STANDARD",
			"BEGIN:STANDARD", "DTSTART:20071104T030000", "RRULE:FREQ=YEARLY;BYDAY=1SU;BYMONTH=11", "TZOFFSETFROM:+0200", "TZOFFSETTO:+0100", "END:STANDARD"),
			append(testZonedEvent("Revised Zone", "20061030T090000", "20061030T100000"), testZonedEvent("Revised Zone", "20071030T090000", "20071030T100000")...)...),
			"20061001T000000Z", "20080101T000000Z", []string{"DTSTART:20061030T080000Z DTEND:20061030T090000Z", "DTSTART:20071030T070000Z DTEND:20071030T080000Z"}},
		{"before the first onset", append(testOutlookZone("Late Zone",
			"BEGIN:STANDARD", "DTSTART:20200101T000000", "TZOFFSETFROM:+0300", "TZOFFSETTO:+0400", "END:STANDARD"),
			testZonedEvent("Late Zone", "20101102T090000", "20101102T100000")...),
			"20101102T000000Z", "20101103T000000Z", []string{"DTSTART:20101102T060000Z DTEND:20101102T070000Z"}},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := expand(test.lines, test.start, test.end); strings.Join(got, "\n") != strings.Join(test.want, "\n") {
				t.Fatalf("expanded instances:\n%s\nwant:\n%s", strings.Join(got, "\n"), strings.Join(test.want, "\n"))
			}
		})
	}

	outlook := testCalendar(t, append(testOutlookZone("W. Europe Standard Time", testEuropeanObservances...),
		testZonedEvent("W. Europe Standard Time", "20260701T090000", "20260701T100000")...)...)
	loc := VTimeZoneLocation(outlook.Children[0])
	if nil == loc {
		t.Fatal("Outlook VTIMEZONE was not resolved")
	}
	// 规则从 1601 年开始，要覆盖各个世纪
	for _, year := range []int{1650, 1900, 2026, 2150} {
		_, summer := time.Date(year, 7, 1, 12, 0, 0, 0, time.UTC).In(loc).Zone()
		_, winter := time.Date(year, 1, 1, 12, 0, 0, 0, time.UTC).In(loc).Zone()
		if 7200 != summer || 3600 != winter {
			t.Fatalf("%d offsets = %d / %d, want 7200 / 3600", year, summer, winter)
		}
	}
	if !testFilter(t, eventRange("20260701T070000Z", "20260701T073000Z")).Match(outlook, time.UTC) ||
		testFilter(t, eventRange("20260701T090000Z", "20260701T093000Z")).Match(outlook, time.UTC) {
		t.Fatal("time-range filter must use the VTIMEZONE rules")
	}
	freeBusy := NewFreeBusy(&TimeRange{Start: time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC), End: time.Date(2026, 7, 2, 0, 0, 0, 0, time.UTC)})
	freeBusy.Add(outlook, time.UTC)
	if got := freeBusy.Encode(time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC)); !strings.Contains(got, "FREEBUSY;FBTYPE=BUSY:20260701T070000Z/20260701T080000Z\r\n") {
		t.Fatalf("free-busy must use the VTIMEZONE rules:\n%s", got)
	}
}

// TestVTimeZoneLocationPrecedence 验证 IANA 名称优先于 VTIMEZONE 中的规则，无法解析的定义返回 nil。
func TestVTimeZoneLocationPrecedence(t *testing.T) {
	zone := func(lines ...string) *ical.Component {
		return testCalendar(t, append(append([]string{"BEGIN:VTIMEZONE"}, lines...), "END:VTIMEZONE")...).Children[0]
	}
	// 截断的定义只含 1970 年起的标准时间，IANA 时区仍给出夏令时
	berlin := zone("TZID:Europe/Berlin", "BEGIN:STANDARD", "DTSTART:19700101T000000", "TZOFFSETFROM:+0100", "TZOFFSETTO:+0100", "END:STANDARD")
	lightning := zone("TZID:Mitteleuropaeische Zeit", "X-LIC-LOCATION:Europe/Berlin", "BEGIN:STANDARD", "DTSTART:19700101T000000", "TZOFFSETFROM:+0100", "TZOFFSETTO:+0100", "END:STANDARD")
	summer := time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC)
	for _, test := range []*ical.Component{berlin, lightning} {
		loc := VTimeZoneLocation(test)
		if nil == loc {
			t.Fatal("IANA time zone was not resolved")
		}
		if _, offset := summer.In(loc).Zone(); 7200 != offset {
			t.Fatalf("%s offset = %d, want the IANA summer offset", loc, offset)
		}
	}
	for _, invalid := range []*ical.Component{
		zone("TZID:No Observance"),
		zone("TZID:Bad Offset", "BEGIN:STANDARD", "DTSTART:19700101T000000", "TZOFFSETFROM:+2", "TZOFFSETTO:+0100", "END:STANDARD"),
		zone("TZID:No Start", "BEGIN:STANDARD", "TZOFFSETFROM:+0100", "TZOFFSETTO:+0100", "END:STANDARD"),
	} {
		if loc := VTimeZoneLocation(invalid); nil != loc {
			t.Fatalf("invalid VTIMEZONE resolved to %s", loc)
		}
	}
}
