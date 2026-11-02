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

func testCalendar(t *testing.T, lines ...string) *ical.Calendar {
	t.Helper()
	text := "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//SiYuan test//EN\r\n" + strings.Join(lines, "\r\n") + "\r\nEND:VCALENDAR\r\n"
	calendar, err := ical.NewDecoder(strings.NewReader(text)).Decode()
	if err != nil {
		t.Fatalf("decode calendar: %v\n%s", err, text)
	}
	return calendar
}

func testFilter(t *testing.T, inner string) *CompFilter {
	t.Helper()
	node, err := ParseXML(strings.NewReader(`<C:filter xmlns:C="urn:ietf:params:xml:ns:caldav"><C:comp-filter name="VCALENDAR">` + inner + `</C:comp-filter></C:filter>`))
	if err != nil {
		t.Fatal(err)
	}
	filter, err := ParseCalendarFilter(node)
	if err != nil {
		t.Fatalf("parse filter: %v", err)
	}
	return filter
}

func eventRange(start, end string) string {
	attrs := ""
	if "" != start {
		attrs += ` start="` + start + `"`
	}
	if "" != end {
		attrs += ` end="` + end + `"`
	}
	return `<C:comp-filter name="VEVENT"><C:time-range` + attrs + `/></C:comp-filter>`
}

// TestCalendarFilterEventTimeRange 覆盖 RFC 4791 §9.9 VEVENT 表格的每一行及其边界。
func TestCalendarFilterEventTimeRange(t *testing.T) {
	for _, test := range []struct {
		name  string
		event []string
		start string
		end   string
		want  bool
	}{
		{"DTEND overlap", []string{"DTSTART:20261102T090000Z", "DTEND:20261102T100000Z"}, "20261102T093000Z", "20261102T094000Z", true},
		{"DTEND ends at range start", []string{"DTSTART:20261102T090000Z", "DTEND:20261102T100000Z"}, "20261102T100000Z", "20261102T110000Z", false},
		{"DTEND starts at range end", []string{"DTSTART:20261102T090000Z", "DTEND:20261102T100000Z"}, "20261102T080000Z", "20261102T090000Z", false},
		{"DURATION overlap", []string{"DTSTART:20261102T090000Z", "DURATION:PT1H"}, "20261102T095900Z", "20261102T110000Z", true},
		{"DURATION ends at range start", []string{"DTSTART:20261102T090000Z", "DURATION:PT1H"}, "20261102T100000Z", "20261102T110000Z", false},
		{"zero DURATION at range start", []string{"DTSTART:20261102T090000Z", "DURATION:PT0S"}, "20261102T090000Z", "20261102T100000Z", true},
		{"instant at range start", []string{"DTSTART:20261102T090000Z"}, "20261102T090000Z", "20261102T100000Z", true},
		{"instant at range end", []string{"DTSTART:20261102T090000Z"}, "20261102T080000Z", "20261102T090000Z", false},
		{"all-day event lasts one day", []string{"DTSTART;VALUE=DATE:20261102"}, "20261102T230000Z", "20261103T010000Z", true},
		{"all-day event ends at midnight", []string{"DTSTART;VALUE=DATE:20261102"}, "20261103T000000Z", "20261103T010000Z", false},
		{"open end", []string{"DTSTART:20261102T090000Z", "DTEND:20261102T100000Z"}, "20261102T093000Z", "", true},
		{"open start excludes later event", []string{"DTSTART:20261102T090000Z", "DTEND:20261102T100000Z"}, "", "20261102T080000Z", false},
		{"open start", []string{"DTSTART:20261102T090000Z", "DTEND:20261102T100000Z"}, "", "20261102T093000Z", true},
	} {
		t.Run(test.name, func(t *testing.T) {
			calendar := testCalendar(t, append(append([]string{"BEGIN:VEVENT", "UID:e", "DTSTAMP:20261101T000000Z"}, test.event...), "END:VEVENT")...)
			if got := testFilter(t, eventRange(test.start, test.end)).Match(calendar, time.UTC); got != test.want {
				t.Fatalf("match = %v, want %v", got, test.want)
			}
		})
	}
}

