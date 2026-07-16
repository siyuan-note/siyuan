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
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestRejectWorkspaceTempPath(t *testing.T) {
	originalWorkspaceDir := util.WorkspaceDir
	originalTempDir := util.TempDir
	workspaceDir := t.TempDir()
	util.WorkspaceDir = workspaceDir
	util.TempDir = filepath.Join(workspaceDir, "temp")
	defer func() {
		util.WorkspaceDir = originalWorkspaceDir
		util.TempDir = originalTempDir
	}()

	if err := os.MkdirAll(filepath.Join(util.TempDir, "export"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(workspaceDir, "data"), 0755); err != nil {
		t.Fatal(err)
	}

	for _, p := range []string{
		util.TempDir,
		filepath.Join(util.TempDir, "export", "artifact.zip"),
		filepath.Join("temp", "export", "artifact.zip"),
	} {
		if !rejectWorkspaceTempPath(p) {
			t.Fatalf("workspace temp path [%s] should be rejected", p)
		}
	}

	for _, p := range []string{
		filepath.Join(workspaceDir, "data", "document.sy"),
		filepath.Join(workspaceDir, "temp-other", "artifact.zip"),
	} {
		if rejectWorkspaceTempPath(p) {
			t.Fatalf("non-temp path [%s] should not be rejected", p)
		}
	}
}

func TestRejectWorkspaceTempPathThroughSymlink(t *testing.T) {
	originalWorkspaceDir := util.WorkspaceDir
	originalTempDir := util.TempDir
	workspaceDir := t.TempDir()
	util.WorkspaceDir = workspaceDir
	util.TempDir = filepath.Join(workspaceDir, "temp")
	defer func() {
		util.WorkspaceDir = originalWorkspaceDir
		util.TempDir = originalTempDir
	}()

	targetDir := filepath.Join(util.TempDir, "export")
	if err := os.MkdirAll(targetDir, 0755); err != nil {
		t.Fatal(err)
	}
	linkPath := filepath.Join(workspaceDir, "export-link")
	if err := os.Symlink(targetDir, linkPath); err != nil {
		t.Skipf("create symlink failed: %s", err)
	}

	if !rejectWorkspaceTempPath(filepath.Join(linkPath, "new", "artifact.zip")) {
		t.Fatal("path resolving through a symlink into workspace temp should be rejected")
	}
}

func TestGetFileRejectsWorkspaceTemp(t *testing.T) {
	originalWorkspaceDir := util.WorkspaceDir
	originalTempDir := util.TempDir
	workspaceDir := t.TempDir()
	util.WorkspaceDir = workspaceDir
	util.TempDir = filepath.Join(workspaceDir, "temp")
	defer func() {
		util.WorkspaceDir = originalWorkspaceDir
		util.TempDir = originalTempDir
	}()

	artifact := filepath.Join(util.TempDir, "export", "plaintext.zip")
	if err := os.MkdirAll(filepath.Dir(artifact), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(artifact, []byte("plaintext"), 0600); err != nil {
		t.Fatal(err)
	}

	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	request := httptest.NewRequest(http.MethodPost, "/api/file/getFile", strings.NewReader(`{"path":"temp/export/plaintext.zip"}`))
	request.Header.Set("Content-Type", "application/json")
	context.Request = request
	getFile(context)

	var result struct {
		Code int `json:"code"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.Code != http.StatusForbidden {
		t.Fatalf("workspace temp file should be rejected, got code %d: %s", result.Code, recorder.Body.String())
	}
}
