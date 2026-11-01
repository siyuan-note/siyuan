// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"bytes"
	"encoding/xml"
	"errors"
	"golang.org/x/sync/errgroup"
	"io"
	"net/http"
	"os"
	"path"
	"slices"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/siyuan-note/siyuan/kernel/util"

	"github.com/88250/gulu"
	"github.com/emersion/go-ical"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/dav"
)

const (
	// REF: https://developers.google.com/calendar/caldav/v2/guide
	CalDavPrefixPath          = "/caldav"
	CalDavPrincipalsPath      = CalDavPrefixPath + "/principals"       // 0 resourceTypeRoot
	CalDavUserPrincipalPath   = CalDavPrincipalsPath + "/main"         // 1 resourceTypeUserPrincipal
	CalDavHomeSetPath         = CalDavUserPrincipalPath + "/calendars" // 2 resourceTypeCalendarHomeSet
	CalDavDefaultCalendarPath = CalDavHomeSetPath + "/default"         // 3 resourceTypeCalendar

	CalDavDefaultCalendarName = "default"

	CalDavCalendarsMetaDataFilePath   = CalDavHomeSetPath + "/calendars.json"
	CalDavCalendarsPropertiesFilePath = CalDavHomeSetPath + "/properties.json"

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

// CalendarMetaData 是 calendars.json 中一个日历的元数据。早期版本直接序列化 go-webdav 的 caldav.Calendar，
// 文件经数据同步在设备间共享，字段名和 JSON 结构必须与之保持一致。
type CalendarMetaData struct {
	Path                  string
	Name                  string
	Description           string
	MaxResourceSize       int64
	SupportedComponentSet []string
}

var (
	calendarMaxResourceSize       int64 = 0
	calendarSupportedComponentSet       = []string{ical.CompEvent, ical.CompToDo}
	// MKCALENDAR 与 PROPPATCH 可以声明的组件类型
	calendarAllowedComponents = []string{ical.CompEvent, ical.CompToDo, ical.CompJournal}

	defaultCalendar = CalendarMetaData{
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
		calendarsMetaData: []*CalendarMetaData{},
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

// CalendarsPropertiesFilePath 返回日历死属性文件的绝对路径。
func CalendarsPropertiesFilePath() string {
	return DavPath2DirectoryPath(CalDavCalendarsPropertiesFilePath)
}

func GetCalDavPathDepth(urlPath string) CalDavPathDepth {
	urlPath = PathCleanWithSlash(urlPath)
	return CalDavPathDepth(len(strings.Split(urlPath, "/")) - 1)
}

// isCalDavCalendarPath 判断路径是否为 home set 下的日历集合；日历只能建在这里，目录也就只会落在 storage/caldav 下。
func isCalDavCalendarPath(calendarPath string) bool {
	return GetCalDavPathDepth(calendarPath) == calDavPathDepth_Calendar && strings.HasPrefix(calendarPath, CalDavHomeSetPath+"/")
}

// calendarWithDefaults 补齐未持久化的默认属性：旧数据没有组件集时按默认的事件与待办处理。
func calendarWithDefaults(calendar CalendarMetaData) CalendarMetaData {
	if 0 == len(calendar.SupportedComponentSet) {
		calendar.SupportedComponentSet = slices.Clone(calendarSupportedComponentSet)
	} else {
		calendar.SupportedComponentSet = slices.Clone(calendar.SupportedComponentSet)
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

type Calendars struct {
	loaded            bool
	changed           bool
	lock              sync.Mutex // load & save
	calendars         sync.Map   // Path -> *Calendar
	calendarsMetaData []*CalendarMetaData
	properties        map[string][]*dav.Node // Path -> 死属性
}

func (c *Calendars) load() error {
	c.loaded = false
	c.calendars.Clear()

	// load calendars meta data file
	calendarsMetaDataFilePath := CalendarsMetaDataFilePath()
	metaData, err := os.ReadFile(calendarsMetaDataFilePath)
	if os.IsNotExist(err) {
		// create & save default calendar
		calendar := calendarWithDefaults(defaultCalendar)
		c.calendarsMetaData = []*CalendarMetaData{&calendar}
		if err := c.saveCalendarsMetaData(); err != nil {
			return err
		}
	} else {
		// load meta data file
		c.calendarsMetaData = []*CalendarMetaData{}
		if err = gulu.JSON.UnmarshalJSON(metaData, &c.calendarsMetaData); err != nil {
			logging.LogErrorf("unmarshal address books meta data failed: %s", err)
			return err
		}
	}
	if c.properties, err = loadDAVDeadProperties(CalendarsPropertiesFilePath()); err != nil {
		return err
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

// CreateCalendar 在 home set 下创建新日历并保存它的死属性；RFC 4918 §9.3 要求 MKCOL 不能作用于已存在的资源，
// RFC 4791 §5.3.1 要求失败时恢复原状态。
func (c *Calendars) CreateCalendar(calendarMetaData *CalendarMetaData, properties []*dav.Node) (err error) {
	c.lock.Lock()
	defer c.lock.Unlock()

	if !isCalDavCalendarPath(calendarMetaData.Path) || CalDavCalendarsMetaDataFilePath == calendarMetaData.Path || CalDavCalendarsPropertiesFilePath == calendarMetaData.Path {
		return dav.NewConditionError(http.StatusForbidden, dav.NewElement(dav.CalDAVName("calendar-collection-location-ok")))
	}
	if _, ok := c.calendars.Load(calendarMetaData.Path); ok {
		return dav.NewError(http.StatusMethodNotAllowed, ErrorCalDavCalendarExists)
	}
	if 0 == len(calendarMetaData.SupportedComponentSet) {
		calendarMetaData.SupportedComponentSet = slices.Clone(calendarSupportedComponentSet)
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
	if nil == c.properties {
		c.properties = map[string][]*dav.Node{}
	}
	previousProperties, hadProperties := c.properties[calendarMetaData.Path]
	if 0 < len(properties) {
		c.properties[calendarMetaData.Path] = properties
	} else {
		delete(c.properties, calendarMetaData.Path)
	}
	if err = c.saveCalendarsMetaData(); err == nil {
		if err = saveDAVDeadProperties(c.properties, CalendarsPropertiesFilePath()); err != nil {
			c.loaded = false
		}
	}
	if err != nil {
		c.calendars.Delete(calendarMetaData.Path)
		c.calendarsMetaData = c.calendarsMetaData[:len(c.calendarsMetaData)-1]
		if hadProperties {
			c.properties[calendarMetaData.Path] = previousProperties
		} else {
			delete(c.properties, calendarMetaData.Path)
		}
		if createdDirectory {
			_ = os.Remove(calendar.DirectoryPath)
		}
		return
	}
	return
}

// UpdateCalendar 在持有锁时修改日历的元数据和死属性；update 返回错误时不做任何修改，保存失败时恢复内存状态。
func (c *Calendars) UpdateCalendar(calendarPath string, update func(metaData *CalendarMetaData, properties *[]*dav.Node) error) error {
	c.lock.Lock()
	defer c.lock.Unlock()

	value, ok := c.calendars.Load(calendarPath)
	if !ok {
		return dav.NewError(http.StatusNotFound, ErrorCalDavCalendarNotFound)
	}
	calendar := value.(*Calendar)
	metaData := calendarWithDefaults(*calendar.MetaData)
	if 0 == len(calendar.MetaData.SupportedComponentSet) {
		// 旧数据没有组件集时不写入默认值，保持文件原样
		metaData.SupportedComponentSet = nil
	}
	properties := cloneDAVNodes(c.properties[calendarPath])
	if err := update(&metaData, &properties); err != nil {
		return err
	}

	previousMetaData, previousProperties := *calendar.MetaData, c.properties[calendarPath]
	metaDataChanged := previousMetaData.Name != metaData.Name || previousMetaData.Description != metaData.Description ||
		!slices.Equal(previousMetaData.SupportedComponentSet, metaData.SupportedComponentSet)
	propertiesChanged := !sameDAVNodes(previousProperties, properties)
	if nil == c.properties {
		c.properties = map[string][]*dav.Node{}
	}
	*calendar.MetaData = metaData
	if 0 < len(properties) {
		c.properties[calendarPath] = properties
	} else {
		delete(c.properties, calendarPath)
	}
	var err error
	if metaDataChanged {
		err = c.saveCalendarsMetaData()
	}
	if err == nil && propertiesChanged {
		err = saveDAVDeadProperties(c.properties, CalendarsPropertiesFilePath())
	}
	if err != nil {
		*calendar.MetaData = previousMetaData
		c.properties[calendarPath] = previousProperties
		c.loaded = false
	}
	return err
}

func (c *Calendars) ListCalendars() (calendars []CalendarMetaData, err error) {
	c.lock.Lock()
	defer c.lock.Unlock()

	for _, calendar := range c.calendarsMetaData {
		calendars = append(calendars, calendarWithDefaults(*calendar))
	}
	return
}

func (c *Calendars) GetCalendar(calendarPath string) (calendar *CalendarMetaData, err error) {
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

// CalendarProperties 返回日历死属性的副本。
func (c *Calendars) CalendarProperties(calendarPath string) []*dav.Node {
	c.lock.Lock()
	defer c.lock.Unlock()

	return cloneDAVNodes(c.properties[calendarPath])
}

func (c *Calendars) DeleteCalendar(calendarPath string, conditions *DAVConditions) (err error) {
	c.lock.Lock()
	defer c.lock.Unlock()

	value, ok := c.calendars.Load(calendarPath)
	if !ok {
		return dav.NewError(http.StatusNotFound, ErrorCalDavCalendarNotFound)
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
	if _, ok = c.properties[calendarPath]; ok {
		delete(c.properties, calendarPath)
		if err = saveDAVDeadProperties(c.properties, CalendarsPropertiesFilePath()); err != nil {
			c.loaded = false
			return
		}
	}

	return nil
}

// PutCalendarObject 写入日历对象；created 表示请求前该资源不存在（RFC 9110 §9.3.4 据此区分 201 与 204）。
func (c *Calendars) PutCalendarObject(objectPath string, calendarData *ical.Calendar, conditions *DAVConditions) (calendarObject *CalendarObjectData, created bool, err error) {
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

	etag := ""
	if value, ok := calendar.Objects.Load(objectID); ok {
		etag = value.(*CalendarObject).Data.ETag
	}
	if err = conditions.check("" != etag, etag); err != nil {
		return
	}

	if err = calendar.validateObject(objectPath, objectID, calendarData); err != nil {
		return
	}

	// Do not mutate a cached object until its replacement is persisted.
	object := &CalendarObject{
		Changed:      true,
		FilePath:     DavPath2DirectoryPath(objectPath),
		CalendarPath: calendarPath,
		Data: &CalendarObjectData{
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
	return object.Data, "" == etag, nil
}

// ListCalendarObjects 返回日历中的全部对象，按路径排序。
func (c *Calendars) ListCalendarObjects(calendarPath string) (calendarObjects []*CalendarObjectData, err error) {
	c.lock.Lock()
	defer c.lock.Unlock()

	var calendar *Calendar
	if value, ok := c.calendars.Load(calendarPath); ok {
		calendar = value.(*Calendar)
	} else {
		err = ErrorCalDavCalendarNotFound
		return
	}

	calendar.Objects.Range(func(id any, object any) bool {
		calendarObjects = append(calendarObjects, object.(*CalendarObject).Data)
		return true
	})
	sort.Slice(calendarObjects, func(i, j int) bool { return calendarObjects[i].Path < calendarObjects[j].Path })
	return
}

func (c *Calendars) GetCalendarObject(objectPath string) (calendarObject *CalendarObjectData, err error) {
	c.lock.Lock()
	defer c.lock.Unlock()

	_, object, err := c.GetObject(objectPath)
	if err != nil {
		return
	}
	return object.Data, nil
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
	MetaData      *CalendarMetaData
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
	Data         *CalendarObjectData
}

// CalendarObjectData 是日历对象资源的当前表示。
type CalendarObjectData struct {
	Path    string
	ModTime time.Time
	ETag    string
	// Content 是持久化文件的原始字节，GET 与完整的 calendar-data 原样返回，ETag 也由它计算
	Content []byte
	Data    *ical.Calendar
}

func (o *CalendarObject) load() error {
	o.Data = &CalendarObjectData{}
	if err := o.update(); err != nil {
		return err
	}

	data, err := ical.NewDecoder(bytes.NewReader(o.Data.Content)).Decode()
	if err != nil {
		logging.LogErrorf("decode iCalendar file [%s] failed: %s", o.FilePath, err)
		return err
	}
	o.Data.Data = data
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

func calDAVPrecondition(name string, children ...*dav.Node) error {
	return dav.NewConditionError(http.StatusConflict, dav.NewElement(dav.CalDAVName(name), children...))
}

// validateObject 检查 RFC 4791 §5.3.2.1 对新写入日历对象资源的前置条件；已有数据不受影响，只校验本次写入。
func (c *Calendar) validateObject(objectPath, objectID string, data *ical.Calendar) error {
	// 编码失败（例如缺少 DTSTAMP）说明不是有效的 iCalendar 数据
	if err := ical.NewEncoder(io.Discard).Encode(data); err != nil {
		return calDAVPrecondition("valid-calendar-data")
	}
	if nil != data.Props.Get(ical.PropMethod) {
		return calDAVPrecondition("valid-calendar-object-resource")
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
			return calDAVPrecondition("valid-calendar-object-resource")
		}
	}
	if "" == componentType {
		return calDAVPrecondition("valid-calendar-object-resource")
	}
	if !slices.Contains(calendarWithDefaults(*c.MetaData).SupportedComponentSet, componentType) {
		return calDAVPrecondition("supported-calendar-component")
	}

	conflict := ""
	c.Objects.Range(func(id any, value any) bool {
		object := value.(*CalendarObject)
		existingUID := calendarObjectUID(object.Data.Data)
		if id.(string) == objectID {
			if "" != existingUID && existingUID != uid {
				conflict = objectPath
			}
		} else if "" != uid && existingUID == uid {
			conflict = object.Data.Path
		}
		return "" == conflict
	})
	if "" != conflict {
		// RFC 4791 §5.3.2.1 要求在条件元素中给出已使用该 UID 的资源
		return calDAVPrecondition("no-uid-conflict", dav.HrefNode(conflict))
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

// update 从磁盘重新读取对象的字节、修改时间和 ETag
func (o *CalendarObject) update() error {
	fileInfo, err := os.Stat(o.FilePath)
	if err != nil {
		logging.LogErrorf("get file [%s] info failed: %s", o.FilePath, err)
		return err
	}
	content, err := os.ReadFile(o.FilePath)
	if err != nil {
		logging.LogErrorf("read iCalendar file [%s] failed: %s", o.FilePath, err)
		return err
	}

	o.Data.Path = PathJoinWithSlash(o.CalendarPath, fileInfo.Name())
	o.Data.ModTime = fileInfo.ModTime()
	o.Data.Content = content
	o.Data.ETag = davContentETag(content)
	return nil
}

var calDAVConfig = &davConfig{
	namespace:  dav.NamespaceCalDAV,
	capability: "calendar-access",
	wellKnown:  "caldav",

	prefix:     CalDavPrefixPath,
	principals: CalDavPrincipalsPath,
	principal:  CalDavUserPrincipalPath,
	homeSet:    CalDavHomeSetPath,

	homeSetProp:      dav.CalDAVName("calendar-home-set"),
	collectionType:   dav.CalDAVName("calendar"),
	descriptionProp:  dav.CalDAVName("calendar-description"),
	componentSetProp: dav.CalDAVName("supported-calendar-component-set"),
	dataProp:         dav.CalDAVName("calendar-data"),

	queryReport:       dav.CalDAVName("calendar-query"),
	multigetReport:    dav.CalDAVName("calendar-multiget"),
	collectionReports: []xml.Name{dav.CalDAVName("free-busy-query")},

	mimeType:          ical.MIMEType,
	contentCondition:  "supported-calendar-data",
	locationCondition: "calendar-collection-location-ok",
	mkcalendar:        true,
	privileges:        []xml.Name{dav.CalDAVName("read-free-busy")},
	protected: []xml.Name{dav.CalDAVName("supported-calendar-data"), dav.CalDAVName("min-date-time"), dav.CalDAVName("max-date-time"),
		dav.CalDAVName("max-instances"), dav.CalDAVName("max-attendees-per-instance")},
}

// calDAVService 把日历存储接入通用 DAV 处理器。
type calDAVService struct {
	store *Calendars
}

func (s *calDAVService) load() error {
	return s.store.Load()
}

func calendarCollection(metaData CalendarMetaData, properties []*dav.Node) *davCollection {
	return &davCollection{path: metaData.Path, maxResourceSize: metaData.MaxResourceSize, state: davCollectionState{
		name: metaData.Name, description: metaData.Description, components: metaData.SupportedComponentSet, properties: properties,
	}}
}

func calendarDAVObject(data *CalendarObjectData) *davObject {
	return &davObject{path: data.Path, etag: data.ETag, modTime: data.ModTime, content: data.Content, calendar: data.Data}
}

func (s *calDAVService) collections() (collections []*davCollection) {
	s.store.lock.Lock()
	defer s.store.lock.Unlock()

	for _, metaData := range s.store.calendarsMetaData {
		collections = append(collections, calendarCollection(calendarWithDefaults(*metaData), cloneDAVNodes(s.store.properties[metaData.Path])))
	}
	return
}

func (s *calDAVService) collection(p string) *davCollection {
	s.store.lock.Lock()
	defer s.store.lock.Unlock()

	value, ok := s.store.calendars.Load(p)
	if !ok {
		return nil
	}
	return calendarCollection(calendarWithDefaults(*value.(*Calendar).MetaData), cloneDAVNodes(s.store.properties[p]))
}

func (s *calDAVService) objects(collectionPath string) (objects []*davObject) {
	list, _ := s.store.ListCalendarObjects(collectionPath)
	for _, data := range list {
		objects = append(objects, calendarDAVObject(data))
	}
	return
}

func (s *calDAVService) object(p string) *davObject {
	data, err := s.store.GetCalendarObject(p)
	if err != nil {
		return nil
	}
	return calendarDAVObject(data)
}

func (s *calDAVService) collectionProps(collection *davCollection) []davProp {
	dataName, componentsName := dav.CalDAVName("supported-calendar-data"), dav.CalDAVName("supported-calendar-component-set")
	return []davProp{
		{name: dataName, allprop: true, value: func() *dav.Node {
			return dav.NewElement(dataName, dav.NewElement(dav.CalDAVName("calendar-data")).WithAttr("content-type", ical.MIMEType).WithAttr("version", "2.0"))
		}},
		{name: componentsName, allprop: true, value: func() *dav.Node {
			node := dav.NewElement(componentsName)
			for _, component := range collection.state.components {
				node.Append(dav.NewElement(dav.CalDAVName("comp")).WithAttr("name", component))
			}
			return node
		}},
	}
}

// calendarTimeZone 解析 CALDAV:calendar-timezone 或 CALDAV:timezone 中的 VTIMEZONE；TZID 无法识别时返回 nil 时区。
func calendarTimeZone(text string) (*time.Location, error) {
	calendar, err := ical.NewDecoder(strings.NewReader(text)).Decode()
	if err != nil {
		return nil, err
	}
	var zones []*ical.Component
	for _, child := range calendar.Children {
		if ical.CompTimezone == child.Name {
			zones = append(zones, child)
		}
	}
	if 1 != len(zones) {
		return nil, errors.New("CalDAV: time zone must contain exactly one VTIMEZONE")
	}
	tzid, _ := zones[0].Props.Text(ical.PropTimezoneID)
	if loc := dav.ResolveTimeZone(tzid); nil != loc {
		return loc, nil
	}
	location, _ := zones[0].Props.Text("X-LIC-LOCATION")
	return dav.ResolveTimeZone(location), nil
}

func (s *calDAVService) validateProperty(prop *dav.Node) error {
	if dav.CalDAVName("calendar-timezone") == prop.XMLName {
		if _, err := calendarTimeZone(prop.Text()); err != nil {
			return calDAVPrecondition("valid-calendar-data")
		}
	}
	return nil
}

func (s *calDAVService) createCollection(p string, state *davCollectionState) error {
	return s.store.CreateCalendar(&CalendarMetaData{
		Path:                  p,
		Name:                  state.name,
		Description:           state.description,
		MaxResourceSize:       calendarMaxResourceSize,
		SupportedComponentSet: state.components,
	}, state.properties)
}

func (s *calDAVService) updateCollection(p string, update func(state *davCollectionState) error) error {
	return s.store.UpdateCalendar(p, func(metaData *CalendarMetaData, properties *[]*dav.Node) error {
		state := davCollectionState{name: metaData.Name, description: metaData.Description, components: metaData.SupportedComponentSet, properties: *properties}
		if err := update(&state); err != nil {
			return err
		}
		metaData.Name, metaData.Description, *properties = state.name, state.description, state.properties
		return nil
	})
}

func (s *calDAVService) deleteCollection(p string, conditions *DAVConditions) error {
	return s.store.DeleteCalendar(p, conditions)
}

func (s *calDAVService) putObject(p string, body []byte, conditions *DAVConditions) (*davObject, bool, error) {
	data, err := ical.NewDecoder(bytes.NewReader(body)).Decode()
	if err != nil {
		return nil, false, calDAVPrecondition("valid-calendar-data")
	}
	object, created, err := s.store.PutCalendarObject(p, data, conditions)
	if err != nil {
		return nil, false, davError(err, calDavWriteErrorCodes)
	}
	return calendarDAVObject(object), created, nil
}

func (s *calDAVService) deleteObject(p string, conditions *DAVConditions) error {
	return davError(s.store.DeleteCalendarObject(p, conditions), calDavReadErrorCodes)
}

// floatingLocations 返回解析浮动时间与 DATE 值所用的时区：请求中的 CALDAV:timezone 优先，其次是日历的
// CALDAV:calendar-timezone，都没有时使用内核所在设备的时区（RFC 4791 §7.3）。结果按日历缓存。
func (s *calDAVService) floatingLocations(timezone *time.Location) func(objectPath string) *time.Location {
	cache := map[string]*time.Location{}
	return func(objectPath string) *time.Location {
		if nil != timezone {
			return timezone
		}
		calendarPath := path.Dir(objectPath)
		if loc, ok := cache[calendarPath]; ok {
			return loc
		}
		loc := time.Local
		for _, prop := range s.store.CalendarProperties(calendarPath) {
			if dav.CalDAVName("calendar-timezone") == prop.XMLName {
				if zone, err := calendarTimeZone(prop.Text()); err == nil && nil != zone {
					loc = zone
				}
			}
		}
		cache[calendarPath] = loc
		return loc
	}
}

func (s *calDAVService) dataRenderer(node *dav.Node, timezone *time.Location) (davDataRenderer, error) {
	request, err := dav.ParseCalendarDataRequest(node)
	if err != nil {
		return nil, err
	}
	floating := s.floatingLocations(timezone)
	return func(object *davObject) (string, error) {
		if request.Full() {
			return string(object.content), nil
		}
		return request.Render(object.calendar, floating(object.path)), nil
	}, nil
}

func (s *calDAVService) report(h *davHandler, w http.ResponseWriter, r *http.Request, target *davResource, root *dav.Node) (bool, error) {
	switch root.XMLName {
	case dav.CalDAVName("calendar-query"):
		return true, s.query(h, w, r, target, root)
	case dav.CalDAVName("free-busy-query"):
		return true, s.freeBusy(h, w, r, target, root)
	}
	return false, nil
}

// query 处理 CALDAV:calendar-query（RFC 4791 §7.8），没有 Depth 头时按 0 处理。
func (s *calDAVService) query(h *davHandler, w http.ResponseWriter, r *http.Request, target *davResource, root *dav.Node) error {
	depth, err := dav.ParseDepth(r.Header.Get("Depth"), dav.DepthZero)
	if err != nil {
		return err
	}
	var timezone *time.Location
	if node := root.Child(dav.CalDAVName("timezone")); nil != node {
		if timezone, err = calendarTimeZone(node.Text()); err != nil {
			return dav.NewConditionError(http.StatusForbidden, dav.NewElement(dav.CalDAVName("valid-calendar-data")))
		}
	}
	filter, err := dav.ParseCalendarFilter(root.Child(dav.CalDAVName("filter")))
	if err != nil {
		return err
	}
	request, err := h.parsePropRequest(root, timezone, true)
	if err != nil {
		return err
	}
	floating := s.floatingLocations(timezone)
	var responses []*dav.Response
	for _, object := range h.objectsInScope(target, depth) {
		if filter.Match(object.object.calendar, floating(object.path)) {
			responses = append(responses, h.propResponse(object, request))
		}
	}
	return dav.WriteMultistatus(w, responses)
}

// freeBusy 处理 CALDAV:free-busy-query（RFC 4791 §7.10）：只能作用于集合，没有 Depth 头时按 0 处理。
func (s *calDAVService) freeBusy(h *davHandler, w http.ResponseWriter, r *http.Request, target *davResource, root *dav.Node) error {
	if davKindObject == target.kind {
		return dav.NewError(http.StatusForbidden, errors.New("CalDAV: free-busy-query can only be run against a collection"))
	}
	depth, err := dav.ParseDepth(r.Header.Get("Depth"), dav.DepthZero)
	if err != nil {
		return err
	}
	timeRangeNode := root.Child(dav.CalDAVName("time-range"))
	if nil == timeRangeNode {
		return dav.NewError(http.StatusBadRequest, errors.New("CalDAV: free-busy-query requires a time-range"))
	}
	timeRange, err := dav.ParseTimeRange(timeRangeNode, true)
	if err != nil {
		return dav.NewError(http.StatusBadRequest, err)
	}
	freeBusy := dav.NewFreeBusy(timeRange)
	floating := s.floatingLocations(nil)
	for _, object := range h.objectsInScope(target, depth) {
		freeBusy.Add(object.object.calendar, floating(object.path))
	}
	body := freeBusy.Encode(time.Now())
	w.Header().Set("Content-Type", ical.MIMEType)
	w.Header().Set("Content-Length", strconv.Itoa(len(body)))
	w.WriteHeader(http.StatusOK)
	_, err = io.WriteString(w, body)
	return err
}
