// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"bytes"
	"io"
	"net/http"
	"strings"

	"github.com/emersion/go-webdav"
	"github.com/emersion/go-webdav/caldav"
	"github.com/emersion/go-webdav/carddav"
)

// NewCalDAVHandler 返回挂载在 /caldav 与 /.well-known/caldav 下的 CalDAV 处理器。
func NewCalDAVHandler() http.Handler {
	// REF: https://github.com/emersion/hydroxide/blob/master/carddav/carddav.go
	handler := &caldav.Handler{Backend: &CalDavBackend{}, Prefix: CalDavPrincipalsPath}
	return newDAVFrontHandler(handler, CalDavPrefixPath, CalDavPrincipalsPath)
}

// NewCardDAVHandler 返回挂载在 /carddav 与 /.well-known/carddav 下的 CardDAV 处理器。
func NewCardDAVHandler() http.Handler {
	// REF: https://github.com/emersion/hydroxide/blob/master/carddav/carddav.go
	handler := &carddav.Handler{Backend: &CardDavBackend{}, Prefix: CardDavPrincipalsPath}
	return newDAVFrontHandler(handler, CardDavPrefixPath, CardDavPrincipalsPath)
}

// RejectNonCanonicalDAVPath 拒绝含 "."、".." 段、反斜杠或 NUL 的请求路径。
// net/http 与 gin 都不清理请求路径，后端清理后可能跳到另一个 DAV 命名空间；Windows 上反斜杠也是路径分隔符。
func RejectNonCanonicalDAVPath(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !isCanonicalDAVPath(r.URL.Path) {
			http.Error(w, "DAV: request path must not contain dot segments, backslashes or NUL", http.StatusBadRequest)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func isCanonicalDAVPath(p string) bool {
	if strings.ContainsAny(p, "\\\x00") {
		return false
	}
	for _, segment := range strings.Split(p, "/") {
		if "." == segment || ".." == segment {
			return false
		}
	}
	return true
}

// newDAVFrontHandler 在 go-webdav 之前规范请求路径，并把 go-webdav 不传给后端的条件头和 PUT 原始请求体放入上下文。
func newDAVFrontHandler(next http.Handler, prefix, rootPath string) http.Handler {
	return RejectNonCanonicalDAVPath(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		request := &DAVRequest{Conditions: DAVConditions{
			IfMatch:     webdav.ConditionalMatch(r.Header.Get("If-Match")),
			IfNoneMatch: webdav.ConditionalMatch(r.Header.Get("If-None-Match")),
		}}
		// WithContext 返回浅拷贝，下面替换 URL 和 Body 不会改动调用方持有的请求
		r = r.WithContext(withDAVRequest(r.Context(), request))

		if normalized := normalizeDAVPath(r.URL.Path, prefix, rootPath); normalized != r.URL.Path {
			// 思源返回的集合 href 都不带尾斜杠，go-webdav 按字符串比较路径；按 RFC 4918 §5.2 告知规范地址
			u := *r.URL
			u.Path, u.RawPath = normalized, ""
			r.URL = &u
			w.Header().Set("Content-Location", normalized)
		}

		if http.MethodPut == r.Method {
			// go-webdav 本身也会把整个请求体解码到内存，这里先读出原始字节供后端比较
			body, err := io.ReadAll(r.Body)
			if err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			request.Body = body
			r.Body = io.NopCloser(bytes.NewReader(body))
		}
		next.ServeHTTP(w, r)
	}))
}

// normalizeDAVPath 把服务根地址映射到 go-webdav 的根资源，并去掉集合地址的尾斜杠。
func normalizeDAVPath(p, prefix, rootPath string) string {
	trimmed := strings.TrimRight(p, "/")
	if trimmed == prefix {
		return rootPath
	}
	if strings.HasPrefix(trimmed, prefix+"/") {
		return trimmed
	}
	return p
}
