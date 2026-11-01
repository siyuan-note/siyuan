// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package server

import (
	"errors"
	"fmt"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
	"golang.org/x/net/webdav"
)

const webdavPrefix = "/webdav/"

// webdavWriteLock 串行化 WebDAV 写请求，使前置条件检查与随后的写入之间没有其他写入插入
var webdavWriteLock sync.Mutex

func newWebDAVHandler() http.Handler {
	// 自定义 WebDAV 文件系统包装——拒绝加密笔记本的所有访问
	// 加密笔记本的读写必须通过 assets/serve 路由的 box-aware + 解密流程，
	// WebDAV 直接访问原始文件系统会绕过所有这些安全控制
	encBoxAwareFS := &encryptedBoxAwareWebdavFS{inner: webdav.Dir(util.WorkspaceDir)}
	handler := &webdav.Handler{
		Prefix:     webdavPrefix,
		FileSystem: encBoxAwareFS,
		LockSystem: webdav.NewMemLS(),
		Logger: func(r *http.Request, err error) {
			if nil != err {
				logging.LogErrorf("WebDAV [%s %s]: %s", r.Method, r.URL.String(), err.Error())
			}
			// logging.LogDebugf("WebDAV [%s %s]", r.Method, r.URL.String())
		},
	}
	return model.RejectNonCanonicalDAVPath(webdavPreconditions(encBoxAwareFS, handler))
}

// webdavPreconditions 为写请求评估 RFC 9110 §13 的前置条件；x/net/webdav 不处理这些请求头，
// GET/HEAD 的条件请求由它内部的 http.ServeContent 处理。
func webdavPreconditions(fs webdav.FileSystem, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodPut, http.MethodDelete, MethodMkCol, MethodCopy, MethodMove, MethodPropPatch, MethodLock:
		default:
			next.ServeHTTP(w, r)
			return
		}

		webdavWriteLock.Lock()
		defer webdavWriteLock.Unlock()
		if status := webdavPreconditionStatus(fs, r); 0 != status {
			http.Error(w, http.StatusText(status), status)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func webdavPreconditionStatus(fs webdav.FileSystem, r *http.Request) int {
	ifMatch, ifNoneMatch, ifUnmodifiedSince := r.Header.Get("If-Match"), r.Header.Get("If-None-Match"), r.Header.Get("If-Unmodified-Since")
	if "" == ifMatch && "" == ifNoneMatch && "" == ifUnmodifiedSince {
		return 0
	}
	name, ok := strings.CutPrefix(r.URL.Path, webdavPrefix)
	if !ok {
		return 0
	}

	info, err := fs.Stat(r.Context(), name)
	exists := nil == err
	if !exists && !errors.Is(err, os.ErrNotExist) {
		// 受保护或无法访问的路径交给 handler 返回原本的错误，不通过 412 泄露其状态
		return 0
	}
	etag := ""
	if exists {
		// 与 x/net/webdav 默认的 ETag 算法一致：修改时间（纳秒）与大小的十六进制拼接
		etag = fmt.Sprintf("%x%x", info.ModTime().UnixNano(), info.Size())
	}
	if status := model.DAVPreconditionStatus(exists, etag, ifMatch, ""); 0 != status {
		return status
	}
	// RFC 9110 §13.2.2：没有 If-Match 时才评估 If-Unmodified-Since，资源不存在时忽略
	if "" == ifMatch && "" != ifUnmodifiedSince && exists {
		if since, parseErr := http.ParseTime(ifUnmodifiedSince); nil == parseErr && info.ModTime().Truncate(time.Second).After(since) {
			return http.StatusPreconditionFailed
		}
	}
	return model.DAVPreconditionStatus(exists, etag, "", ifNoneMatch)
}
