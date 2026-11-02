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
	"time"

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

// davFileSave 是一次集合操作中要写入的一个文件。
type davFileSave struct {
	path string
	save func() error
}

// davFileSnapshot 是文件写入前的内容；existed 为 false 表示文件原本不存在。
type davFileSnapshot struct {
	path    string
	content []byte
	mode    os.FileMode
	existed bool
}

func (s *davFileSnapshot) restore() error {
	if !s.existed {
		if err := os.Remove(s.path); err != nil && !os.IsNotExist(err) {
			return err
		}
		return nil
	}
	return writeDAVFile(s.path, s.content, s.mode)
}

// saveDAVFiles 先记录所有文件的当前内容再依次写入，任一写入失败时把全部文件恢复为写入前的内容。集合的元数据与死属性
// 分存在两个文件中，借此一起更新或都不变：RFC 4918 §9.2 要求 PROPPATCH 的指令全部生效或全部不生效，
// RFC 4791 §5.3.1 与 RFC 5689 §3 要求创建集合失败时恢复原状态。
func saveDAVFiles(saves ...davFileSave) error {
	snapshots := make([]*davFileSnapshot, 0, len(saves))
	for _, save := range saves {
		snapshot := &davFileSnapshot{path: save.path, mode: 0644}
		info, err := os.Stat(save.path)
		if err == nil {
			if !info.Mode().IsRegular() {
				return fmt.Errorf("DAV file [%s] is not a regular file", save.path)
			}
			if snapshot.content, err = os.ReadFile(save.path); err != nil {
				return err
			}
			snapshot.mode, snapshot.existed = info.Mode().Perm(), true
		} else if !os.IsNotExist(err) {
			return err
		}
		snapshots = append(snapshots, snapshot)
	}
	for i, save := range saves {
		if err := save.save(); err != nil {
			// 写入失败的文件也要恢复：写入可能已经完成，只是之后报错
			for j := i; 0 <= j; j-- {
				if restoreErr := snapshots[j].restore(); restoreErr != nil {
					logging.LogErrorf("restore DAV file [%s] failed: %s", snapshots[j].path, restoreErr)
				}
			}
			return err
		}
	}
	return nil
}

// deleteDAVCollection 删除集合目录，commit 从元数据中移除集合并在失败时恢复内存与元数据文件。目录先改名为同级的
// 隐藏目录，commit 成功后才删除；commit 失败时改回原名，集合连同其中的对象保持不变，不会出现元数据仍列出集合、
// 目录却已删除的状态（重新载入后集合以空集合的形式出现）。
func deleteDAVCollection(dir string, commit func() error) error {
	trash := filepath.Join(filepath.Dir(dir), fmt.Sprintf(".%s.deleting-%d", filepath.Base(dir), time.Now().UnixNano()))
	if err := os.Rename(dir, trash); err != nil {
		if !os.IsNotExist(err) {
			logging.LogErrorf("move directory [%s] failed: %s", dir, err)
			return err
		}
		trash = ""
	}
	if err := commit(); err != nil {
		if "" != trash {
			if restoreErr := os.Rename(trash, dir); restoreErr != nil {
				logging.LogErrorf("restore directory [%s] from [%s] failed: %s", dir, trash, restoreErr)
			}
		}
		return err
	}
	if "" != trash {
		// 集合已从元数据中删除，残留的隐藏目录不会再被载入
		if err := os.RemoveAll(trash); err != nil {
			logging.LogWarnf("remove deleted collection directory [%s] failed: %s", trash, err)
		}
	}
	return nil
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
