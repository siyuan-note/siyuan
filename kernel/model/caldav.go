// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"bytes"
	"context"
	"errors"
	"golang.org/x/sync/errgroup"
	"io"
	"net/http"
	"os"
	"path"
	"slices"
	"strings"
	"sync"

	"github.com/siyuan-note/siyuan/kernel/util"

	"github.com/88250/gulu"
	"github.com/emersion/go-ical"
	"github.com/emersion/go-webdav"
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

	ErrorCalDavCalendarNotFound    = errors.New("CalDAV: calendar not found")
	ErrorCalDavCalendarPathInvalid = errors.New("CalDAV: calendar path is invalid")
	ErrorCalDavCalendarExists      = errors.New("CalDAV: calendar already exists")

	ErrorCalDavCalendarObjectNotFound    = errors.New("CalDAV: calendar object not found")
	ErrorCalDavCalendarObjectPathInvalid = errors.New("CalDAV: calendar object path is invalid")

	calDavReadErrorCodes = map[error]int{
		ErrorCalDavCalendarNotFound:          http.StatusNotFound,
		ErrorCalDavCalendarPathInvalid:       http.StatusNotFound,
		ErrorCalDavCalendarObjectNotFound:    http.StatusNotFound,
		ErrorCalDavCalendarObjectPathInvalid: http.StatusNotFound,
	}
	// PUT 到不存在的日历时缺少父集合（RFC 4918 §9.7.1）；对象名不合法时不允许在此创建资源
	calDavWriteErrorCodes = map[error]int{
		ErrorCalDavCalendarNotFound:          http.StatusConflict,
		ErrorCalDavCalendarPathInvalid:       http.StatusForbidden,
		ErrorCalDavCalendarObjectPathInvalid: http.StatusForbidden,
	}
)

// CalendarsMetaDataFilePath returns the absolute path of the calendars' meta data file
func CalendarsMetaDataFilePath() string {
	return DavPath2DirectoryPath(CalDavCalendarsMetaDataFilePath)
}

func GetCalDavPathDepth(urlPath string) CalDavPathDepth {
	urlPath = PathCleanWithSlash(urlPath)
	return CalDavPathDepth(len(strings.Split(urlPath, "/")) - 1)
}

// isCalDavCalendarPath 判断路径是否为 home set 下的日历集合；日历只能建在这里，目录也就只会落在 storage/caldav 下。
func isCalDavCalendarPath(calendarPath string) bool {
	return GetCalDavPathDepth(calendarPath) == calDavPathDepth_Calendar && strings.HasPrefix(calendarPath, CalDavHomeSetPath+"/")
}

// calendarWithDefaults 补齐未持久化的默认属性：旧数据没有组件集时 go-webdav 只会声明 VEVENT。
func calendarWithDefaults(calendar caldav.Calendar) caldav.Calendar {
	if 0 == len(calendar.SupportedComponentSet) {
		calendar.SupportedComponentSet = append([]string(nil), calendarSupportedComponentSet...)
	}
	return calendar
}

// GetCardDavPathDepth parses
func ParseCalendarObjectPath(objectPath string) (calendarPath string, objectID string, err error) {
	calendarPath, objectFileName := path.Split(objectPath)
	calendarPath = PathCleanWithSlash(calendarPath)
	objectID = path.Base(objectFileName)
	objectFileExt := util.Ext(objectFileName)

	if !isCalDavCalendarPath(calendarPath) {
		err = ErrorCalDavCalendarPathInvalid
		return
	}

	if objectFileExt != ICalendarFileExt {
		err = ErrorCalDavCalendarObjectPathInvalid
		return
	}

	return
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
	c.loaded = false
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
	wg := &errgroup.Group{}
	for _, calendarMetaData := range c.calendarsMetaData {
		calendar := &Calendar{
			Changed:       false,
			DirectoryPath: DavPath2DirectoryPath(calendarMetaData.Path),
			MetaData:      calendarMetaData,
			Objects:       sync.Map{},
		}
		c.calendars.Store(calendarMetaData.Path, calendar)
		wg.Go(func() error {
			return calendar.load()
		})
	}
	if err := wg.Wait(); err != nil {
		return err
	}

	c.loaded = true
	c.changed = false
	return nil
}

// save all calendars meta data
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

