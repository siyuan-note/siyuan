package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/conf"
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

func TestReadDirAPI(t *testing.T) {
	gin.SetMode(gin.TestMode)

	oldWorkspaceDir := util.WorkspaceDir
	oldDataDir := util.DataDir
	oldReadOnly := util.ReadOnly
	oldConf := model.Conf
	oldLangs := util.Langs
	workspace := t.TempDir()
	util.WorkspaceDir = workspace
	util.DataDir = filepath.Join(workspace, "data")
	util.ReadOnly = false
	model.Conf = model.NewAppConf()
	model.Conf.Lang = "read-dir-test"
	util.Langs = map[string]map[int]string{
		"read-dir-test": {321: "encrypted notebook access denied"},
	}
	t.Cleanup(func() {
		util.WorkspaceDir = oldWorkspaceDir
		util.DataDir = oldDataDir
		util.ReadOnly = oldReadOnly
		model.Conf = oldConf
		util.Langs = oldLangs
	})

	directory := filepath.Join(workspace, "directory")
	if err := os.MkdirAll(filepath.Join(directory, "A"), 0755); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"b", "m", "z"} {
		if err := os.WriteFile(filepath.Join(directory, name), []byte(name), 0644); err != nil {
			t.Fatal(err)
		}
	}

	mixedCaseDirectory := filepath.Join(workspace, "MiXeD")
	if err := os.Mkdir(mixedCaseDirectory, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(mixedCaseDirectory, "entry"), []byte("content"), 0644); err != nil {
		t.Fatal(err)
	}
	mixedStatus, mixedBody := requestReadDir(t, model.RoleAdministrator, `{"path":"MiXeD"}`)
	mixedResponse := decodeReadDirResponse(t, mixedBody)
	if mixedStatus != http.StatusOK || mixedResponse.Code != 0 {
		t.Fatalf("mixed-case directory access failed: status=%d body=%s", mixedStatus, mixedBody)
	}

	status, body := requestReadDir(t, model.RoleAdministrator, `{"path":"directory"}`)
	if status != http.StatusOK {
		t.Fatalf("administrator transport status = %d: %s", status, body)
	}
	response := decodeReadDirResponse(t, body)
	if response.Code != 0 {
		t.Fatalf("administrator logical code = %d: %s", response.Code, body)
	}
	var files []map[string]json.RawMessage
	if err := json.Unmarshal(response.Data, &files); err != nil {
		t.Fatal(err)
	}
	wantNames := []string{"A", "b", "m", "z"}
	if len(files) != len(wantNames) {
		t.Fatalf("file count = %d: %s", len(files), body)
	}
	allowedFields := map[string]bool{"name": true, "isDir": true, "isSymlink": true, "updated": true}
	for i, file := range files {
		if len(file) != len(allowedFields) {
			t.Fatalf("file %d fields = %v", i, file)
		}
		for field := range file {
			if !allowedFields[field] {
				t.Fatalf("unexpected response field %q", field)
			}
		}
		var name string
		if err := json.Unmarshal(file["name"], &name); err != nil {
			t.Fatal(err)
		}
		if name != wantNames[i] {
			t.Fatalf("file %d name = %q, want %q", i, name, wantNames[i])
		}
	}

	for _, role := range []model.Role{model.RoleEditor, model.RoleReader} {
		status, _ = requestReadDir(t, role, `{"path":"directory"}`)
		if status != http.StatusForbidden {
			t.Fatalf("role %v transport status = %d", role, status)
		}
	}

	util.ReadOnly = true
	status, body = requestReadDir(t, model.RoleAdministrator, `{"path":"directory"}`)
	util.ReadOnly = false
	if status != http.StatusOK || decodeReadDirResponse(t, body).Code != 0 {
		t.Fatalf("read-only directory read failed: status=%d body=%s", status, body)
	}

	status, body = requestReadDir(t, model.RoleAdministrator, `{"path":"missing"}`)
	response = decodeReadDirResponse(t, body)
	if status != http.StatusOK || response.Code != http.StatusNotFound || string(response.Data) != "null" {
		t.Fatalf("missing path response: status=%d body=%s", status, body)
	}
	status, body = requestReadDir(t, model.RoleAdministrator, `{"path":"directory/b"}`)
	response = decodeReadDirResponse(t, body)
	if status != http.StatusOK || response.Code != http.StatusConflict || string(response.Data) != "null" {
		t.Fatalf("non-directory response: status=%d body=%s", status, body)
	}
	status, body = requestReadDir(t, model.RoleAdministrator, `{"path":"../outside"}`)
	response = decodeReadDirResponse(t, body)
	if status != http.StatusOK || response.Code != http.StatusForbidden || string(response.Data) != "null" {
		t.Fatalf("escape response: status=%d body=%s", status, body)
	}

	status, body = requestReadDir(t, model.RoleAdministrator, `{"path":`)
	if status != http.StatusOK || !json.Valid(body) {
		t.Fatalf("malformed request returned invalid envelope: status=%d body=%q", status, body)
	}

	outside := t.TempDir()
	unsafeDirectory := filepath.Join(workspace, "unsafe")
	if err := os.Mkdir(unsafeDirectory, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(unsafeDirectory, "A"), []byte("stable"), 0644); err != nil {
		t.Fatal(err)
	}
	if createTestSymlink(t, outside, filepath.Join(unsafeDirectory, "z")) {
		status, body = requestReadDir(t, model.RoleAdministrator, `{"path":"unsafe"}`)
		response = decodeReadDirResponse(t, body)
		if status != http.StatusOK || response.Code != http.StatusInternalServerError || string(response.Data) != "null" {
			t.Fatalf("escaping entry response: status=%d body=%s", status, body)
		}
	}

	const boxID = "20260807000000-abcdefg"
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
	status, body = requestReadDir(t, model.RoleAdministrator, `{"path":"data/`+boxID+`"}`)
	response = decodeReadDirResponse(t, body)
	if status != http.StatusOK || response.Code != -3 || string(response.Data) != "null" {
		t.Fatalf("encrypted notebook response: status=%d body=%s", status, body)
	}
}

