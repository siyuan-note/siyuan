package api

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAPIContractFileMalformedBody(t *testing.T) {
	engine := gin.New()
	engine.POST("/api/file/readDir", readDir)
	engine.POST("/api/file/renameFile", renameFile)
	engine.POST("/api/file/removeFile", removeFile)
	engine.POST("/api/file/getUniqueFilename", getUniqueFilename)
	for _, path := range []string{"/api/file/readDir", "/api/file/renameFile", "/api/file/removeFile", "/api/file/getUniqueFilename"} {
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest("POST", path, strings.NewReader("{")))
		requireAPIContract(t, "POST", path, recorder)
		var response struct {
			Code int `json:"code"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code != -1 {
			t.Fatalf("expected one valid error response: %s, %v", recorder.Body.String(), err)
		}
	}
}

func TestAPIContractGetFileTransport(t *testing.T) {
	originalWorkspace, originalData := util.WorkspaceDir, util.DataDir
	util.WorkspaceDir = t.TempDir()
	util.DataDir = filepath.Join(util.WorkspaceDir, "data")
	t.Cleanup(func() { util.WorkspaceDir, util.DataDir = originalWorkspace, originalData })
	engine := gin.New()
	engine.Use(func(c *gin.Context) { c.Set(model.RoleContextKey, model.RoleAdministrator) })
	engine.POST("/api/file/getFile", getFile)
	for _, entry := range []struct{ name, content, media string }{
		{"file.txt", "plain text", "text/plain"},
		{"file.json", `{"nested":[1,true,null]}`, "application/json"},
		{"file.bin", "\x00\xff\x01\x02", "application/octet-stream"},
	} {
		if err := os.WriteFile(filepath.Join(util.WorkspaceDir, entry.name), []byte(entry.content), 0644); err != nil {
			t.Fatal(err)
		}
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest("POST", "/api/file/getFile", strings.NewReader(`{"path":" `+entry.name+` "}`)))
		requireAPIContract(t, "POST", "/api/file/getFile", recorder)
		if recorder.Code != 200 || recorder.Body.String() != entry.content || !strings.HasPrefix(recorder.Header().Get("Content-Type"), entry.media) {
			t.Fatalf("raw response changed: %d %v %q", recorder.Code, recorder.Header(), recorder.Body.String())
		}
	}
	for _, entry := range []struct {
		body string
		code int
	}{
		{"{", -1}, {`{}`, -1}, {`{"path":null}`, -1}, {`{"path":false}`, -1},
		{`{"path":"missing.txt"}`, 404}, {`{"path":"."}`, 409},
	} {
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest("POST", "/api/file/getFile", strings.NewReader(entry.body)))
		requireAPIContract(t, "POST", "/api/file/getFile", recorder)
		var response struct {
			Code int `json:"code"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || recorder.Code != 202 || response.Code != entry.code {
			t.Fatalf("file failure changed: %d %s, %v", recorder.Code, recorder.Body.String(), err)
		}
	}
}

