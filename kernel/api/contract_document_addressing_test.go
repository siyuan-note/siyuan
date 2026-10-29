// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

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

type addressingAPIPutResponse struct {
	Code int
	Msg  string
}

func addressingAPIPut(t *testing.T, name, value string, directory bool) int {
	t.Helper()
	return addressingAPIPutResult(t, name, value, directory).Code
}

func addressingAPIPutResult(t *testing.T, name, value string, directory bool) addressingAPIPutResponse {
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
	var response addressingAPIPutResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	return response
}

func TestAPIContractDocumentAddressingRawTitleSpec(t *testing.T) {
	addressingAPIWorkspace(t)
	addressingAPIWrite(t, filepath.Join(util.DataDir, addressingAPIBox, documentaddressing.ConfigPath), `{"documentAddressingVersion":2}`)
	const document = "20261022130000-rawdoc1.sy"
	name := "data/" + addressingAPIBox + "/" + document
	abs := filepath.Join(util.WorkspaceDir, name)
	ordinary := `{"Spec":"2","Properties":{"title":"Ordinary"}}`
	underVersioned := `{"Spec":"2","Properties":{"title":"A/B"}}`
	valid := "\xef\xbb\xbf" + "{\n  \"Spec\":\"6\",\"Properties\":{\"title\":\"A/B\"}\n}\n"
	addressingAPIWrite(t, abs, ordinary)
	before, _ := os.Stat(abs)
	result := addressingAPIPutResult(t, name, underVersioned, false)
	if result.Code != -1 || result.Msg != "document title requires spec 6" {
		t.Fatalf("put did not expose the title spec requirement: %+v", result)
	}
	after, _ := os.Stat(abs)
	if data, _ := os.ReadFile(abs); string(data) != ordinary || !before.ModTime().Equal(after.ModTime()) {
		t.Fatal("rejected title changed the destination")
	}
	source := filepath.Join(util.DataDir, "assets", document)
	addressingAPIWrite(t, source, underVersioned)
	first := filepath.Join(util.DataDir, "assets", "first.txt")
	addressingAPIWrite(t, first, "attachment")
	renamed := "data/" + addressingAPIBox + "/20261022130000-parent1/" + document
	for _, request := range []struct {
		name    string
		handler gin.HandlerFunc
		body    interface{}
	}{
		{"copyFile", copyFile, apicontract.CopyFileRequest{Src: "assets/" + document, Dest: abs}},
		{"renameFile", renameFile, apicontract.RenameFileRequest{Path: "data/assets/" + document, NewPath: renamed}},
		{"globalCopyFiles", globalCopyFiles, apicontract.CopyFilesRequest{Srcs: []string{first, source}, DestDir: "data/" + addressingAPIBox}},
		{"workspaceCopyFiles", workspaceCopyFiles, apicontract.CopyFilesRequest{Srcs: []string{"data/assets/first.txt", "data/assets/" + document}, DestDir: "data/" + addressingAPIBox}},
	} {
		if code := addressingAPIRequest(t, request.name, request.handler, request.body); code != -1 {
			t.Fatalf("%s accepted a low-spec slash title: %d", request.name, code)
		}
	}
	if data, _ := os.ReadFile(source); string(data) != underVersioned {
		t.Fatal("rejected rename changed the original source")
	}
	for _, path := range []string{filepath.Join(util.DataDir, addressingAPIBox, "first.txt"), filepath.Dir(filepath.Join(util.WorkspaceDir, renamed))} {
		if _, err := os.Stat(path); !os.IsNotExist(err) {
			t.Fatal("rejected batch created destination entries", path, err)
		}
	}
	// 已有低 Spec 源仍可读取，合法替换可以修复版本，原始字节不被重新序列化。
	addressingAPIWrite(t, abs, underVersioned)
	if code := addressingAPIPut(t, name, valid, false); code != 0 {
		t.Fatalf("valid replacement could not repair an existing source: %d", code)
	}
	if data, _ := os.ReadFile(abs); string(data) != valid {
		t.Fatal("valid title write changed request bytes")
	}
	addressingAPIWrite(t, source, valid)
	if code := addressingAPIRequest(t, "copyFile", copyFile, apicontract.CopyFileRequest{Src: "assets/" + document, Dest: abs}); code != 0 {
		t.Fatalf("valid title copy failed: %d", code)
	}
	if data, _ := os.ReadFile(abs); string(data) != valid {
		t.Fatal("valid title copy changed source bytes")
	}
}