func (c *Calendars) GetObject(objectPath string) (calendar *Calendar, calendarObject *CalendarObject, err error) {
	calendarPath, objectID, err := ParseCalendarObjectPath(objectPath)
	if err != nil {
		logging.LogErrorf("parse calendar object path [%s] failed: %s", objectPath, err)
		return
	}

	if value, ok := c.calendars.Load(calendarPath); ok {
		calendar = value.(*Calendar)
	} else {
		err = ErrorCalDavCalendarNotFound
		return
	}

	if value, ok := calendar.Objects.Load(objectID); ok {
		calendarObject = value.(*CalendarObject)
	} else {
		err = ErrorCalDavCalendarObjectNotFound
		return
	}

	return
}

func (c *Calendars) DeleteObject(objectPath string, conditions *DAVConditions) (calendar *Calendar, calendarObject *CalendarObject, err error) {
	calendarPath, objectID, err := ParseCalendarObjectPath(objectPath)
	if err != nil {
		logging.LogErrorf("parse calendar object path [%s] failed: %s", objectPath, err)
		return
	}

	if value, ok := c.calendars.Load(calendarPath); ok {
		calendar = value.(*Calendar)
	} else {
		err = ErrorCalDavCalendarNotFound
		return
	}

	if value, loaded := calendar.Objects.Load(objectID); loaded {
		calendarObject = value.(*CalendarObject)
	} else {
		err = ErrorCalDavCalendarObjectNotFound
		return
	}

	if err = conditions.check(true, calendarObject.Data.ETag); err != nil {
		return
	}

	if err = os.Remove(calendarObject.FilePath); err != nil {
		c.loaded = false
		logging.LogErrorf("remove file [%s] failed: %s", calendarObject.FilePath, err)
		return
	}
	calendar.Objects.Delete(objectID)

	return
}

// CreateCalendar 在 home set 下创建新日历；RFC 4918 §9.3 要求 MKCOL 不能作用于已存在的资源，失败时恢复原状态。
func (c *Calendars) CreateCalendar(calendarMetaData *caldav.Calendar) (err error) {
	c.lock.Lock()
	defer c.lock.Unlock()

	if !isCalDavCalendarPath(calendarMetaData.Path) {
		return caldav.NewPreconditionError(caldav.PreconditionCalendarCollectionLocationOk)
	}
	if _, ok := c.calendars.Load(calendarMetaData.Path); ok {
		return webdav.NewHTTPError(http.StatusMethodNotAllowed, ErrorCalDavCalendarExists)
	}
	if 0 == len(calendarMetaData.SupportedComponentSet) {
		calendarMetaData.SupportedComponentSet = append([]string(nil), calendarSupportedComponentSet...)
	}

	calendar := &Calendar{
		Changed:       false,
		DirectoryPath: DavPath2DirectoryPath(calendarMetaData.Path),
		MetaData:      calendarMetaData,
		Objects:       sync.Map{},
	}
	_, statErr := os.Stat(calendar.DirectoryPath)
	createdDirectory := os.IsNotExist(statErr)
	// 目录可能因同步或中断的操作而已经存在，载入其中的对象以免之后被同名写入覆盖
	if err = calendar.load(); err != nil {
		return
	}

	c.calendars.Store(calendarMetaData.Path, calendar)
	c.calendarsMetaData = append(c.calendarsMetaData, calendarMetaData)
	if err = c.saveCalendarsMetaData(); err != nil {
		c.calendars.Delete(calendarMetaData.Path)
		c.calendarsMetaData = c.calendarsMetaData[:len(c.calendarsMetaData)-1]
		if createdDirectory {
			_ = os.Remove(calendar.DirectoryPath)
		}
		return
	}
	return
}

func (c *Calendars) ListCalendars() (calendars []caldav.Calendar, err error) {
	c.lock.Lock()
	defer c.lock.Unlock()

	for _, calendar := range c.calendarsMetaData {
		calendars = append(calendars, calendarWithDefaults(*calendar))
	}
	return
}

func (c *Calendars) GetCalendar(calendarPath string) (calendar *caldav.Calendar, err error) {
	c.lock.Lock()
	defer c.lock.Unlock()

	if value, ok := c.calendars.Load(calendarPath); ok {
		withDefaults := calendarWithDefaults(*value.(*Calendar).MetaData)
		calendar = &withDefaults
		return
	}

	err = ErrorCalDavCalendarNotFound
	return
}