func TestAPIContractFileEncryptedPath(t *testing.T) {
	_, boxID := setupArchiveWorkspace(t)
	originalConf := model.Conf
	model.Conf = model.NewAppConf()
	t.Cleanup(func() { model.Conf = originalConf })
	filePath := "data/" + boxID + "/existing.sy"
	absPath := filepath.Join(util.WorkspaceDir, filePath)
	if err := os.WriteFile(absPath, []byte("ciphertext"), 0600); err != nil {
		t.Fatal(err)
	}
	engine := gin.New()
	engine.Use(func(c *gin.Context) { c.Set(model.RoleContextKey, model.RoleAdministrator) })
	engine.POST("/api/file/getFile", getFile)
	engine.POST("/api/file/putFile", putFile)
	engine.POST("/api/file/removeFile", removeFile)
	engine.POST("/api/file/renameFile", renameFile)
	engine.POST("/api/file/readDir", readDir)
	for _, entry := range []struct{ route, body, media string }{
		{"getFile", `{"path":"` + filePath + `"}`, "application/json"},
		{"putFile", "path=" + filePath + "&isDir=true", "application/x-www-form-urlencoded"},
		{"removeFile", `{"path":"` + filePath + `"}`, "application/json"},
		{"renameFile", `{"path":"` + filePath + `","newPath":"temp/moved.sy"}`, "application/json"},
		{"readDir", `{"path":"data/` + boxID + `"}`, "application/json"},
	} {
		path := "/api/file/" + entry.route
		request := httptest.NewRequest("POST", path, strings.NewReader(entry.body))
		request.Header.Set("Content-Type", entry.media)
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, request)
		requireAPIContract(t, "POST", path, recorder)
		var response struct {
			Code int `json:"code"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code != -3 {
			t.Fatalf("encrypted path admitted by %s: %s, %v", path, recorder.Body.String(), err)
		}
	}
	content, err := os.ReadFile(absPath)
	if err != nil || string(content) != "ciphertext" {
		t.Fatalf("encrypted source changed: %q, %v", content, err)
	}
}

func TestAPIContractPutFileFormCompatibility(t *testing.T) {
	originalWorkspace := util.WorkspaceDir
	util.WorkspaceDir = t.TempDir()
	t.Cleanup(func() { util.WorkspaceDir = originalWorkspace })
	engine := gin.New()
	engine.POST("/api/file/putFile", putFile)
	for _, entry := range []struct {
		name, body, created string
		code                int
	}{
		{"missing path", "isDir=true", "", 400},
		{"directory without file", "path=temp/first&path=temp/ignored&isDir=true&modTime=1700000000123", "temp/first", 0},
		{"invalid bool requires file", "path=temp/missing&isDir=invalid", "", 400},
		{"timestamp checked after creation", "path=temp/created&isDir=true&modTime=invalid", "temp/created", 500},
	} {
		t.Run(entry.name, func(t *testing.T) {
			request := httptest.NewRequest("POST", "/api/file/putFile", strings.NewReader(entry.body))
			request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
			recorder := httptest.NewRecorder()
			engine.ServeHTTP(recorder, request)
			requireAPIContract(t, "POST", "/api/file/putFile", recorder)
			var response struct {
				Code int `json:"code"`
			}
			if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code != entry.code {
				t.Fatalf("unexpected form response: %s, %v", recorder.Body.String(), err)
			}
			if entry.created != "" {
				info, err := os.Stat(filepath.Join(util.WorkspaceDir, entry.created))
				if err != nil || !info.IsDir() {
					t.Fatalf("directory not created: %v", err)
				}
				if entry.code == 0 && info.ModTime().UnixMilli() != 1700000000123 {
					t.Fatalf("modification time changed: %s", info.ModTime())
				}
			}
		})
	}
	if _, err := os.Stat(filepath.Join(util.WorkspaceDir, "temp/ignored")); !os.IsNotExist(err) {
		t.Fatalf("repeated path must use first value: %v", err)
	}
}

func TestAPIContractPutFileMultipartCompatibility(t *testing.T) {
	originalWorkspace, originalData := util.WorkspaceDir, util.DataDir
	util.WorkspaceDir = t.TempDir()
	util.DataDir = filepath.Join(util.WorkspaceDir, "data")
	t.Cleanup(func() { util.WorkspaceDir, util.DataDir = originalWorkspace, originalData })
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	for _, field := range [][2]string{{"path", " temp/upload.txt "}, {"isDir", "false"}, {"modTime", "1700000000123"}} {
		if err := writer.WriteField(field[0], field[1]); err != nil {
			t.Fatal(err)
		}
	}
	for _, content := range []string{"first file", "ignored file"} {
		part, err := writer.CreateFormFile("file", "upload.txt")
		if err != nil {
			t.Fatal(err)
		}
		if _, err = part.Write([]byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	engine := gin.New()
	engine.POST("/api/file/putFile", putFile)
	request := httptest.NewRequest("POST", "/api/file/putFile", &body)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, request)
	requireAPIContract(t, "POST", "/api/file/putFile", recorder)
	var response struct {
		Code int `json:"code"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code != 0 {
		t.Fatalf("upload failed: %s, %v", recorder.Body.String(), err)
	}
	path := filepath.Join(util.WorkspaceDir, "temp/upload.txt")
	content, err := os.ReadFile(path)
	if err != nil || string(content) != "first file" {
		t.Fatalf("uploaded content changed: %q, %v", content, err)
	}
	info, err := os.Stat(path)
	if err != nil || info.ModTime().UnixMilli() != 1700000000123 {
		t.Fatalf("uploaded modification time changed: %v, %v", info, err)
	}
}

func TestAPIContractFileCopyErrors(t *testing.T) {
	engine := gin.New()
	engine.POST("/api/file/globalCopyFiles", globalCopyFiles)
	engine.POST("/api/file/workspaceCopyFiles", workspaceCopyFiles)
	engine.POST("/api/file/copyFile", copyFile)
	for _, entry := range []struct{ path, body, message string }{
		{"/api/file/globalCopyFiles", `{"srcs":["relative.txt"],"destDir":""}`, "Field [srcs]: each path must be absolute"},
		{"/api/file/globalCopyFiles", `{"srcs":[],"destDir":""}`, "Field [srcs] must not be empty"},
		{"/api/file/workspaceCopyFiles", `{"srcs":[" "],"destDir":""}`, "Field [srcs]: path must not be empty"},
		{"/api/file/workspaceCopyFiles", `{"srcs":[null],"destDir":""}`, "Field [srcs]: each element should be of type [String]"},
		{"/api/file/copyFile", `{"src":"asset.png","dest":"relative.png"}`, "Field [dest]: path must be absolute"},
	} {
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest("POST", entry.path, strings.NewReader(entry.body)))
		requireAPIContract(t, "POST", entry.path, recorder)
		var response struct {
			Code int    `json:"code"`
			Msg  string `json:"msg"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code != -1 || response.Msg != entry.message {
			t.Fatalf("copy error changed: %s, %v", recorder.Body.String(), err)
		}
	}
}
