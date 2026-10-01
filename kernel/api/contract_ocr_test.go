package api

import (
	"bytes"
	"encoding/json"
	"image"
	"image/png"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAPIContractOCREncryptedAssetAliases(t *testing.T) {
	setupAssetContractWorkspace(t)
	const boxID = "20261001010000-abcdefg"
	directory := filepath.Join(util.DataDir, boxID, ".siyuan")
	if err := os.MkdirAll(directory, 0755); err != nil {
		t.Fatal(err)
	}
	box := conf.NewBoxConf()
	box.Encrypted = true
	content, err := json.Marshal(box)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(directory, "conf.json"), content, 0600); err != nil {
		t.Fatal(err)
	}
	const path = "assets/missing-encrypted.png"
	util.SetAssetText(path, "ordinary text")
	t.Cleanup(func() { util.RemoveAssetText(path) })
	engine := gin.New()
	engine.POST("/api/asset/getImageOCRText", getImageOCRText)
	engine.POST("/api/asset/setImageOCRText", setImageOCRText)
	engine.POST("/api/asset/ocr", ocr)
	for _, suffix := range []string{"?box=" + boxID, "?box=" + boxID + "#fragment"} {
		for _, route := range []string{"getImageOCRText", "setImageOCRText", "ocr"} {
			body, _ := json.Marshal(map[string]string{"path": path + suffix, "text": "private text"})
			recorder := httptest.NewRecorder()
			url := "/api/asset/" + route
			engine.ServeHTTP(recorder, httptest.NewRequest("POST", url, bytes.NewReader(body)))
			requireAPIContract(t, "POST", url, recorder)
			var response struct {
				Code int
				Data struct{ Text string }
			}
			if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Data.Text != "" || (route == "ocr" && response.Code == 0) {
				t.Fatalf("encrypted OCR alias: %s, %v", recorder.Body.String(), err)
			}
			if util.GetAssetText(path) != "ordinary text" {
				t.Fatal("encrypted OCR write changed shared text")
			}
		}
	}
}

func TestAPIContractOCRNotebookIsolation(t *testing.T) {
	assets := setupAssetContractWorkspace(t)
	const name = "ocr-notebook-contract.png"
	const path = "assets/" + name
	const firstBox = "20261001021001-abcdefg"
	const secondBox = "20261001021002-abcdefg"
	boxConfig, err := json.Marshal(conf.NewBoxConf())
	if err != nil {
		t.Fatal(err)
	}
	for _, boxID := range []string{firstBox, secondBox} {
		for name, content := range map[string][]byte{".siyuan/conf.json": boxConfig, path: []byte(boxID)} {
			filename := filepath.Join(util.DataDir, boxID, filepath.FromSlash(name))
			if err = os.MkdirAll(filepath.Dir(filename), 0755); err != nil {
				t.Fatal(err)
			}
			if err = os.WriteFile(filename, content, 0644); err != nil {
				t.Fatal(err)
			}
		}
	}
	if err = os.WriteFile(filepath.Join(assets, name), []byte("global image"), 0644); err != nil {
		t.Fatal(err)
	}
	engine := gin.New()
	engine.POST("/api/asset/setImageOCRText", setImageOCRText)
	engine.POST("/api/asset/getImageOCRText", getImageOCRText)
	results := map[string]string{path: "global OCR", path + "?box=" + firstBox: "first notebook OCR", path + "?box=" + secondBox: "second notebook OCR"}
	for reference, text := range results {
		reference := reference
		t.Cleanup(func() { util.RemoveAssetText(reference) })
		body, _ := json.Marshal(map[string]string{"path": reference + "#preview", "text": text})
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest("POST", "/api/asset/setImageOCRText", bytes.NewReader(body)))
		requireAPIContract(t, "POST", "/api/asset/setImageOCRText", recorder)
		var response struct{ Code int }
		if err = json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code != 0 {
			t.Fatalf("set OCR: %s, %v", recorder.Body.String(), err)
		}
	}
	for reference, want := range results {
		body, _ := json.Marshal(map[string]string{"path": reference + "#different-preview"})
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest("POST", "/api/asset/getImageOCRText", bytes.NewReader(body)))
		requireAPIContract(t, "POST", "/api/asset/getImageOCRText", recorder)
		var response struct {
			Code int
			Data apicontract.AssetTextData
		}
		if err = json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code != 0 || response.Data.Text != want {
			t.Fatalf("get OCR for %s: %s, %v", reference, recorder.Body.String(), err)
		}
	}
}