func (c *Calendars) DeleteCalendar(calendarPath string, conditions *DAVConditions) (err error) {
	c.lock.Lock()
	defer c.lock.Unlock()

	value, ok := c.calendars.Load(calendarPath)
	if !ok {
		return webdav.NewHTTPError(http.StatusNotFound, ErrorCalDavCalendarNotFound)
	}
	calendar := value.(*Calendar)
	if err = conditions.check(true, ""); err != nil {
		return
	}

	// 先删除目录，失败时缓存和元数据仍与磁盘一致
	if err = os.RemoveAll(calendar.DirectoryPath); err != nil {
		c.loaded = false
		logging.LogErrorf("remove directory [%s] failed: %s", calendar.DirectoryPath, err)
		return
	}

	c.calendars.Delete(calendarPath)
	for i, item := range c.calendarsMetaData {
		if item.Path == calendarPath {
			c.calendarsMetaData = append(c.calendarsMetaData[:i], c.calendarsMetaData[i+1:]...)
			break
		}
	}

	if err = c.saveCalendarsMetaData(); err != nil {
		c.loaded = false
		return
	}

	return nil
}

func (c *Calendars) PutCalendarObject(objectPath string, calendarData *ical.Calendar, opts *caldav.PutCalendarObjectOptions) (calendarObject *caldav.CalendarObject, err error) {
	c.lock.Lock()
	defer c.lock.Unlock()

	calendarPath, objectID, err := ParseCalendarObjectPath(objectPath)
	if err != nil {
		logging.LogErrorf("parse calendar object path [%s] failed: %s", objectPath, err)
		return
	}

	var calendar *Calendar
	if value, ok := c.calendars.Load(calendarPath); ok {
		calendar = value.(*Calendar)
	} else {
		err = ErrorCalDavCalendarNotFound
		return
	}

	if opts != nil {
		etag := ""
		if value, ok := calendar.Objects.Load(objectID); ok {
			etag = value.(*CalendarObject).Data.ETag
		}
		if err = checkDAVConditions(etag, opts.IfMatch, opts.IfNoneMatch); err != nil {
			return
		}
	}

	if err = calendar.validateObject(objectID, calendarData); err != nil {
		return
	}

	// Do not mutate a cached object until its replacement is persisted.
	object := &CalendarObject{
		Changed:      true,
		FilePath:     DavPath2DirectoryPath(objectPath),
		CalendarPath: calendarPath,
		Data: &caldav.CalendarObject{
			Data: calendarData,
		},
	}

	err = object.save(true)
	if err != nil {
		c.loaded = false
		return
	}

	err = object.update()
	if err != nil {
		c.loaded = false
		return
	}

	calendar.Objects.Store(objectID, object)
	calendarObject = object.Data
	return
}

func (c *Calendars) ListCalendarObjects(calendarPath string, req *caldav.CalendarCompRequest) (calendarObjects []caldav.CalendarObject, err error) {
	c.lock.Lock()
	defer c.lock.Unlock()

	return c.listCalendarObjects(calendarPath, req)
}

// listCalendarObjects requires c.lock to be held by the caller.
func (c *Calendars) listCalendarObjects(calendarPath string, req *caldav.CalendarCompRequest) (calendarObjects []caldav.CalendarObject, err error) {
	var calendar *Calendar
	if value, ok := c.calendars.Load(calendarPath); ok {
		calendar = value.(*Calendar)
	} else {
		err = ErrorCalDavCalendarNotFound
		return
	}

	calendar.Objects.Range(func(id any, object any) bool {
		// TODO: filter calendar objects' props and comps
		calendarObjects = append(calendarObjects, *object.(*CalendarObject).Data)
		return true
	})

	return
}

func (c *Calendars) GetCalendarObject(objectPath string, req *caldav.CalendarCompRequest) (calendarObject *caldav.CalendarObject, err error) {
	c.lock.Lock()
	defer c.lock.Unlock()

	_, object, err := c.GetObject(objectPath)
	if err != nil {
		return
	}

	calendarObject = object.Data
	// TODO: filter calendar object's props and comps
	return
}

