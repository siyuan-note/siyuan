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
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/siyuan-note/siyuan/kernel/internal/testutil"
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
	defer reader.Close()
	defer writer.Close()
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

func newWebDAVDirectoryAlias(t *testing.T, alias, target string) {
	t.Helper()
	if "windows" == runtime.GOOS {
		if output, err := exec.Command("cmd", "/d", "/c", "mklink", "/J", alias, target).CombinedOutput(); err != nil {
			t.Fatalf("create directory junction: %s: %v", output, err)
		}
	} else if err := os.Symlink(target, alias); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Remove(alias) })
}

// TestWebDAVWriteAliases 验证目录别名下的 PUT、COPY/MOVE 目标和祖先删除都等待真实路径上的上传，
// 条件 PUT 在上传完成后重新检查 ETag，拒绝过时写入并保持上传内容完整。
func TestWebDAVWriteAliases(t *testing.T) {
	for _, method := range []string{http.MethodPut, MethodCopy, MethodMove, http.MethodDelete} {
		t.Run(method, func(t *testing.T) {
			ws := newWebDAVGuardWorkspace(t)
			realDir := filepath.Join(ws, "data", webdavGuardNormalBoxID)
			newWebDAVDirectoryAlias(t, filepath.Join(ws, "Alias"), realDir)
			if err := os.Mkdir(filepath.Join(realDir, "nested"), 0755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(ws, "source.bin"), []byte("replacement"), 0644); err != nil {
				t.Fatal(err)
			}
			h := newWebDAVHandler()
			reader, writer := io.Pipe()
			upload := make(chan int, 1)
			uploadFinished := make(chan struct{})
			t.Cleanup(func() {
				_ = writer.Close()
				_ = reader.Close()
				select {
				case <-uploadFinished:
				case <-time.After(5 * time.Second):
					t.Error("upload cleanup stalled")
				}
			})
			go func() {
				defer close(uploadFinished)
				response := httptest.NewRecorder()
				h.ServeHTTP(response, httptest.NewRequest(http.MethodPut, "/webdav/data/"+webdavGuardNormalBoxID+"/nested/upload.bin", reader))
				upload <- response.Code
			}()
			if _, err := writer.Write([]byte("partial")); err != nil {
				t.Fatal(err)
			}
			file := filepath.Join(realDir, "nested", "upload.bin")
			var info os.FileInfo
			for deadline := time.Now().Add(5 * time.Second); ; time.Sleep(10 * time.Millisecond) {
				info, _ = os.Stat(file)
				if info != nil && info.Size() == 7 {
					break
				}
				if time.Now().After(deadline) {
					t.Fatal("upload did not start")
				}
			}
			target := "/webdav/Alias/nested/upload.bin"
			header := map[string]string{}
			want := http.StatusNoContent
			switch method {
			case http.MethodPut:
				header["If-Match"] = fmt.Sprintf(`"%x%x"`, info.ModTime().UnixNano(), info.Size())
				want = http.StatusPreconditionFailed
			case MethodCopy, MethodMove:
				header["Destination"] = target
				header["Overwrite"] = "T"
				target = "/webdav/source.bin"
			case http.MethodDelete:
				target = "/webdav/Alias/nested"
			}
			second := make(chan int, 1)
			go func() { second <- serveWebDAVTestRequest(h, method, target, header, "replacement").Code }()
			select {
			case status := <-second:
				t.Fatalf("%s through alias finished during upload: status = %d", method, status)
			case <-time.After(300 * time.Millisecond):
			}
			if _, err := writer.Write([]byte("-tail")); err != nil {
				t.Fatal(err)
			}
			if err := writer.Close(); err != nil {
				t.Fatal(err)
			}
			for _, result := range []struct {
				name string
				done <-chan int
				want int
			}{{"upload", upload, http.StatusCreated}, {"alias request", second, want}} {
				select {
				case status := <-result.done:
					if status != result.want {
						t.Fatalf("%s: status = %d, want %d", result.name, status, result.want)
					}
				case <-time.After(5 * time.Second):
					t.Fatalf("%s stalled", result.name)
				}
			}
			data, err := os.ReadFile(file)
			if method == http.MethodDelete {
				if !os.IsNotExist(err) {
					t.Fatalf("deleted directory remains: %v", err)
				}
			} else {
				content := "replacement"
				if method == http.MethodPut {
					content = "partial-tail"
				}
				if err != nil || string(data) != content {
					t.Fatalf("file content = %q, want %q; err = %v", data, content, err)
				}
			}
		})
	}
}