func TestAPIContractOCRPermissions(t *testing.T) {
	setupAssetContractWorkspace(t)
	previousReadOnly := util.ReadOnly
	t.Cleanup(func() { util.ReadOnly = previousReadOnly })
	for _, route := range []struct {
		path    string
		write   bool
		handler gin.HandlerFunc
	}{
		{"/api/asset/getOCRConfig", false, getOCRConfig},
		{"/api/asset/setOCRConfig", true, setOCRConfig},
		{"/api/asset/importOCRModels", true, importOCRModels},
	} {
		for _, role := range []model.Role{model.RoleReader, model.RoleEditor, model.RoleAdministrator} {
			for _, readonly := range []bool{false, true} {
				util.ReadOnly = readonly
				called := false
				engine := gin.New()
				engine.Use(func(c *gin.Context) { c.Set(model.RoleContextKey, role) })
				handlers := []gin.HandlerFunc{model.CheckAuth, model.CheckAdminRole}
				if route.write {
					handlers = append(handlers, model.CheckReadonly)
				}
				handlers = append(handlers, func(c *gin.Context) { called = true; route.handler(c) })
				engine.POST(route.path, handlers...)
				engine.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("POST", route.path, strings.NewReader(`{}`)))
				if called != (role == model.RoleAdministrator && (!readonly || !route.write)) {
					t.Fatalf("unexpected authorization: %s, %v, readonly=%v, called=%v", route.path, role, readonly, called)
				}
			}
		}
	}
}

func TestAPIContractOCRNativeImportAndHeadlessRecognition(t *testing.T) {
	models := os.Getenv("SIYUAN_OCR_TEST_ASSETS")
	if models == "" || os.Getenv("SIYUAN_OCR_TEST_LIBRARY") == "" {
		t.Skip("native OCR resources are not configured")
	}
	assets := setupAssetContractWorkspace(t)
	previousWorking, previousTemp, previousConf := util.WorkingDir, util.TempDir, util.ConfDir
	util.WorkingDir = filepath.Dir(filepath.Dir(filepath.Dir(models)))
	util.TempDir, util.ConfDir = t.TempDir(), t.TempDir()
	t.Cleanup(func() { util.WorkingDir, util.TempDir, util.ConfDir = previousWorking, previousTemp, previousConf })
	model.Conf.OCR = &conf.OCR{Provider: "paddleocr", Model: "tiny", Auto: true}
	engine := gin.New()
	engine.POST("/api/asset/importOCRModels", importOCRModels)
	engine.POST("/api/asset/ocr", ocr)
	upload := func(invalid bool) apicontract.OCRModel {
		t.Helper()
		var body bytes.Buffer
		writer := multipart.NewWriter(&body)
		for field, name := range map[string]string{"detector": "det/inference.onnx", "detectorConfig": "det/inference.yml", "recognizer": "rec/inference.onnx", "recognizerConfig": "rec/inference.yml"} {
			part, err := writer.CreateFormFile(field, "../../untrusted-"+filepath.Base(name))
			if err != nil {
				t.Fatal(err)
			}
			if invalid && field == "recognizer" {
				_, err = part.Write([]byte("invalid ONNX"))
			} else {
				file, openErr := os.Open(filepath.Join(models, "tiny", filepath.FromSlash(name)))
				if openErr != nil {
					t.Fatal(openErr)
				}
				_, err = io.Copy(part, file)
				file.Close()
			}
			if err != nil {
				t.Fatal(err)
			}
		}
		if err := writer.Close(); err != nil {
			t.Fatal(err)
		}
		request := httptest.NewRequest("POST", "/api/asset/importOCRModels", &body)
		request.Header.Set("Content-Type", writer.FormDataContentType())
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, request)
		if request.MultipartForm != nil {
			defer request.MultipartForm.RemoveAll()
		}
		requireAPIContract(t, "POST", request.URL.Path, recorder)
		var response struct {
			Code int
			Data apicontract.OCRModel
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
			t.Fatal(err)
		}
		if (response.Code != 0) != invalid {
			t.Fatalf("import: %s", recorder.Body.String())
		}
		return response.Data
	}
	imported := upload(false)
	if len(imported.ID) != 64 || imported.BuiltIn {
		t.Fatalf("invalid model result: %+v", imported)
	}
	if duplicate := upload(false); duplicate.ID != imported.ID {
		t.Fatal("duplicate upload changed model identity")
	}
	if err := model.Conf.SetOCR(conf.OCR{Provider: "paddleocr", Model: imported.ID, Auto: true}); err != nil {
		t.Fatal(err)
	}
	file, err := os.Create(filepath.Join(assets, "headless.png"))
	if err != nil {
		t.Fatal(err)
	}
	if err = png.Encode(file, image.NewRGBA(image.Rect(0, 0, 100, 100))); err != nil {
		t.Fatal(err)
	}
	file.Close()
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/api/asset/ocr", strings.NewReader(`{"path":"assets/headless.png"}`)))
	requireAPIContract(t, "POST", "/api/asset/ocr", recorder)
	var result struct {
		Code int
		Data apicontract.AssetOCRData
	}
	if err = json.Unmarshal(recorder.Body.Bytes(), &result); err != nil || result.Code != 0 || result.Data.OCRJSON == nil {
		t.Fatalf("headless API: %s, %v", recorder.Body.String(), err)
	}
	if !util.ExistsAssetText("assets/headless.png") {
		t.Fatal("successful empty result was not saved")
	}
	t.Cleanup(func() { util.RemoveAssetText("assets/headless.png") })
	upload(true)
	entries, err := os.ReadDir(filepath.Join(util.DataDir, "ocr", "models"))
	if err != nil || len(entries) != 1 {
		t.Fatalf("invalid import published files: %v, %v", entries, err)
	}
	entries, err = os.ReadDir(util.TempDir)
	if err != nil || len(entries) != 0 {
		t.Fatalf("import leaked staging files: %v, %v", entries, err)
	}
}

