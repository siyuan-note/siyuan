package api

import (
	"bytes"
	"encoding/json"
	"io"
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

func TestAPIContractOCRReasoningSettingsCompatibility(t *testing.T) {
	engine := setupAIOCRContract(t, func(http.ResponseWriter, *http.Request) { t.Error("settings reached model") })
	previousConfDir := util.ConfDir
	util.ConfDir = t.TempDir()
	t.Cleanup(func() { util.ConfDir = previousConfDir })
	model.Conf.OCR = &conf.OCR{Provider: "ai", Model: "tiny", AIModelID: "vision"}
	engine.POST("/api/asset/setOCRConfig", setOCRConfig)
	for _, test := range []struct {
		field, expected string
		success         bool
	}{
		{`,"reasoningEffort":"none"`, "none", true},
		{"", "none", true},
		{`,"reasoningEffort":null`, "none", true},
		{`,"reasoningEffort":"high"`, "high", true},
		{`,"reasoningEffort":"invalid"`, "high", false},
		{`,"reasoningEffort":3`, "high", false},
		{`,"reasoningEffort":""`, "", true},
	} {
		body := `{"provider":"ai","model":"tiny","auto":false` + test.field + `}`
		var response apicontract.SettingOCR
		code := requestOCRProvider(t, engine, "/api/asset/setOCRConfig", body, &response)
		if (code == 0) != test.success || model.Conf.GetOCR().ReasoningEffort != test.expected ||
			test.success && (response.ReasoningEffort == nil || *response.ReasoningEffort != test.expected) {
			t.Fatalf("reasoning settings changed unexpectedly: %s, %+v", body, response)
		}
		data, err := os.ReadFile(filepath.Join(util.ConfDir, "conf.json"))
		if err != nil {
			t.Fatal(err)
		}
		var saved struct{ OCR conf.OCR }
		if err = json.Unmarshal(data, &saved); err != nil || saved.OCR.ReasoningEffort != test.expected {
			t.Fatalf("reasoning effort was not persisted: %+v, %v", saved, err)
		}
	}
}

func TestAPIContractOCRReasoningProtocols(t *testing.T) {
	for _, protocol := range []string{"", "openai-responses", "anthropic-messages"} {
		for _, effort := range []string{"", "none", "low"} {
			t.Run(protocol+"/"+effort, func(t *testing.T) {
				calls := 0
				engine := setupAIOCRContract(t, func(w http.ResponseWriter, r *http.Request) {
					calls++
					var body map[string]json.RawMessage
					if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
						t.Error(err)
						w.WriteHeader(http.StatusBadRequest)
						return
					}
					w.Header().Set("Content-Type", "application/json")
					switch protocol {
					case "openai-responses":
						var reasoning struct{ Effort string }
						_ = json.Unmarshal(body["reasoning"], &reasoning)
						if reasoning.Effort != effort {
							t.Errorf("Responses effort: %s", body["reasoning"])
						}
						_, _ = io.WriteString(w, `{"id":"resp_1","status":"completed","output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"text"}]}]}`)
					case "anthropic-messages":
						var thinking struct {
							Type   string
							Budget int `json:"budget_tokens"`
						}
						_ = json.Unmarshal(body["thinking"], &thinking)
						if effort == "" && thinking.Type != "" || effort == "none" && thinking.Type != "disabled" || effort == "low" && (thinking.Type != "enabled" || thinking.Budget != 1024) {
							t.Errorf("Anthropic thinking: %s", body["thinking"])
						}
						_, _ = io.WriteString(w, `{"id":"msg_1","type":"message","role":"assistant","model":"vision-test","content":[{"type":"text","text":"text"}],"stop_reason":"end_turn","usage":{"input_tokens":1,"output_tokens":2}}`)
					default:
						var received string
						_ = json.Unmarshal(body["reasoning_effort"], &received)
						if received != effort {
							t.Errorf("Chat effort: %s", body["reasoning_effort"])
						}
						_, _ = io.WriteString(w, `{"choices":[{"finish_reason":"stop","message":{"content":"text"}}]}`)
					}
				})
				model.Conf.AI.Providers[0].Protocol = protocol
				if protocol == "anthropic-messages" {
					model.Conf.AI.Providers[0].Models[0].Name = "claude-sonnet-4"
				}
				model.Conf.OCR = &conf.OCR{Provider: "ai", Model: "tiny", AIModelID: "vision", ReasoningEffort: effort}
				const path = "assets/ai-ocr.png"
				t.Cleanup(func() { util.RemoveAssetText(path) })
				if response := requestAIOCR(t, engine, path); response.Code != 0 || response.Data.Text != "text" || calls != 1 {
					t.Fatalf("reasoning OCR failed: %+v, calls=%d", response, calls)
				}
			})
		}
	}
}

func TestAPIContractOCRRejectedReasoningPreservesResult(t *testing.T) {
	calls := 0
	engine := setupAIOCRContract(t, func(w http.ResponseWriter, r *http.Request) {
		calls++
		body, _ := io.ReadAll(r.Body)
		if !bytes.Contains(body, []byte(`"effort":"none"`)) {
			t.Errorf("reasoning effort was silently dropped: %s", body)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = io.WriteString(w, `{"error":{"message":"unsupported reasoning effort","type":"invalid_request_error","param":"reasoning.effort"}}`)
	})
	model.Conf.AI.Providers[0].Protocol = "openai-responses"
	model.Conf.OCR = &conf.OCR{Provider: "ai", Model: "tiny", AIModelID: "vision", ReasoningEffort: "none"}
	const path = "assets/ai-ocr.png"
	util.SetAssetText(path, "previous text")
	t.Cleanup(func() { util.RemoveAssetText(path) })
	if response := requestAIOCR(t, engine, path); response.Code == 0 || calls != 1 || util.GetAssetText(path) != "previous text" {
		t.Fatal("rejected reasoning effort was retried with defaults or replaced the previous text")
	}
}
