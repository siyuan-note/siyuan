package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"mime/multipart"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAPIContractStagedImport(t *testing.T) {
	previous := util.TempDir
	util.TempDir = t.TempDir()
	t.Cleanup(func() { util.TempDir = previous })
	engine := gin.New()
	engine.POST("/api/import/cancelImportSY", cancelImportSY)
	engine.POST("/api/import/continueImportSY", continueImportSY)
	request := func(route, body string, code int, message string) {
		t.Helper()
		recorder := httptest.NewRecorder()
		path := "/api/import/" + route
		engine.ServeHTTP(recorder, httptest.NewRequest("POST", path, strings.NewReader(body)))
		requireAPIContract(t, "POST", path, recorder)
		var response struct {
			Code int             `json:"code"`
			Msg  string          `json:"msg"`
			Data json.RawMessage `json:"data"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code != code || response.Msg != message || string(response.Data) != "null" {
			t.Fatalf("staged import response changed: %s, %v", recorder.Body.String(), err)
		}
	}
	request("cancelImportSY", `{"token":" invalid "}`, -1, "invalid import token")
	request("continueImportSY", `{"token":"invalid","notebook":"box"}`, -1, "invalid import token")
	source := filepath.Join(util.TempDir, "source.zip")
	if err := os.WriteFile(source, []byte("archive"), 0600); err != nil {
		t.Fatal(err)
	}
	token, err := stageSYImport(source)
	if err != nil {
		t.Fatal(err)
	}
	request("cancelImportSY", `{"token":" `+token+` "}`, 0, "")
	if _, err := os.Stat(stagedSYImportPath(token)); !os.IsNotExist(err) {
		t.Fatalf("cancelled archive remains: %v", err)
	}
	request("cancelImportSY", `{"token":"`+token+`"}`, 0, "")
	request("continueImportSY", `{"token":"`+token+`","notebook":" box "}`, -1, "import task not found or expired")
}

func TestAPIContractObsidianTask(t *testing.T) {
	previous := model.Conf
	model.Conf = model.NewAppConf()
	t.Cleanup(func() { model.Conf = previous })
	engine := gin.New()
	engine.POST("/api/import/startObsidianVaultAnalysis", startObsidianVaultAnalysis)
	engine.POST("/api/import/getObsidianVaultTask", getObsidianVaultTask)
	engine.POST("/api/import/cancelObsidianVaultTask", cancelObsidianVaultTask)
	engine.POST("/api/import/startObsidianVaultImport", startObsidianVaultImport)
	call := func(route string, body []byte) (int, *model.ObsidianVaultTask) {
		t.Helper()
		path := "/api/import/" + route
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest("POST", path, strings.NewReader(string(body))))
		requireAPIContract(t, "POST", path, recorder)
		var response struct {
			Code int                      `json:"code"`
			Data *model.ObsidianVaultTask `json:"data"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
			t.Fatal(err)
		}
		return response.Code, response.Data
	}
	for _, route := range []string{"getObsidianVaultTask", "cancelObsidianVaultTask", "startObsidianVaultImport"} {
		for _, id := range []string{"invalid", "20260101000000-missing"} {
			code, task := call(route, []byte(`{"taskID":" `+id+` ","notebookName":" name "}`))
			if code != -1 || task != nil {
				t.Fatalf("missing task response changed: %s, %d, %+v", route, code, task)
			}
		}
	}
	body, err := json.Marshal(map[string]string{"localPath": " " + filepath.Join(t.TempDir(), "missing") + " "})
	if err != nil {
		t.Fatal(err)
	}
	code, task := call("startObsidianVaultAnalysis", body)
	if code != 0 || task == nil || task.TaskID == "" {
		t.Fatalf("task start failed: %d, %+v", code, task)
	}
	id := task.TaskID
	defer model.CancelObsidianVaultTask(id)
	deadline := time.Now().Add(5 * time.Second)
	for task.State != model.ObsidianTaskStateFailed {
		if time.Now().After(deadline) {
			t.Fatalf("analysis did not finish: %+v", task)
		}
		time.Sleep(10 * time.Millisecond)
		code, task = call("getObsidianVaultTask", []byte(`{"taskID":" `+id+` "}`))
		if code != 0 || task == nil {
			t.Fatalf("task query failed: %d, %+v", code, task)
		}
	}
	code, cancelled := call("cancelObsidianVaultTask", []byte(`{"taskID":"`+id+`"}`))
	if code != -1 || cancelled == nil || cancelled.TaskID != id || cancelled.State != task.State {
		t.Fatalf("failed cancellation lost task data: %d, %+v", code, cancelled)
	}
}

