// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package server

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/util"
	"golang.org/x/net/webdav"
)

const (
	webdavGuardEncryptedBoxID = "20261101000000-encbox1"
	webdavGuardNormalBoxID    = "20261101000000-plainb1"
)

// newWebDAVGuardWorkspace 创建包含 temp/ 导出、加密笔记本和普通笔记本的临时工作空间。
func newWebDAVGuardWorkspace(t *testing.T) string {
	t.Helper()
	ws := t.TempDir()
	previousWorkspace, previousData := util.WorkspaceDir, util.DataDir
	util.WorkspaceDir, util.DataDir = ws, filepath.Join(ws, "data")
	t.Cleanup(func() { util.WorkspaceDir, util.DataDir = previousWorkspace, previousData })

	writeFile := func(rel, content string) {
		p := filepath.Join(ws, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(p), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(content), 0644); err != nil {
			t.Fatal(err)
		}
	}
	writeFile("temp/export/plain.md", "decrypted export")
	writeFile("data/"+webdavGuardEncryptedBoxID+"/.siyuan/conf.json", `{"encrypted":true}`)
	writeFile("data/"+webdavGuardEncryptedBoxID+"/secret.sy", "ciphertext")
	writeFile("data/"+webdavGuardNormalBoxID+"/.siyuan/conf.json", `{"encrypted":false}`)
	writeFile("data/"+webdavGuardNormalBoxID+"/doc.sy", "plain document")
	return ws
}

func serveWebDAVTestRequest(h http.Handler, method, target string, header map[string]string, body string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, target, strings.NewReader(body))
	for k, v := range header {
		request.Header.Set(k, v)
	}
	response := httptest.NewRecorder()
	h.ServeHTTP(response, request)
	return response
}

func sameDirectory(a, b string) bool {
	aInfo, err := os.Stat(a)
	if err != nil {
		return false
	}
	bInfo, err := os.Stat(b)
	return err == nil && os.SameFile(aInfo, bInfo)
}

// TestWebDAVGuardRejectsProtectedDirectoryAliases 验证 temp/ 和加密笔记本目录的任何别名
// （大小写变体、符号链接）都不能读写；大小写敏感的文件系统上大小写变体指向不存在的目录，跳过。
func TestWebDAVGuardRejectsProtectedDirectoryAliases(t *testing.T) {
	ws := newWebDAVGuardWorkspace(t)
	tempDir := filepath.Join(ws, "temp")
	boxDir := filepath.Join(ws, "data", webdavGuardEncryptedBoxID)
	aliases := []struct {
		urlDir, realDir, file string
	}{
		{"temp/export", filepath.Join(tempDir, "export"), "plain.md"},
		{"TEMP/export", filepath.Join(tempDir, "export"), "plain.md"},
		{"Temp/export", filepath.Join(tempDir, "export"), "plain.md"},
		{"data/" + webdavGuardEncryptedBoxID, boxDir, "secret.sy"},
		{"Data/" + webdavGuardEncryptedBoxID, boxDir, "secret.sy"},
		{"DATA/" + strings.ToUpper(webdavGuardEncryptedBoxID), boxDir, "secret.sy"},
		{"data/" + strings.ToUpper(webdavGuardEncryptedBoxID), boxDir, "secret.sy"},
	}
	if err := os.Symlink(boxDir, filepath.Join(ws, "data", "box-link")); err == nil {
		aliases = append(aliases, struct{ urlDir, realDir, file string }{"data/box-link", boxDir, "secret.sy"})
	} else {
		t.Logf("symlink alias skipped: %v", err)
	}

	h := newWebDAVHandler()
	exercised := 0
	for _, alias := range aliases {
		if !sameDirectory(filepath.Join(ws, filepath.FromSlash(alias.urlDir)), alias.realDir) {
			t.Logf("alias %s does not resolve to the protected directory on this file system", alias.urlDir)
			continue
		}
		exercised++
		get := serveWebDAVTestRequest(h, http.MethodGet, "/webdav/"+alias.urlDir+"/"+alias.file, nil, "")
		if get.Code != http.StatusNotFound {
			t.Errorf("GET via %s: status = %d, want 404; body = %q", alias.urlDir, get.Code, get.Body.String())
		}
		put := serveWebDAVTestRequest(h, http.MethodPut, "/webdav/"+alias.urlDir+"/injected.txt", nil, "plaintext")
		if put.Code >= 200 && put.Code < 300 {
			t.Errorf("PUT via %s: status = %d, want rejection", alias.urlDir, put.Code)
		}
		if _, err := os.Stat(filepath.Join(alias.realDir, "injected.txt")); err == nil {
			t.Errorf("PUT via %s created a file in the protected directory", alias.urlDir)
			_ = os.Remove(filepath.Join(alias.realDir, "injected.txt"))
		}
	}
	t.Logf("exercised %d of %d aliases", exercised, len(aliases))

	normal := "/webdav/data/" + webdavGuardNormalBoxID
	if get := serveWebDAVTestRequest(h, http.MethodGet, normal+"/doc.sy", nil, ""); get.Code != http.StatusOK || get.Body.String() != "plain document" {
		t.Fatalf("GET normal notebook file: status = %d, body = %q", get.Code, get.Body.String())
	}
	if put := serveWebDAVTestRequest(h, http.MethodPut, normal+"/new.sy", nil, "new"); put.Code != http.StatusCreated {
		t.Fatalf("PUT normal notebook file: status = %d", put.Code)
	}
}

