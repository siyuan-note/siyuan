package api

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func requestOCRProvider(t *testing.T, engine *gin.Engine, route, body string, data any) int {
	t.Helper()
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, httptest.NewRequest("POST", route, strings.NewReader(body)))
	requireAPIContract(t, "POST", route, recorder)
	var response struct {
		Code int
		Data json.RawMessage
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if data != nil && response.Code == 0 {
		if err := json.Unmarshal(response.Data, data); err != nil {
			t.Fatal(err)
		}
	}
	return response.Code
}

func TestAPIContractOCRAIProviderSettings(t *testing.T) {
	engine := setupAIOCRContract(t, func(http.ResponseWriter, *http.Request) { t.Error("settings reached AI provider") })
	previousConfDir, previousDisabled := util.ConfDir, util.DisabledFeatures
	util.ConfDir, util.DisabledFeatures = t.TempDir(), nil
	t.Cleanup(func() { util.ConfDir, util.DisabledFeatures = previousConfDir, previousDisabled })
	engine.POST("/api/asset/getOCRConfig", getOCRConfig)
	engine.POST("/api/asset/setOCRConfig", setOCRConfig)
	model.Conf.OCR = &conf.OCR{Provider: "tesseract", Model: "tiny", Auto: true}
	provider := model.Conf.AI.Providers[0]
	provider.DisplayName = "Images"
	provider.Models = append(provider.Models, &conf.Model{ID: "disabled", Name: "hidden", Enabled: false})
	get := func() apicontract.OCRConfigData {
		var data apicontract.OCRConfigData
		if requestOCRProvider(t, engine, "/api/asset/getOCRConfig", `{}`, &data) != 0 {
			t.Fatal("get OCR settings failed")
		}
		return data
	}
	data := get()
	if len(data.Providers) != 3 || len(data.AIModels) != 1 || data.AIModels[0].ID != "vision" || data.AIModels[0].Provider != "Images" {
		t.Fatalf("enabled model choices: %+v", data)
	}
	set := func(body string, success bool, automatic bool) {
		var data apicontract.SettingOCR
		code := requestOCRProvider(t, engine, "/api/asset/setOCRConfig", body, &data)
		if (code == 0) != success || success && (data.Auto != automatic || data.AIModelID == nil || *data.AIModelID != "vision") {
			t.Fatalf("set OCR settings: code=%d data=%+v", code, data)
		}
	}
	set(`{"provider":"ai","model":"tiny","auto":true,"aiModelId":"vision"}`, true, false)
	set(`{"provider":"ai","model":"tiny","auto":true}`, true, true)
	set(`{"provider":"ai","model":"tiny","auto":false,"aiModelId":null}`, true, false)
	set(`{"provider":"ai","model":"tiny","auto":false,"aiModelId":"missing"}`, false, false)
	provider.Models[0].Enabled = false
	data = get()
	if len(data.AIModels) != 0 || len(data.Providers) != 3 || data.Providers[2].Available || *data.Config.AIModelID != "vision" {
		t.Fatalf("disabled selected model fell back: %+v", data)
	}
	set(`{"provider":"ai","model":"tiny","auto":false}`, true, false)
	set(`{"provider":"tesseract","model":"tiny","auto":true}`, true, true)
	if len(get().Providers) != 2 {
		t.Fatal("AI choice shown without enabled models")
	}
	provider.Models[0].Enabled = true
	util.DisabledFeatures = []string{"ai"}
	if data = get(); len(data.Providers) != 2 || len(data.AIModels) != 0 {
		t.Fatal("disabled AI feature advertised models")
	}
}

func TestAPIContractOCRUsesIndependentAIModel(t *testing.T) {
	calls := 0
	engine := setupAIOCRContract(t, func(w http.ResponseWriter, r *http.Request) {
		calls++
		body, _ := io.ReadAll(r.Body)
		if !bytes.Contains(body, []byte(`"model":"independent"`)) || bytes.Contains(body, []byte("vision-test")) {
			t.Errorf("OCR used the agent model: %s", body)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, aiOCRSuccess)
	})
	model.Conf.AI.Providers[0].Models = append(model.Conf.AI.Providers[0].Models,
		&conf.Model{ID: "ocr-model", Enabled: true, Name: "independent"})
	model.Conf.OCR = &conf.OCR{Provider: "ai", Model: "tiny", AIModelID: "ocr-model"}
	engine.POST("/api/asset/ocr", ocr)
	const path = "assets/ai-ocr.png"
	t.Cleanup(func() { util.RemoveAssetText(path) })
	var result apicontract.AssetOCRData
	if requestOCRProvider(t, engine, "/api/asset/ocr", `{"path":"assets/ai-ocr.png#preview"}`, &result) != 0 ||
		result.Text != "first  column\nsecond line" || result.OCRJSON == nil || len(result.OCRJSON) != 0 || calls != 1 {
		t.Fatalf("unified AI OCR response: %+v, calls=%d", result, calls)
	}
	model.Conf.OCR.Provider = "tesseract"
	if response := requestAIOCR(t, engine, path); response.Code != 0 || calls != 2 {
		t.Fatal("manual AI OCR ignored independent model")
	}
	model.Conf.OCR.AIModelID = "missing"
	if response := requestAIOCR(t, engine, path); response.Code == 0 || calls != 2 || util.GetAssetText(path) != result.Text {
		t.Fatal("invalid OCR model fell back to agent or changed text")
	}
	model.Conf.OCR.Provider, model.Conf.OCR.AIModelID = "ai", ""
	if response := requestAIOCR(t, engine, path); response.Code == 0 || calls != 2 {
		t.Fatal("AI provider without a selected model fell back to agent")
	}
}
