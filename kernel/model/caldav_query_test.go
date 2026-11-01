// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/emersion/go-ical"
)

const davTestQueryEvents = `<?xml version="1.0"?><C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:prop><D:getetag/></D:prop><C:filter><C:comp-filter name="VCALENDAR"><C:comp-filter name="VEVENT"/></C:comp-filter></C:filter></C:calendar-query>`

// TestCalDAVQueryScope 验证 calendar-query 的范围：单个对象；日历集合按 Depth 包含其中的对象；
// home set 等普通集合只考虑深度范围内各日历中的对象（RFC 4791 §7.2、§7.8）。
func TestCalDAVQueryScope(t *testing.T) {
	calDAV, _ := newDAVHandlerFixture(t)
	work := CalDavHomeSetPath + "/work"
	if response := davTestRequest(calDAV, "MKCOL", work, map[string]string{"Content-Type": "application/xml"}, davTestMkcolCalendar); response.Code != http.StatusCreated {
		t.Fatalf("MKCOL: status = %d", response.Code)
	}
	for _, object := range []string{CalDavDefaultCalendarPath + "/a.ics", CalDavDefaultCalendarPath + "/b.ics", work + "/c.ics"} {
		uid := strings.TrimSuffix(object[strings.LastIndex(object, "/")+1:], ".ics")
		if response := davTestRequest(calDAV, http.MethodPut, object, davICalendarHeader, davTestEvent(uid, uid)); response.Code != http.StatusCreated {
			t.Fatalf("PUT %s: status = %d", object, response.Code)
		}
	}
	for _, test := range []struct {
		target, depth string
		want          []string
	}{
		{CalDavDefaultCalendarPath + "/a.ics", "0", []string{"/a.ics"}},
		{CalDavDefaultCalendarPath, "1", []string{"/a.ics", "/b.ics"}},
		{CalDavDefaultCalendarPath, "", nil},
		{CalDavHomeSetPath, "1", []string{"/a.ics", "/b.ics", "/c.ics"}},
		{CalDavHomeSetPath, "0", nil},
		{CalDavUserPrincipalPath, "1", nil},
		{CalDavUserPrincipalPath, "infinity", []string{"/a.ics", "/b.ics", "/c.ics"}},
	} {
		header := map[string]string{"Content-Type": "application/xml"}
		if "" != test.depth {
			header["Depth"] = test.depth
		}
		response := davTestRequest(calDAV, "REPORT", test.target, header, davTestQueryEvents)
		body := response.Body.String()
		if response.Code != http.StatusMultiStatus || strings.Count(body, "<response") != len(test.want) {
			t.Errorf("calendar-query on %s with Depth %q: status = %d, responses = %d, want %v; body = %s", test.target, test.depth, response.Code, strings.Count(body, "<response"), test.want, body)
			continue
		}
		for _, want := range test.want {
			if !strings.Contains(body, want+"<") {
				t.Errorf("calendar-query on %s lacks %s", test.target, want)
			}
		}
	}
}

