// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package plugin

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type pausedDocumentResponse struct {
	*httptest.ResponseRecorder
	started chan struct{}
	release chan struct{}
	once    sync.Once
}

func (writer *pausedDocumentResponse) Write(data []byte) (int, error) {
	writer.once.Do(func() { close(writer.started) })
	<-writer.release
	return writer.ResponseRecorder.Write(data)
}

func TestPluginDocumentResponseDoesNotBlockSave(t *testing.T) {
	workspace := newPluginServiceWorkspace(t)
	oldTemp := util.TempDir
	util.TempDir = t.TempDir()
	t.Cleanup(func() { util.TempDir = oldTemp })
	filename := filepath.Join(workspace, "document.sy")
	original := `{"content":"original"}`
	if err := os.WriteFile(filename, []byte(original), 0600); err != nil {
		t.Fatal(err)
	}
	engine := gin.New()
	engine.GET("/document", func(c *gin.Context) {
		serviceTestWrite(c, pluginServiceHTTPResponse(nil, c, "test", &HttpResponse{
			Body: &ResponseBody{File: &ResponseFile{Path: filename}},
		}))
	})
	writer := &pausedDocumentResponse{ResponseRecorder: httptest.NewRecorder(), started: make(chan struct{}), release: make(chan struct{})}
	done := make(chan struct{})
	go func() {
		defer close(done)
		engine.ServeHTTP(writer, httptest.NewRequest(http.MethodGet, "/document", nil))
	}()
	var releaseOnce sync.Once
	release := func() { releaseOnce.Do(func() { close(writer.release) }) }
	defer func() { release(); <-done }()
	select {
	case <-writer.started:
	case <-time.After(5 * time.Second):
		t.Fatal("document response did not start")
	}
	saved := make(chan error, 1)
	go func() {
		saved <- util.WriteFileWithPreflight(filename, []byte(`{"content":"replacement"}`), false, func([]byte) error { return nil })
	}()
	select {
	case err := <-saved:
		if err != nil {
			t.Fatalf("slow document response prevented save: %v", err)
		}
	case <-time.After(3 * time.Second):
		release()
		<-saved
		t.Fatal("save waited for the network response")
	}
	release()
	<-done
	if writer.Code != http.StatusOK || writer.Body.String() != original {
		t.Fatalf("document response did not retain its snapshot: %d %q", writer.Code, writer.Body.String())
	}
	entries, err := os.ReadDir(filepath.Join(util.TempDir, "os"))
	if err != nil || len(entries) != 0 {
		t.Fatalf("document response retained temporary snapshots: %v, %v", entries, err)
	}
}

func TestPluginDocumentResponsePreservesFileHTTPBehavior(t *testing.T) {
	workspace := newPluginServiceWorkspace(t)
	oldTemp := util.TempDir
	util.TempDir = t.TempDir()
	t.Cleanup(func() { util.TempDir = oldTemp })
	filename := filepath.Join(workspace, "document.sy")
	if err := os.WriteFile(filename, []byte("0123456789"), 0600); err != nil {
		t.Fatal(err)
	}
	stamp := time.Unix(1700000000, 0).UTC()
	if err := os.Chtimes(filename, stamp, stamp); err != nil {
		t.Fatal(err)
	}
	for _, scenario := range []struct {
		name, method, rangeHeader, modifiedSince string
		status                                   int
		body                                     string
	}{
		{name: "range", method: http.MethodGet, rangeHeader: "bytes=2-4", status: http.StatusPartialContent, body: "234"},
		{name: "head", method: http.MethodHead, status: http.StatusOK},
		{name: "conditional", method: http.MethodGet, modifiedSince: stamp.Format(http.TimeFormat), status: http.StatusNotModified},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			engine := gin.New()
			engine.Any("/document", func(c *gin.Context) {
				serviceTestWrite(c, pluginServiceHTTPResponse(nil, c, "test", &HttpResponse{
					Body: &ResponseBody{File: &ResponseFile{Path: filename, Name: "download.sy"}},
				}))
			})
			request := httptest.NewRequest(scenario.method, "/document", nil)
			if scenario.rangeHeader != "" {
				request.Header.Set("Range", scenario.rangeHeader)
			}
			if scenario.modifiedSince != "" {
				request.Header.Set("If-Modified-Since", scenario.modifiedSince)
			}
			recorder := httptest.NewRecorder()
			engine.ServeHTTP(recorder, request)
			if recorder.Code != scenario.status || recorder.Body.String() != scenario.body {
				t.Fatalf("file response changed: %d %q", recorder.Code, recorder.Body.String())
			}
			if recorder.Header().Get("Last-Modified") != stamp.Format(http.TimeFormat) ||
				!strings.Contains(recorder.Header().Get("Content-Disposition"), "download.sy") {
				t.Fatalf("source metadata changed: %v", recorder.Header())
			}
			if entries, err := os.ReadDir(filepath.Join(util.TempDir, "os")); err != nil || len(entries) != 0 {
				t.Fatalf("HTTP response retained snapshots: %v, %v", entries, err)
			}
		})
	}
}

