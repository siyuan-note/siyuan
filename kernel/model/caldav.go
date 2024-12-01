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
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"path"
	"sync"

	"github.com/88250/gulu"
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

	CalDavCalendarsMetaDataFilePath = CalDavHomeSetPath + "/calendars.json"

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

	ErrorCalDavPathInvalid = errors.New("CalDAV: path is invalid")

	ErrorCalDavCalendarNotFound    = errors.New("CalDAV: calendar not found")
	ErrorCalDavCalendarPathInvalid = errors.New("CalDAV: calendar path is invalid")

	ErrorCalDavCalendarObjectNotFound    = errors.New("CalDAV: calendar object not found")
	ErrorCalDavCalendarObjectPathInvalid = errors.New("CalDAV: calendar object path is invalid")
)

// CalendarsMetaDataFilePath returns the absolute path of the calendars' meta data file
func CalendarsMetaDataFilePath() string {
	return DavPath2DirectoryPath(CalDavCalendarsMetaDataFilePath)
}

// LoadCalendarObject loads a iCalendar file (*.ics)
func LoadCalendarObject(filePath string) (calendar *ical.Calendar, err error) {
	data, err := os.ReadFile(filePath)
	if err != nil {
		logging.LogErrorf("read iCalendar file [%s] failed: %s", filePath, err)
		return
	}

	decoder := ical.NewDecoder(bytes.NewReader(data))
	calendar, err = decoder.Decode()
	return
}

type Calendars struct {
	loaded            bool
	changed           bool
	lock              sync.Mutex // load & save
	calendars         sync.Map   // Path -> *Calendar
	calendarsMetaData []*caldav.Calendar
}

func (c *Calendars) load() error {
	c.calendars.Clear()

	// load calendars meta data file
	calendarsMetaDataFilePath := CalendarsMetaDataFilePath()
	metaData, err := os.ReadFile(calendarsMetaDataFilePath)
	if os.IsNotExist(err) {
		// create & save default calendar
		c.calendarsMetaData = []*caldav.Calendar{&defaultCalendar}
		if err := c.saveCalendarsMetaData(); err != nil {
			return err
		}
	} else {
		// load meta data file
		c.calendarsMetaData = []*caldav.Calendar{}
		if err = gulu.JSON.UnmarshalJSON(metaData, &c.calendarsMetaData); err != nil {
			logging.LogErrorf("unmarshal address books meta data failed: %s", err)
			return err
		}
	}

	// load iCalendar files (*.ics)
	wg := &sync.WaitGroup{}
	wg.Add(len(c.calendarsMetaData))
	for _, calendarMetaData := range c.calendarsMetaData {
		calendar := &Calendar{
			Changed:       false,
			DirectoryPath: DavPath2DirectoryPath(calendarMetaData.Path),
			MetaData:      calendarMetaData,
			Objects:       sync.Map{},
		}
		c.calendars.Store(calendarMetaData.Path, calendar)
		go func() {
			defer wg.Done()
			calendar.load()
		}()
	}
	wg.Wait()

	c.loaded = true
	c.changed = false
	return nil
}

// save all calendars
func (c *Calendars) saveCalendarsMetaData() error {
	return SaveMetaData(c.calendarsMetaData, CalendarsMetaDataFilePath())
}

func (c *Calendars) Load() error {
	c.lock.Lock()
	defer c.lock.Unlock()

	if !c.loaded {
		return c.load()
	}
	return nil
}

func (c *Calendars) CreateCalendar(calendarMetaData *caldav.Calendar) (err error) {
	c.lock.Lock()
	defer c.lock.Unlock()

	var calendar *Calendar

	// update map
	if value, ok := c.calendars.Load(calendarMetaData.Path); ok {
		// update map item
		calendar = value.(*Calendar)
		calendar.MetaData = calendarMetaData
	} else {
		// insert map item
		calendar = &Calendar{
			Changed:       false,
			DirectoryPath: DavPath2DirectoryPath(calendarMetaData.Path),
			MetaData:      calendarMetaData,
			Objects:       sync.Map{},
		}
		c.calendars.Store(calendarMetaData.Path, calendar)
	}

	var index = -1
	for i, item := range c.calendarsMetaData {
		if item.Path == calendarMetaData.Path {
			index = i
			break
		}
	}

	if index >= 0 {
		// update list
		c.calendarsMetaData[index] = calendarMetaData
	} else {
		// insert list
		c.calendarsMetaData = append(c.calendarsMetaData, calendarMetaData)
	}

	// create calendar directory
	if err = os.MkdirAll(calendar.DirectoryPath, 0755); err != nil {
		logging.LogErrorf("create directory [%s] failed: %s", calendar.DirectoryPath, err)
		return
	}

	// save meta data
	if err = c.saveCalendarsMetaData(); err != nil {
		return
	}

	return
}

func (c *Calendars) ListCalendars() (calendars []caldav.Calendar, err error) {
	c.lock.Lock()
	defer c.lock.Unlock()

	for _, calendar := range c.calendarsMetaData {
		calendars = append(calendars, *calendar)
	}
	return
}

