// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"compress/gzip"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func newGzipCacheTestEngine(payload string) *gin.Engine {
	engine := gin.New()
	engine.POST(JSONGzipCachePaths[0], withGzipJSONCache([]gin.HandlerFunc{func(c *gin.Context) {
		c.Writer.Header().Add("Vary", "Origin")
		c.JSON(http.StatusOK, gin.H{"msg": payload})
	}})...)
	return engine
}

func serveGzipCacheRequest(engine *gin.Engine, acceptEncoding string) *httptest.ResponseRecorder {
	request := httptest.NewRequest("POST", JSONGzipCachePaths[0], nil)
	if acceptEncoding != "" {
		request.Header.Set("Accept-Encoding", acceptEncoding)
	}
	writer := httptest.NewRecorder()
	engine.ServeHTTP(writer, request)
	return writer
}

func TestGzipJSONCacheReusesCompressedPayload(t *testing.T) {
	compressions := 0
	oldCompressor := jsonGzipCompressor
	jsonGzipCompressor = func(data []byte) ([]byte, error) {
		compressions++
		return oldCompressor(data)
	}
	t.Cleanup(func() { jsonGzipCompressor = oldCompressor })

	payload := strings.Repeat("reusable-", jsonGzipCacheMinBody/8)
	engine := newGzipCacheTestEngine(payload)
	for range 2 {
		writer := serveGzipCacheRequest(engine, "gzip")
		if "gzip" != writer.Header().Get("Content-Encoding") {
			t.Fatalf("bazaar list was not compressed: %v", writer.Header())
		}
		if vary := writer.Header().Values("Vary"); len(vary) != 2 || vary[0] != "Origin" || vary[1] != "Accept-Encoding" {
			t.Fatalf("unexpected Vary values: %v", vary)
		}
		if strconv.Itoa(writer.Body.Len()) != writer.Header().Get("Content-Length") {
			t.Fatalf("content length does not match the gzip payload: %v", writer.Header())
		}
		reader, err := gzip.NewReader(writer.Body)
		if err != nil {
			t.Fatal(err)
		}
		body, err := io.ReadAll(reader)
		reader.Close()
		if err != nil || !strings.Contains(string(body), "reusable-") {
			t.Fatalf("invalid compressed response: %q, %v", body, err)
		}
	}
	if 1 != compressions {
		t.Fatalf("identical responses were compressed %d times, want 1", compressions)
	}
}

func TestGzipJSONCacheLeavesPlainClientsUntouched(t *testing.T) {
	payload := strings.Repeat("plain-", jsonGzipCacheMinBody/6)
	engine := newGzipCacheTestEngine(payload)
	writer := serveGzipCacheRequest(engine, "")
	if "" != writer.Header().Get("Content-Encoding") {
		t.Fatalf("plain client received a compressed response: %v", writer.Header())
	}
	if !strings.Contains(writer.Body.String(), "plain-") {
		t.Fatalf("unexpected plain response: %q", writer.Body.String())
	}
}

func TestGzipJSONCacheKeepsSmallResponsesUncached(t *testing.T) {
	compressions := 0
	oldCompressor := jsonGzipCompressor
	jsonGzipCompressor = func(data []byte) ([]byte, error) {
		compressions++
		return oldCompressor(data)
	}
	t.Cleanup(func() { jsonGzipCompressor = oldCompressor })

	engine := newGzipCacheTestEngine("small")
	for range 2 {
		if writer := serveGzipCacheRequest(engine, "gzip"); "gzip" != writer.Header().Get("Content-Encoding") {
			t.Fatalf("small response was not compressed: %v", writer.Header())
		}
	}
	if 2 != compressions {
		t.Fatalf("small response was compressed %d times, want 2", compressions)
	}
}

func TestGzipJSONCacheExpiresCompressedPayload(t *testing.T) {
	compressions := 0
	oldCompressor := jsonGzipCompressor
	jsonGzipCompressor = func(data []byte) ([]byte, error) {
		compressions++
		return oldCompressor(data)
	}
	now := time.Now()
	oldNow := jsonGzipCacheNow
	jsonGzipCacheNow = func() time.Time { return now }
	t.Cleanup(func() {
		jsonGzipCompressor = oldCompressor
		jsonGzipCacheNow = oldNow
	})

	payload := strings.Repeat("expiring-", jsonGzipCacheMinBody/9)
	engine := newGzipCacheTestEngine(payload)
	serveGzipCacheRequest(engine, "gzip")
	serveGzipCacheRequest(engine, "gzip")
	if 1 != compressions {
		t.Fatalf("fresh payload was compressed %d times, want 1", compressions)
	}

	now = now.Add(jsonGzipCacheTTL + time.Second)
	if writer := serveGzipCacheRequest(engine, "gzip"); "gzip" != writer.Header().Get("Content-Encoding") {
		t.Fatalf("expired entry was not recompressed: %v", writer.Header())
	}
	if 2 != compressions {
		t.Fatalf("expired payload was compressed %d times, want 2", compressions)
	}
}
