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

// TestGetFileReaderCanReadHiddenNotebookFile 验证「仅隐藏」语义：reader 可通过原始文件 API
// 直接读取显式隐藏（Visible:false）笔记本下的普通文件与 .sy 文档，
// 隐藏仅控制发布文件树中的列出，不构成访问控制边界。
func TestGetFileReaderCanReadHiddenNotebookFile(t *testing.T) {
	workspaceDir := t.TempDir()
	origWorkspaceDir, origDataDir := util.WorkspaceDir, util.DataDir
	util.WorkspaceDir = workspaceDir
	util.DataDir = filepath.Join(workspaceDir, "data")
	t.Cleanup(func() {
		util.WorkspaceDir, util.DataDir = origWorkspaceDir, origDataDir
		if err := model.SetPublishAccess(model.PublishAccess{}); err != nil {
			t.Errorf("reset publish access failed: %v", err)
		}
	})

	const boxID = "20260821000000-hidebox"
	boxDir := filepath.Join(util.DataDir, boxID)
	if err := os.MkdirAll(boxDir, 0755); err != nil {
		t.Fatal(err)
	}
	canary := []byte("PRIVATE_NOTE_CANARY")
	names := []string{"private.txt", "20260821000001-hiddoc.sy"}
	for _, name := range names {
		if err := os.WriteFile(filepath.Join(boxDir, name), canary, 0644); err != nil {
			t.Fatal(err)
		}
	}
	if err := model.SetPublishAccess(model.PublishAccess{{ID: boxID, Visible: false}}); err != nil {
		t.Fatal(err)
	}

	for _, name := range names {
		recorder := httptest.NewRecorder()
		context, _ := gin.CreateTestContext(recorder)
		context.Set(model.RoleContextKey, model.RoleReader)
		request := httptest.NewRequest(http.MethodPost, "/api/file/getFile",
			strings.NewReader(`{"path":"data/`+boxID+`/`+name+`"}`))
		request.Header.Set("Content-Type", "application/json")
		context.Request = request
		getFile(context)

		if recorder.Code != http.StatusOK {
			t.Fatalf("reader should read file [%s] under hidden notebook, got status %d: %s",
				name, recorder.Code, recorder.Body.String())
		}
		if !strings.Contains(recorder.Body.String(), string(canary)) {
			t.Fatalf("hidden notebook file [%s] content missing: %s", name, recorder.Body.String())
		}
	}
}

// TestGetFileReaderCanReadVisibleNotebookFile 验证 reader 仍可读取可见笔记本下的文件，
// 防止 Visible 校验误伤正常发布访问。
func TestGetFileReaderCanReadVisibleNotebookFile(t *testing.T) {
	workspaceDir := t.TempDir()
	origWorkspaceDir, origDataDir := util.WorkspaceDir, util.DataDir
	util.WorkspaceDir = workspaceDir
	util.DataDir = filepath.Join(workspaceDir, "data")
	t.Cleanup(func() {
		util.WorkspaceDir, util.DataDir = origWorkspaceDir, origDataDir
		if err := model.SetPublishAccess(model.PublishAccess{}); err != nil {
			t.Errorf("reset publish access failed: %v", err)
		}
	})

	const boxID = "20260821000002-showbox"
	boxDir := filepath.Join(util.DataDir, boxID)
	if err := os.MkdirAll(boxDir, 0755); err != nil {
		t.Fatal(err)
	}
	content := []byte("public note content")
	if err := os.WriteFile(filepath.Join(boxDir, "public.txt"), content, 0644); err != nil {
		t.Fatal(err)
	}
	if err := model.SetPublishAccess(model.PublishAccess{{ID: boxID, Visible: true}}); err != nil {
		t.Fatal(err)
	}

	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Set(model.RoleContextKey, model.RoleReader)
	request := httptest.NewRequest(http.MethodPost, "/api/file/getFile",
		strings.NewReader(`{"path":"data/`+boxID+`/public.txt"}`))
	request.Header.Set("Content-Type", "application/json")
	context.Request = request
	getFile(context)

	if recorder.Code != http.StatusOK {
		t.Fatalf("reader should read file under visible notebook, got status %d: %s",
			recorder.Code, recorder.Body.String())
	}
	if recorder.Body.String() != string(content) {
		t.Fatalf("unexpected file content: %q", recorder.Body.String())
	}
}