// QueryCalendarObjects 的查询范围由 Request-URI 决定（RFC 4791 §7.8）：单个对象、单个日历，或其下的全部日历。
func (c *Calendars) QueryCalendarObjects(urlPath string, query *caldav.CalendarQuery) (calendarObjects []caldav.CalendarObject, err error) {
	c.lock.Lock()
	defer c.lock.Unlock()

	switch GetCalDavPathDepth(urlPath) {
	case calDavPathDepth_Object:
		var object *CalendarObject
		if _, object, err = c.GetObject(urlPath); err != nil {
			return
		}
		calendarObjects = append(calendarObjects, *object.Data)
	case calDavPathDepth_Calendar:
		if calendarObjects, err = c.listCalendarObjects(urlPath, &query.CompRequest); err != nil {
			return
		}
	case calDavPathDepth_Root, calDavPathDepth_Principals, calDavPathDepth_UserPrincipal, calDavPathDepth_HomeSet:
		c.calendars.Range(func(calendarPath any, value any) bool {
			if strings.HasPrefix(calendarPath.(string), urlPath+"/") {
				value.(*Calendar).Objects.Range(func(id any, object any) bool {
					calendarObjects = append(calendarObjects, *object.(*CalendarObject).Data)
					return true
				})
			}
			return true
		})
	default:
		err = ErrorCalDavCalendarPathInvalid
		return
	}

	calendarObjects, err = caldav.Filter(query, calendarObjects)
	if err != nil {
		return
	}

	return
}

func (c *Calendars) DeleteCalendarObject(objectPath string, conditions *DAVConditions) (err error) {
	c.lock.Lock()
	defer c.lock.Unlock()

	_, _, err = c.DeleteObject(objectPath, conditions)
	if err != nil {
		return
	}

	return
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

	wg := &errgroup.Group{}
	for _, entry := range entries {
		if !entry.IsDir() {
			filename := entry.Name()
			ext := util.Ext(filename)
			if ext == ICalendarFileExt {
				wg.Go(func() error {
					// create & load calendar object
					calendarObjectFilePath := path.Join(c.DirectoryPath, filename)
					calendarObject := &CalendarObject{
						Changed:      false,
						FilePath:     calendarObjectFilePath,
						CalendarPath: c.MetaData.Path,
					}
					if err := calendarObject.load(); err != nil {
						return err
					}

					id := path.Base(filename)
					c.Objects.Store(id, calendarObject)
					return nil
				})
			}
		}
	}
	return wg.Wait()
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
	// 响应体是重新编码的数据，同步或手工放入的文件不一定是规范编码；无法编码时不声明长度
	if o.Data.ContentLength, err = davEncodedLength(func(w io.Writer) error { return ical.NewEncoder(w).Encode(o.Data.Data) }); err != nil {
		logging.LogWarnf("encode iCalendar [%s] failed: %s", o.FilePath, err)
		o.Data.ContentLength = 0
	}

	o.Changed = false
	return nil
}

// calendarObjectUID 返回日历对象资源的 UID；RFC 4791 §4.1 要求资源内除 VTIMEZONE 外的组件共用一个 UID。
func calendarObjectUID(data *ical.Calendar) string {
	if nil == data {
		return ""
	}
	for _, child := range data.Children {
		if ical.CompTimezone != child.Name {
			uid, _ := child.Props.Text(ical.PropUID)
			return uid
		}
	}
	return ""
}

// validateObject 检查 RFC 4791 §5.3.2.1 对新写入日历对象资源的前置条件；已有数据不受影响，只校验本次写入。
func (c *Calendar) validateObject(objectID string, data *ical.Calendar) error {
	// 编码失败（例如缺少 DTSTAMP）说明不是有效的 iCalendar 数据
	if err := ical.NewEncoder(io.Discard).Encode(data); err != nil {
		return caldav.NewPreconditionError(caldav.PreconditionValidCalendarData)
	}
	if nil != data.Props.Get(ical.PropMethod) {
		return caldav.NewPreconditionError(caldav.PreconditionValidCalendarObjectResource)
	}
	componentType, uid := "", calendarObjectUID(data)
	for _, child := range data.Children {
		if ical.CompTimezone == child.Name {
			continue
		}
		if "" == componentType {
			componentType = child.Name
		}
		childUID, _ := child.Props.Text(ical.PropUID)
		if child.Name != componentType || childUID != uid {
			return caldav.NewPreconditionError(caldav.PreconditionValidCalendarObjectResource)
		}
	}
	if "" == componentType {
		return caldav.NewPreconditionError(caldav.PreconditionValidCalendarObjectResource)
	}
	if !slices.Contains(calendarWithDefaults(*c.MetaData).SupportedComponentSet, componentType) {
		return caldav.NewPreconditionError(caldav.PreconditionSupportedCalendarComponent)
	}

	conflict := false
	c.Objects.Range(func(id any, value any) bool {
		existingUID := calendarObjectUID(value.(*CalendarObject).Data.Data)
		if id.(string) == objectID {
			conflict = "" != existingUID && existingUID != uid
		} else {
			conflict = "" != uid && existingUID == uid
		}
		return !conflict
	})
	if conflict {
		return caldav.NewPreconditionError(caldav.PreconditionNoUIDConflict)
	}
	return nil
}