func (c *Calendars) GetCalendar(calendarPath string) (calendar *caldav.Calendar, err error) {
	c.lock.Lock()
	defer c.lock.Unlock()

	if value, ok := calendars.calendars.Load(calendarPath); ok {
		calendar = value.(*Calendar).MetaData
		return
	}

	err = ErrorCalDavCalendarNotFound
	return
}

func (c *Calendars) DeleteCalendar(calendarPath string) (err error) {
	c.lock.Lock()
	defer c.lock.Unlock()

	var calendar *Calendar

	// delete map item
	if value, loaded := c.calendars.LoadAndDelete(calendarPath); loaded {
		calendar = value.(*Calendar)
	}

	// delete list item
	for i, item := range c.calendarsMetaData {
		if item.Path == calendarPath {
			c.calendarsMetaData = append(c.calendarsMetaData[:i], c.calendarsMetaData[i+1:]...)
			break
		}
	}

	// remove address book directory
	if err = os.RemoveAll(calendar.DirectoryPath); err != nil {
		logging.LogErrorf("remove directory [%s] failed: %s", calendar.DirectoryPath, err)
		return
	}

	// save meta data
	if err = c.saveCalendarsMetaData(); err != nil {
		return
	}

	return nil
}

type Calendar struct {
	Changed       bool
	DirectoryPath string
	MetaData      *caldav.Calendar
	Objects       sync.Map // id -> *CalendarObject
}

func (c *Calendar) load() error {
	if err := os.MkdirAll(c.DirectoryPath, 0755); err != nil {
		logging.LogErrorf("create directory [%s] failed: %s", c.DirectoryPath, err)
		return err
	}

	entries, err := os.ReadDir(c.DirectoryPath)
	if err != nil {
		logging.LogErrorf("read dir [%s] failed: %s", c.DirectoryPath, err)
		return err
	}

	wg := &sync.WaitGroup{}
	for _, entry := range entries {
		if !entry.IsDir() {
			filename := entry.Name()
			ext := path.Ext(filename)
			if ext == ICalendarFileExt {
				wg.Add(1)
				go func() {
					defer wg.Done()

					// create & load calendar object
					calendarObjectFilePath := path.Join(c.DirectoryPath, filename)
					calendarObject := &CalendarObject{
						Changed:      false,
						FilePath:     calendarObjectFilePath,
						CalendarPath: c.MetaData.Path,
					}
					err = calendarObject.load()
					if err != nil {
						return
					}

					id := path.Base(filename)
					c.Objects.Store(id, calendarObject)
				}()
			}
		}
	}
	wg.Wait()
	return nil
}

type CalendarObject struct {
	Changed      bool
	FilePath     string
	CalendarPath string
	Data         *caldav.CalendarObject
}

func (o *CalendarObject) load() error {
	// load iCalendar file
	calendarObjectData, err := LoadCalendarObject(o.FilePath)
	if err != nil {
		return err
	}

	// create address object
	o.Data = &caldav.CalendarObject{
		Data: calendarObjectData,
	}

	// update file info
	err = o.update()
	if err != nil {
		return err
	}

	o.Changed = false
	return nil
}

// update file info
func (o *CalendarObject) update() error {
	addressFileInfo, err := os.Stat(o.FilePath)
	if err != nil {
		logging.LogErrorf("get file [%s] info failed: %s", o.FilePath, err)
		return err
	}

	o.Data.Path = PathJoinWithSlash(o.CalendarPath, addressFileInfo.Name())
	o.Data.ModTime = addressFileInfo.ModTime()
	o.Data.ContentLength = addressFileInfo.Size()
	o.Data.ETag = fmt.Sprintf("%x-%x", addressFileInfo.ModTime(), addressFileInfo.Size())

	return nil
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
	if err = calendars.Load(); err != nil {
		return
	}

	err = calendars.CreateCalendar(calendar)
	logging.LogDebugf("CalDAV CreateCalendar <- err: %s", err)
	return
}

func (b *CalDavBackend) ListCalendars(ctx context.Context) (calendars_ []caldav.Calendar, err error) {
	logging.LogDebugf("CalDAV ListCalendars")
	if err = calendars.Load(); err != nil {
		return
	}

	calendars_, err = calendars.ListCalendars()
	logging.LogDebugf("CalDAV ListCalendars <- calendars: %#v, err: %s", calendars_, err)
	return
}

func (b *CalDavBackend) GetCalendar(ctx context.Context, calendarPath string) (calendar *caldav.Calendar, err error) {
	logging.LogDebugf("CalDAV GetCalendar -> calendarPath: %s", calendarPath)
	if err = calendars.Load(); err != nil {
		return
	}

	calendar, err = calendars.GetCalendar(calendarPath)
	logging.LogDebugf("CalDAV GetCalendar <- calendar: %#v, err: %s", calendar, err)
	return
}

func (b *CalDavBackend) DeleteCalendar(ctx context.Context, calendarPath string) (err error) {
	logging.LogDebugf("CalDAV DeleteCalendar -> calendarPath: %s", calendarPath)
	if err = calendars.Load(); err != nil {
		return
	}

	err = calendars.DeleteCalendar(calendarPath)
	logging.LogDebugf("CalDAV DeleteCalendar <- err: %s", err)
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
