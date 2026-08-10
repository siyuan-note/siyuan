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
	"slices"
	"strings"
	"testing"

	"github.com/88250/gulu"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestRejectMobileWorkspaceBaseDir(t *testing.T) {
	_, workspaceBaseDir := prepareMobileWorkspaceBaseDirTest(t)
	ret := gulu.Ret.NewResult()

	if !rejectMobileWorkspaceBaseDir(ret, workspaceBaseDir) {
		t.Fatal("mobile workspace base dir should be rejected")
	}
	if -1 != ret.Code {
		t.Fatalf("unexpected result code: got %d, want -1", ret.Code)
	}
	if !isInvalidWorkspacePath(workspaceBaseDir) {
		t.Fatal("mobile workspace base dir should be excluded from workspace discovery")
	}
}

func TestGetMobileWorkspacesExcludesBaseDir(t *testing.T) {
	packageDir, workspaceBaseDir := prepareMobileWorkspaceBaseDirTest(t)
	otherWorkspaceDir := filepath.Join(packageDir, "Todo")
	for _, dir := range []string{util.WorkspaceDir, otherWorkspaceDir} {
		if err := os.MkdirAll(dir, 0755); err != nil {
			t.Fatal(err)
		}
	}

	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.GET("/api/system/getMobileWorkspaces", getMobileWorkspaces)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "http://127.0.0.1/api/system/getMobileWorkspaces", nil)
	engine.ServeHTTP(recorder, request)

	response := &struct {
		Code int      `json:"code"`
		Data []string `json:"data"`
	}{}
	if err := json.Unmarshal(recorder.Body.Bytes(), response); err != nil {
		t.Fatalf("unmarshal getMobileWorkspaces response failed: %s", err)
	}
	if 0 != response.Code {
		t.Fatalf("getMobileWorkspaces failed: %s", recorder.Body.String())
	}
	if slices.Contains(response.Data, workspaceBaseDir) {
		t.Fatalf("mobile workspace base dir must not be discoverable: %v", response.Data)
	}
	if !slices.Contains(response.Data, otherWorkspaceDir) {
		t.Fatalf("regular sibling workspace should remain discoverable: %v", response.Data)
	}
}

func TestRemoveWorkspaceDirPhysicallyProtectsBaseDir(t *testing.T) {
	_, workspaceBaseDir := prepareMobileWorkspaceBaseDirTest(t)
	marker := filepath.Join(workspaceBaseDir, "marker")
	if err := os.WriteFile(marker, []byte("test"), 0644); err != nil {
		t.Fatal(err)
	}

	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.POST("/api/system/removeWorkspaceDirPhysically", removeWorkspaceDirPhysically)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "http://127.0.0.1/api/system/removeWorkspaceDirPhysically",
		strings.NewReader(`{"path":"`+filepath.ToSlash(workspaceBaseDir)+`"}`))
	request.Header.Set("Content-Type", "application/json")
	engine.ServeHTTP(recorder, request)

	response := &struct {
		Code int `json:"code"`
	}{}
	if err := json.Unmarshal(recorder.Body.Bytes(), response); err != nil {
		t.Fatalf("unmarshal removeWorkspaceDirPhysically response failed: %s", err)
	}
	if -1 != response.Code {
		t.Fatalf("mobile workspace base dir removal was accepted: %s", recorder.Body.String())
	}
	if _, err := os.Stat(marker); err != nil {
		t.Fatalf("mobile workspace base dir content must remain unchanged: %s", err)
	}
}

func prepareMobileWorkspaceBaseDirTest(t *testing.T) (packageDir, workspaceBaseDir string) {
	t.Helper()
	packageDir = t.TempDir()
	workspaceBaseDir = filepath.Join(packageDir, "files")
	if err := os.MkdirAll(workspaceBaseDir, 0755); err != nil {
		t.Fatal(err)
	}

	originalContainer, originalHomeDir, originalWorkspaceDir := util.Container, util.HomeDir, util.WorkspaceDir
	originalConf := model.Conf
	originalEnglishLang, hadEnglishLang := util.Langs["en"]
	util.Container = util.ContainerAndroid
	util.HomeDir = filepath.Join(workspaceBaseDir, "home")
	util.WorkspaceDir = filepath.Join(packageDir, "1")
	model.Conf = model.NewAppConf()
	model.Conf.Lang = "en"
	util.Langs["en"] = map[int]string{274: "Please create a new folder as the workspace"}
	t.Cleanup(func() {
		util.Container, util.HomeDir, util.WorkspaceDir = originalContainer, originalHomeDir, originalWorkspaceDir
		model.Conf = originalConf
		if hadEnglishLang {
			util.Langs["en"] = originalEnglishLang
		} else {
			delete(util.Langs, "en")
		}
	})
	return packageDir, workspaceBaseDir
}
