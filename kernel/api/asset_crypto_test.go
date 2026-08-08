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
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

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
