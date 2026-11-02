// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package server

import (
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
	"golang.org/x/net/webdav"
)

const webdavPrefix = "/webdav/"

// webdavWriteLocks 让写请求按路径互斥：前置条件检查与随后的写入之间，同一资源及其祖先、后代上没有其他写入插入，
// 其他路径上的写入（包括慢速上传）不受影响
var webdavWriteLocks = newWebDAVPathLocks()

type webdavPathLocks struct {
	mu     sync.Mutex
	cond   *sync.Cond
	active []string
}

func newWebDAVPathLocks() *webdavPathLocks {
	locks := &webdavPathLocks{}
	locks.cond = sync.NewCond(&locks.mu)
	return locks
}

// lock 等到 paths 与正在写入的路径都不重叠后登记它们，返回释放函数。
func (l *webdavPathLocks) lock(paths []string) (unlock func()) {
	l.mu.Lock()
	var keys []string
	for {
		// 等待期间目录可能被移动，必须根据当前文件系统重新解析别名。
		keys = webdavLockKeys(paths)
		if !l.overlaps(keys) {
			break
		}
		l.cond.Wait()
	}
	l.active = append(l.active, keys...)
	l.mu.Unlock()
	return func() {
		l.mu.Lock()
		for _, p := range keys {
			if i := slices.Index(l.active, p); 0 <= i {
				l.active = slices.Delete(l.active, i, i+1)
			}
		}
		l.cond.Broadcast()
		l.mu.Unlock()
	}
}

func (l *webdavPathLocks) overlaps(paths []string) bool {
	for _, p := range paths {
		for _, active := range l.active {
			if webdavPathsOverlap(p, active) {
				return true
			}
		}
	}
	return false
}

// webdavPathsOverlap 判断两个已清理的路径是否相同或互为祖先。
func webdavPathsOverlap(a, b string) bool {
	if len(a) > len(b) {
		a, b = b, a
	}
	return a == b || strings.HasPrefix(b, strings.TrimSuffix(a, "/")+"/")
}

// webdavWritePaths 返回写请求影响的路径：请求目标，COPY 与 MOVE 还有 Destination。
func webdavWritePaths(r *http.Request) []string {
	paths := []string{webdavLockPath(r.URL.Path)}
	if destination := r.Header.Get("Destination"); "" != destination {
		if u, err := url.Parse(destination); err == nil {
			paths = append(paths, webdavLockPath(u.Path))
		}
	}
	return paths
}

func webdavLockPath(p string) string {
	return path.Clean("/" + strings.TrimPrefix(p, strings.TrimSuffix(webdavPrefix, "/")))
}

// webdavLockKeys 同时锁定请求位置和真实位置：目录移动要与经该目录访问的请求互斥，符号链接、目录联接和短文件名
// 也要与真实目标互斥。尚未创建的文件按最长已存在父目录解析；保留原始大小写解析后再统一锁键的大小写。
// 大小写敏感的文件系统上，大小写不同的资源可能多等待，但不会错过冲突。
func webdavLockKeys(paths []string) (keys []string) {
	for _, p := range paths {
		absolute := filepath.Join(util.WorkspaceDir, filepath.FromSlash(p))
		for _, name := range []string{absolute, util.ResolveLongestExistingParent(absolute)} {
			key := strings.ToLower(filepath.ToSlash(filepath.Clean(name)))
			if !slices.Contains(keys, key) {
				keys = append(keys, key)
			}
		}
	}
	return
}

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
	return model.RejectNonCanonicalWebDAVPath(withWebDAVGuardCache(webdavPreconditions(encBoxAwareFS, handler)))
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

		unlock := webdavWriteLocks.lock(webdavWritePaths(r))
		defer unlock()
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
