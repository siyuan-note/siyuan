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

// TestRenderTemplatePathRestriction 验证 /api/template/render 拒绝读取 <data>/templates/ 目录之外的路径，
// 防止通过模板渲染接口读取工作空间内的敏感文件（如 conf/conf.json）
func TestRenderTemplatePathRestriction(t *testing.T) {
	tmpWorkspace := t.TempDir()
	origWorkspace, origData := util.WorkspaceDir, util.DataDir
	util.WorkspaceDir = tmpWorkspace
	util.DataDir = filepath.Join(tmpWorkspace, "data")
	t.Cleanup(func() { util.WorkspaceDir, util.DataDir = origWorkspace, origData })

	confFile := filepath.Join(tmpWorkspace, "conf", "conf.json")
	if err := os.MkdirAll(filepath.Dir(confFile), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(confFile, []byte(`{"api":{"token":"secret"}}`), 0644); err != nil {
		t.Fatal(err)
	}

	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.Use(func(c *gin.Context) {
		c.Set(model.RoleContextKey, model.RoleAdministrator)
		c.Next()
	})
	ServeAPI(engine)

	body, err := json.Marshal(map[string]any{
		"id":   "20220724223548-j6g0o87",
		"path": confFile,
	})
	if err != nil {
		t.Fatal(err)
	}
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/template/render", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	engine.ServeHTTP(recorder, request)

	response := &struct {
		Code int    `json:"code"`
		Msg  string `json:"msg"`
	}{}
	if err := json.Unmarshal(recorder.Body.Bytes(), response); err != nil {
		t.Fatal(err)
	}
	if -1 != response.Code {
		t.Fatalf("conf.json should be rejected: got code %d, msg %q", response.Code, response.Msg)
	}
	if "Path ["+confFile+"] is not in templates directory" != response.Msg {
		t.Fatalf("unexpected msg: got %q", response.Msg)
	}
}

// TestIsPathInTemplatesDir 覆盖模板路径校验：仅接受 <data>/templates/ 目录内的文件，
// 并拒绝通过符号链接指向目录外的敏感文件
func TestIsPathInTemplatesDir(t *testing.T) {
	tmpWorkspace := t.TempDir()
	origWorkspace, origData := util.WorkspaceDir, util.DataDir
	util.WorkspaceDir = tmpWorkspace
	util.DataDir = filepath.Join(tmpWorkspace, "data")
	t.Cleanup(func() { util.WorkspaceDir, util.DataDir = origWorkspace, origData })

	templatesDir := filepath.Join(util.DataDir, "templates")
	templateFile := filepath.Join(templatesDir, "sub", "foo.md")
	if err := os.MkdirAll(filepath.Dir(templateFile), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(templateFile, []byte("foo"), 0644); err != nil {
		t.Fatal(err)
	}

	confFile := filepath.Join(tmpWorkspace, "conf", "conf.json")
	if err := os.MkdirAll(filepath.Dir(confFile), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(confFile, []byte(`{"api":{"token":"secret"}}`), 0644); err != nil {
		t.Fatal(err)
	}
	assetFile := filepath.Join(util.DataDir, "assets", "note.md")
	if err := os.MkdirAll(filepath.Dir(assetFile), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(assetFile, []byte("asset"), 0644); err != nil {
		t.Fatal(err)
	}

	rejected := []string{
		confFile,  // 工作空间内的敏感文件
		assetFile, // 模板目录之外的工作空间文件
		filepath.Join(util.DataDir, "templates2"), // 名称相近的目录
		"foo.md", // 相对路径
	}
	for _, p := range rejected {
		if got := isPathInTemplatesDir(p); got {
			t.Errorf("isPathInTemplatesDir(%q) = true, want false", p)
		}
	}

	if got := isPathInTemplatesDir(templateFile); !got {
		t.Errorf("isPathInTemplatesDir(%q) = false, want true (template file)", templateFile)
	}

	// 通过符号链接指向模板目录外的敏感文件时应被拒绝
	link := filepath.Join(templatesDir, "sub", "leak.md")
	if err := os.Symlink(confFile, link); err != nil {
		t.Skipf("symlink not supported on this platform: %v", err)
	}
	if got := isPathInTemplatesDir(link); got {
		t.Errorf("isPathInTemplatesDir(symlink -> conf.json) = true, want false")
	}
}
