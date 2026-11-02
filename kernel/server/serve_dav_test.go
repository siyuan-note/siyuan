// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package server

import (
	"bufio"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

// TestWebDAVPreconditions 验证 WebDAV 写请求按 RFC 9110 §13 执行 If-Match、If-None-Match 与 If-Unmodified-Since。
func TestWebDAVPreconditions(t *testing.T) {
	ws := newWebDAVGuardWorkspace(t)
	h := newWebDAVHandler()
	note := filepath.Join(ws, "note.txt")
	content := func() string {
		data, _ := os.ReadFile(note)
		return string(data)
	}
	if response := serveWebDAVTestRequest(h, http.MethodPut, "/webdav/note.txt", nil, "v1"); response.Code != http.StatusCreated {
		t.Fatalf("setup PUT: status = %d", response.Code)
	}
	etag := serveWebDAVTestRequest(h, http.MethodGet, "/webdav/note.txt", nil, "").Header().Get("ETag")
	if "" == etag {
		t.Fatal("GET returned no ETag")
	}

	for _, test := range []struct {
		name, method, target string
		header               map[string]string
		status               int
	}{
		{"stale If-Match", http.MethodPut, "/webdav/note.txt", map[string]string{"If-Match": `"stale"`}, http.StatusPreconditionFailed},
		{"If-Match on missing", http.MethodPut, "/webdav/missing.txt", map[string]string{"If-Match": "*"}, http.StatusPreconditionFailed},
		{"create-only on existing", http.MethodPut, "/webdav/note.txt", map[string]string{"If-None-Match": "*"}, http.StatusPreconditionFailed},
		{"modified since", http.MethodPut, "/webdav/note.txt", map[string]string{"If-Unmodified-Since": time.Unix(0, 0).UTC().Format(http.TimeFormat)}, http.StatusPreconditionFailed},
		{"stale If-Match delete", http.MethodDelete, "/webdav/note.txt", map[string]string{"If-Match": `"stale"`}, http.StatusPreconditionFailed},
		{"stale If-Match move", "MOVE", "/webdav/note.txt", map[string]string{"If-Match": `"stale"`, "Destination": "/webdav/moved.txt"}, http.StatusPreconditionFailed},
		{"malformed If-Match", http.MethodDelete, "/webdav/note.txt", map[string]string{"If-Match": "unquoted"}, http.StatusBadRequest},
	} {
		if response := serveWebDAVTestRequest(h, test.method, test.target, test.header, "v2"); response.Code != test.status {
			t.Errorf("%s: status = %d, want %d", test.name, response.Code, test.status)
		}
	}
	if got := content(); "v1" != got {
		t.Fatalf("rejected requests changed the file: %q", got)
	}
	if _, err := os.Stat(filepath.Join(ws, "missing.txt")); err == nil {
		t.Fatal("rejected If-Match PUT created a file")
	}

	if response := serveWebDAVTestRequest(h, http.MethodPut, "/webdav/note.txt", map[string]string{"If-Match": `"other", ` + etag}, "v2"); response.Code != http.StatusCreated || "v2" != content() {
		t.Fatalf("PUT with current ETag in a list: status = %d, content = %q", response.Code, content())
	}
	if response := serveWebDAVTestRequest(h, http.MethodPut, "/webdav/new.txt", map[string]string{"If-None-Match": "*"}, "new"); response.Code != http.StatusCreated {
		t.Fatalf("create-only PUT on missing file: status = %d", response.Code)
	}
	etag = serveWebDAVTestRequest(h, http.MethodGet, "/webdav/note.txt", nil, "").Header().Get("ETag")
	if response := serveWebDAVTestRequest(h, http.MethodDelete, "/webdav/note.txt", map[string]string{"If-Match": etag}, ""); response.Code != http.StatusNoContent {
		t.Fatalf("DELETE with current ETag: status = %d", response.Code)
	}
}

// TestWebDAVWriteConcurrency 验证上传未完成时，其他文件的写请求无论是否带条件头都并发执行；同一文件与祖先目录上的写请求
// 等上传结束后才执行，带条件头的请求据此检查条件。
func TestWebDAVWriteConcurrency(t *testing.T) {
	ws := newWebDAVGuardWorkspace(t)
	h := newWebDAVHandler()
	serve := func(method, target string, header map[string]string, body io.Reader) <-chan int {
		done := make(chan int, 1)
		go func() {
			request := httptest.NewRequest(method, target, body)
			for k, v := range header {
				request.Header.Set(k, v)
			}
			response := httptest.NewRecorder()
			h.ServeHTTP(response, request)
			done <- response.Code
		}()
		return done
	}
	wait := func(done <-chan int, timeout time.Duration) (int, bool) {
		select {
		case status := <-done:
			return status, true
		case <-time.After(timeout):
			return 0, false
		}
	}

	dir := "/webdav/data/" + webdavGuardNormalBoxID
	uploaded := filepath.Join(ws, "data", webdavGuardNormalBoxID, "upload.bin")
	reader, writer := io.Pipe()
	upload := serve(http.MethodPut, dir+"/upload.bin", nil, reader)
	if _, err := writer.Write([]byte("partial")); err != nil {
		t.Fatal(err)
	}
	// 写入的数据被读走说明上传请求已经打开目标文件，正在持有锁
	for deadline := time.Now().Add(5 * time.Second); ; time.Sleep(10 * time.Millisecond) {
		if info, err := os.Stat(uploaded); err == nil && 0 < info.Size() {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("upload did not start")
		}
	}

	// 带条件头的请求在前，用来确认它既不等上传结束，也不挡住之后的请求
	for _, test := range []struct {
		name, target string
		header       map[string]string
	}{
		{"conditional PUT of another file", dir + "/new.txt", map[string]string{"If-None-Match": "*"}},
		{"unconditional PUT of another file", dir + "/other.txt", nil},
	} {
		if status, ok := wait(serve(http.MethodPut, test.target, test.header, strings.NewReader("other")), 5*time.Second); !ok || status != http.StatusCreated {
			t.Fatalf("%s during an upload: finished = %v, status = %d", test.name, ok, status)
		}
	}
	sameFile := serve(http.MethodPut, dir+"/upload.bin", map[string]string{"If-None-Match": "*"}, strings.NewReader("replaced"))
	parent := serve(MethodMkCol, dir, nil, nil)
	for name, done := range map[string]<-chan int{"conditional PUT of the same file": sameFile, "MKCOL of the parent directory": parent} {
		if status, ok := wait(done, 300*time.Millisecond); ok {
			t.Fatalf("%s finished with status %d while the upload was in progress", name, status)
		}
	}

	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	if status, ok := wait(upload, 5*time.Second); !ok || status != http.StatusCreated {
		t.Fatalf("upload: finished = %v, status = %d", ok, status)
	}
	if status, ok := wait(sameFile, 5*time.Second); !ok || status != http.StatusPreconditionFailed {
		t.Fatalf("conditional PUT of the same file after the upload: finished = %v, status = %d", ok, status)
	}
	if status, ok := wait(parent, 5*time.Second); !ok || status != http.StatusMethodNotAllowed {
		t.Fatalf("MKCOL of the parent directory after the upload: finished = %v, status = %d", ok, status)
	}
	if data, _ := os.ReadFile(uploaded); "partial" != string(data) {
		t.Fatalf("upload content = %q", data)
	}
}

// TestWebDAVPathsOverlap 验证写请求的路径锁：相同路径、祖先与后代互斥，前缀相同的兄弟路径不互斥，大小写不同的路径视为相同。
func TestWebDAVPathsOverlap(t *testing.T) {
	for _, test := range []struct {
		a, b string
		want bool
	}{
		{"/data/a", "/data/a", true},
		{"/data", "/data/a/b.sy", true},
		{"/", "/data", true},
		{"/data/a", "/data/ab", false},
		{"/data/a", "/data/b", false},
	} {
		if got := webdavPathsOverlap(test.a, test.b); got != test.want {
			t.Errorf("overlap(%s, %s) = %v, want %v", test.a, test.b, got, test.want)
		}
		if got := webdavPathsOverlap(test.b, test.a); got != test.want {
			t.Errorf("overlap(%s, %s) = %v, want %v", test.b, test.a, got, test.want)
		}
	}
	request := httptest.NewRequest("MOVE", "/webdav/Data/A.sy", nil)
	request.Header.Set("Destination", "http://localhost/webdav/data/b/../c.sy")
	if got := webdavWritePaths(request); 2 != len(got) || "/data/a.sy" != got[0] || "/data/c.sy" != got[1] {
		t.Fatalf("write paths = %v", got)
	}
}

// TestWebDAVRejectsNonCanonicalPaths 验证含点段的 WebDAV 请求路径在进入文件系统前被拒绝。
func TestWebDAVRejectsNonCanonicalPaths(t *testing.T) {
	newWebDAVGuardWorkspace(t)
	server := httptest.NewServer(newWebDAVHandler())
	defer server.Close()
	request := func(target string) int {
		conn, err := net.Dial("tcp", strings.TrimPrefix(server.URL, "http://"))
		if err != nil {
			t.Fatal(err)
		}
		defer conn.Close()
		fmt.Fprintf(conn, "GET %s HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n", target)
		response, err := http.ReadResponse(bufio.NewReader(conn), nil)
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		return response.StatusCode
	}
	for _, target := range []string{"/webdav/data/../temp/export/plain.md", "/webdav/data/%2e%2e/temp/export/plain.md", "/webdav/./data"} {
		if status := request(target); status != http.StatusBadRequest {
			t.Errorf("GET %s: status = %d, want 400", target, status)
		}
	}
	if status := request("/webdav/data/" + webdavGuardNormalBoxID + "/doc.sy"); status != http.StatusOK {
		t.Fatalf("GET canonical path: status = %d", status)
	}
	if status := request("/webdav/data/" + webdavGuardNormalBoxID + "/doc%00.sy"); status != http.StatusBadRequest {
		t.Errorf("GET path with NUL: status = %d, want 400", status)
	}
}

// TestWebDAVBackslashFileNames 验证反斜杠只在 Windows 上被拒绝，其他系统上可以读写文件名含反斜杠的文件。
func TestWebDAVBackslashFileNames(t *testing.T) {
	ws := newWebDAVGuardWorkspace(t)
	h := newWebDAVHandler()
	put := serveWebDAVTestRequest(h, http.MethodPut, "/webdav/a%5Cb.txt", nil, "content")
	if "windows" == runtime.GOOS {
		if put.Code != http.StatusBadRequest {
			t.Fatalf("PUT with a backslash on Windows: status = %d, want 400", put.Code)
		}
		return
	}
	if put.Code != http.StatusCreated {
		t.Fatalf("PUT with a backslash: status = %d", put.Code)
	}
	if data, err := os.ReadFile(filepath.Join(ws, `a\b.txt`)); err != nil || "content" != string(data) {
		t.Fatalf("file with a backslash: %q, %v", data, err)
	}
	if get := serveWebDAVTestRequest(h, http.MethodGet, "/webdav/a%5Cb.txt", nil, ""); get.Code != http.StatusOK || "content" != get.Body.String() {
		t.Fatalf("GET with a backslash: status = %d, body = %q", get.Code, get.Body.String())
	}
}
