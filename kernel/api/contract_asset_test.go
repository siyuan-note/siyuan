package api

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func setupAssetContractWorkspace(t *testing.T) string {
	t.Helper()
	previousConf, previousData, previousWorkspace := model.Conf, util.DataDir, util.WorkspaceDir
	model.Conf = model.NewAppConf()
	model.Conf.Sync = conf.NewSync()
	util.WorkspaceDir = t.TempDir()
	util.DataDir = filepath.Join(util.WorkspaceDir, "data")
	t.Cleanup(func() { model.Conf, util.DataDir, util.WorkspaceDir = previousConf, previousData, previousWorkspace })
	dir := filepath.Join(util.DataDir, "assets")
	if err := os.MkdirAll(dir, 0755); err != nil {
		t.Fatal(err)
	}
	return dir
}

func TestAssetUploadContractAdapter(t *testing.T) {
	assets := setupAssetContractWorkspace(t)
	content := []byte("upload fixture")
	name := "sample-20260101000000-abcdefg.txt"
	if err := os.WriteFile(filepath.Join(assets, name), content, 0644); err != nil {
		t.Fatal(err)
	}
	hash, err := util.GetEtagByHandle(bytes.NewReader(content), int64(len(content)))
	if err != nil {
		t.Fatal(err)
	}
	cache.SetAssetHash(hash, "assets/"+name)
	t.Cleanup(func() { cache.RemoveAssetHash(hash) })
	bundle, err := apicontract.BuildBundle()
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		name    string
		files   bool
		failure bool
		emptyID bool
	}{
		{name: "empty"},
		{name: "duplicate names", files: true},
		{name: "partial failure", files: true, failure: true},
		{name: "explicit empty document", emptyID: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			request := func() *http.Request {
				var body bytes.Buffer
				writer := multipart.NewWriter(&body)
				if test.files {
					for i := 0; i < 2; i++ {
						part, err := writer.CreateFormFile("file[]", "sample.txt")
						if err != nil {
							t.Fatal(err)
						}
						if _, err := part.Write(content); err != nil {
							t.Fatal(err)
						}
					}
				}
				if test.emptyID {
					if err := writer.WriteField("id", ""); err != nil {
						t.Fatal(err)
					}
				}
				if err := writer.Close(); err != nil {
					t.Fatal(err)
				}
				request := httptest.NewRequest(http.MethodPost, "/api/asset/upload", &body)
				request.Header.Set("Content-Type", writer.FormDataContentType())
				if err := request.ParseMultipartForm(1 << 20); err != nil {
					t.Fatal(err)
				}
				t.Cleanup(func() { _ = request.MultipartForm.RemoveAll() })
				if test.failure {
					request.MultipartForm.File["file[]"][0] = &multipart.FileHeader{Filename: "missing.png", Size: 1}
				}
				return request
			}
			var responses []map[string]interface{}
			for _, handler := range []gin.HandlerFunc{model.Upload, uploadAsset} {
				engine := gin.New()
				engine.POST("/api/asset/upload", handler)
				recorder := httptest.NewRecorder()
				engine.ServeHTTP(recorder, request())
				if err := bundle.ValidateHTTPResponse("POST", "/api/asset/upload", recorder.Code, recorder.Header().Get("Content-Type"), recorder.Body.Bytes()); err != nil {
					t.Fatal(err)
				}
				var response map[string]interface{}
				if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
					t.Fatal(err)
				}
				responses = append(responses, response)
			}
			if !reflect.DeepEqual(responses[0], responses[1]) {
				t.Fatalf("upload adapter differs: %+v / %+v", responses[0], responses[1])
			}
			if test.failure && (responses[1]["code"] != float64(0) || responses[1]["msg"] == "") {
				t.Fatalf("partial upload must retain success code and failure message: %+v", responses[1])
			}
		})
	}
}

func TestAssetOCRMissingPathContract(t *testing.T) {
	setupAssetContractWorkspace(t)
	previous := util.GetAssetText("")
	util.SetAssetText("", "empty path content")
	t.Cleanup(func() { util.SetAssetText("", previous) })
	engine := gin.New()
	engine.POST("/api/asset/getImageOCRText", getImageOCRText)
	for _, test := range []struct{ body, text string }{
		{`{}`, ""}, {`{"path":null}`, ""}, {`{"path":""}`, "empty path content"},
	} {
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest("POST", "/api/asset/getImageOCRText", strings.NewReader(test.body)))
		requireAPIContract(t, "POST", "/api/asset/getImageOCRText", recorder)
		var response struct{ Data apicontract.AssetTextData }
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Data.Text != test.text {
			t.Fatalf("OCR response: %s %v", recorder.Body.String(), err)
		}
	}
}