// save an object to *.ics file
func (o *CalendarObject) save(force bool) error {
	if force || o.Changed {
		var objectData bytes.Buffer

		// encode data
		encoder := ical.NewEncoder(&objectData)
		if err := encoder.Encode(o.Data.Data); err != nil {
			logging.LogErrorf("encode iCalendar [%s] failed: %s", o.Data.Path, err)
			return err
		}

		// create directory
		dirPath := path.Dir(o.FilePath)
		if err := os.MkdirAll(dirPath, 0755); err != nil {
			logging.LogErrorf("create directory [%s] failed: %s", dirPath, err)
			return err
		}

		// write file
		if err := writeDAVFile(o.FilePath, objectData.Bytes(), 0755); err != nil {
			logging.LogErrorf("write file [%s] failed: %s", o.FilePath, err)
			return err
		}

		o.Changed = false
	}
	return nil
}

// update file info
func (o *CalendarObject) update() error {
	addressFileInfo, err := os.Stat(o.FilePath)
	if err != nil {
		logging.LogErrorf("get file [%s] info failed: %s", o.FilePath, err)
		return err
	}

	etag, err := FileETag(o.FilePath)
	if err != nil {
		return err
	}
	o.Data.Path = PathJoinWithSlash(o.CalendarPath, addressFileInfo.Name())
	o.Data.ModTime = addressFileInfo.ModTime()
	o.Data.ContentLength = addressFileInfo.Size()
	o.Data.ETag = etag

	return nil
}

type CalDavBackend struct{}

func (b *CalDavBackend) CurrentUserPrincipal(ctx context.Context) (string, error) {
	// logging.LogDebugf("CalDAV CurrentUserPrincipal")
	return CalDavUserPrincipalPath, nil
}

func (b *CalDavBackend) CalendarHomeSetPath(ctx context.Context) (string, error) {
	// logging.LogDebugf("CalDAV CalendarHomeSetPath")
	return CalDavHomeSetPath, nil
}

func (b *CalDavBackend) CreateCalendar(ctx context.Context, calendar *caldav.Calendar) (err error) {
	// logging.LogDebugf("CalDAV CreateCalendar -> calendar: %#v", calendar)
	calendar.Path = PathCleanWithSlash(calendar.Path)

	if err = calendars.Load(); err != nil {
		return
	}

	err = calendars.CreateCalendar(calendar)
	// logging.LogDebugf("CalDAV CreateCalendar <- err: %s", err)
	return
}

func (b *CalDavBackend) ListCalendars(ctx context.Context) (calendars_ []caldav.Calendar, err error) {
	// logging.LogDebugf("CalDAV ListCalendars")
	if err = calendars.Load(); err != nil {
		return
	}

	calendars_, err = calendars.ListCalendars()
	// logging.LogDebugf("CalDAV ListCalendars <- calendars: %#v, err: %s", calendars_, err)
	return
}

func (b *CalDavBackend) GetCalendar(ctx context.Context, calendarPath string) (calendar *caldav.Calendar, err error) {
	// logging.LogDebugf("CalDAV GetCalendar -> calendarPath: %s", calendarPath)
	calendarPath = PathCleanWithSlash(calendarPath)

	if err = calendars.Load(); err != nil {
		return
	}

	calendar, err = calendars.GetCalendar(calendarPath)
	err = davError(err, calDavReadErrorCodes)
	// logging.LogDebugf("CalDAV GetCalendar <- calendar: %#v, err: %s", calendar, err)
	return
}

func (b *CalDavBackend) DeleteCalendar(ctx context.Context, calendarPath string) (err error) {
	// logging.LogDebugf("CalDAV DeleteCalendar -> calendarPath: %s", calendarPath)
	calendarPath = PathCleanWithSlash(calendarPath)

	if err = calendars.Load(); err != nil {
		return
	}

	err = calendars.DeleteCalendar(calendarPath, davConditionsFromContext(ctx))
	// logging.LogDebugf("CalDAV DeleteCalendar <- err: %s", err)
	return
}