func TestAPIContractObsidianTaskConversion(t *testing.T) {
	for _, task := range []*model.ObsidianVaultTask{nil, {}, {
		TaskID: "id", State: "completed", Progress: 100, Message: "done", Error: "error", Detail: "detail",
		Analysis: &model.ObsidianVaultAnalysis{VaultName: "vault", VaultPath: "path", MarkdownCount: 7, ImportableAssetSize: 1234, BlockingErrors: []string{}, Warnings: []string{"warning"}},
		Result:   &model.ObsidianVaultImportResult{NotebookID: "box", ImportedAttachmentCount: 4, Incomplete: true, FailedStage: "writing"},
	}} {
		expected, err := json.Marshal(task)
		if err != nil {
			t.Fatal(err)
		}
		actual, err := json.Marshal(obsidianTaskContract(task))
		if err != nil || string(expected) != string(actual) {
			t.Fatalf("task serialization changed: %s != %s, %v", expected, actual, err)
		}
	}
}

func TestAPIContractMarkdownImportWorkingDirectory(t *testing.T) {
	previous := util.WorkingDir
	util.WorkingDir = t.TempDir()
	t.Cleanup(func() { util.WorkingDir = previous })
	localPath := filepath.Join(util.WorkingDir, "protected")
	body, err := json.Marshal(map[string]string{"notebook": "box", "localPath": localPath, "toPath": "/"})
	if err != nil {
		t.Fatal(err)
	}
	engine := gin.New()
	engine.POST("/api/import/importStdMd", importStdMd)
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, httptest.NewRequest("POST", "/api/import/importStdMd", strings.NewReader(string(body))))
	requireAPIContract(t, "POST", "/api/import/importStdMd", recorder)
	var response struct {
		Code int             `json:"code"`
		Msg  string          `json:"msg"`
		Data json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code != -1 || response.Msg != fmt.Sprintf("import from local path [%s] failed: local path is sub path of working dir", localPath) || string(response.Data) != "null" {
		t.Fatalf("working directory protection changed: %s, %v", recorder.Body.String(), err)
	}
}