// TestCalendarFilterRecurrence 验证时间区间考虑每个重复实例、EXDATE 和覆盖实例（RFC 4791 §9.9）。
func TestCalendarFilterRecurrence(t *testing.T) {
	master := []string{"BEGIN:VEVENT", "UID:r", "DTSTAMP:20261101T000000Z", "DTSTART:20261102T090000Z", "DTEND:20261102T100000Z", "RRULE:FREQ=DAILY;COUNT=5"}
	day4 := eventRange("20261105T000000Z", "20261106T000000Z")
	for _, test := range []struct {
		name   string
		lines  []string
		filter string
		want   bool
	}{
		{"later instance", append(master, "END:VEVENT"), day4, true},
		{"after the last instance", append(master, "END:VEVENT"), eventRange("20261107T000000Z", "20261108T000000Z"), false},
		{"excluded instance", append(master, "EXDATE:20261105T090000Z", "END:VEVENT"), day4, false},
		{"excluded with a date list", append(master, "EXDATE:20261104T090000Z,20261105T090000Z", "END:VEVENT"), day4, false},
		{"instance moved away", append(append(master, "END:VEVENT"), "BEGIN:VEVENT", "UID:r", "DTSTAMP:20261101T000000Z",
			"RECURRENCE-ID:20261105T090000Z", "DTSTART:20261110T090000Z", "DTEND:20261110T100000Z", "END:VEVENT"), day4, false},
		{"instance moved into range", append(append(master, "END:VEVENT"), "BEGIN:VEVENT", "UID:r", "DTSTAMP:20261101T000000Z",
			"RECURRENCE-ID:20261103T090000Z", "DTSTART:20261120T090000Z", "DTEND:20261120T100000Z", "END:VEVENT"),
			eventRange("20261120T000000Z", "20261121T000000Z"), true},
		{"RDATE instance", append(master[:5], "RDATE:20261201T090000Z", "END:VEVENT"), eventRange("20261201T000000Z", "20261202T000000Z"), true},
		{"unbounded rule with open end", append(master[:5], "RRULE:FREQ=YEARLY", "END:VEVENT"), eventRange("20301102T093000Z", ""), true},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := testFilter(t, test.filter).Match(testCalendar(t, test.lines...), time.UTC); got != test.want {
				t.Fatalf("match = %v, want %v", got, test.want)
			}
		})
	}
}

func TestCalendarFilterTimeZones(t *testing.T) {
	berlin := []string{"BEGIN:VEVENT", "UID:tz", "DTSTAMP:20261101T000000Z", "DTSTART;TZID=/mozilla.org/20050126_1/Europe/Berlin:20261102T090000",
		"DTEND;TZID=/mozilla.org/20050126_1/Europe/Berlin:20261102T100000", "END:VEVENT"}
	// 柏林 2026-11-02 处于冬令时（UTC+1），09:00 对应 08:00Z
	if !testFilter(t, eventRange("20261102T080000Z", "20261102T083000Z")).Match(testCalendar(t, berlin...), time.UTC) {
		t.Fatal("TZID with a vendor prefix was not resolved to Europe/Berlin")
	}
	floating := []string{"BEGIN:VEVENT", "UID:f", "DTSTAMP:20261101T000000Z", "DTSTART:20261102T090000", "DTEND:20261102T100000", "END:VEVENT"}
	tokyo, err := time.LoadLocation("Asia/Tokyo")
	if err != nil {
		t.Fatal(err)
	}
	filter := testFilter(t, eventRange("20261102T000000Z", "20261102T010000Z"))
	if !filter.Match(testCalendar(t, floating...), tokyo) || filter.Match(testCalendar(t, floating...), time.UTC) {
		t.Fatal("floating time must be resolved with the supplied time zone")
	}
}

