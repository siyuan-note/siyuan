package api

import (
	archivezip "archive/zip"
	"bytes"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func exportContractRequest(t *testing.T, name string, handler gin.HandlerFunc, body string) (code int, message string, data json.RawMessage) {
	t.Helper()
	engine := gin.New()
	path := "/api/export/" + name
	engine.Use(boxLeaseMiddleware)
	engine.POST(path, handler)
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, httptest.NewRequest("POST", path, strings.NewReader(body)))
	requireAPIContract(t, "POST", path, recorder)
	var response struct {
		Code int             `json:"code"`
		Msg  string          `json:"msg"`
		Data json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	return response.Code, response.Msg, response.Data
}

func TestAPIContractExportErrorVariants(t *testing.T) {
	for _, body := range []string{`{}`, `{"paths":null}`} {
		code, msg, data := exportContractRequest(t, "exportResources", exportResources, body)
		if code != 1 || msg != "[paths] is required" || string(data) != `""` {
			t.Fatalf("resources prompt changed: %d %s %s", code, msg, data)
		}
	}
	for _, entry := range []struct {
		name    string
		handler gin.HandlerFunc
		body    string
		code    int
		msg     string
	}{
		{"exportCodeBlock", exportCodeBlock, `{}`, -1, "Field [id] is required"},
		{"exportAttributeView", exportAttributeView, `{"id":"av","blockID":false}`, -1, "Field [blockID] should be of type [String]"},
		{"exportDocx", exportDocx, `{"id":"id","savePath":"path"}`, -1, "Field [removeAssets] is required"},
		{"exportHTML", exportHTML, `{"id":"id"}`, -1, "Field [pdf] is required"},
		{"processPDF", processPDF, `{"id":"id","path":" "}`, -1, "Field [path] must not be empty"},
		{"copyExportFile", copyExportFile, `{"srcPath":"/export/file","dest":"relative"}`, -1, "dest must be an absolute path"},
		{"exportNotebooksSY", exportNotebooksSY, `{"notebooks":false}`, -1, ""},
		{"exportNotebooksMd", exportNotebooksMd, `{"notebooks":[],"addTitle":false}`, -1, ""},
	} {
		code, msg, data := exportContractRequest(t, entry.name, entry.handler, entry.body)
		if code != entry.code || msg != entry.msg || string(data) != "null" {
			t.Fatalf("%s validation changed: %d %s %s", entry.name, code, msg, data)
		}
	}
	previous := util.TempDir
	util.TempDir = filepath.Join(t.TempDir(), "file")
	t.Cleanup(func() { util.TempDir = previous })
	if err := os.WriteFile(util.TempDir, []byte("occupied"), 0644); err != nil {
		t.Fatal(err)
	}
	code, _, data := exportContractRequest(t, "exportTempContent", exportTempContent, `{"content":""}`)
	if code != 1 || string(data) != `{"closeTimeout":7000}` {
		t.Fatalf("export timeout prompt changed: %d %s", code, data)
	}
}

func TestAPIContractExportLockedNotebook(t *testing.T) {
	_, boxID := setupArchiveWorkspace(t)
	previous := model.Conf
	model.Conf = model.NewAppConf()
	t.Cleanup(func() { model.Conf = previous })
	for _, entry := range []struct {
		name     string
		handler  gin.HandlerFunc
		body     string
		language int
	}{
		{"exportNotebookMd", exportNotebookMd, `{"notebook":"` + boxID + `","blockRefMode":false}`, 314},
		{"exportNotebookSY", exportNotebookSY, `{"id":"` + boxID + `"}`, 314},
		{"exportNotebooksMd", exportNotebooksMd, `{"notebooks":["` + boxID + `"],"blockRefMode":false}`, 395},
		{"exportNotebooksSY", exportNotebooksSY, `{"notebooks":["` + boxID + `"]}`, 395},
		{"exportBrowserHTML", exportBrowserHTML, `{"folder":"` + boxID + `/html-test","html":"<p>secret</p>","name":"secret"}`, 314},
	} {
		code, msg, data := exportContractRequest(t, entry.name, entry.handler, entry.body)
		if code != -1 || msg != model.Conf.Language(entry.language) || string(data) != "null" {
			t.Fatalf("%s encrypted admission changed: %d %s %s", entry.name, code, msg, data)
		}
	}
}

func TestAPIContractExportMarkdownOptions(t *testing.T) {
	input := `{"id":"id","addTitle":false,"inlineMemo":true,"blockRefMode":2.9,"blockEmbedMode":-2.9,"fileAnnotationRefMode":3.9,"blockRefTextLeft":" left ","blockRefTextRight":"right","tagOpenMarker":"#","tagCloseMarker":"#","includeSubDocs":false,"includeRelatedDocs":true,"markdownYFM":false,"removeAssetsID":true}`
	request, err := apicontract.ExportMd.Decode(strings.NewReader(input))
	if err != nil || request.Validate() != nil {
		t.Fatalf("decode failed: %v", err)
	}
	var fields map[string]interface{}
	if err = json.Unmarshal([]byte(input), &fields); err != nil {
		t.Fatal(err)
	}
	if got, want := exportMarkdownOptions(request.ExportMarkdownOptions), model.ParseExportOptions(fields); !reflect.DeepEqual(got, want) {
		t.Fatalf("markdown conversion changed: %+v != %+v", got, want)
	}
	previous := model.Conf
	model.Conf = model.NewAppConf()
	model.Conf.Export = conf.NewExport()
	model.Conf.Export.AddTitle = true
	t.Cleanup(func() { model.Conf = previous })
	addTitle, title := exportTitleOptions(apicontract.ExportTitleOptions{CustomTitle: " custom "})
	if !addTitle || title != "custom" {
		t.Fatalf("title defaults changed: %v %q", addTitle, title)
	}
}

func TestAPIContractExportArtifacts(t *testing.T) {
	previousTemp, previousURL := util.TempDir, util.ServerURL
	util.TempDir = t.TempDir()
	util.ServerURL = &url.URL{Scheme: "http"}
	t.Cleanup(func() { util.TempDir, util.ServerURL = previousTemp, previousURL })
	code, msg, data := exportContractRequest(t, "exportTempContent", exportTempContent, `{"content":"  content\n"}`)
	var temp apicontract.ExportURLData
	if err := json.Unmarshal(data, &temp); err != nil || code != 0 {
		t.Fatalf("temp export failed: %d %s %s %v", code, msg, data, err)
	}
	u, err := url.Parse(temp.URL)
	if err != nil {
		t.Fatal(err)
	}
	content, err := os.ReadFile(filepath.Join(util.TempDir, filepath.FromSlash(strings.TrimPrefix(u.Path, "/"))))
	if err != nil || string(content) != "  content\n" {
		t.Fatalf("temp content changed: %q %v", content, err)
	}
	if err = os.MkdirAll(filepath.Join(util.TempDir, "export", "folder"), 0755); err != nil {
		t.Fatal(err)
	}
	code, msg, data = exportContractRequest(t, "exportBrowserHTML", exportBrowserHTML, `{"folder":" folder ","html":" <p>content</p> ","name":" name "}`)
	var archive apicontract.ExportZipData
	if err = json.Unmarshal(data, &archive); err != nil || code != 0 {
		t.Fatalf("browser export failed: %d %s %s %v", code, msg, data, err)
	}
	zipPath, err := url.PathUnescape(archive.Zip)
	if err != nil {
		t.Fatal(err)
	}
	reader, err := archivezip.OpenReader(filepath.Join(util.TempDir, filepath.FromSlash(strings.TrimPrefix(zipPath, "/"))))
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()
	found := false
	for _, file := range reader.File {
		if file.Name == "index.html" {
			stream, err := file.Open()
			if err != nil {
				t.Fatal(err)
			}
			body, err := io.ReadAll(stream)
			stream.Close()
			if err != nil || string(body) != "<p>content</p>" {
				t.Fatalf("browser content changed: %q %v", body, err)
			}
			found = true
		}
	}
	if !found {
		t.Fatal("browser archive is missing index.html")
	}
	if _, err = os.Stat(filepath.Join(util.TempDir, "export", "folder")); !os.IsNotExist(err) {
		t.Fatalf("temporary browser folder was not removed: %v", err)
	}
}

func TestAPIContractExportAsFile(t *testing.T) {
	previous := util.TempDir
	util.TempDir = t.TempDir()
	t.Cleanup(func() { util.TempDir = previous })
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	for _, content := range []string{"first", "second"} {
		part, err := writer.CreateFormFile("file", "sample#file.txt")
		if err != nil {
			t.Fatal(err)
		}
		if _, err = io.WriteString(part, content); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.WriteField("type", "application/octet-stream"); err != nil {
		t.Fatal(err)
	}
	if err := writer.WriteField("type", "image/png"); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	engine := gin.New()
	engine.POST("/api/export/exportAsFile", exportAsFile)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/export/exportAsFile", &body)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	engine.ServeHTTP(recorder, request)
	requireAPIContract(t, "POST", "/api/export/exportAsFile", recorder)
	var response struct {
		Code int                        `json:"code"`
		Data apicontract.ExportFileData `json:"data"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code != 0 {
		t.Fatalf("file export failed: %s %v", recorder.Body.String(), err)
	}
	if strings.Contains(response.Data.File, "#") || strings.HasSuffix(response.Data.File, ".png") {
		t.Fatalf("file naming changed: %s", response.Data.File)
	}
	content, err := os.ReadFile(filepath.Join(util.TempDir, filepath.FromSlash(strings.TrimPrefix(response.Data.File, "/"))))
	if err != nil || string(content) != "first" {
		t.Fatalf("first upload changed: %q %v", content, err)
	}
}