func TestAPIContractImportDataUpload(t *testing.T) {
	previousConf, previousTemp := model.Conf, util.TempDir
	model.Conf = model.NewAppConf()
	util.TempDir = filepath.Join(t.TempDir(), "blocked")
	if err := os.WriteFile(util.TempDir, []byte("not a directory"), 0600); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { model.Conf, util.TempDir = previousConf, previousTemp })
	engine := gin.New()
	engine.POST("/api/import/importData", importData)
	for _, withFile := range []bool{false, true} {
		var body bytes.Buffer
		writer := multipart.NewWriter(&body)
		if withFile {
			file, err := writer.CreateFormFile("file", "data.zip")
			if err != nil {
				t.Fatal(err)
			}
			if _, err = file.Write([]byte("archive")); err != nil {
				t.Fatal(err)
			}
		}
		if err := writer.Close(); err != nil {
			t.Fatal(err)
		}
		request := httptest.NewRequest("POST", "/api/import/importData", &body)
		request.Header.Set("Content-Type", writer.FormDataContentType())
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, request)
		requireAPIContract(t, "POST", "/api/import/importData", recorder)
		var response struct {
			Code int    `json:"code"`
			Msg  string `json:"msg"`
		}
		expected := "file not found"
		if withFile {
			expected = "create temp import dir failed"
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code != -1 || response.Msg != expected {
			t.Fatalf("upload error changed: %s, %v", recorder.Body.String(), err)
		}
	}
	request := httptest.NewRequest("POST", "/api/import/importData", strings.NewReader("{"))
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, request)
	requireAPIContract(t, "POST", "/api/import/importData", recorder)
	var response struct {
		Code int    `json:"code"`
		Msg  string `json:"msg"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code != -1 || response.Msg != "request Content-Type isn't multipart/form-data" {
		t.Fatalf("upload parse error changed: %s, %v", recorder.Body.String(), err)
	}
}

func TestAPIContractImportMarkdownArchiveCleanup(t *testing.T) {
	previousConf, previousTemp := model.Conf, util.TempDir
	model.Conf, util.TempDir = model.NewAppConf(), t.TempDir()
	t.Cleanup(func() { model.Conf, util.TempDir = previousConf, previousTemp })
	engine := gin.New()
	engine.POST("/api/import/importZipMd", importZipMd)
	for _, fields := range []bool{false, true} {
		var body bytes.Buffer
		writer := multipart.NewWriter(&body)
		file, err := writer.CreateFormFile("file", "invalid.zip")
		if err != nil {
			t.Fatal(err)
		}
		if _, err = file.Write([]byte("invalid archive")); err != nil {
			t.Fatal(err)
		}
		if fields {
			if err = writer.WriteField("notebook", "box"); err != nil {
				t.Fatal(err)
			}
			if err = writer.WriteField("toPath", "/"); err != nil {
				t.Fatal(err)
			}
		}
		if err = writer.Close(); err != nil {
			t.Fatal(err)
		}
		request := httptest.NewRequest("POST", "/api/import/importZipMd", &body)
		request.Header.Set("Content-Type", writer.FormDataContentType())
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, request)
		requireAPIContract(t, "POST", "/api/import/importZipMd", recorder)
		var response struct {
			Code int    `json:"code"`
			Msg  string `json:"msg"`
		}
		if err = json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code != -1 || response.Msg == "" {
			t.Fatalf("invalid upload response: %s, %v", recorder.Body.String(), err)
		}
		if !fields && response.Msg != "Field [notebook] is required" {
			t.Fatalf("missing notebook error changed: %s", recorder.Body.String())
		}
		for _, name := range []string{"invalid.zip", "invalid"} {
			if _, err = os.Stat(filepath.Join(util.TempDir, "import", name)); !os.IsNotExist(err) {
				t.Fatalf("failed import left temporary data %s: %v", name, err)
			}
		}
	}
}

func TestAPIContractImportSYUpload(t *testing.T) {
	previousConf, previousTemp := model.Conf, util.TempDir
	model.Conf, util.TempDir = model.NewAppConf(), t.TempDir()
	t.Cleanup(func() { model.Conf, util.TempDir = previousConf, previousTemp })
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	for _, content := range []string{"first archive", "ignored archive"} {
		file, err := writer.CreateFormFile("file", "document.sy.zip")
		if err != nil {
			t.Fatal(err)
		}
		if _, err = file.Write([]byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest("POST", "/api/import/importSY", &body)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = request
	form, err := c.MultipartForm()
	if err != nil {
		t.Fatal(err)
	}
	defer form.RemoveAll()
	upload, err := apicontract.ImportSY.DecodeMultipart(form)
	if err != nil {
		t.Fatal(err)
	}
	path, cleanup, err := saveImportUploadFile(c, upload.File)
	if err != nil {
		t.Fatal(err)
	}
	defer cleanup()
	content, err := os.ReadFile(path)
	if err != nil || string(content) != "first archive" {
		t.Fatalf("upload selection changed: %q, %v", content, err)
	}
	cleanup()
	if _, err = os.Stat(filepath.Dir(path)); !os.IsNotExist(err) {
		t.Fatalf("upload directory remains: %v", err)
	}
	engine := gin.New()
	engine.POST("/api/import/importSY", importSY)
	engine.POST("/api/import/importSYNotebook", importSYNotebook)
	engine.POST("/api/import/importSYAuto", importSYAuto)
	var empty bytes.Buffer
	emptyWriter := multipart.NewWriter(&empty)
	if err = emptyWriter.Close(); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{"/api/import/importSY", "/api/import/importSYNotebook", "/api/import/importSYAuto"} {
		missing := httptest.NewRequest("POST", path, bytes.NewReader(empty.Bytes()))
		missing.Header.Set("Content-Type", emptyWriter.FormDataContentType())
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, missing)
		requireAPIContract(t, "POST", path, recorder)
		var response struct {
			Code int    `json:"code"`
			Msg  string `json:"msg"`
		}
		if err = json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code != -1 || response.Msg != "no file found" {
			t.Fatalf("missing upload response changed: %s, %v", recorder.Body.String(), err)
		}
	}
}

func TestAPIContractImportedNotebookResults(t *testing.T) {
	box := &model.Box{ID: "box", Name: "name", Icon: "icon", Sort: 3, Encrypted: true, Unlocked: false}
	for _, boxes := range [][]*model.Box{nil, {}, {box, nil}} {
		expected, err := json.Marshal(map[string][]*model.Box{"notebooks": boxes})
		if err != nil {
			t.Fatal(err)
		}
		data := apicontract.ImportedNotebooksResult(importedNotebookContracts(boxes))
		actual, err := json.Marshal(data)
		if err != nil || string(actual) != string(expected) {
			t.Fatalf("imported notebooks changed: %s != %s, %v", actual, expected, err)
		}
		recorder := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(recorder)
		c.JSON(200, apicontract.Success(data))
		requireAPIContract(t, "POST", "/api/import/importSYNotebook", recorder)
	}
	expected, err := json.Marshal(map[string]*model.Box{"notebook": box})
	if err != nil {
		t.Fatal(err)
	}
	data := apicontract.ImportedNotebookResult(notebookContract(box))
	actual, err := json.Marshal(data)
	if err != nil || string(actual) != string(expected) {
		t.Fatalf("imported notebook changed: %s != %s, %v", actual, expected, err)
	}
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.JSON(200, apicontract.Success(data))
	requireAPIContract(t, "POST", "/api/import/importSYNotebook", recorder)
}

func TestAPIContractAutomaticImportVariants(t *testing.T) {
	for _, entry := range []struct {
		data     apicontract.ImportAutoData
		expected string
	}{
		{apicontract.AutoImportedDocument(""), `{"type":"document"}`},
		{apicontract.AutoImportedDocument("token"), `{"type":"document","token":"token"}`},
		{apicontract.AutoImportedNotebook(nil), `{"type":"notebook","notebook":null}`},
		{apicontract.AutoImportedNotebooks(nil), `{"type":"notebooks","notebooks":null}`},
		{apicontract.AutoImportedNotebooks([]*apicontract.Notebook{}), `{"type":"notebooks","notebooks":[]}`},
	} {
		actual, err := json.Marshal(entry.data)
		if err != nil || string(actual) != entry.expected {
			t.Fatalf("automatic import result changed: %s != %s, %v", actual, entry.expected, err)
		}
		for _, response := range []apicontract.Response[apicontract.ImportAutoData]{apicontract.Success(entry.data), apicontract.ImportSYAuto.FailureWithData(-1, "mount failed", entry.data)} {
			recorder := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(recorder)
			c.JSON(200, response)
			requireAPIContract(t, "POST", "/api/import/importSYAuto", recorder)
		}
	}
}