// TestWebDAVGuardCleansNamesLikeWebDAVDir 验证守卫与 webdav.Dir 以同样的方式清理名称：
// webdav.Dir 把 "../temp/x" 当作 "/temp/x" 解析到工作空间内，守卫不能把它判为工作空间外的路径而放行。
func TestWebDAVGuardCleansNamesLikeWebDAVDir(t *testing.T) {
	ws := newWebDAVGuardWorkspace(t)
	fs := &encryptedBoxAwareWebdavFS{inner: webdav.Dir(ws)}
	for _, name := range []string{
		"../temp/export/plain.md",
		"../../temp/export/plain.md",
		"../data/" + webdavGuardEncryptedBoxID + "/secret.sy",
	} {
		if file, err := fs.OpenFile(context.Background(), name, os.O_RDONLY, 0); !errors.Is(err, os.ErrPermission) {
			if nil == err {
				file.Close()
			}
			t.Errorf("OpenFile(%q): err = %v, want permission error", name, err)
		}
	}
}

// TestWebDAVGuardKeepsDataDirectoryInPlace 验证不能整体删除或移走 data/，否则加密笔记本会随之被删除或移走。
func TestWebDAVGuardKeepsDataDirectoryInPlace(t *testing.T) {
	ws := newWebDAVGuardWorkspace(t)
	h := newWebDAVHandler()
	boxConf := filepath.Join(ws, "data", webdavGuardEncryptedBoxID, ".siyuan", "conf.json")

	if response := serveWebDAVTestRequest(h, http.MethodDelete, "/webdav/data", nil, ""); response.Code >= 200 && response.Code < 300 {
		t.Errorf("DELETE /webdav/data: status = %d, want rejection", response.Code)
	}
	if _, err := os.Stat(boxConf); err != nil {
		t.Fatalf("encrypted notebook removed by DELETE /webdav/data: %v", err)
	}

	move := serveWebDAVTestRequest(h, "MOVE", "/webdav/data", map[string]string{"Destination": "/webdav/moved-data"}, "")
	if move.Code >= 200 && move.Code < 300 {
		t.Errorf("MOVE /webdav/data: status = %d, want rejection", move.Code)
	}
	if _, err := os.Stat(boxConf); err != nil {
		t.Fatalf("encrypted notebook moved by MOVE /webdav/data: %v", err)
	}
	if _, err := os.Stat(filepath.Join(ws, "moved-data")); err == nil {
		t.Fatal("MOVE /webdav/data created the destination")
	}

	if response := serveWebDAVTestRequest(h, http.MethodDelete, "/webdav/data/"+webdavGuardNormalBoxID, nil, ""); response.Code != http.StatusNoContent {
		t.Fatalf("DELETE normal notebook directory: status = %d, want 204", response.Code)
	}
}
