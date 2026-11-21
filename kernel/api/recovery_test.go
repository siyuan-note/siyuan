// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	stdgzip "compress/gzip"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-contrib/gzip"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/model"
)

func TestAPIContractPanicRecovery(t *testing.T) {
	engine := gin.New()
	engine.Use(model.Recover, gzip.Gzip(gzip.DefaultCompression))
	ServeAPI(engine)
	engine.GET("/api/test/unwritten", func(c *gin.Context) {
		c.Status(http.StatusPartialContent)
		c.Header("Content-Type", "application/octet-stream")
		c.Header("Content-Encoding", "identity")
		c.Header("Content-Length", "1")
		c.Header("Content-Disposition", "attachment")
		c.Header("Content-Range", "bytes 0-0/2")
		c.Header("Access-Control-Allow-Origin", "http://localhost")
		panic("private recovery test detail")
	})
	engine.GET("/api/test/committed", func(c *gin.Context) {
		c.SSEvent("message", "partial")
		c.Writer.Flush()
		panic("private recovery test detail")
	})
	engine.GET("/api/test/no-content", func(c *gin.Context) { c.Status(http.StatusNoContent) })

	for _, encoding := range []string{"identity", "gzip"} {
		t.Run(encoding, func(t *testing.T) {
			makeRequest := func(path string) (*http.Response, string) {
				t.Helper()
				request := httptest.NewRequest(http.MethodGet, path, nil)
				request.Header.Set("Accept-Encoding", encoding)
				recorder := httptest.NewRecorder()
				engine.ServeHTTP(recorder, request)
				response := recorder.Result()
				defer response.Body.Close()
				var body io.Reader = response.Body
				if response.Header.Get("Content-Encoding") == "gzip" && response.StatusCode != http.StatusNoContent {
					reader, err := stdgzip.NewReader(body)
					if err != nil {
						t.Fatal(err)
					}
					defer reader.Close()
					body = reader
				}
				content, err := io.ReadAll(body)
				if err != nil {
					t.Fatal(err)
				}
				return response, string(content)
			}
			response, body := makeRequest("/api/test/unwritten")
			if response.StatusCode != 500 || response.Header.Get("Content-Type") != "application/json; charset=utf-8" ||
				(response.Header.Get("Content-Encoding") == "gzip") != (encoding == "gzip") {
				t.Fatalf("unexpected error response: %d %v", response.StatusCode, response.Header)
			}
			if response.Header.Get("Content-Disposition") != "" || response.Header.Get("Content-Range") != "" ||
				response.Header.Get("Content-Length") == "1" || response.Header.Get("Access-Control-Allow-Origin") != "http://localhost" {
				t.Fatalf("headers did not match the error response: %v", response.Header)
			}
			var payload struct {
				Code int             `json:"code"`
				Msg  string          `json:"msg"`
				Data json.RawMessage `json:"data"`
			}
			if err := json.Unmarshal([]byte(body), &payload); err != nil || payload.Code != -1 || payload.Msg == "" ||
				string(payload.Data) != "null" || strings.Contains(body, "private recovery test detail") {
				t.Fatalf("unexpected error envelope: %s (%v)", body, err)
			}
			response, body = makeRequest("/api/test/committed")
			if response.StatusCode != 200 || !strings.HasPrefix(response.Header.Get("Content-Type"), "text/event-stream") ||
				body != "event:message\ndata:partial\n\n" {
				t.Fatalf("committed stream changed: %d %v %q", response.StatusCode, response.Header, body)
			}
			response, body = makeRequest("/api/test/no-content")
			if response.StatusCode != 204 || body != "" {
				t.Fatalf("ordinary empty response changed: %d %q", response.StatusCode, body)
			}
		})
	}
}