func TestAssetAnnotationContractFormat(t *testing.T) {
	assets := setupAssetContractWorkspace(t)
	if err := os.WriteFile(filepath.Join(assets, "fixture.pdf"), []byte("PDF fixture"), 0644); err != nil {
		t.Fatal(err)
	}
	data := `{"one":{"pages":[{"index":1,"positions":[[1.5,2.5]]}],"color":"red","type":"highlight","content":"note","mode":"rect","ids":["id"],"ignored":true}}`
	body, err := json.Marshal(apicontract.SetAssetAnnotationRequest{Path: "assets/fixture.pdf.sya", Data: data})
	if err != nil {
		t.Fatal(err)
	}
	engine := gin.New()
	engine.Use(func(c *gin.Context) {
		c.Set(model.RoleContextKey, model.RoleAdministrator)
		c.Next()
	})
	engine.POST("/api/asset/setFileAnnotation", setFileAnnotation)
	engine.POST("/api/asset/getFileAnnotation", getFileAnnotation)
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, httptest.NewRequest("POST", "/api/asset/setFileAnnotation", bytes.NewReader(body)))
	requireAPIContract(t, "POST", "/api/asset/setFileAnnotation", recorder)
	var response struct{ Code int }
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code != 0 {
		t.Fatalf("annotation write failed: %s %v", recorder.Body.String(), err)
	}
	var expected map[string]fileAnno
	if err := json.Unmarshal([]byte(data), &expected); err != nil {
		t.Fatal(err)
	}
	normalized, _ := json.Marshal(expected)
	stored, err := os.ReadFile(filepath.Join(assets, "fixture.pdf.sya"))
	if err != nil || !bytes.Equal(stored, normalized) {
		t.Fatalf("annotation format differs: %s %v", stored, err)
	}
	recorder = httptest.NewRecorder()
	engine.ServeHTTP(recorder, httptest.NewRequest("POST", "/api/asset/getFileAnnotation", strings.NewReader(`{"path":"assets/fixture.pdf.sya"}`)))
	requireAPIContract(t, "POST", "/api/asset/getFileAnnotation", recorder)
	var read struct {
		Data apicontract.AssetAnnotationData
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &read); err != nil || read.Data.Data != string(normalized) {
		t.Fatalf("annotation read differs: %s %v", recorder.Body.String(), err)
	}
	reader := gin.New()
	reader.POST("/api/asset/getFileAnnotation", getFileAnnotation)
	recorder = httptest.NewRecorder()
	reader.ServeHTTP(recorder, httptest.NewRequest("POST", "/api/asset/getFileAnnotation", strings.NewReader(`{"path":"assets/fixture.pdf.sya"}`)))
	requireAPIContract(t, "POST", "/api/asset/getFileAnnotation", recorder)
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code != http.StatusForbidden {
		t.Fatalf("unpublished annotation must remain forbidden: %s %v", recorder.Body.String(), err)
	}
}

func TestAssetUploadResultContractNullability(t *testing.T) {
	for _, test := range []struct {
		errors    []string
		failures  []model.AssetUploadFailure
		successes []model.AssetUploadSuccess
		mapping   map[string]string
	}{
		{},
		{errors: []string{}, failures: []model.AssetUploadFailure{}, successes: []model.AssetUploadSuccess{}, mapping: map[string]string{}},
		{errors: []string{"file"}, failures: []model.AssetUploadFailure{{Index: 1, Name: "file", Error: "failed"}}, successes: []model.AssetUploadSuccess{{Index: 0, Name: "file", Path: "assets/file"}}, mapping: map[string]string{"file": "assets/file"}},
	} {
		expected, _ := json.Marshal(model.AssetUploadResult{ErrFiles: test.errors, FailedFiles: test.failures, SuccFiles: test.successes, SuccMap: test.mapping})
		actual, _ := json.Marshal(assetUploadData(test.errors, test.failures, test.successes, test.mapping))
		if !bytes.Equal(expected, actual) {
			t.Fatalf("upload data differs: %s / %s", expected, actual)
		}
	}
}
