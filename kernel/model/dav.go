// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"bytes"
	"crypto/sha256"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/88250/gulu"
	"github.com/siyuan-note/dejavu"
	"github.com/siyuan-note/dejavu/entity"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/dav"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var writeDAVFile = gulu.File.WriteFileSafer

// Reload only caches that have been used, after synchronization has updated disk.
// Holding the same locks as DAV operations prevents publishing an old loaded
// cache after this refresh. Unused services remain lazy and do not create files.
func reloadSyncedDAV(result *dejavu.MergeResult, calendarStore *Calendars, contactStore *Contacts) {
	var reloadCalendar, reloadContacts bool
	for _, files := range [][]*entity.File{result.Upserts, result.Removes} {
		for _, file := range files {
			reloadCalendar = reloadCalendar || strings.HasPrefix(file.Path, "/storage/caldav/")
			reloadContacts = reloadContacts || strings.HasPrefix(file.Path, "/storage/carddav/")
		}
	}
	if reloadCalendar {
		calendarStore.lock.Lock()
		if calendarStore.loaded {
			calendarStore.loaded = false
			if err := calendarStore.load(); err != nil {
				logging.LogErrorf("reload synchronized calendars failed: %s", err)
			}
		}
		calendarStore.lock.Unlock()
	}
	if reloadContacts {
		contactStore.lock.Lock()
		if contactStore.loaded {
			contactStore.loaded = false
			if err := contactStore.load(); err != nil {
				logging.LogErrorf("reload synchronized contacts failed: %s", err)
			}
		}
		contactStore.lock.Unlock()
	}
}

// DAVConditions 是写请求携带的 If-Match / If-None-Match 前置条件。
type DAVConditions struct {
	IfMatch     string
	IfNoneMatch string
}

func davConditionsOf(r *http.Request) *DAVConditions {
	return &DAVConditions{IfMatch: r.Header.Get("If-Match"), IfNoneMatch: r.Header.Get("If-None-Match")}
}

// DAVPreconditionStatus 按 RFC 9110 §13.1.1、§13.1.2 评估 If-Match 与 If-None-Match（不含 GET/HEAD 的 304 语义）。
// etag 是资源当前的不透明实体标签（不含引号），集合等没有 ETag 的资源传空串；
// 条件满足返回 0，条件不满足返回 412，请求头格式错误返回 400。
func DAVPreconditionStatus(exists bool, etag, ifMatch, ifNoneMatch string) int {
	if "" != strings.TrimSpace(ifMatch) {
		matched, err := matchEntityTags(ifMatch, exists, etag, true)
		if err != nil {
			return http.StatusBadRequest
		}
		if !matched {
			return http.StatusPreconditionFailed
		}
	}
	if "" != strings.TrimSpace(ifNoneMatch) {
		matched, err := matchEntityTags(ifNoneMatch, exists, etag, false)
		if err != nil {
			return http.StatusBadRequest
		}
		if matched {
			return http.StatusPreconditionFailed
		}
	}
	return 0
}

// matchEntityTags 判断 "*" 或实体标签列表是否匹配当前资源；
// If-Match 使用强比较，If-None-Match 使用弱比较（RFC 9110 §8.8.3.2）。
func matchEntityTags(field string, exists bool, etag string, strong bool) (bool, error) {
	field = strings.TrimSpace(field)
	if "*" == field {
		return exists, nil
	}
	matched := false
	for rest := field; ; {
		rest = strings.TrimLeft(rest, " \t,")
		if "" == rest {
			return matched, nil
		}
		weak := strings.HasPrefix(rest, "W/")
		if weak {
			rest = rest[2:]
		}
		if !strings.HasPrefix(rest, `"`) {
			return false, errors.New("malformed entity tag")
		}
		end := strings.IndexByte(rest[1:], '"')
		if end < 0 {
			return false, errors.New("unterminated entity tag")
		}
		opaque := rest[1 : end+1]
		rest = rest[end+2:]
		if trimmed := strings.TrimLeft(rest, " \t"); "" != trimmed && ',' != trimmed[0] {
			return false, errors.New("malformed entity tag list")
		}
		if exists && "" != etag && opaque == etag && (!strong || !weak) {
			matched = true
		}
	}
}

// check 必须在持有集合锁、修改之前调用；集合没有 ETag，只能匹配 "*"。
func (conditions *DAVConditions) check(exists bool, etag string) error {
	if nil == conditions {
		return nil
	}
	switch DAVPreconditionStatus(exists, etag, conditions.IfMatch, conditions.IfNoneMatch) {
	case http.StatusBadRequest:
		return dav.NewError(http.StatusBadRequest, errors.New("malformed If-Match or If-None-Match header"))
	case http.StatusPreconditionFailed:
		return dav.NewError(http.StatusPreconditionFailed, errors.New("If-Match or If-None-Match condition failed"))
	}
	return nil
}