func TestReadDirAPIWindowsReparseMatrix(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("Windows reparse API test")
	}
	oldWorkspaceDir := util.WorkspaceDir
	workspaceBase := windowsTempDir(t, os.Getenv("LOCALAPPDATA"))
	workspace := filepath.Join(workspaceBase, "workspace")
	if err := os.Mkdir(workspace, 0755); err != nil {
		t.Fatal(err)
	}
	util.WorkspaceDir = workspace
	t.Cleanup(func() { util.WorkspaceDir = oldWorkspaceDir })

	insideTarget := filepath.Join(workspace, "inside-target")
	if err := os.Mkdir(insideTarget, 0755); err != nil {
		t.Fatal(err)
	}
	createTestJunction(t, insideTarget, filepath.Join(workspace, "inside-junction"))
	status, body := requestReadDir(t, model.RoleAdministrator, `{"path":"inside-junction"}`)
	response := decodeReadDirResponse(t, body)
	if status != http.StatusOK || response.Code != http.StatusInternalServerError || string(response.Data) != "null" {
		t.Fatalf("internal junction response: status=%d body=%s", status, body)
	}
	t.Log("internal junction request returned logical 500 with null data")

	crossTarget := windowsCrossVolumeTempDir(t, `D:\`)
	createTestJunction(t, crossTarget, filepath.Join(workspace, "cross-direct"))
	status, body = requestReadDir(t, model.RoleAdministrator, `{"path":"cross-direct"}`)
	response = decodeReadDirResponse(t, body)
	if status != http.StatusOK || response.Code != http.StatusForbidden || string(response.Data) != "null" {
		t.Fatalf("cross-volume junction response: status=%d body=%s", status, body)
	}
	t.Log("C:-to-D: junction request returned logical 403 with null data")

	listing := filepath.Join(workspace, "listing")
	if err := os.Mkdir(listing, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(listing, "A"), []byte("stable"), 0644); err != nil {
		t.Fatal(err)
	}
	createTestJunction(t, crossTarget, filepath.Join(listing, "z"))
	status, body = requestReadDir(t, model.RoleAdministrator, `{"path":"listing"}`)
	if !json.Valid(body) {
		t.Fatalf("cross-volume entry returned invalid JSON: %q", body)
	}
	response = decodeReadDirResponse(t, body)
	if status != http.StatusOK || response.Code != http.StatusInternalServerError || string(response.Data) != "null" {
		t.Fatalf("cross-volume entry response: status=%d body=%s", status, body)
	}
	t.Log("C:-to-D: junction entry returned logical 500 with valid JSON and null data")

	symlinkTarget := filepath.Join(workspace, "symlink-target")
	if err := os.Mkdir(symlinkTarget, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(symlinkTarget, "A"), []byte("inside"), 0644); err != nil {
		t.Fatal(err)
	}
	if createTestRelativeDirectorySymlink(t, "symlink-target", filepath.Join(workspace, "symlink")) {
		status, body = requestReadDir(t, model.RoleAdministrator, `{"path":"symlink"}`)
		response = decodeReadDirResponse(t, body)
		if status != http.StatusOK || response.Code != 0 {
			t.Fatalf("contained relative symlink response: status=%d body=%s", status, body)
		}
		t.Log("contained relative directory symlink traversal succeeded")
	}
}

type readDirAPIResponse struct {
	Code int             `json:"code"`
	Msg  string          `json:"msg"`
	Data json.RawMessage `json:"data"`
}

func requestReadDir(t *testing.T, role model.Role, body string) (int, []byte) {
	t.Helper()
	engine := gin.New()
	engine.Use(func(c *gin.Context) {
		c.Set(model.RoleContextKey, role)
		c.Next()
	})
	ServeAPI(engine)

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/file/readDir", bytes.NewBufferString(body))
	request.Header.Set("Content-Type", "application/json")
	engine.ServeHTTP(recorder, request)
	return recorder.Code, recorder.Body.Bytes()
}

func decodeReadDirResponse(t *testing.T, body []byte) readDirAPIResponse {
	t.Helper()
	response := readDirAPIResponse{}
	if err := json.Unmarshal(body, &response); err != nil {
		t.Fatalf("decode response failed: %v: %s", err, body)
	}
	return response
}