// TestCalDAVQueryReleasesLock 验证匹配、不匹配和目标不存在的查询都不会让后续请求阻塞在存储锁上。
func TestCalDAVQueryReleasesLock(t *testing.T) {
	store := &Calendars{loaded: true}
	calendar := &Calendar{MetaData: &CalendarMetaData{Path: CalDavDefaultCalendarPath}}
	data := ical.NewCalendar()
	event := ical.NewComponent(ical.CompEvent)
	event.Props.SetText(ical.PropUID, "query-event")
	data.Children = append(data.Children, event)
	calendar.Objects.Store("event.ics", &CalendarObject{Data: &CalendarObjectData{Path: CalDavDefaultCalendarPath + "/event.ics", Data: data}})
	store.calendars.Store(CalDavDefaultCalendarPath, calendar)
	store.calendarsMetaData = []*CalendarMetaData{calendar.MetaData}
	handler := newCalDAVHandler(store)

	for _, test := range []struct {
		name, path, comp string
		status, want     int
	}{
		{"match", CalDavDefaultCalendarPath, ical.CompEvent, http.StatusMultiStatus, 1},
		{"filtered", CalDavDefaultCalendarPath, ical.CompToDo, http.StatusMultiStatus, 0},
		{"missing", CalDavDefaultCalendarPath + "/missing", ical.CompEvent, http.StatusNotFound, 0},
	} {
		t.Run(test.name, func(t *testing.T) {
			done := make(chan struct{})
			go func() {
				defer close(done)
				query := strings.Replace(davTestQueryEvents, `name="VEVENT"`, `name="`+test.comp+`"`, 1)
				response := davTestRequest(handler, "REPORT", test.path, davXMLHeader, query)
				if response.Code != test.status || strings.Count(response.Body.String(), "<response") != test.want {
					t.Errorf("query: status = %d, body = %s; want %d with %d responses", response.Code, response.Body.String(), test.status, test.want)
				}
				if _, err := store.ListCalendarObjects(CalDavDefaultCalendarPath); err != nil {
					t.Errorf("list after query: %v", err)
				}
			}()
			select {
			case <-done:
			case <-time.After(3 * time.Second):
				t.Fatal("calendar query or subsequent list deadlocked")
			}
		})
	}
}

// TestCalDAVQueryFilters 验证 calendar-query 的过滤条件：只有一端的时间区间、重复实例、提醒触发时间、
// is-not-defined、negate-condition 与排序规则（RFC 4791 §9.7、§9.9）。
func TestCalDAVQueryFilters(t *testing.T) {
	calDAV, _ := newDAVHandlerFixture(t)
	calendar := CalDavDefaultCalendarPath
	objects := map[string]string{
		"/single.ics": davTestEvent("single", "Team Meeting"),
		"/daily.ics": davCRLF("BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//SiYuan test//EN", "BEGIN:VEVENT", "UID:daily", "SUMMARY:Standup",
			"DTSTAMP:20261101T000000Z", "DTSTART:20261101T080000Z", "DTEND:20261101T081500Z", "RRULE:FREQ=DAILY;COUNT=30",
			"BEGIN:VALARM", "ACTION:DISPLAY", "TRIGGER:-PT10M", "END:VALARM", "END:VEVENT", "END:VCALENDAR"),
	}
	for name, body := range objects {
		if response := davTestRequest(calDAV, http.MethodPut, calendar+name, davICalendarHeader, body); response.Code != http.StatusCreated {
			t.Fatalf("PUT %s: status = %d; body = %s", name, response.Code, response.Body.String())
		}
	}
	query := func(filter string) string {
		return `<?xml version="1.0"?><C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:prop><D:getetag/></D:prop><C:filter><C:comp-filter name="VCALENDAR"><C:comp-filter name="VEVENT">` +
			filter + `</C:comp-filter></C:comp-filter></C:filter></C:calendar-query>`
	}
	for _, test := range []struct {
		name, filter string
		want         []string
	}{
		{"recurrence instance", `<C:time-range start="20261120T080000Z" end="20261120T090000Z"/>`, []string{"/daily.ics"}},
		{"open end", `<C:time-range start="20261102T093000Z"/>`, []string{"/daily.ics", "/single.ics"}},
		{"open start", `<C:time-range end="20261101T080001Z"/>`, []string{"/daily.ics"}},
		{"alarm defined", `<C:comp-filter name="VALARM"/>`, []string{"/daily.ics"}},
		{"alarm not defined", `<C:comp-filter name="VALARM"><C:is-not-defined/></C:comp-filter>`, []string{"/single.ics"}},
		{"alarm time", `<C:comp-filter name="VALARM"><C:time-range start="20261105T074500Z" end="20261105T075500Z"/></C:comp-filter>`, []string{"/daily.ics"}},
		{"negated text", `<C:prop-filter name="SUMMARY"><C:text-match negate-condition="yes">meeting</C:text-match></C:prop-filter>`, []string{"/daily.ics"}},
		{"octet collation", `<C:prop-filter name="SUMMARY"><C:text-match collation="i;octet">team meeting</C:text-match></C:prop-filter>`, nil},
	} {
		t.Run(test.name, func(t *testing.T) {
			response := davTestRequest(calDAV, "REPORT", calendar, davXMLHeader, query(test.filter))
			body := response.Body.String()
			if response.Code != http.StatusMultiStatus || strings.Count(body, "<response") != len(test.want) {
				t.Fatalf("status = %d, responses = %d, want %v; body = %s", response.Code, strings.Count(body, "<response"), test.want, body)
			}
			for _, want := range test.want {
				if !strings.Contains(body, want+"<") {
					t.Fatalf("result lacks %s: %s", want, body)
				}
			}
		})
	}
	for _, test := range []struct{ name, filter, condition string }{
		{"unsupported collation", `<C:prop-filter name="SUMMARY"><C:text-match collation="i;basic">x</C:text-match></C:prop-filter>`, "supported-collation"},
		{"invalid time-range", `<C:time-range/>`, "valid-filter"},
	} {
		response := davTestRequest(calDAV, "REPORT", calendar, davXMLHeader, query(test.filter))
		if response.Code != http.StatusForbidden || !strings.Contains(response.Body.String(), test.condition) {
			t.Errorf("%s: status = %d; body = %s", test.name, response.Code, response.Body.String())
		}
	}
}

