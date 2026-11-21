// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"bytes"
	"compress/gzip"
	"hash/maphash"
	"net/http"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

const (
	// 集市列表是最大的 JSON 响应，压缩开销集中在 gzip，按响应内容复用压缩结果
	jsonGzipCacheEntryLimit = 8
	jsonGzipCacheByteLimit  = 8 << 20
	jsonGzipCacheMinBody    = 32 << 10
	// 有效期与集市索引缓存一致，超过后重新压缩，避免长期持有旧载荷
	jsonGzipCacheTTL = 10 * time.Minute
)

// JSONGzipCachePaths 列出由本包自行压缩的集市列表接口。
// 全局 gzip 中间件需要排除这些路径，否则响应会被压缩两次。
var JSONGzipCachePaths = []string{
	"/api/bazaar/getBazaarPlugin",
	"/api/bazaar/getBazaarTheme",
	"/api/bazaar/getBazaarWidget",
	"/api/bazaar/getBazaarIcon",
	"/api/bazaar/getBazaarTemplate",
}

// JSONGzipCachePathPattern 供 server 包的全局 gzip 中间件按路径排除。
var JSONGzipCachePathPattern = func() *regexp.Regexp {
	paths := make([]string, len(JSONGzipCachePaths))
	for i, path := range JSONGzipCachePaths {
		paths[i] = regexp.QuoteMeta(path)
	}
	return regexp.MustCompile("^(?:" + strings.Join(paths, "|") + ")$")
}()

type jsonGzipCacheEntry struct {
	hash      uint64
	bodySize  int
	payload   []byte
	expiresAt time.Time
}

var (
	jsonGzipCacheSeed = maphash.MakeSeed()
	// 缓存按响应内容索引，内容变化自然未命中，有效期只决定压缩结果的保有时间
	jsonGzipCache = struct {
		mu      sync.Mutex
		entries []jsonGzipCacheEntry
		bytes   int
	}{}
	jsonGzipCompressor = gzipCompress // 压缩入口，便于测试替换
	jsonGzipCacheNow   = time.Now     // 时钟入口，便于测试有效期
)

func gzipCompress(data []byte) ([]byte, error) {
	buf := &bytes.Buffer{}
	// 压缩级别与全局 gzip 中间件一致，命中缓存与未命中时的传输体积相同
	writer, err := gzip.NewWriterLevel(buf, gzip.DefaultCompression)
	if nil != err {
		return nil, err
	}
	if _, err = writer.Write(data); nil != err {
		return nil, err
	}
	if err = writer.Close(); nil != err {
		return nil, err
	}
	return buf.Bytes(), nil
}

// lookupJSONGzipPayload 返回未过期的压缩结果，顺手清理本次遇到的过期条目。
func lookupJSONGzipPayload(hash uint64, bodySize int) []byte {
	now := jsonGzipCacheNow()
	jsonGzipCache.mu.Lock()
	defer jsonGzipCache.mu.Unlock()
	for i, entry := range jsonGzipCache.entries {
		if entry.hash != hash || entry.bodySize != bodySize {
			continue
		}
		if !now.Before(entry.expiresAt) {
			jsonGzipCache.bytes -= len(entry.payload)
			jsonGzipCache.entries = slices.Delete(jsonGzipCache.entries, i, i+1)
			return nil
		}
		return entry.payload
	}
	return nil
}

func storeJSONGzipPayload(hash uint64, bodySize int, payload []byte) {
	if 0 == len(payload) || jsonGzipCacheByteLimit < len(payload) {
		return
	}
	now := jsonGzipCacheNow()
	expiresAt := now.Add(jsonGzipCacheTTL)
	jsonGzipCache.mu.Lock()
	defer jsonGzipCache.mu.Unlock()
	jsonGzipCache.entries = slices.DeleteFunc(jsonGzipCache.entries, func(entry jsonGzipCacheEntry) bool {
		if now.Before(entry.expiresAt) {
			return false
		}
		jsonGzipCache.bytes -= len(entry.payload)
		return true
	})
	for i, entry := range jsonGzipCache.entries {
		if entry.hash == hash && entry.bodySize == bodySize {
			jsonGzipCache.bytes += len(payload) - len(entry.payload)
			jsonGzipCache.entries[i].payload = payload
			jsonGzipCache.entries[i].expiresAt = expiresAt
			return
		}
	}
	jsonGzipCache.entries = append(jsonGzipCache.entries, jsonGzipCacheEntry{
		hash: hash, bodySize: bodySize, payload: payload, expiresAt: expiresAt})
	jsonGzipCache.bytes += len(payload)
	for jsonGzipCacheEntryLimit < len(jsonGzipCache.entries) ||
		(jsonGzipCacheByteLimit < jsonGzipCache.bytes && 1 < len(jsonGzipCache.entries)) {
		jsonGzipCache.bytes -= len(jsonGzipCache.entries[0].payload)
		// 清空被淘汰的引用，避免切片窗口继续持有旧载荷
		jsonGzipCache.entries[0] = jsonGzipCacheEntry{}
		jsonGzipCache.entries = jsonGzipCache.entries[1:]
	}
}