func TestAPIContractOCRSettings(t *testing.T) {
	setupAssetContractWorkspace(t)
	previousConfDir := util.ConfDir
	util.ConfDir = t.TempDir()
	t.Cleanup(func() { util.ConfDir = previousConfDir })
	engine := gin.New()
	engine.POST("/api/asset/getOCRConfig", getOCRConfig)
	engine.POST("/api/asset/setOCRConfig", setOCRConfig)
	get := httptest.NewRecorder()
	engine.ServeHTTP(get, httptest.NewRequest("POST", "/api/asset/getOCRConfig", strings.NewReader(`{}`)))
	requireAPIContract(t, "POST", "/api/asset/getOCRConfig", get)
	var result struct{ Data apicontract.OCRConfigData }
	if err := json.Unmarshal(get.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.Data.Config.Provider != "tesseract" || !result.Data.Config.Auto || len(result.Data.Models) != 2 || len(result.Data.Providers) != 2 {
		t.Fatalf("unexpected defaults: %+v", result.Data)
	}
	path := "assets/preserved.png"
	util.SetAssetText(path, "existing text")
	t.Cleanup(func() { util.RemoveAssetText(path) })
	for _, test := range []struct {
		body    string
		success bool
	}{
		{`{"provider":"tesseract","model":"tiny","auto":false}`, true},
		{`{"provider":"unknown","model":"tiny","auto":true}`, false},
		{`{"provider":"paddleocr","model":"../../outside","auto":true}`, false},
		{`{"provider":"tesseract","model":"tiny","auto":"false"}`, false},
		{`{"provider":"tesseract","model":"tiny"}`, false},
	} {
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest("POST", "/api/asset/setOCRConfig", strings.NewReader(test.body)))
		requireAPIContract(t, "POST", "/api/asset/setOCRConfig", recorder)
		var response struct{ Code int }
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
			t.Fatal(err)
		}
		if (response.Code == 0) != test.success {
			t.Fatalf("body=%s response=%s", test.body, recorder.Body.String())
		}
		if util.GetAssetText(path) != "existing text" {
			t.Fatal("configuration update changed existing OCR text")
		}
	}
	data, err := os.ReadFile(filepath.Join(util.ConfDir, "conf.json"))
	if err != nil {
		t.Fatal(err)
	}
	var saved struct {
		OCR conf.OCR `json:"ocr"`
	}
	if err = json.Unmarshal(data, &saved); err != nil {
		t.Fatal(err)
	}
	if saved.OCR.Auto || saved.OCR.Model != "tiny" {
		t.Fatalf("settings were not persisted: %+v", saved.OCR)
	}
}

func TestAPIContractOCRFailurePreservesText(t *testing.T) {
	assets := setupAssetContractWorkspace(t)
	path := "assets/failure.png"
	if err := os.WriteFile(filepath.Join(assets, "failure.png"), []byte("invalid image"), 0644); err != nil {
		t.Fatal(err)
	}
	model.Conf.OCR = &conf.OCR{Provider: "paddleocr", Model: "small"}
	util.SetAssetText(path, "previous result")
	t.Cleanup(func() { util.RemoveAssetText(path) })
	engine := gin.New()
	engine.POST("/api/asset/ocr", ocr)
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, httptest.NewRequest("POST", "/api/asset/ocr", strings.NewReader(`{"path":"assets/failure.png"}`)))
	requireAPIContract(t, "POST", "/api/asset/ocr", recorder)
	var response struct{ Code int }
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response.Code == 0 || util.GetAssetText(path) != "previous result" {
		t.Fatalf("failed OCR replaced text: %s", recorder.Body.String())
	}
}