func TestCalendarFilterComponentsAndProperties(t *testing.T) {
	event := []string{"BEGIN:VEVENT", "UID:p", "DTSTAMP:20261101T000000Z", "DTSTART:20261102T090000Z", "DURATION:PT1H",
		"SUMMARY:Team meeting", "ATTENDEE;PARTSTAT=ACCEPTED:mailto:a@example.com", "ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:b@example.com",
		"BEGIN:VALARM", "ACTION:DISPLAY", "TRIGGER:-PT15M", "END:VALARM", "END:VEVENT"}
	todo := []string{"BEGIN:VTODO", "UID:t", "DTSTAMP:20261101T000000Z", "SUMMARY:Task", "END:VTODO"}
	for _, test := range []struct {
		name   string
		lines  []string
		filter string
		want   bool
	}{
		{"event exists", event, `<C:comp-filter name="VEVENT"/>`, true},
		{"todo is not defined", event, `<C:comp-filter name="VTODO"><C:is-not-defined/></C:comp-filter>`, true},
		{"event is defined", event, `<C:comp-filter name="VEVENT"><C:is-not-defined/></C:comp-filter>`, false},
		{"case-insensitive substring", event, `<C:comp-filter name="VEVENT"><C:prop-filter name="SUMMARY"><C:text-match>MEET</C:text-match></C:prop-filter></C:comp-filter>`, true},
		{"octet collation", event, `<C:comp-filter name="VEVENT"><C:prop-filter name="SUMMARY"><C:text-match collation="i;octet">MEET</C:text-match></C:prop-filter></C:comp-filter>`, false},
		{"negated text-match", event, `<C:comp-filter name="VEVENT"><C:prop-filter name="SUMMARY"><C:text-match negate-condition="yes">meeting</C:text-match></C:prop-filter></C:comp-filter>`, false},
		{"any property instance", event, `<C:comp-filter name="VEVENT"><C:prop-filter name="ATTENDEE"><C:text-match>b@example</C:text-match></C:prop-filter></C:comp-filter>`, true},
		{"parameter on the same instance", event, `<C:comp-filter name="VEVENT"><C:prop-filter name="ATTENDEE"><C:text-match>b@example</C:text-match><C:param-filter name="PARTSTAT"><C:text-match>ACCEPTED</C:text-match></C:param-filter></C:prop-filter></C:comp-filter>`, false},
		{"property is not defined", event, `<C:comp-filter name="VEVENT"><C:prop-filter name="LOCATION"><C:is-not-defined/></C:prop-filter></C:comp-filter>`, true},
		{"effective DTEND", event, `<C:comp-filter name="VEVENT"><C:prop-filter name="DTEND"><C:time-range start="20261102T100000Z" end="20261102T100100Z"/></C:prop-filter></C:comp-filter>`, true},
		{"alarm trigger", event, `<C:comp-filter name="VEVENT"><C:comp-filter name="VALARM"><C:time-range start="20261102T084000Z" end="20261102T085000Z"/></C:comp-filter></C:comp-filter>`, true},
		{"alarm outside range", event, `<C:comp-filter name="VEVENT"><C:comp-filter name="VALARM"><C:time-range start="20261102T085000Z" end="20261102T090000Z"/></C:comp-filter></C:comp-filter>`, false},
		{"undated todo always overlaps", todo, `<C:comp-filter name="VTODO"><C:time-range start="20300101T000000Z" end="20300102T000000Z"/></C:comp-filter>`, true},
		{"todo by due date", append(todo[:4], "DUE:20261105T000000Z", "END:VTODO"), `<C:comp-filter name="VTODO"><C:time-range start="20261104T000000Z" end="20261105T000000Z"/></C:comp-filter>`, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := testFilter(t, test.filter).Match(testCalendar(t, test.lines...), time.UTC); got != test.want {
				t.Fatalf("match = %v, want %v", got, test.want)
			}
		})
	}
}

func TestParseCalendarFilterErrors(t *testing.T) {
	for _, test := range []struct {
		name, xml, condition string
	}{
		{"missing comp-filter", `<C:filter xmlns:C="urn:ietf:params:xml:ns:caldav"/>`, "valid-filter"},
		{"top-level component", `<C:filter xmlns:C="urn:ietf:params:xml:ns:caldav"><C:comp-filter name="VEVENT"/></C:filter>`, "valid-filter"},
		{"time-range on VCALENDAR", `<C:filter xmlns:C="urn:ietf:params:xml:ns:caldav"><C:comp-filter name="VCALENDAR"><C:time-range start="20261101T000000Z"/></C:comp-filter></C:filter>`, "valid-filter"},
		{"empty time-range", `<C:filter xmlns:C="urn:ietf:params:xml:ns:caldav"><C:comp-filter name="VCALENDAR"><C:comp-filter name="VEVENT"><C:time-range/></C:comp-filter></C:comp-filter></C:filter>`, "valid-filter"},
		{"unsupported collation", `<C:filter xmlns:C="urn:ietf:params:xml:ns:caldav"><C:comp-filter name="VCALENDAR"><C:comp-filter name="VEVENT"><C:prop-filter name="SUMMARY"><C:text-match collation="i;basic">x</C:text-match></C:prop-filter></C:comp-filter></C:comp-filter></C:filter>`, "supported-collation"},
	} {
		t.Run(test.name, func(t *testing.T) {
			node, err := ParseXML(strings.NewReader(test.xml))
			if err != nil {
				t.Fatal(err)
			}
			_, err = ParseCalendarFilter(node)
			if name := ConditionErrorName(err); name != CalDAVName(test.condition) {
				t.Fatalf("error = %v (%v), want %s", err, name, test.condition)
			}
		})
	}
}
