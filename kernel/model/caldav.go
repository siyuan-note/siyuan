// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package model

import (
	"context"
	"sync"

	"github.com/emersion/go-ical"
	"github.com/emersion/go-webdav/caldav"
	"github.com/siyuan-note/logging"
)

const (
	// REF: https://developers.google.com/calendar/caldav/v2/guide
	CalDavPrefixPath          = "/caldav"
	CalDavPrincipalsPath      = CalDavPrefixPath + "/principals"       // 0 resourceTypeRoot
	CalDavUserPrincipalPath   = CalDavPrincipalsPath + "/main"         // 1 resourceTypeUserPrincipal
	CalDavHomeSetPath         = CalDavUserPrincipalPath + "/calendars" // 2 resourceTypeCalendarHomeSet
	CalDavDefaultCalendarPath = CalDavHomeSetPath + "/default"         // 3 resourceTypeCalendar

	CalDavDefaultCalendarName = "default"

	ICalendarFileExt = "." + ical.Extension // .ics
)

type CalDavPathDepth int

const (
	calDavPathDepth_Root          CalDavPathDepth = 1 + iota // /caldav
	calDavPathDepth_Principals                               // /caldav/principals
	calDavPathDepth_UserPrincipal                            // /caldav/principals/main
	calDavPathDepth_HomeSet                                  // /caldav/principals/main/calendars
	calDavPathDepth_Calendar                                 // /caldav/principals/main/calendars/default
	calDavPathDepth_Object                                   // /caldav/principals/main/calendars/default/id.ics
)

var (
	calendarMaxResourceSize       int64 = 0
	calendarSupportedComponentSet       = []string{"VEVENT", "VTODO"}

	defaultCalendar = caldav.Calendar{
		Path:                  CalDavDefaultCalendarPath,
		Name:                  CalDavDefaultCalendarName,
		Description:           "Default calendar",
		MaxResourceSize:       calendarMaxResourceSize,
		SupportedComponentSet: calendarSupportedComponentSet,
	}
	calendars = Calendars{
		loaded:            false,
		changed:           false,
		lock:              sync.Mutex{},
		calendars:         sync.Map{},
		calendarsMetaData: []*caldav.Calendar{},
	}
)

type Calendars struct {
	loaded            bool
	changed           bool
	lock              sync.Mutex // load & save
	calendars         sync.Map   // Path -> *Calendar
	calendarsMetaData []*caldav.Calendar
}

type Calendar struct {
	Changed       bool
	DirectoryPath string
	MetaData      *caldav.Calendar
	Objects       sync.Map // id -> *CalendarObject
}

type CalendarObject struct {
	Changed      bool
	FilePath     string
	CalendarPath string
	Data         *caldav.CalendarObject
}

type CalDavBackend struct{}

func (b *CalDavBackend) CurrentUserPrincipal(ctx context.Context) (string, error) {
	logging.LogDebugf("CalDAV CurrentUserPrincipal")
	return CalDavUserPrincipalPath, nil
}

func (b *CalDavBackend) CalendarHomeSetPath(ctx context.Context) (string, error) {
	logging.LogDebugf("CalDAV CalendarHomeSetPath")
	return CalDavHomeSetPath, nil
}

func (b *CalDavBackend) CreateCalendar(ctx context.Context, calendar *caldav.Calendar) (err error) {
	logging.LogDebugf("CalDAV CreateCalendar -> calendar: %#v", calendar)
	// TODO: create calendar
	return
}

func (b *CalDavBackend) ListCalendars(ctx context.Context) (calendars []caldav.Calendar, err error) {
	logging.LogDebugf("CalDAV ListCalendars")
	// TODO: list calendars
	return
}

func (b *CalDavBackend) GetCalendar(ctx context.Context, calendarPath string) (calendar *caldav.Calendar, err error) {
	logging.LogDebugf("CalDAV GetCalendar -> calendarPath: %s", calendarPath)
	// TODO: get calendar
	return
}

func (b *CalDavBackend) GetCalendarObject(ctx context.Context, calendarPath string, req *caldav.CalendarCompRequest) (calendarObjects *caldav.CalendarObject, err error) {
	logging.LogDebugf("CalDAV GetCalendarObject -> calendarPath: %s, req: %#v", calendarPath, req)
	// TODO: get calendar object
	return
}

func (b *CalDavBackend) ListCalendarObjects(ctx context.Context, calendarPath string, req *caldav.CalendarCompRequest) (calendarObjects []caldav.CalendarObject, err error) {
	logging.LogDebugf("CalDAV ListCalendarObjects -> calendarPath: %s, req: %#v", calendarPath, req)
	// TODO: list calendar objects
	return
}

func (b *CalDavBackend) QueryCalendarObjects(ctx context.Context, calendarPath string, query *caldav.CalendarQuery) (calendarObjects []caldav.CalendarObject, err error) {
	logging.LogDebugf("CalDAV QueryCalendarObjects -> calendarPath: %s, query: %#v", calendarPath, query)
	// TODO: query calendar objects
	return
}

func (b *CalDavBackend) PutCalendarObject(ctx context.Context, calendarPath string, calendar *ical.Calendar, opts *caldav.PutCalendarObjectOptions) (calendarObject *caldav.CalendarObject, err error) {
	logging.LogDebugf("CalDAV PutCalendarObject -> calendarPath: %s, opts: %#v", calendarPath, opts)
	// TODO: put calendar object
	return
}

func (b *CalDavBackend) DeleteCalendarObject(ctx context.Context, calendarPath string) (err error) {
	logging.LogDebugf("CalDAV DeleteCalendarObject -> calendarPath: %s", calendarPath)
	// TODO: delete calendar object
	return
}
