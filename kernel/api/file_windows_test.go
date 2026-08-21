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

//go:build windows

package api

import (
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// 目录联接（junction）无需管理员权限即可创建，是 Windows 上对符号链接漏洞的同源变体，
// 用于验证 getFile 的链接解析与工作空间边界检查（security advisory GHSA-g7gf-v79m-jwrm）
func TestGetFileJunctionBoundary(t *testing.T) {
	originalWorkspaceDir := util.WorkspaceDir
	originalDataDir := util.DataDir
	workspaceDir := t.TempDir()
	util.WorkspaceDir = workspaceDir
	util.DataDir = filepath.Join(workspaceDir, "data")
	defer func() {
		util.WorkspaceDir = originalWorkspaceDir
		util.DataDir = originalDataDir
	}()

	outsideDir := t.TempDir()
	outsideFile := filepath.Join(outsideDir, "secret.txt")
	content := []byte("outside workspace secret")
	if err := os.WriteFile(outsideFile, content, 0644); err != nil {
		t.Fatal(err)
	}

	assetsDir := filepath.Join(util.DataDir, "assets")
	if err := os.MkdirAll(assetsDir, 0755); err != nil {
		t.Fatal(err)
	}
	junctionPath := filepath.Join(assetsDir, "out")
	if out, err := exec.Command("cmd", "/c", "mklink", "/J", junctionPath, outsideDir).CombinedOutput(); err != nil {
		t.Skipf("junction creation not supported: %s: %s", err, out)
	}

	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Set(model.RoleContextKey, model.RoleReader)
	request := httptest.NewRequest(http.MethodPost, "/api/file/getFile", strings.NewReader(`{"path":"data/assets/out/secret.txt"}`))
	request.Header.Set("Content-Type", "application/json")
	context.Request = request
	getFile(context)

	if recorder.Code == http.StatusOK {
		t.Fatalf("reader must not read workspace-external files via junction, got status %d: %s", recorder.Code, recorder.Body.String())
	}
	if !strings.Contains(recorder.Body.String(), `"code":403`) {
		t.Fatalf("reader junction escape should be rejected with 403, got: %s", recorder.Body.String())
	}
	if strings.Contains(recorder.Body.String(), string(content)) {
		t.Fatalf("workspace-external file content leaked to reader: %s", recorder.Body.String())
	}

	recorder = httptest.NewRecorder()
	context, _ = gin.CreateTestContext(recorder)
	context.Set(model.RoleContextKey, model.RoleAdministrator)
	request = httptest.NewRequest(http.MethodPost, "/api/file/getFile", strings.NewReader(`{"path":"data/assets/out/secret.txt"}`))
	request.Header.Set("Content-Type", "application/json")
	context.Request = request
	getFile(context)
	if recorder.Code != http.StatusOK {
		t.Fatalf("admin should keep legacy junction access, got status %d: %s", recorder.Code, recorder.Body.String())
	}
	if recorder.Body.String() != string(content) {
		t.Fatalf("unexpected junction target content: %q", recorder.Body.String())
	}
}
