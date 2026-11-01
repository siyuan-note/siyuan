// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/88250/gulu"
	"github.com/emersion/go-webdav"
	"github.com/emersion/go-webdav/caldav"
	"github.com/emersion/go-webdav/carddav"
	"github.com/siyuan-note/dejavu"
	"github.com/siyuan-note/dejavu/entity"
	"github.com/siyuan-note/logging"
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
	IfMatch     webdav.ConditionalMatch
	IfNoneMatch webdav.ConditionalMatch
}

// DAVRequest 携带 go-webdav 不会传给后端的请求信息，由 NewCalDAVHandler / NewCardDAVHandler 放入请求上下文。
type DAVRequest struct {
	Conditions DAVConditions
	// Body 是 PUT 请求体的原始字节，用于判断存储内容与提交内容是否逐字节相同
	Body []byte
}

type davRequestContextKey struct{}

func withDAVRequest(ctx context.Context, request *DAVRequest) context.Context {
	return context.WithValue(ctx, davRequestContextKey{}, request)
}

func davRequestFromContext(ctx context.Context) *DAVRequest {
	if request, ok := ctx.Value(davRequestContextKey{}).(*DAVRequest); ok {
		return request
	}
	return nil
}

func davConditionsFromContext(ctx context.Context) *DAVConditions {
	if request := davRequestFromContext(ctx); nil != request {
		return &request.Conditions
	}
	return nil
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

// checkDAVConditions 必须在持有集合锁、修改之前调用；etag 为空表示资源不存在。
func checkDAVConditions(etag string, ifMatch, ifNoneMatch webdav.ConditionalMatch) error {
	return checkDAVConditionsOf("" != etag, etag, ifMatch, ifNoneMatch)
}

func checkDAVConditionsOf(exists bool, etag string, ifMatch, ifNoneMatch webdav.ConditionalMatch) error {
	switch DAVPreconditionStatus(exists, etag, string(ifMatch), string(ifNoneMatch)) {
	case http.StatusBadRequest:
		return webdav.NewHTTPError(http.StatusBadRequest, errors.New("malformed If-Match or If-None-Match header"))
	case http.StatusPreconditionFailed:
		return webdav.NewHTTPError(http.StatusPreconditionFailed, errors.New("If-Match or If-None-Match condition failed"))
	}
	return nil
}

// check 评估删除请求的前置条件；集合没有 ETag，只能匹配 "*"。
func (conditions *DAVConditions) check(exists bool, etag string) error {
	if nil == conditions {
		return nil
	}
	return checkDAVConditionsOf(exists, etag, conditions.IfMatch, conditions.IfNoneMatch)
}

// davError 把存储层的哨兵错误转换为 go-webdav 识别的 HTTP 错误；同一错误在读、写操作中对应的状态码不同。
// 转换结果不能再包装：go-webdav 处理 OPTIONS 时用类型断言识别 404。
func davError(err error, codes map[error]int) error {
	if code, ok := codes[err]; ok {
		return webdav.NewHTTPError(code, err)
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

func SaveMetaData[T []*caldav.Calendar | []*carddav.AddressBook](metaData T, metaDataFilePath string) error {
	data, err := gulu.JSON.MarshalIndentJSON(metaData, "", "  ")
	if err != nil {
		logging.LogErrorf("marshal address books meta data failed: %s", err)
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

// davEncodedLength 返回对象按 go-webdav 输出时的字节数；磁盘文件可能不是规范编码，不能用文件大小作为 Content-Length。
func davEncodedLength(encode func(io.Writer) error) (int64, error) {
	var counter davByteCounter
	if err := encode(&counter); err != nil {
		return 0, err
	}
	return int64(counter), nil
}

type davByteCounter int64

func (c *davByteCounter) Write(p []byte) (int, error) {
	*c += davByteCounter(len(p))
	return len(p), nil
}

// FileETag identifies the persisted representation, including equal-size changes
// whose timestamps may be identical after synchronization.
func FileETag(filePath string) (string, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return "", err
	}
	defer file.Close()
	hash := sha256.New()
	if _, err = io.Copy(hash, file); err != nil {
		return "", err
	}
	return fmt.Sprintf("%x", hash.Sum(nil)), nil
}