// gzipJSONCache 暂存集市列表响应，按响应内容复用压缩结果。
func gzipJSONCache() gin.HandlerFunc {
	return func(c *gin.Context) {
		if !acceptsGzipEncoding(c) {
			c.Next()
			return
		}
		writer := &bufferedJSONResponseWriter{ResponseWriter: c.Writer}
		c.Writer = writer
		// 处理函数 panic 时外层只记录日志，这里恢复真实写入器，避免后续写入落在未刷新的缓冲区
		defer func() { c.Writer = writer.ResponseWriter }()
		c.Next()
		writer.writeCompressed()
	}
}

// withGzipJSONCache 在鉴权之后、处理函数之前插入响应压缩缓存中间件。
func withGzipJSONCache(handlers []gin.HandlerFunc) []gin.HandlerFunc {
	if 0 == len(handlers) {
		return handlers
	}
	ret := make([]gin.HandlerFunc, 0, len(handlers)+1)
	ret = append(ret, handlers[:len(handlers)-1]...)
	ret = append(ret, gzipJSONCache())
	return append(ret, handlers[len(handlers)-1])
}

func acceptsGzipEncoding(c *gin.Context) bool {
	return strings.Contains(c.GetHeader("Accept-Encoding"), "gzip") &&
		!strings.Contains(c.GetHeader("Connection"), "Upgrade")
}

// bufferedJSONResponseWriter 暂存 JSON 响应体，等处理函数结束后统一压缩并写出。
type bufferedJSONResponseWriter struct {
	gin.ResponseWriter
	status  int
	size    int
	written bool
	body    bytes.Buffer
}

func (w *bufferedJSONResponseWriter) WriteHeader(status int) {
	if 0 < status && status != w.status {
		if w.written {
			return
		}
		w.status = status
	}
}

func (w *bufferedJSONResponseWriter) WriteHeaderNow() { w.written = true }

func (w *bufferedJSONResponseWriter) Write(data []byte) (int, error) {
	w.written = true
	n, err := w.body.Write(data)
	w.size += n
	return n, err
}

func (w *bufferedJSONResponseWriter) WriteString(data string) (int, error) {
	w.written = true
	n, err := w.body.WriteString(data)
	w.size += n
	return n, err
}

func (w *bufferedJSONResponseWriter) Status() int {
	if 0 == w.status {
		return http.StatusOK
	}
	return w.status
}

func (w *bufferedJSONResponseWriter) Size() int { return w.size }

func (w *bufferedJSONResponseWriter) Written() bool { return w.written }

// writeCompressed 压缩暂存的响应体并写入真实响应，命中缓存时直接复用已有压缩结果。
func (w *bufferedJSONResponseWriter) writeCompressed() {
	status := w.Status()
	body := w.body.Bytes()
	if 0 == len(body) {
		w.ResponseWriter.WriteHeader(status)
		return
	}

	header := w.ResponseWriter.Header()
	// 处理函数已经编码过的响应直接透传，避免重复压缩
	alreadyEncoded := "" != header.Get("Content-Encoding")
	var payload []byte
	if !alreadyEncoded {
		if jsonGzipCacheMinBody <= len(body) {
			hash := maphash.Bytes(jsonGzipCacheSeed, body)
			if cached := lookupJSONGzipPayload(hash, len(body)); nil != cached {
				payload = cached
			} else if encoded, err := jsonGzipCompressor(body); nil == err {
				// 内容相同的响应直接复用压缩结果，限制条目数与总字节数
				storeJSONGzipPayload(hash, len(body), encoded)
				payload = encoded
			}
		} else if encoded, err := jsonGzipCompressor(body); nil == err {
			payload = encoded
		}
	}
	if compressed := nil != payload; compressed {
		header.Set("Content-Encoding", "gzip")
		header.Set("Vary", "Accept-Encoding")
	} else {
		payload = body
	}

	header.Set("Content-Length", strconv.Itoa(len(payload)))
	w.ResponseWriter.WriteHeader(status)
	_, _ = w.ResponseWriter.Write(payload)
}
