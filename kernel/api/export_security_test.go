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
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestExportBrowserHTMLRejectsPathTraversal(t *testing.T) {
	gin.SetMode(gin.TestMode)

	originalConf, originalTempDir := model.Conf, util.TempDir
	workspaceDir := t.TempDir()
	util.TempDir = filepath.Join(workspaceDir, "temp")
	model.Conf = model.NewAppConf()
	defer func() {
		model.Conf, util.TempDir = originalConf, originalTempDir
	}()

	escapedDir := filepath.Join(filepath.Dir(workspaceDir), "escaped")
	if err := os.MkdirAll(escapedDir, 0755); err != nil {
		t.Fatal(err)
	}
	rel, err := filepath.Rel(filepath.Join(util.TempDir, "export"), escapedDir)
	if err != nil {
		t.Fatal(err)
	}

	body, err := json.Marshal(map[string]string{
		"folder": filepath.ToSlash(rel),
		"html":   "<script>alert(1)</script>",
		"name":   "x",
	})
	if err != nil {
		t.Fatal(err)
	}

	engine := gin.New()
	engine.POST("/api/export/exportBrowserHTML", exportBrowserHTML)

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/export/exportBrowserHTML", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	engine.ServeHTTP(recorder, request)

	response := &struct {
		Code int    `json:"code"`
		Msg  string `json:"msg"`
	}{}
	if err := json.Unmarshal(recorder.Body.Bytes(), response); err != nil {
		t.Fatalf("unmarshal response failed: %v", err)
	}
	if response.Code != -1 {
		t.Fatalf("path traversal folder was accepted: %s", recorder.Body.String())
	}
	if _, err := os.Stat(filepath.Join(escapedDir, "index.html")); !os.IsNotExist(err) {
		t.Fatalf("index.html was written outside the export directory: %v", err)
	}
}

func TestExportBrowserHTMLAcceptsNormalFolder(t *testing.T) {
	gin.SetMode(gin.TestMode)

	originalConf, originalTempDir := model.Conf, util.TempDir
	workspaceDir := t.TempDir()
	util.TempDir = filepath.Join(workspaceDir, "temp")
	model.Conf = model.NewAppConf()
	defer func() {
		model.Conf, util.TempDir = originalConf, originalTempDir
	}()

	const folder = "htmlmd-20260101000000-abc123def"
	exportDir := filepath.Join(util.TempDir, "export")
	if err := os.MkdirAll(filepath.Join(exportDir, folder), 0755); err != nil {
		t.Fatal(err)
	}

	body, err := json.Marshal(map[string]string{
		"folder": folder,
		"html":   "<h1>hello</h1>",
		"name":   "x",
	})
	if err != nil {
		t.Fatal(err)
	}

	engine := gin.New()
	engine.POST("/api/export/exportBrowserHTML", exportBrowserHTML)

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/export/exportBrowserHTML", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	engine.ServeHTTP(recorder, request)

	response := &struct {
		Code int `json:"code"`
	}{}
	if err := json.Unmarshal(recorder.Body.Bytes(), response); err != nil {
		t.Fatalf("unmarshal response failed: %v", err)
	}
	if response.Code != 0 {
		t.Fatalf("normal folder was rejected: %s", recorder.Body.String())
	}
}
