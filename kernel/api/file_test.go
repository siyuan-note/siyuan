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

func TestGetFileReaderRejectsAssetsSymlinkOutsideWorkspace(t *testing.T) {
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
	linkPath := filepath.Join(assetsDir, "leak.txt")
	if err := os.Symlink(outsideFile, linkPath); err != nil {
		t.Skipf("symlinks are not supported on this system: %s", err)
	}

	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Set(model.RoleContextKey, model.RoleReader)
	request := httptest.NewRequest(http.MethodPost, "/api/file/getFile", strings.NewReader(`{"path":"data/assets/leak.txt"}`))
	request.Header.Set("Content-Type", "application/json")
	context.Request = request
	getFile(context)

	if recorder.Code == http.StatusOK {
		t.Fatalf("reader must not read workspace-external files via assets symlink, got status %d: %s", recorder.Code, recorder.Body.String())
	}
	if strings.Contains(recorder.Body.String(), string(content)) {
		t.Fatalf("workspace-external file content leaked to reader: %s", recorder.Body.String())
	}
}

func TestGetFileAdminCanFollowAssetsSymlinkOutsideWorkspace(t *testing.T) {
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
	outsideFile := filepath.Join(outsideDir, "external.txt")
	content := []byte("admin readable external content")
	if err := os.WriteFile(outsideFile, content, 0644); err != nil {
		t.Fatal(err)
	}

	assetsDir := filepath.Join(util.DataDir, "assets")
	if err := os.MkdirAll(assetsDir, 0755); err != nil {
		t.Fatal(err)
	}
	linkPath := filepath.Join(assetsDir, "external-link.txt")
	if err := os.Symlink(outsideFile, linkPath); err != nil {
		t.Skipf("symlinks are not supported on this system: %s", err)
	}

	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Set(model.RoleContextKey, model.RoleAdministrator)
	request := httptest.NewRequest(http.MethodPost, "/api/file/getFile", strings.NewReader(`{"path":"data/assets/external-link.txt"}`))
	request.Header.Set("Content-Type", "application/json")
	context.Request = request
	getFile(context)

	if recorder.Code != http.StatusOK {
		t.Fatalf("admin should keep legacy symlink access, got status %d: %s", recorder.Code, recorder.Body.String())
	}
	if recorder.Body.String() != string(content) {
		t.Fatalf("unexpected symlink target content: %q", recorder.Body.String())
	}
}