// TestCalDAVCalendarDataRetrieval 验证 REPORT 中 calendar-data 的部分检索与展开（RFC 4791 §9.6），
// 以及 calendar-data 不是 WebDAV 属性、不会出现在 PROPFIND 中（RFC 4791 §9.6 Note）。
func TestCalDAVCalendarDataRetrieval(t *testing.T) {
	calDAV, _ := newDAVHandlerFixture(t)
	object := CalDavDefaultCalendarPath + "/series.ics"
	body := davCRLF("BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//SiYuan test//EN", "BEGIN:VEVENT", "UID:series", "SUMMARY:Series",
		"DTSTAMP:20261101T000000Z", "DTSTART;TZID=Asia/Shanghai:20261102T090000", "DTEND;TZID=Asia/Shanghai:20261102T100000",
		"RRULE:FREQ=DAILY;COUNT=3", "END:VEVENT", "END:VCALENDAR")
	if response := davTestRequest(calDAV, http.MethodPut, object, davICalendarHeader, body); response.Code != http.StatusCreated {
		t.Fatalf("PUT: status = %d; body = %s", response.Code, response.Body.String())
	}
	multiget := func(data string) string {
		return `<?xml version="1.0"?><C:calendar-multiget xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:prop><D:getetag/>` + data +
			`</D:prop><D:href>` + object + `</D:href></C:calendar-multiget>`
	}
	expanded := davTestRequest(calDAV, "REPORT", CalDavDefaultCalendarPath, davXMLHeader,
		multiget(`<C:calendar-data><C:expand start="20261102T000000Z" end="20261104T000000Z"/></C:calendar-data>`)).Body.String()
	for _, want := range []string{"DTSTART:20261102T010000Z", "DTSTART:20261103T010000Z", "RECURRENCE-ID:20261103T010000Z"} {
		if !strings.Contains(expanded, want) {
			t.Fatalf("expanded data lacks %s: %s", want, expanded)
		}
	}
	if strings.Contains(expanded, "RRULE") || strings.Contains(expanded, "20261104T010000Z") {
		t.Fatalf("expanded data contains the rule or an instance outside the range: %s", expanded)
	}
	partial := davTestRequest(calDAV, "REPORT", CalDavDefaultCalendarPath, davXMLHeader,
		multiget(`<C:calendar-data><C:comp name="VCALENDAR"><C:comp name="VEVENT"><C:prop name="SUMMARY"/></C:comp></C:comp></C:calendar-data>`)).Body.String()
	if !strings.Contains(partial, "SUMMARY:Series") || strings.Contains(partial, "DTSTAMP") || strings.Contains(partial, "VERSION") {
		t.Fatalf("partial retrieval: %s", partial)
	}
	full := davTestRequest(calDAV, "REPORT", CalDavDefaultCalendarPath, davXMLHeader, multiget(`<C:calendar-data/>`)).Body.String()
	if !strings.Contains(full, "RRULE:FREQ=DAILY;COUNT=3") || !strings.Contains(full, "TZID=Asia/Shanghai") {
		t.Fatalf("full calendar-data: %s", full)
	}
	for _, request := range []string{"", `<?xml version="1.0"?><D:propfind xmlns:D="DAV:"><D:allprop/></D:propfind>`} {
		if propfind := davTestRequest(calDAV, "PROPFIND", object, map[string]string{"Depth": "0"}, request).Body.String(); strings.Contains(propfind, "calendar-data") || !strings.Contains(propfind, "getetag") {
			t.Fatalf("allprop must return getetag and must not return calendar-data: %s", propfind)
		}
	}
	explicit := davTestRequest(calDAV, "PROPFIND", object, map[string]string{"Depth": "0"},
		`<?xml version="1.0"?><D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:prop><C:calendar-data/></D:prop></D:propfind>`).Body.String()
	if strings.Contains(explicit, "BEGIN:VCALENDAR") || !strings.Contains(explicit, "404 Not Found") {
		t.Fatalf("PROPFIND for calendar-data must report 404: %s", explicit)
	}
}

