// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"testing"
	"time"

	"github.com/emersion/go-ical"
	"github.com/emersion/go-webdav/caldav"
)

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