func (b *CalDavBackend) PutCalendarObject(ctx context.Context, objectPath string, calendar *ical.Calendar, opts *caldav.PutCalendarObjectOptions) (calendarObject *caldav.CalendarObject, err error) {
	// logging.LogDebugf("CalDAV PutCalendarObject -> objectPath: %s, opts: %#v", objectPath, opts)
	objectPath = PathCleanWithSlash(objectPath)

	if err = calendars.Load(); err != nil {
		return
	}

	calendarObject, err = calendars.PutCalendarObject(objectPath, calendar, opts)
	if err != nil {
		return nil, davError(err, calDavWriteErrorCodes)
	}
	// logging.LogDebugf("CalDAV PutCalendarObject <- calendarObject: %#v, err: %s", calendarObject, err)
	return calendarObjectForPutResponse(ctx, calendarObject), nil
}

// calendarObjectForPutResponse 在存储内容与提交内容不是同一字节序列时去掉 ETag，
// RFC 4791 §5.3.4 不允许此时在 PUT 响应中返回强 ETag，客户端需要重新获取。
func calendarObjectForPutResponse(ctx context.Context, calendarObject *caldav.CalendarObject) *caldav.CalendarObject {
	request := davRequestFromContext(ctx)
	if nil == request || nil == request.Body {
		return calendarObject
	}
	var stored bytes.Buffer
	if err := ical.NewEncoder(&stored).Encode(calendarObject.Data); err == nil && bytes.Equal(stored.Bytes(), request.Body) {
		return calendarObject
	}
	response := *calendarObject
	response.ETag = ""
	return &response
}

func (b *CalDavBackend) ListCalendarObjects(ctx context.Context, calendarPath string, req *caldav.CalendarCompRequest) (calendarObjects []caldav.CalendarObject, err error) {
	// logging.LogDebugf("CalDAV ListCalendarObjects -> calendarPath: %s, req: %#v", calendarPath, req)
	calendarPath = PathCleanWithSlash(calendarPath)

	if err = calendars.Load(); err != nil {
		return
	}

	calendarObjects, err = calendars.ListCalendarObjects(calendarPath, req)
	err = davError(err, calDavReadErrorCodes)
	// logging.LogDebugf("CalDAV ListCalendarObjects <- calendarObjects: %#v, err: %s", calendarObjects, err)
	return
}

func (b *CalDavBackend) GetCalendarObject(ctx context.Context, objectPath string, req *caldav.CalendarCompRequest) (calendarObject *caldav.CalendarObject, err error) {
	// logging.LogDebugf("CalDAV GetCalendarObject -> objectPath: %s, req: %#v", objectPath, req)
	objectPath = PathCleanWithSlash(objectPath)

	if err = calendars.Load(); err != nil {
		return
	}

	calendarObject, err = calendars.GetCalendarObject(objectPath, req)
	err = davError(err, calDavReadErrorCodes)
	// logging.LogDebugf("CalDAV GetCalendarObject <- calendarObject: %#v, err: %s", calendarObject, err)
	return
}

func (b *CalDavBackend) QueryCalendarObjects(ctx context.Context, calendarPath string, query *caldav.CalendarQuery) (calendarObjects []caldav.CalendarObject, err error) {
	// logging.LogDebugf("CalDAV QueryCalendarObjects -> calendarPath: %s, query: %#v", calendarPath, query)
	calendarPath = PathCleanWithSlash(calendarPath)

	if err = calendars.Load(); err != nil {
		return
	}

	calendarObjects, err = calendars.QueryCalendarObjects(calendarPath, query)
	err = davError(err, calDavReadErrorCodes)
	// logging.LogDebugf("CalDAV QueryCalendarObjects <- calendarObjects: %#v, err: %s", calendarObjects, err)
	return
}

// DeleteCalendarObject 处理所有层级的 DELETE：go-webdav 不区分资源类型，日历集合路径在这里转为删除日历。
func (b *CalDavBackend) DeleteCalendarObject(ctx context.Context, objectPath string) (err error) {
	// logging.LogDebugf("CalDAV DeleteCalendarObject -> objectPath: %s", objectPath)
	objectPath = PathCleanWithSlash(objectPath)

	if err = calendars.Load(); err != nil {
		return
	}

	switch depth := GetCalDavPathDepth(objectPath); {
	case calDavPathDepth_Calendar == depth:
		return calendars.DeleteCalendar(objectPath, davConditionsFromContext(ctx))
	case calDavPathDepth_Calendar > depth:
		return webdav.NewHTTPError(http.StatusForbidden, errors.New("CalDAV: cannot delete resource at given location"))
	}
	err = calendars.DeleteCalendarObject(objectPath, davConditionsFromContext(ctx))
	err = davError(err, calDavReadErrorCodes)
	// logging.LogDebugf("CalDAV DeleteCalendarObject <- err: %s", err)
	return
}
