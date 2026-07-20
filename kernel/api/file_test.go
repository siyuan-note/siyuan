package api

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestGetFileAllowsWorkspaceTemp(t *testing.T) {
	originalWorkspaceDir := util.WorkspaceDir
	originalTempDir := util.TempDir
	workspaceDir := t.TempDir()
	util.WorkspaceDir = workspaceDir
	util.TempDir = filepath.Join(workspaceDir, "temp")
	defer func() {
		util.WorkspaceDir = originalWorkspaceDir
		util.TempDir = originalTempDir
	}()

	artifact := filepath.Join(util.TempDir, "export", "plugin-package.zip")
	if err := os.MkdirAll(filepath.Dir(artifact), 0755); err != nil {
		t.Fatal(err)
	}
	content := []byte("plugin package")
	if err := os.WriteFile(artifact, content, 0644); err != nil {
		t.Fatal(err)
	}

	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Set(model.RoleContextKey, model.RoleAdministrator)
	request := httptest.NewRequest(http.MethodPost, "/api/file/getFile", strings.NewReader(`{"path":"temp/export/plugin-package.zip"}`))
	request.Header.Set("Content-Type", "application/json")
	context.Request = request
	getFile(context)

	if recorder.Code != http.StatusOK {
		t.Fatalf("workspace temp file should be accessible, got status %d: %s", recorder.Code, recorder.Body.String())
	}
	if recorder.Body.String() != string(content) {
		t.Fatalf("unexpected workspace temp file content: %q", recorder.Body.String())
	}
}
