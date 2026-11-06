// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package server

import (
	"compress/gzip"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

type agentStreamWriter struct {
	*httptest.ResponseRecorder
	deadline time.Time
	flushErr error
}

func (w *agentStreamWriter) SetWriteDeadline(deadline time.Time) error {
	w.deadline = deadline
	return nil
}

func (w *agentStreamWriter) FlushError() error {
	return w.flushErr
}

func TestGzipKeepsAgentStreamingControls(t *testing.T) {
	flushErr := errors.New("connection lost")
	writer := &agentStreamWriter{ResponseRecorder: httptest.NewRecorder(), flushErr: flushErr}
	engine := gin.New()
	engine.Use(gzipMiddleware())
	engine.POST("/api/ai/agent/chat", func(c *gin.Context) {
		unwrapper, ok := c.Writer.(interface{ Unwrap() http.ResponseWriter })
		if !ok {
			t.Fatal("agent stream is wrapped in a writer without transport controls")
		}
		controller := http.NewResponseController(unwrapper.Unwrap())
		deadline := time.Now().Add(time.Second)
		if err := controller.SetWriteDeadline(deadline); err != nil || !writer.deadline.Equal(deadline) {
			t.Fatalf("write deadline did not reach the connection: %v", err)
		}
		c.Header("Content-Type", "text/event-stream")
		_, _ = c.Writer.Write([]byte("event:content\ndata:{\"token\":\"partial\"}\n\n"))
		if err := controller.Flush(); !errors.Is(err, flushErr) {
			t.Fatalf("flush error was swallowed: %v", err)
		}
		if !strings.Contains(writer.Body.String(), "partial") {
			t.Fatal("stream content was buffered until request completion")
		}
	})
	request := httptest.NewRequest("POST", "/api/ai/agent/chat", nil)
	request.Header.Set("Accept-Encoding", "gzip")
	engine.ServeHTTP(writer, request)
	if writer.Header().Get("Content-Encoding") != "" {
		t.Fatal("agent stream was compressed")
	}
}

func TestGzipPreservesOtherRoutesAndExcludedAssets(t *testing.T) {
	for _, path := range []string{"/api/ai/agent/chat-extra", "/api/system/version", "/assets/photo.HEIC", "/assets/photo.png"} {
		t.Run(path, func(t *testing.T) {
			engine := gin.New()
			engine.Use(gzipMiddleware())
			engine.GET(path, func(c *gin.Context) { c.String(http.StatusOK, "response") })
			request := httptest.NewRequest("GET", path, nil)
			request.Header.Set("Accept-Encoding", "gzip")
			writer := httptest.NewRecorder()
			engine.ServeHTTP(writer, request)
			compressed := writer.Header().Get("Content-Encoding") == "gzip"
			if compressed != strings.HasPrefix(path, "/api/") {
				t.Fatalf("unexpected compression for %s: %t", path, compressed)
			}
			if compressed {
				reader, err := gzip.NewReader(writer.Body)
				if err != nil {
					t.Fatal(err)
				}
				defer reader.Close()
				body, err := io.ReadAll(reader)
				if err != nil || string(body) != "response" {
					t.Fatalf("invalid compressed response: %q, %v", body, err)
				}
			}
		})
	}
}