func TestAPIContractDocumentAddressingIncomingBatch(t *testing.T) {
	addressingAPIWorkspace(t)
	source := testutil.PublicDataDir(t)
	plain := filepath.Join(source, "first.txt")
	future := filepath.Join(source, addressingAPIBox)
	addressingAPIWrite(t, plain, "first")
	addressingAPIWrite(t, filepath.Join(future, ".siyuan", "conf.json"), `{"documentAddressingVersion":3}`)
	addressingAPIWrite(t, filepath.Join(future, "20261022130000-rawdoc1.sy"), `{"Spec":"999","Properties":{"title":"Future"}}`)
	if code := addressingAPIRequest(t, "globalCopyFiles", globalCopyFiles,
		apicontract.CopyFilesRequest{Srcs: []string{plain, future}, DestDir: "data"}); code != -1 {
		t.Fatalf("incoming unsupported batch accepted: %d", code)
	}
	entries, _ := os.ReadDir(util.DataDir)
	if len(entries) != 0 {
		t.Fatalf("batch wrote files before checking all notebooks: %v", entries)
	}
	if code := addressingAPIPut(t, "data/20261022120000-rawbox2/.siyuan/conf.json", `{"documentAddressingVersion":3}`, false); code != 0 {
		t.Fatal("retired marker blocked config copy", code)
	}

}

func TestAPIContractDocumentAddressingDocumentSources(t *testing.T) {
	addressingAPIWorkspace(t)
	const document = "20261022130000-rawdoc1.sy"
	name := "data/" + addressingAPIBox + "/" + document
	abs := filepath.Join(util.WorkspaceDir, name)
	ordinary := `{"Spec":"2","Properties":{"title":"Ordinary"}}`
	for _, unsupported := range []string{
		`{"Spec":"999","Properties":{"title":"Future"}}`,
		`{"Spec":"2","Properties":{"title":{"format":"future"}}}`,
		`{"Spec":"999","Spec":"2","Properties":{"title":"Future"}}`,
		`null`,
	} {
		addressingAPIWrite(t, abs, ordinary)
		before, _ := os.Stat(abs)
		if code := addressingAPIPut(t, name, unsupported, false); code != -1 {
			t.Fatalf("put accepted an incompatible document source: %d", code)
		}
		after, _ := os.Stat(abs)
		data, _ := os.ReadFile(abs)
		if string(data) != ordinary || !before.ModTime().Equal(after.ModTime()) {
			t.Fatal("rejected source changed the existing document")
		}
		addressingAPIWrite(t, abs, unsupported)
		before, _ = os.Stat(abs)
		if code := addressingAPIPut(t, name, ordinary, false); code != -1 {
			t.Fatalf("put overwrote an incompatible existing source: %d", code)
		}
		after, _ = os.Stat(abs)
		data, _ = os.ReadFile(abs)
		if string(data) != unsupported || !before.ModTime().Equal(after.ModTime()) {
			t.Fatal("existing incompatible source was modified")
		}
	}
	addressingAPIWrite(t, abs, ordinary)
	for _, title := range []string{"A&amp;#47;B", "A%2FB", "A／B", "**literal**"} {
		source := `{"Spec":"2","Properties":{"title":"` + title + `"}}`
		if code := addressingAPIPut(t, name, source, false); code != 0 {
			t.Fatalf("compatible title was rejected: %d", code)
		}
		data, _ := os.ReadFile(abs)
		if string(data) != source {
			t.Fatal("raw document write normalized source bytes")
		}
	}
	if code := addressingAPIPut(t, "data/assets/"+document, "arbitrary attachment", false); code != 0 {
		t.Fatalf("attachment was treated as a document: %d", code)
	}
}

