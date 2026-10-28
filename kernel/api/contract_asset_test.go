// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func setupAssetContractWorkspace(t *testing.T) string {
	t.Helper()
	previousConf, previousData, previousWorkspace := model.Conf, util.DataDir, util.WorkspaceDir
	model.Conf = model.NewAppConf()
	model.Conf.Sync.Store(conf.NewSync())
	util.WorkspaceDir = t.TempDir()
	util.DataDir = filepath.Join(util.WorkspaceDir, "data")
	t.Cleanup(func() { model.Conf, util.DataDir, util.WorkspaceDir = previousConf, previousData, previousWorkspace })
	dir := filepath.Join(util.DataDir, "assets")
	if err := os.MkdirAll(dir, 0755); err != nil {
		t.Fatal(err)
	}
	return dir
}

func TestMissingAssetsContract(t *testing.T) {
	for _, mode := range []string{"empty", "missing", "unreadable document", "source failure", "panic"} {
		t.Run(mode, func(t *testing.T) {
			setupAssetContractWorkspace(t)
			model.Conf.FileTree.Store(conf.NewFileTree())
			if mode == "source failure" {
				util.DataDir = filepath.Join(util.WorkspaceDir, "missing")
			} else if mode == "panic" {
				model.Conf = nil
			} else if mode != "empty" {
				boxID := "20260918000000-abcdefg"
				boxConf := conf.NewBoxConf()
				boxConf.Closed = false
				if err := (&model.Box{ID: boxID}).SaveConf(boxConf); err != nil {
					t.Fatal(err)
				}
				data := `{"Type":"NodeDocument","ID":"20260918000001-abcdefg","Properties":{"title-img":"background-image: url(assets/missing.png)"}}`
				if mode == "unreadable document" {
					if err := os.WriteFile(filepath.Join(util.DataDir, boxID, "20260918000002-abcdefg.sy"), []byte(data), 0644); err != nil {
						t.Fatal(err)
					}
					data = `{"Type":`
				}
				if err := os.WriteFile(filepath.Join(util.DataDir, boxID, "20260918000001-abcdefg.sy"), []byte(data), 0644); err != nil {
					t.Fatal(err)
				}
			}
			engine := gin.New()
			engine.POST("/api/asset/getMissingAssets", getMissingAssets)
			recorder := httptest.NewRecorder()
			engine.ServeHTTP(recorder, httptest.NewRequest("POST", "/api/asset/getMissingAssets", strings.NewReader(`{}`)))
			requireAPIContract(t, "POST", "/api/asset/getMissingAssets", recorder)
			var response struct {
				Code int
				Msg  string
				Data []*apicontract.AssetUnusedItem
			}
			if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
				t.Fatal(err)
			}
			if mode == "empty" || mode == "missing" {
				want := 0
				if mode == "missing" {
					want = 1
				}
				if response.Code != 0 || response.Data == nil || len(response.Data) != want {
					t.Fatalf("invalid successful list: %s", recorder.Body.String())
				}
			} else if response.Code != -1 || response.Msg == "" || response.Data != nil {
				t.Fatalf("failed scan must not publish a successful list: %s", recorder.Body.String())
			}
			if mode == "unreadable document" && !strings.Contains(response.Msg, "incomplete") {
				t.Fatalf("skipped documents must be identified as an incomplete scan: %s", recorder.Body.String())
			}
		})
	}
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
					for range 2 {
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
			var responses []map[string]any
			for _, handler := range []gin.HandlerFunc{model.Upload, uploadAsset} {
				engine := gin.New()
				engine.POST("/api/asset/upload", handler)
				recorder := httptest.NewRecorder()
				engine.ServeHTTP(recorder, request())
				if err := bundle.ValidateHTTPResponse("POST", "/api/asset/upload", recorder.Code, recorder.Header().Get("Content-Type"), recorder.Body.Bytes()); err != nil {
					t.Fatal(err)
				}
				var response map[string]any
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

func TestAssetUnusedScanFailureContract(t *testing.T) {
	assets := setupAssetContractWorkspace(t)
	model.Conf.FileTree.Store(conf.NewFileTree())
	box := &model.Box{ID: "20260918000000-abcdefg"}
	if err := box.SaveConf(conf.NewBoxConf()); err != nil {
		t.Fatal(err)
	}
	docPath := filepath.Join(util.DataDir, box.ID, "20260918000001-abcdefg.sy")
	assetPath := filepath.Join(assets, "protected.png")
	if err := os.WriteFile(assetPath, []byte("original"), 0644); err != nil {
		t.Fatal(err)
	}
	engine := gin.New()
	engine.POST("/api/asset/getUnusedAssets", getUnusedAssets)
	engine.POST("/api/asset/removeUnusedAssets", removeUnusedAssets)
	engine.POST("/api/asset/removeUnusedAsset", removeUnusedAsset)
	for _, data := range []string{`{"Type":"NodeDocument","Spec":"99"}`, `{"Type":`} {
		if err := os.WriteFile(docPath, []byte(data), 0644); err != nil {
			t.Fatal(err)
		}
		for _, endpoint := range []string{"getUnusedAssets", "removeUnusedAssets", "removeUnusedAsset"} {
			url := "/api/asset/" + endpoint
			recorder := httptest.NewRecorder()
			engine.ServeHTTP(recorder, httptest.NewRequest("POST", url, strings.NewReader(`{"path":"assets/protected.png","keyword":"protected"}`)))
			requireAPIContract(t, "POST", url, recorder)
			var response struct {
				Code int
				Msg  string
				Data json.RawMessage
			}
			if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code != -1 || !strings.Contains(response.Msg, filepath.Base(docPath)) || string(response.Data) != "null" {
				t.Fatalf("%s must report scan failure: %s, %v", endpoint, recorder.Body.String(), err)
			}
			if stored, err := os.ReadFile(assetPath); err != nil || string(stored) != "original" {
				t.Fatalf("%s changed asset: %q, %v", endpoint, stored, err)
			}
		}
	}
	if err := os.Remove(docPath); err != nil {
		t.Fatal(err)
	}
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, httptest.NewRequest("POST", "/api/asset/getUnusedAssets", strings.NewReader(`{}`)))
	requireAPIContract(t, "POST", "/api/asset/getUnusedAssets", recorder)
	var response struct {
		Code int
		Data []apicontract.AssetUnusedItem
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code != 0 || len(response.Data) != 1 || response.Data[0].Item != "assets/protected.png" {
		t.Fatalf("successful scan changed response shape: %s, %v", recorder.Body.String(), err)
	}
}

func TestUnusedAssetsFilenameSearchContract(t *testing.T) {
	assets := setupAssetContractWorkspace(t)
	model.Conf.FileTree.Store(conf.NewFileTree())
	for i := range 513 {
		if err := os.WriteFile(filepath.Join(assets, fmt.Sprintf("unused-%04d.txt", i)), []byte("unused"), 0644); err != nil {
			t.Fatal(err)
		}
	}
	const target = "Cover-报告-20261025000000-abcdefg.JPG"
	for _, name := range []string{target, "literal[1]%.zip", "literalX1.zip", "referenced.JPG"} {
		if err := os.WriteFile(filepath.Join(assets, name), []byte("unused"), 0644); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Chtimes(filepath.Join(assets, target), time.Unix(1, 0), time.Unix(1, 0)); err != nil {
		t.Fatal(err)
	}
	box := &model.Box{ID: "20260918000000-abcdefg"}
	if err := box.SaveConf(conf.NewBoxConf()); err != nil {
		t.Fatal(err)
	}
	data := `{"Type":"NodeDocument","ID":"20260918000001-abcdefg","Properties":{"title-img":"background-image: url(assets/referenced.JPG)"}}`
	if err := os.WriteFile(filepath.Join(util.DataDir, box.ID, "20260918000001-abcdefg.sy"), []byte(data), 0644); err != nil {
		t.Fatal(err)
	}
	engine := gin.New()
	engine.POST("/api/asset/getUnusedAssets", getUnusedAssets)
	for _, test := range []struct {
		body  string
		count int
		name  string
	}{
		{body: "", count: 512},
		{body: `{}`, count: 512},
		{body: `{"keyword":null}`, count: 512},
		{body: `{"keyword":"  "}`, count: 512},
		{body: `{"all":false}`, count: 512},
		{body: `{"all":null}`, count: 512},
		{body: `{"all":true}`, count: 516},
		{body: `{"all":true,"keyword":"cover"}`, count: 1, name: target},
		{body: `{"keyword":"  cOvEr  "}`, count: 1, name: target},
		{body: `{"keyword":"报告"}`, count: 1, name: target},
		{body: `{"keyword":"abcdefg.jpg"}`, count: 1, name: target},
		{body: `{"keyword":"[1]%"}`, count: 1, name: "literal[1]%.zip"},
		{body: `{"keyword":"referenced"}`},
		{body: `{"keyword":"assets"}`},
		{body: `{"keyword":"missing"}`},
	} {
		t.Run(test.body, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			engine.ServeHTTP(recorder, httptest.NewRequest("POST", "/api/asset/getUnusedAssets", strings.NewReader(test.body)))
			requireAPIContract(t, "POST", "/api/asset/getUnusedAssets", recorder)
			var response struct {
				Code int
				Data []apicontract.AssetUnusedItem
			}
			if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code != 0 || len(response.Data) != test.count {
				t.Fatalf("filename search failed: %s, %v", recorder.Body.String(), err)
			}
			if response.Data == nil {
				t.Fatal("empty search result must remain an array")
			}
			for _, item := range response.Data {
				if test.name != "" && item.Name != test.name || test.count == 512 && item.Name == target {
					t.Fatalf("unexpected filename result: %+v", item)
				}
			}
		})
	}
}

func TestAndroidNotificationAssetDeletionContract(t *testing.T) {
	if os.Getenv("SIYUAN_TEST_ANDROID_NOTIFICATION_ASSET") != "1" {
		command := exec.Command(os.Args[0], "-test.run=^TestAndroidNotificationAssetDeletionContract$", "-test.timeout=30s")
		command.Env = append(os.Environ(), "SIYUAN_TEST_ANDROID_NOTIFICATION_ASSET=1")
		if output, err := command.CombinedOutput(); err != nil {
			t.Fatalf("notification asset subprocess failed: %v\n%s", err, output)
		}
		return
	}
	assets := setupAssetContractWorkspace(t)
	{
		confSectionValue0, confSectionValue1 := conf.NewFileTree(), conf.NewSearch()
		model.Conf.FileTree.Store(confSectionValue0)
		model.Conf.Search.Store(confSectionValue1)
	}
	util.HistoryDir, util.TempDir, util.ConfDir = t.TempDir(), t.TempDir(), t.TempDir()
	util.QueueDir = t.TempDir()
	util.DBPath, util.HistoryDBPath = filepath.Join(util.TempDir, "siyuan.db"), filepath.Join(util.TempDir, "history.db")
	util.AssetContentDBPath = filepath.Join(util.TempDir, "asset_content.db")
	util.BlockTreeDBPath = filepath.Join(util.TempDir, "blocktree.db")
	sql.InitDatabase(true)
	sql.InitHistoryDatabase(true)
	sql.InitAssetContentDatabase(true)
	defer sql.CloseDatabase()
	p := filepath.Join(assets, "android-notification-texts.txt")
	content := []byte("notification title\n")
	if err := os.WriteFile(p, content, 0644); err != nil {
		t.Fatal(err)
	}
	engine := gin.New()
	engine.POST("/api/asset/getUnusedAssets", getUnusedAssets)
	engine.POST("/api/asset/removeUnusedAssets", removeUnusedAssets)
	engine.POST("/api/asset/removeUnusedAsset", removeUnusedAsset)
	call := func(endpoint, body string) *httptest.ResponseRecorder {
		t.Helper()
		url := "/api/asset/" + endpoint
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest("POST", url, strings.NewReader(body)))
		requireAPIContract(t, "POST", url, recorder)
		var response struct{ Code int }
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code != 0 {
			t.Fatalf("%s failed: %s, %v", endpoint, recorder.Body.String(), err)
		}
		return recorder
	}
	for _, endpoint := range []string{"getUnusedAssets", "removeUnusedAssets"} {
		recorder := call(endpoint, `{}`)
		var response struct{ Data json.RawMessage }
		want := "[]"
		if endpoint == "removeUnusedAssets" {
			want = `{"paths":[]}`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || !bytes.Equal(response.Data, []byte(want)) {
			t.Fatalf("%s exposed the switch: %s, %v", endpoint, recorder.Body.String(), err)
		}
		if stored, err := os.ReadFile(p); err != nil || !bytes.Equal(stored, content) {
			t.Fatalf("%s changed the switch: %q, %v", endpoint, stored, err)
		}
	}
	recorder := call("removeUnusedAsset", `{"path":"assets/android-notification-texts.txt"}`)
	var response struct{ Data apicontract.AssetPathData }
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Data.Path != p {
		t.Fatalf("explicit deletion result differs: %s, %v", recorder.Body.String(), err)
	}
	if _, err := os.Stat(p); !os.IsNotExist(err) {
		t.Fatalf("switch remains after explicit deletion: %v", err)
	}
	histories, err := filepath.Glob(filepath.Join(util.HistoryDir, "*-clean", "assets", "android-notification-texts.txt"))
	if err != nil || len(histories) != 1 {
		t.Fatalf("missing cleanup history: %v, %v", histories, err)
	}
	if stored, err := os.ReadFile(histories[0]); err != nil || !bytes.Equal(stored, content) {
		t.Fatalf("history changed notification texts: %q, %v", stored, err)
	}
}