// TestWebDAVAliasLockKeys 验证别名下尚未创建的文件按真实父目录互斥，同时保留别名自身的目录移动锁。
func TestWebDAVAliasLockKeys(t *testing.T) {
	ws := newWebDAVGuardWorkspace(t)
	realDir := filepath.Join(ws, "MixedCase")
	if err := os.Mkdir(realDir, 0755); err != nil {
		t.Fatal(err)
	}
	newWebDAVDirectoryAlias(t, filepath.Join(ws, "Alias"), realDir)
	locks := newWebDAVPathLocks()
	unlock := locks.lock([]string{"/Alias/missing/file.bin"})
	defer unlock()
	for _, p := range []string{"/MixedCase/missing/file.bin", "/MixedCase", "/Alias"} {
		if !locks.overlaps(webdavLockKeys([]string{p})) {
			t.Errorf("%s does not overlap the active alias write", p)
		}
	}
	if locks.overlaps(webdavLockKeys([]string{"/MixedCase/other.bin"})) {
		t.Fatal("unrelated file overlaps the alias write")
	}
	t.Run("short parent name", func(t *testing.T) {
		short := filepath.Base(testutil.ShortPath(t, realDir))
		if !locks.overlaps(webdavLockKeys([]string{"/" + short + "/missing/file.bin"})) {
			t.Fatal("short parent name does not overlap the alias write")
		}
	})
}

// TestWebDAVWaitingAliasResolvesAgain 验证等待期间目录别名被重新指向后，等待者按新目标参与互斥。
func TestWebDAVWaitingAliasResolvesAgain(t *testing.T) {
	ws := newWebDAVGuardWorkspace(t)
	first, second := filepath.Join(ws, "first"), filepath.Join(ws, "second")
	for _, dir := range []string{first, second} {
		if err := os.Mkdir(dir, 0755); err != nil {
			t.Fatal(err)
		}
	}
	alias := filepath.Join(ws, "Alias")
	newWebDAVDirectoryAlias(t, alias, first)
	locks := newWebDAVPathLocks()
	releaseAlias := locks.lock([]string{"/Alias"})
	defer func() {
		if releaseAlias != nil {
			releaseAlias()
		}
	}()
	acquired := make(chan func(), 1)
	go func() { acquired <- locks.lock([]string{"/Alias/file.bin"}) }()
	assertWaiting := func() {
		t.Helper()
		select {
		case release := <-acquired:
			release()
			t.Fatal("alias write did not wait for the overlapping write")
		case <-time.After(300 * time.Millisecond):
		}
	}
	assertWaiting()
	if err := os.Remove(alias); err != nil {
		t.Fatal(err)
	}
	newWebDAVDirectoryAlias(t, alias, second)
	releaseSecond := locks.lock([]string{"/second/file.bin"})
	defer func() {
		if releaseSecond != nil {
			releaseSecond()
		}
	}()
	releaseAlias()
	releaseAlias = nil
	assertWaiting()
	releaseSecond()
	releaseSecond = nil
	select {
	case release := <-acquired:
		release()
	case <-time.After(5 * time.Second):
		t.Fatal("alias write stalled after both overlapping writes finished")
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
		{"c:/", "c:/data", true},
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
	if got := webdavWritePaths(request); 2 != len(got) || "/Data/A.sy" != got[0] || "/data/c.sy" != got[1] {
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