// davError 把存储层的哨兵错误转换为带状态码的协议错误；同一错误在读、写操作中对应的状态码不同。
func davError(err error, codes map[error]int) error {
	if code, ok := codes[err]; ok {
		return dav.NewError(code, err)
	}
	return err
}

// PathJoinWithSlash joins the elements to a path with slash ('/') character
func PathJoinWithSlash(elems ...string) string {
	return filepath.ToSlash(filepath.Join(elems...))
}

// PathCleanWithSlash 规范化 CalDAV/CardDAV 的 URL 路径；URL 路径只以 '/' 分隔，不能使用平台相关的 filepath。
func PathCleanWithSlash(p string) string {
	return path.Clean("/" + p)
}

// DavPath2DirectoryPath converts CalDAV/CardDAV path to absolute path of the file system
func DavPath2DirectoryPath(davPath string) string {
	return PathJoinWithSlash(util.DataDir, "storage", PathCleanWithSlash(davPath))
}

func SaveMetaData[T []*CalendarMetaData | []*AddressBookMetaData | map[string][]string](metaData T, metaDataFilePath string) error {
	data, err := gulu.JSON.MarshalIndentJSON(metaData, "", "  ")
	if err != nil {
		logging.LogErrorf("marshal DAV meta data [%s] failed: %s", metaDataFilePath, err)
		return err
	}

	dirPath := path.Dir(metaDataFilePath)
	if err := os.MkdirAll(dirPath, 0755); err != nil {
		logging.LogErrorf("create directory [%s] failed: %s", dirPath, err)
		return err
	}

	if err := writeDAVFile(metaDataFilePath, data, 0644); err != nil {
		logging.LogErrorf("write file [%s] failed: %s", metaDataFilePath, err)
		return err
	}

	return nil
}

// FileETag identifies the persisted representation, including equal-size changes
// whose timestamps may be identical after synchronization.
func FileETag(filePath string) (string, error) {
	content, err := os.ReadFile(filePath)
	if err != nil {
		return "", err
	}
	return davContentETag(content), nil
}

func davContentETag(content []byte) string {
	return fmt.Sprintf("%x", sha256.Sum256(content))
}

// loadDAVDeadProperties 读取集合的死属性（RFC 4918 §4.2）：键是集合路径，值是序列化后的 XML 元素。
// 集合名称和描述仍保存在 calendars.json / address-books.json 中；旧版本会按自己的结构整体重写这两个文件，
// 其他属性因此单独保存，文件不存在表示没有死属性。
func loadDAVDeadProperties(filePath string) (map[string][]*dav.Node, error) {
	properties := map[string][]*dav.Node{}
	data, err := os.ReadFile(filePath)
	if os.IsNotExist(err) {
		return properties, nil
	}
	if err != nil {
		logging.LogErrorf("read DAV properties [%s] failed: %s", filePath, err)
		return nil, err
	}
	var stored map[string][]string
	if err = gulu.JSON.UnmarshalJSON(data, &stored); err != nil {
		logging.LogErrorf("unmarshal DAV properties [%s] failed: %s", filePath, err)
		return nil, err
	}
	for collectionPath, elements := range stored {
		for _, element := range elements {
			node, parseErr := dav.ParseXML(bytes.NewReader([]byte(element)))
			if parseErr != nil || nil == node {
				logging.LogWarnf("skip invalid DAV property of [%s]: %s", collectionPath, parseErr)
				continue
			}
			properties[collectionPath] = append(properties[collectionPath], node)
		}
	}
	return properties, nil
}

func saveDAVDeadProperties(properties map[string][]*dav.Node, filePath string) error {
	stored := map[string][]string{}
	for collectionPath, nodes := range properties {
		for _, node := range nodes {
			element, err := node.Marshal()
			if err != nil {
				return err
			}
			stored[collectionPath] = append(stored[collectionPath], string(element))
		}
	}
	if _, err := os.Stat(filePath); 0 == len(stored) && os.IsNotExist(err) {
		return nil
	}
	return SaveMetaData(stored, filePath)
}

func cloneDAVNodes(nodes []*dav.Node) (clones []*dav.Node) {
	for _, node := range nodes {
		clones = append(clones, node.Clone())
	}
	return
}

func sameDAVNodes(a, b []*dav.Node) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		x, errX := a[i].Marshal()
		y, errY := b[i].Marshal()
		if errX != nil || errY != nil || !bytes.Equal(x, y) {
			return false
		}
	}
	return true
}