func TestAPIContractDocumentAddressingDocumentCopies(t *testing.T) {
	addressingAPIWorkspace(t)
	const document = "20261022130000-rawdoc1.sy"
	name := "data/" + addressingAPIBox + "/" + document
	abs := filepath.Join(util.WorkspaceDir, name)
	ordinary := `{"Spec":"2","Properties":{"title":"Ordinary"}}`
	future := `{"Spec":"999","Properties":{"title":"Future"}}`
	source := filepath.Join(util.DataDir, "assets", document)
	addressingAPIWrite(t, source, future)
	addressingAPIWrite(t, abs, ordinary)
	if code := addressingAPIRequest(t, "copyFile", copyFile,
		apicontract.CopyFileRequest{Src: "assets/" + document, Dest: abs}); code != -1 {
		t.Fatalf("copy accepted an incompatible incoming source: %d", code)
	}
	addressingAPIWrite(t, source, ordinary)
	addressingAPIWrite(t, abs, future)
	if code := addressingAPIRequest(t, "copyFile", copyFile,
		apicontract.CopyFileRequest{Src: "assets/" + document, Dest: abs}); code != -1 {
		t.Fatalf("copy overwrote an incompatible existing source: %d", code)
	}
	if data, _ := os.ReadFile(abs); string(data) != future {
		t.Fatal("copy changed the protected destination")
	}
	addressingAPIWrite(t, source, future)
	first := filepath.Join(util.DataDir, "assets", "first.txt")
	addressingAPIWrite(t, first, "ordinary attachment")
	for _, request := range []struct {
		name    string
		handler gin.HandlerFunc
		sources []string
	}{
		{"globalCopyFiles", globalCopyFiles, []string{first, source}},
		{"workspaceCopyFiles", workspaceCopyFiles, []string{"data/assets/first.txt", "data/assets/" + document}},
	} {
		if code := addressingAPIRequest(t, request.name, request.handler,
			apicontract.CopyFilesRequest{Srcs: request.sources, DestDir: "data/" + addressingAPIBox}); code != -1 {
			t.Fatalf("%s accepted an incompatible batch: %d", request.name, code)
		}
		if _, err := os.Stat(filepath.Join(util.DataDir, addressingAPIBox, "first.txt")); !os.IsNotExist(err) {
			t.Fatal("batch copied an earlier file before checking all sources", err)
		}
	}
	destination := "data/" + addressingAPIBox + "/20261022130000-parent1/" + document
	if code := addressingAPIRequest(t, "renameFile", renameFile,
		apicontract.RenameFileRequest{Path: "data/assets/" + document, NewPath: destination}); code != -1 {
		t.Fatalf("rename installed an incompatible source as a document: %d", code)
	}
	if data, _ := os.ReadFile(source); string(data) != future {
		t.Fatal("rejected rename changed the source")
	}
	if _, err := os.Stat(filepath.Dir(filepath.Join(util.WorkspaceDir, destination))); !os.IsNotExist(err) {
		t.Fatal("rejected rename created the destination parent", err)
	}
	addressingAPIWrite(t, source, ordinary)
	addressingAPIWrite(t, abs, ordinary)
	for _, request := range []struct {
		name    string
		handler gin.HandlerFunc
		body    interface{}
	}{
		{"copyFile", copyFile, apicontract.CopyFileRequest{Src: "assets/" + document, Dest: abs}},
		{"globalCopyFiles", globalCopyFiles, apicontract.CopyFilesRequest{Srcs: []string{source}, DestDir: "data/" + addressingAPIBox}},
		{"workspaceCopyFiles", workspaceCopyFiles, apicontract.CopyFilesRequest{Srcs: []string{"data/assets/" + document}, DestDir: "data/" + addressingAPIBox}},
	} {
		if code := addressingAPIRequest(t, request.name, request.handler, request.body); code != 0 {
			t.Fatalf("%s rejected a compatible document: %d", request.name, code)
		}
		if data, _ := os.ReadFile(abs); string(data) != ordinary {
			t.Fatal("compatible document copy changed source bytes")
		}
	}
	if code := addressingAPIRequest(t, "renameFile", renameFile,
		apicontract.RenameFileRequest{Path: "data/assets/" + document, NewPath: destination}); code != 0 {
		t.Fatalf("compatible document move failed: %d", code)
	}
	if data, _ := os.ReadFile(filepath.Join(util.WorkspaceDir, destination)); string(data) != ordinary {
		t.Fatal("compatible document move changed source bytes")
	}
}

func TestAPIContractDocumentAddressingSettingsBackup(t *testing.T) {
	addressingAPIWorkspace(t)
	addressingAPIWrite(t, filepath.Join(util.DataDir, addressingAPIBox, ".siyuan", "conf.json"), `{"documentAddressingVersion":3}`)
	_ = documentaddressing.CheckBox(addressingAPIBox)
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
	if err != nil || bytes.Contains(data, []byte(`"documentAddressing"`)) {
		t.Fatal("settings export regenerated retired records", err)
	}
	if code := importPreferencesRequest(t, "old.json", []byte(`{"editor":{"fontSize":18},"documentAddressing":{"version":99,"notebooks":{}}}`)); code != 0 {
		t.Fatal("retired settings field blocked ordinary import", code)
	}
	if model.Conf.Editor.Load().FontSize != 18 {
		t.Fatal("ordinary settings were lost")
	}
	if _, err := os.Stat(filepath.Join(util.ConfDir, "document-addressing.json")); !os.IsNotExist(err) {
		t.Fatal("settings import created retired record", err)
	}

}