// TestCalDAVFreeBusyQuery 验证 free-busy-query 返回合并后的忙碌时段，且不能作用于对象（RFC 4791 §7.10）。
func TestCalDAVFreeBusyQuery(t *testing.T) {
	calDAV, _ := newDAVHandlerFixture(t)
	calendar := CalDavDefaultCalendarPath
	for uid, times := range map[string][2]string{"a": {"20261102T090000Z", "20261102T100000Z"}, "b": {"20261102T093000Z", "20261102T110000Z"}} {
		body := strings.NewReplacer("DTSTART:20261102T090000Z", "DTSTART:"+times[0], "DTEND:20261102T100000Z", "DTEND:"+times[1]).Replace(davTestEvent(uid, uid))
		if response := davTestRequest(calDAV, http.MethodPut, calendar+"/"+uid+".ics", davICalendarHeader, body); response.Code != http.StatusCreated {
			t.Fatalf("PUT %s: status = %d", uid, response.Code)
		}
	}
	query := `<?xml version="1.0"?><C:free-busy-query xmlns:C="urn:ietf:params:xml:ns:caldav"><C:time-range start="20261102T000000Z" end="20261103T000000Z"/></C:free-busy-query>`
	response := davTestRequest(calDAV, "REPORT", calendar, map[string]string{"Content-Type": "application/xml", "Depth": "1"}, query)
	body := response.Body.String()
	if response.Code != http.StatusOK || !strings.HasPrefix(response.Header().Get("Content-Type"), ical.MIMEType) ||
		!strings.Contains(body, "FREEBUSY;FBTYPE=BUSY:20261102T090000Z/20261102T110000Z\r\n") {
		t.Fatalf("free-busy-query: status = %d, content type = %s; body = %s", response.Code, response.Header().Get("Content-Type"), body)
	}
	if empty := davTestRequest(calDAV, "REPORT", calendar, davTestXMLOnly, query).Body.String(); strings.Contains(empty, "FREEBUSY;") || !strings.Contains(empty, "BEGIN:VFREEBUSY") {
		t.Fatalf("Depth 0 on a calendar must return an empty VFREEBUSY: %s", empty)
	}
	if forbidden := davTestRequest(calDAV, "REPORT", calendar+"/a.ics", davXMLHeader, query); forbidden.Code != http.StatusForbidden {
		t.Fatalf("free-busy-query on an object: status = %d", forbidden.Code)
	}
}