func TestPluginDocumentResponseSnapshotFailureReleasesSource(t *testing.T) {
	workspace := newPluginServiceWorkspace(t)
	oldTemp := util.TempDir
	util.TempDir = filepath.Join(t.TempDir(), "not-a-directory")
	t.Cleanup(func() { util.TempDir = oldTemp })
	if err := os.WriteFile(util.TempDir, []byte("occupied"), 0600); err != nil {
		t.Fatal(err)
	}
	filename := filepath.Join(workspace, "document.sy")
	if err := os.WriteFile(filename, []byte("original"), 0600); err != nil {
		t.Fatal(err)
	}
	engine := gin.New()
	engine.GET("/document", func(c *gin.Context) {
		serviceTestWrite(c, pluginServiceHTTPResponse(nil, c, "test", &HttpResponse{
			Headers: map[string][]string{
				"Content-Disposition": {"attachment; filename=wrong.sy"},
				"Content-Type":        {"application/json"},
				"Content-Length":      {"10000"},
				"Content-Range":       {"bytes 0-9/10000"},
				"Content-Encoding":    {"gzip"},
				"Accept-Ranges":       {"bytes"},
				"Last-Modified":       {time.Now().UTC().Format(http.TimeFormat)},
				"ETag":                {"old-content"},
				"X-Plugin-Test":       {"preserved"},
			},
			Body: &ResponseBody{File: &ResponseFile{Path: filename, Name: "download.sy"}},
		}))
	})
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/document", nil))
	if recorder.Code != http.StatusInternalServerError || strings.Contains(recorder.Body.String(), workspace) {
		t.Fatalf("snapshot failure response changed or exposed a source path: %d %q", recorder.Code, recorder.Body.String())
	}
	if recorder.Body.String() != "[plugin:test] could not prepare document response" ||
		recorder.Header().Get("Content-Type") != "text/plain; charset=utf-8" || recorder.Header().Get("X-Plugin-Test") != "preserved" {
		t.Fatalf("snapshot failure did not use the plugin error response: %v %q", recorder.Header(), recorder.Body.String())
	}
	for _, header := range []string{"Content-Disposition", "Content-Length", "Content-Range", "Content-Encoding", "Accept-Ranges", "Last-Modified", "ETag"} {
		if recorder.Header().Get(header) != "" {
			t.Fatalf("snapshot failure retained file header %s", header)
		}
	}
	saved := make(chan error, 1)
	go func() {
		saved <- util.WriteFileWithPreflight(filename, []byte("replacement"), false, func([]byte) error { return nil })
	}()
	select {
	case err := <-saved:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("snapshot failure retained the source lock")
	}
}

func TestPluginDocumentResponseMissingFile(t *testing.T) {
	filename := filepath.Join(newPluginServiceWorkspace(t), "missing.sy")
	engine := gin.New()
	engine.GET("/document", func(c *gin.Context) {
		serviceTestWrite(c, pluginServiceHTTPResponse(nil, c, "test", &HttpResponse{
			Body: &ResponseBody{File: &ResponseFile{Path: filename}},
		}))
	})
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/document", nil))
	if recorder.Code != http.StatusNotFound || recorder.Body.String() != "[plugin:test] file not found" {
		t.Fatalf("missing source response changed: %d %q", recorder.Code, recorder.Body.String())
	}
}

func TestPluginServiceNonDocumentDoesNotRequireSnapshot(t *testing.T) {
	workspace := newPluginServiceWorkspace(t)
	oldTemp := util.TempDir
	util.TempDir = filepath.Join(t.TempDir(), "not-a-directory")
	t.Cleanup(func() { util.TempDir = oldTemp })
	if err := os.WriteFile(util.TempDir, []byte("occupied"), 0600); err != nil {
		t.Fatal(err)
	}
	for _, scenario := range []struct{ name, filename string }{
		{"asset", filepath.Join(workspace, "asset.txt")},
		{"directory", filepath.Join(workspace, "directory.sy", "index.html")},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			if err := os.MkdirAll(filepath.Dir(scenario.filename), 0700); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(scenario.filename, []byte("original"), 0600); err != nil {
				t.Fatal(err)
			}
			filename := scenario.filename
			requestPath := "/file"
			if scenario.name == "directory" {
				filename = filepath.Dir(filename)
				requestPath += "/"
			}
			engine := gin.New()
			engine.GET(requestPath, func(c *gin.Context) {
				serviceTestWrite(c, pluginServiceHTTPResponse(nil, c, "test", &HttpResponse{
					Body: &ResponseBody{File: &ResponseFile{Path: filename}},
				}))
			})
			recorder := httptest.NewRecorder()
			engine.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, requestPath, nil))
			if recorder.Code != http.StatusOK || recorder.Body.String() != "original" {
				t.Fatalf("non-document response required a snapshot: %d %q", recorder.Code, recorder.Body.String())
			}
		})
	}
}
