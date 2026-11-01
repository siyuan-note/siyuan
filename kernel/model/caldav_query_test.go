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
	"github.com/emersion/go-webdav/caldav"
)

// TestCalDAVQueryScope 验证 calendar-query 的范围由 Request-URI 决定：单个对象、单个日历，
// 或 home set 下的全部日历（RFC 4791 §7.8）。
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
	query := `<?xml version="1.0"?><C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:prop><D:getetag/></D:prop><C:filter><C:comp-filter name="VCALENDAR"><C:comp-filter name="VEVENT"/></C:comp-filter></C:filter></C:calendar-query>`
	for _, test := range []struct {
		target string
		want   []string
	}{
		{CalDavDefaultCalendarPath + "/a.ics", []string{"/a.ics"}},
		{CalDavDefaultCalendarPath, []string{"/a.ics", "/b.ics"}},
		{CalDavHomeSetPath, []string{"/a.ics", "/b.ics", "/c.ics"}},
	} {
		response := davTestRequest(calDAV, "REPORT", test.target, davXMLHeader, query)
		body := response.Body.String()
		if response.Code != http.StatusMultiStatus || strings.Count(body, "<response") != len(test.want) {
			t.Errorf("calendar-query on %s: status = %d, responses = %d, want %v; body = %s", test.target, response.Code, strings.Count(body, "<response"), test.want, body)
			continue
		}
		for _, want := range test.want {
			if !strings.Contains(body, want+"<") {
				t.Errorf("calendar-query on %s lacks %s", test.target, want)
			}
		}
	}
}

func TestCalDAVQueryReleasesLock(t *testing.T) {
	store := &Calendars{}
	calendar := &Calendar{}
	data := ical.NewCalendar()
	event := ical.NewComponent(ical.CompEvent)
	event.Props.SetText(ical.PropUID, "query-event")
	data.Children = append(data.Children, event)
	calendar.Objects.Store("event.ics", &CalendarObject{Data: &caldav.CalendarObject{Data: data}})
	store.calendars.Store(CalDavDefaultCalendarPath, calendar)

	for _, test := range []struct {
		name, path, comp string
		want             int
		wantErr          bool
	}{
		{"match", CalDavDefaultCalendarPath, ical.CompEvent, 1, false},
		{"filtered", CalDavDefaultCalendarPath, ical.CompToDo, 0, false},
		{"missing", CalDavDefaultCalendarPath + "/missing", ical.CompEvent, 0, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			done := make(chan struct{})
			go func() {
				defer close(done)
				query := &caldav.CalendarQuery{CompFilter: caldav.CompFilter{
					Name: ical.CompCalendar, Comps: []caldav.CompFilter{{Name: test.comp}},
				}}
				objects, err := store.QueryCalendarObjects(test.path, query)
				if (err != nil) != test.wantErr || len(objects) != test.want {
					t.Errorf("query returned %d objects, %v; want %d, error=%v", len(objects), err, test.want, test.wantErr)
				}
				if _, err = store.ListCalendarObjects(CalDavDefaultCalendarPath, nil); err != nil {
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
