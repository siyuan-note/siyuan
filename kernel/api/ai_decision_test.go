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
	"github.com/siyuan-note/siyuan/kernel/model"
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
			io.WriteString(w, `{"model":"jev-test","answers":{"sample":{"type":"noul","noul":0.99}}}`)
		} else {
			io.WriteString(w, `{"answers":{}}`)
		}
	}))
	defer server.Close()
	model.Conf.AI.Decision.Endpoint = server.URL
	model.Conf.AI.Decision.APIKey = "test-key"
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
