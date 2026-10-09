package api

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAPIContractAIDecisionConnection(t *testing.T) {
	aiContractConfiguration(t)
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		if !strings.Contains(string(body), "The sky is blue.") || strings.Contains(string(body), "private-note") {
			t.Error("connection test did not use a fixed sample")
		}
		if calls.Add(1) == 1 {
			io.WriteString(w, `{"model":"jev-test","answers":{"sample":{"type":"noul","noul":0.99},"category":{"type":"choice","choice":"sky","probabilities":{"sky":0.99,"sea":0.01},"confidence":0.99},"rating":{"type":"score","score":0.99,"probabilities":{"0":0.01,"1":0.99},"confidence":0.99,"legend":{"0":"No color mentioned","1":"A color is explicitly mentioned"}}}}`)
		} else {
			io.WriteString(w, `{"answers":{}}`)
		}
	}))
	defer server.Close()
	model.Conf.AI.Decision.Profiles["typesafe"].Endpoint = server.URL
	model.Conf.AI.Decision.Profiles["typesafe"].APIKey = "test-key"
	engine := gin.New()
	engine.POST("/api/ai/testDecisionModel", testDecisionModel)
	bundle, err := apicontract.BuildBundle()
	if err != nil {
		t.Fatal(err)
	}
	for _, expected := range []bool{true, false} {
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest("POST", "/api/ai/testDecisionModel", strings.NewReader(`{"text":"private-note"}`)))
		if err = bundle.ValidateHTTPResponse("POST", "/api/ai/testDecisionModel", recorder.Code, recorder.Header().Get("Content-Type"), recorder.Body.Bytes()); err != nil {
			t.Fatal(err)
		}
		var response struct {
			Code int
			Data apicontract.AIDecisionTestData
		}
		if err = json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
			t.Fatal(err)
		}
		if response.Code != 0 || response.Data.Matched != expected || (!expected && response.Data.Msg == nil) {
			t.Fatalf("incorrect connection result: %s", recorder.Body.String())
		}
	}
	if model.Conf.AI.Decision.Enabled || calls.Load() != 2 {
		t.Fatal("test requires enabled model or retries requests")
	}
}

func TestAPIContractAIDecisionDraftIsolation(t *testing.T) {
	aiContractConfiguration(t)
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.Header.Get("Authorization") != "Bearer draft-key" {
			t.Error("draft borrowed saved credentials")
		}
		io.WriteString(w, `{"answers":{}}`)
	}))
	defer server.Close()
	saved := model.Conf.AI.Decision
	saved.Profiles["typesafe"].APIKey = "saved-secret"
	before, _ := json.Marshal(saved)
	engine := gin.New()
	engine.POST("/api/ai/testDecisionModel", testDecisionModel)
	for _, key := range []string{"", "draft-key"} {
		payload, _ := json.Marshal(apicontract.AIDecisionTestRequest{Provider: "typesafe", Profile: &apicontract.SettingDecisionProfile{Endpoint: server.URL, APIKey: key, Name: "jev-test", Timeout: 1}})
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest("POST", "/api/ai/testDecisionModel", strings.NewReader(string(payload))))
		if strings.Contains(recorder.Body.String(), "saved-secret") || strings.Contains(recorder.Body.String(), "draft-key") {
			t.Fatal("test leaked credentials")
		}
	}
	for _, body := range []string{`{"provider":"","profile":null}`, `{"profile":null}`, `{"provider":""}`} {
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest("POST", "/api/ai/testDecisionModel", strings.NewReader(body)))
		if !strings.Contains(recorder.Body.String(), "complete profile") {
			t.Fatalf("incomplete draft fell back to saved configuration: %s", recorder.Body.String())
		}
	}
	after, _ := json.Marshal(model.Conf.AI.Decision)
	if string(before) != string(after) || calls.Load() != 1 {
		t.Fatal("draft saved state or missing draft key borrowed saved key")
	}
}