// TestGetFileEditorCanReadHiddenNotebookFile 验证编辑者不受发布可见性限制，
// 仍可通过原始文件 API 读取隐藏笔记本下的普通文件。
func TestGetFileEditorCanReadHiddenNotebookFile(t *testing.T) {
	workspaceDir := t.TempDir()
	origWorkspaceDir, origDataDir := util.WorkspaceDir, util.DataDir
	util.WorkspaceDir = workspaceDir
	util.DataDir = filepath.Join(workspaceDir, "data")
	t.Cleanup(func() {
		util.WorkspaceDir, util.DataDir = origWorkspaceDir, origDataDir
		if err := model.SetPublishAccess(model.PublishAccess{}); err != nil {
			t.Errorf("reset publish access failed: %v", err)
		}
	})

	const boxID = "20260821000003-editbox"
	boxDir := filepath.Join(util.DataDir, boxID)
	if err := os.MkdirAll(boxDir, 0755); err != nil {
		t.Fatal(err)
	}
	content := []byte("editor accessible content")
	if err := os.WriteFile(filepath.Join(boxDir, "private.txt"), content, 0644); err != nil {
		t.Fatal(err)
	}
	if err := model.SetPublishAccess(model.PublishAccess{{ID: boxID, Visible: false}}); err != nil {
		t.Fatal(err)
	}

	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Set(model.RoleContextKey, model.RoleEditor)
	request := httptest.NewRequest(http.MethodPost, "/api/file/getFile",
		strings.NewReader(`{"path":"data/`+boxID+`/private.txt"}`))
	request.Header.Set("Content-Type", "application/json")
	context.Request = request
	getFile(context)

	if recorder.Code != http.StatusOK {
		t.Fatalf("editor should read file under hidden notebook, got status %d: %s",
			recorder.Code, recorder.Body.String())
	}
	if recorder.Body.String() != string(content) {
		t.Fatalf("unexpected file content: %q", recorder.Body.String())
	}
}

// TestGetFileDeniesNotebookSiyuanConf 验证非管理员无法通过原始文件 API 读取笔记本
// .siyuan 目录下的内部文件（与发布可见性无关，黑名单独立拦截）。
func TestGetFileDeniesNotebookSiyuanConf(t *testing.T) {
	workspaceDir := t.TempDir()
	origWorkspaceDir, origDataDir := util.WorkspaceDir, util.DataDir
	util.WorkspaceDir = workspaceDir
	util.DataDir = filepath.Join(workspaceDir, "data")
	t.Cleanup(func() {
		util.WorkspaceDir, util.DataDir = origWorkspaceDir, origDataDir
		if err := model.SetPublishAccess(model.PublishAccess{}); err != nil {
			t.Errorf("reset publish access failed: %v", err)
		}
	})

	const boxID = "20260821000004-confbox"
	confDir := filepath.Join(util.DataDir, boxID, ".siyuan")
	if err := os.MkdirAll(confDir, 0755); err != nil {
		t.Fatal(err)
	}
	canary := []byte(`{"name":"private notebook"}`)
	if err := os.WriteFile(filepath.Join(confDir, "conf.json"), canary, 0644); err != nil {
		t.Fatal(err)
	}
	if err := model.SetPublishAccess(model.PublishAccess{{ID: boxID, Visible: true}}); err != nil {
		t.Fatal(err)
	}

	for _, role := range []model.Role{model.RoleEditor, model.RoleReader} {
		recorder := httptest.NewRecorder()
		context, _ := gin.CreateTestContext(recorder)
		context.Set(model.RoleContextKey, role)
		request := httptest.NewRequest(http.MethodPost, "/api/file/getFile",
			strings.NewReader(`{"path":"data/`+boxID+`/.siyuan/conf.json"}`))
		request.Header.Set("Content-Type", "application/json")
		context.Request = request
		getFile(context)

		if recorder.Code == http.StatusOK {
			t.Fatalf("role [%d] must not read notebook .siyuan/conf.json, got status %d: %s",
				role, recorder.Code, recorder.Body.String())
		}
		if strings.Contains(recorder.Body.String(), string(canary)) {
			t.Fatalf("notebook conf leaked to role [%d]: %s", role, recorder.Body.String())
		}
	}
}
