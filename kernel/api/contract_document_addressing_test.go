package api

import (
	archivezip "archive/zip"
	"bytes"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/documentaddressing"
	"github.com/siyuan-note/siyuan/kernel/internal/testutil"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

const addressingAPIBox = "20261022120000-rawbox1"

func addressingAPIWorkspace(t *testing.T) {
	t.Helper()
	importedPreferencesFixture(t)
	data, repo := util.DataDir, util.RepoDir
	t.Cleanup(func() { util.DataDir, util.RepoDir = data, repo })
	util.WorkspaceDir = testutil.PublicDataDir(t)
	util.DataDir, util.ConfDir = filepath.Join(util.WorkspaceDir, "data"), filepath.Join(util.WorkspaceDir, "conf")
	util.RepoDir, util.TempDir = filepath.Join(util.WorkspaceDir, "repo"), filepath.Join(util.WorkspaceDir, "temp")
	for _, dir := range []string{util.DataDir, util.ConfDir, util.TempDir} {
		if err := os.MkdirAll(dir, 0755); err != nil {
			t.Fatal(err)
		}
	}
}

func addressingAPIWrite(t *testing.T, name, value string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(name), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(name, []byte(value), 0600); err != nil {
		t.Fatal(err)
	}
}

func addressingAPIRequest(t *testing.T, route string, handler gin.HandlerFunc, payload interface{}) int {
	t.Helper()
	data, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Set(model.RoleContextKey, model.RoleAdministrator)
	c.Request = httptest.NewRequest("POST", "/api/file/"+route, bytes.NewReader(data))
	c.Request.Header.Set("Content-Type", "application/json")
	handler(c)
	requireAPIContract(t, "POST", "/api/file/"+route, recorder)
	var response struct{ Code int }
	if err = json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	return response.Code
}

func addressingAPIPut(t *testing.T, name, value string, directory bool) int {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	_ = writer.WriteField("path", name)
	if directory {
		_ = writer.WriteField("isDir", "true")
	} else {
		part, err := writer.CreateFormFile("file", "document.sy")
		if err != nil {
			t.Fatal(err)
		}
		_, _ = io.WriteString(part, value)
	}
	_ = writer.Close()
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest("POST", "/api/file/putFile", &body)
	c.Request.Header.Set("Content-Type", writer.FormDataContentType())
	putFile(c)
	requireAPIContract(t, "POST", "/api/file/putFile", recorder)
	var response struct{ Code int }
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	return response.Code
}

func TestAPIContractDocumentAddressingRawWrites(t *testing.T) {
	addressingAPIWorkspace(t)
	confPath := filepath.Join(util.DataDir, addressingAPIBox, ".siyuan", "conf.json")
	addressingAPIWrite(t, confPath, `{"documentAddressingVersion":2}`)
	name := "data/" + addressingAPIBox + "/original.sy"
	abs := filepath.Join(util.WorkspaceDir, name)
	addressingAPIWrite(t, abs, "future source")
	addressingAPIWrite(t, filepath.Join(util.DataDir, "assets", "source.txt"), "asset")
	before, _ := os.Stat(abs)
	if code := addressingAPIPut(t, name, "overwrite", false); code != -1 {
		t.Fatalf("put accepted unsupported notebook: %d", code)
	}
	if code := addressingAPIPut(t, "data/"+addressingAPIBox+"/new/child", "", true); code != -1 {
		t.Fatalf("mkdir accepted unsupported notebook: %d", code)
	}
	for _, test := range []struct {
		route   string
		handler gin.HandlerFunc
		body    interface{}
	}{
		{"removeFile", removeFile, apicontract.RemoveFileRequest{Path: name}},
		{"removeFile", removeFile, apicontract.RemoveFileRequest{Path: "data/" + addressingAPIBox + "/.siyuan"}},
		{"renameFile", renameFile, apicontract.RenameFileRequest{Path: name, NewPath: "new-parent/moved.sy"}},
		{"workspaceCopyFiles", workspaceCopyFiles, apicontract.CopyFilesRequest{Srcs: []string{name}, DestDir: "new-parent"}},
		{"globalCopyFiles", globalCopyFiles, apicontract.CopyFilesRequest{Srcs: []string{abs}, DestDir: "new-parent"}},
		{"copyFile", copyFile, apicontract.CopyFileRequest{Src: "assets/source.txt", Dest: abs}},
	} {
		if code := addressingAPIRequest(t, test.route, test.handler, test.body); code != -1 {
			t.Fatalf("%s accepted unsupported notebook: %d", test.route, code)
		}
	}
	after, _ := os.Stat(abs)
	data, _ := os.ReadFile(abs)
	if string(data) != "future source" || !before.ModTime().Equal(after.ModTime()) {
		t.Fatal("rejected operations modified the source")
	}
	for _, path := range []string{filepath.Join(util.WorkspaceDir, "new-parent"), filepath.Join(util.DataDir, addressingAPIBox, "new")} {
		if _, err := os.Stat(path); !os.IsNotExist(err) {
			t.Fatalf("rejected operation created directory: %s, %v", path, err)
		}
	}
	if code := addressingAPIRequest(t, "removeFile", removeFile, apicontract.RemoveFileRequest{Path: "data/" + addressingAPIBox}); code != 0 {
		t.Fatalf("whole notebook deletion failed: %d", code)
	}
	if code := addressingAPIPut(t, name, "old restored source", false); code != -1 {
		t.Fatalf("same identity lost its remembered requirement: %d", code)
	}
	if _, err := os.Stat(filepath.Dir(abs)); !os.IsNotExist(err) {
		t.Fatal("rejected restore recreated the deleted notebook")
	}
	for path, expected := range map[string]int{"conf/document-addressing.json": -1, "conf": 403} {
		if code := addressingAPIRequest(t, "removeFile", removeFile, apicontract.RemoveFileRequest{Path: path}); code != expected {
			t.Fatalf("local floor protection changed for %s: %d", path, code)
		}
	}
	if code := addressingAPIPut(t, "conf/document-addressing.json", `{"version":1,"notebooks":{}}`, false); code != -1 {
		t.Fatalf("local floor overwritten: %d", code)
	}
}

func TestAPIContractDocumentAddressingIncomingBatch(t *testing.T) {
	addressingAPIWorkspace(t)
	source := testutil.PublicDataDir(t)
	plain := filepath.Join(source, "first.txt")
	future := filepath.Join(source, addressingAPIBox)
	addressingAPIWrite(t, plain, "first")
	addressingAPIWrite(t, filepath.Join(future, ".siyuan", "conf.json"), `{"documentAddressingVersion":2}`)
	addressingAPIWrite(t, filepath.Join(future, "document.sy"), "future source")
	if code := addressingAPIRequest(t, "globalCopyFiles", globalCopyFiles,
		apicontract.CopyFilesRequest{Srcs: []string{plain, future}, DestDir: "data"}); code != -1 {
		t.Fatalf("incoming unsupported batch accepted: %d", code)
	}
	entries, _ := os.ReadDir(util.DataDir)
	if len(entries) != 0 {
		t.Fatalf("batch wrote files before checking all notebooks: %v", entries)
	}
	if code := addressingAPIPut(t, "data/20261022120000-rawbox2/.siyuan/conf.json", `{"documentAddressingVersion":2}`, false); code != -1 {
		t.Fatalf("incoming mode accepted: %d", code)
	}
	entries, _ = os.ReadDir(util.DataDir)
	if len(entries) != 0 {
		t.Fatal("rejected put created the notebook directory")
	}
	if code := addressingAPIPut(t, "data/20261022120000-rawbox3/document.sy", "legacy raw data", false); code != 0 {
		t.Fatalf("legacy write changed: %d", code)
	}
}

func TestAPIContractDocumentAddressingSettingsBackup(t *testing.T) {
	addressingAPIWorkspace(t)
	addressingAPIWrite(t, filepath.Join(util.DataDir, addressingAPIBox, ".siyuan", "conf.json"), `{"documentAddressingVersion":2}`)
	_ = documentaddressing.CheckBox(util.DataDir, util.ConfDir, addressingAPIBox)
	recorder := systemContractRequest(t, "POST", "exportConf", exportConf, nil)
	var response struct {
		Code int
		Data apicontract.SystemExportConfData
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code != 0 {
		t.Fatalf("export failed: %s, %v", recorder.Body.String(), err)
	}
	archive, err := archivezip.OpenReader(filepath.Join(util.TempDir, filepath.FromSlash(response.Data.Zip)))
	if err != nil {
		t.Fatal(err)
	}
	defer archive.Close()
	if len(archive.File) != 1 {
		t.Fatal("settings export changed the single-file package")
	}
	file, err := archive.File[0].Open()
	if err != nil {
		t.Fatal(err)
	}
	data, err := io.ReadAll(file)
	file.Close()
	if err != nil || !bytes.Contains(data, []byte(`"documentAddressing"`)) {
		t.Fatalf("settings backup omitted the floor: %s, %v", data, err)
	}
	if code := importPreferencesRequest(t, "old.json", []byte(`{"editor":{"fontSize":18}}`)); code != 0 {
		t.Fatalf("legacy settings import changed: %d", code)
	}
	if err = documentaddressing.CheckBox(util.DataDir, util.ConfDir, addressingAPIBox); err == nil {
		t.Fatal("legacy settings lowered the floor")
	}
	before := model.Conf.Editor.Load().FontSize
	if code := importPreferencesRequest(t, "invalid.json", []byte(`{"editor":{"fontSize":27},"documentAddressing":{"version":99,"notebooks":{}}}`)); code != -1 {
		t.Fatalf("invalid backup accepted: %d", code)
	}
	if model.Conf.Editor.Load().FontSize != before {
		t.Fatal("invalid backup partially applied ordinary settings")
	}
	util.ConfDir = t.TempDir()
	if code := importPreferencesRequest(t, "backup.json", data); code != 0 {
		t.Fatalf("backed up floor could not be restored: %d", code)
	}
	if _, err = os.Stat(filepath.Join(util.ConfDir, "document-addressing.json")); err != nil {
		t.Fatal(err)
	}
}