func TestAPIContractSettingDecisionLegacyProjection(t *testing.T) {
	decision := &conf.Decision{Provider: "openai", Profiles: map[string]*conf.DecisionProfile{
		"typesafe": {Endpoint: "https://typesafe.example", APIKey: "typesafe-key", Name: "typesafe", Timeout: 30},
		"openai":   {Endpoint: "https://openai.example", APIKey: "openai-key", Name: "openai", Timeout: 60},
	}}
	payload := settingDecisionPayload(decision)
	system, err := systemConfPayload(&model.AppConf{AI: &conf.AI{Decision: decision}})
	if err != nil || system.AI.Decision.APIKey != "typesafe-key" || system.AI.Decision.Provider != "openai" {
		t.Fatal("initial configuration lost legacy projection")
	}
	if payload.APIKey != "typesafe-key" || payload.Endpoint != "https://typesafe.example" || payload.Provider != "openai" || payload.Profiles["openai"].APIKey != "openai-key" {
		t.Fatal("legacy projection leaked active profile")
	}
}

func TestAPIContractSettingDecisionPartialSave(t *testing.T) {
	aiContractConfiguration(t)
	previousReadOnly := util.ReadOnly
	util.ReadOnly = true
	t.Cleanup(func() { util.ReadOnly = previousReadOnly })
	decision := model.Conf.AI.Decision
	decision.Provider = "openai"
	decision.Profiles["openai"].APIKey = "openai-key"
	decision.Profiles["typesafe"].APIKey = "typesafe-key"
	for _, body := range []string{
		`{}`,
		`{"decision":{"enabled":true,"endpoint":"https://legacy.example","apiKey":"legacy-key","name":"legacy","timeout":30}}`,
		`{"decision":{"enabled":true,"profiles":{"typesafe":{"endpoint":"https://new.example","apiKey":"new-key","name":"new","timeout":40}}}}`,
	} {
		code, message, _ := settingContractRequest(t, "setAI", setAI, body)
		if code != 0 {
			t.Fatalf("save failed: %s", message)
		}
		current := model.Conf.AI.Decision
		if current.Provider != "openai" || current.Profiles["openai"].APIKey != "openai-key" {
			t.Fatal("partial save lost provider or unrelated credentials")
		}
	}
	if model.Conf.AI.Decision.Profiles["typesafe"].APIKey != "new-key" {
		t.Fatal("partial profile was not saved")
	}
}

func TestAPIContractSettingDecisionLegacyPatch(t *testing.T) {
	aiContractConfiguration(t)
	previousReadOnly := util.ReadOnly
	util.ReadOnly = true
	t.Cleanup(func() { util.ReadOnly = previousReadOnly })
	decision := model.Conf.AI.Decision
	decision.Provider = "openai"
	decision.Profiles["openai"].APIKey = "openai-key"
	for _, body := range []string{
		`{"ai":{"decision":{"apiKey":"changed-typesafe-key"}}}`,
		`{"ai":{"decision":{"endpoint":"https://typesafe.example/decision","name":"changed-model","timeout":45}}}`,
	} {
		code, message, _ := settingContractRequest(t, "patch", patchSetting, body)
		if code != 0 {
			t.Fatalf("legacy patch failed: %s", message)
		}
	}
	decision = model.Conf.AI.Decision
	profile := decision.Profiles["typesafe"]
	if decision.Provider != "openai" || decision.Profiles["openai"].APIKey != "openai-key" || profile.APIKey != "changed-typesafe-key" || profile.Endpoint != "https://typesafe.example/decision" || profile.Name != "changed-model" || profile.Timeout != 45 {
		t.Fatal("legacy patch was lost or changed the active provider")
	}
	code, message, _ := settingContractRequest(t, "patch", patchSetting, `{"ai":{"decision":{"apiKey":"stale-projection","profiles":{"typesafe":{"apiKey":"modern-key"}}}}}`)
	if code != 0 || model.Conf.AI.Decision.Profiles["typesafe"].APIKey != "modern-key" {
		t.Fatalf("legacy projection overwrote modern patch: %s", message)
	}
}
