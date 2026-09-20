// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func testResolveEncryptedAssetPath(t *testing.T, boxID string, key []byte) func() {
	t.Helper()
	const diskName = "asset-20260918000000-abcdefg.docx"
	const originalName = "外部文档.docx"
	plaintext := []byte("external document content")
	ciphertext, err := model.EncryptAsset(boxID, diskName, originalName, key, plaintext)
	if err != nil {
		t.Fatal(err)
	}
	source := filepath.Join(util.DataDir, boxID, "assets", diskName)
	if err = os.MkdirAll(filepath.Dir(source), 0755); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(source, ciphertext, 0600); err != nil {
		t.Fatal(err)
	}
	engine := gin.New()
	engine.Use(boxLeaseMiddleware)
	engine.POST("/api/asset/resolveAssetPath", model.CheckAuth, model.CheckAdminRole, resolveAssetPath)
	resolve := func(assetPath string, wantSuccess bool) string {
		t.Helper()
		body, _ := json.Marshal(map[string]string{"path": assetPath})
		request := httptest.NewRequest(http.MethodPost, "/api/asset/resolveAssetPath", bytes.NewReader(body))
		request.Header.Set("Authorization", "Token system-lock-test")
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, request)
		requireAPIContract(t, http.MethodPost, request.URL.Path, recorder)
		var response struct {
			Code int             `json:"code"`
			Data json.RawMessage `json:"data"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || (response.Code == 0) != wantSuccess {
			t.Fatalf("resolve asset: %s, %v", recorder.Body.String(), err)
		}
		var resolved string
		if wantSuccess {
			if err := json.Unmarshal(response.Data, &resolved); err != nil {
				t.Fatal(err)
			}
		}
		return resolved
	}
	assetPath := "assets/" + diskName + "?box=" + boxID
	exported := resolve(assetPath, true)
	wantRoot := filepath.Join(util.TempDir, "export", boxID, "external") + string(filepath.Separator)
	if !strings.HasPrefix(exported, wantRoot) || filepath.Base(exported) != originalName {
		t.Fatalf("unexpected external asset path: %s", exported)
	}
	if data, err := os.ReadFile(exported); err != nil || !bytes.Equal(data, plaintext) {
		t.Fatalf("unexpected external asset content: %v", err)
	}
	if data, err := os.ReadFile(source); err != nil || !bytes.Equal(data, ciphertext) {
		t.Fatalf("source ciphertext changed: %v", err)
	}
	// 认证失败不得发布新副本，也不得删除或改写损坏的源文件。
	corrupt := append([]byte(nil), ciphertext...)
	corrupt[len(corrupt)-1] ^= 1
	if err := os.WriteFile(source, corrupt, 0600); err != nil {
		t.Fatal(err)
	}
	resolve(assetPath, false)
	if data, err := os.ReadFile(source); err != nil || !bytes.Equal(data, corrupt) {
		t.Fatalf("corrupt ciphertext changed: %v", err)
	}
	entries, err := os.ReadDir(filepath.Dir(filepath.Dir(exported)))
	if err != nil || len(entries) != 1 {
		t.Fatalf("failed export left temporary data: %v, %d", err, len(entries))
	}
	if err = os.WriteFile(source, ciphertext, 0600); err != nil {
		t.Fatal(err)
	}
	return func() {
		t.Helper()
		resolve(assetPath, false)
		if _, err := os.Stat(exported); !os.IsNotExist(err) {
			t.Fatalf("locking did not clean external asset: %v", err)
		}
	}
}

func TestSetFileAnnotationDoesNotDeleteFromLockedEncryptedNotebook(t *testing.T) {
	gin.SetMode(gin.TestMode)

	oldWorkspaceDir, oldDataDir := util.WorkspaceDir, util.DataDir
	workspaceDir := t.TempDir()
	util.WorkspaceDir = workspaceDir
	util.DataDir = filepath.Join(workspaceDir, "data")
	t.Cleanup(func() {
		util.WorkspaceDir, util.DataDir = oldWorkspaceDir, oldDataDir
	})

	const boxID = "20260731180000-abcdefg"
	boxConf := conf.NewBoxConf()
	boxConf.Encrypted = true
	confData, err := json.Marshal(boxConf)
	if err != nil {
		t.Fatal(err)
	}
	confPath := filepath.Join(util.DataDir, boxID, ".siyuan", "conf.json")
	if err = os.MkdirAll(filepath.Dir(confPath), 0755); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(confPath, confData, 0644); err != nil {
		t.Fatal(err)
	}

	assetPath := filepath.Join(util.DataDir, boxID, "assets", "document.pdf")
	annotationPath := assetPath + ".sya"
	if err = os.MkdirAll(filepath.Dir(assetPath), 0755); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(assetPath, []byte("encrypted asset"), 0600); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(annotationPath, []byte("encrypted annotation"), 0600); err != nil {
		t.Fatal(err)
	}

	engine := gin.New()
	engine.Use(boxLeaseMiddleware)
	engine.POST("/api/asset/setFileAnnotation", setFileAnnotation)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(
		http.MethodPost,
		"/api/asset/setFileAnnotation",
		strings.NewReader(`{"path":"assets/document.pdf?box=`+boxID+`.sya","data":"{}"}`),
	)
	request.Header.Set("Content-Type", "application/json")
	engine.ServeHTTP(recorder, request)

	response := &struct {
		Code int `json:"code"`
	}{}
	if err = json.Unmarshal(recorder.Body.Bytes(), response); err != nil {
		t.Fatalf("unmarshal response failed: %v", err)
	}
	if response.Code == 0 {
		t.Fatalf("locked encrypted annotation deletion unexpectedly succeeded: %s", recorder.Body.String())
	}
	if _, err = os.Stat(annotationPath); err != nil {
		t.Fatalf("locked encrypted annotation was removed: %v", err)
	}
}
