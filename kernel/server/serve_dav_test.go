// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package server

import (
	"bufio"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
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
}
