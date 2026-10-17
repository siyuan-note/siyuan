package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAPIContractGeminiInteractionsSessionContent(t *testing.T) {
	testNativeSessionContract(t, `{"protocol":"gemini-interactions","version":1,"blocks":[{"type":"thought","signature":"opaque","summary":[{"type":"text","text":"reason"}]},{"type":"model_output","content":[{"type":"text","text":"answer"}]}]}`)
}

func TestAPIContractGeminiInteractionsGenerationAndModels(t *testing.T) {
	aiContractConfiguration(t)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("x-goog-api-key") != "key" || r.Header.Get("X-Custom") != "configured" {
			t.Errorf("provider headers missing: %v", r.Header)
		}
		if r.URL.Path == "/v1beta/models" {
			fmt.Fprint(w, `{"models":[{"name":"models/test","inputTokenLimit":200000}]}`)
			return
		}
		if r.URL.Path != "/v1beta/interactions" {
			t.Errorf("unexpected path %s", r.URL.Path)
		}
		var request struct {
			Stream bool  `json:"stream"`
			Store  *bool `json:"store"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Error(err)
		}
		if request.Store == nil || *request.Store {
			t.Error("server-side storage enabled")
		}
		if !request.Stream {
			fmt.Fprint(w, `{"id":"i1","status":"completed","steps":[{"type":"model_output","content":[{"type":"text","text":"answer"}]}]}`)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		for _, event := range []string{
			`{"event_type":"interaction.created","interaction":{"id":"i1","status":"in_progress"}}`,
			`{"event_type":"step.start","index":0,"step":{"type":"thought","signature":"signed","summary":[{"type":"text","text":"reason"}]}}`,
			`{"event_type":"step.stop","index":0}`,
			`{"event_type":"step.start","index":1,"step":{"type":"model_output"}}`,
			`{"event_type":"step.delta","index":1,"delta":{"type":"text","text":"answer"}}`,
			`{"event_type":"step.stop","index":1}`,
			`{"event_type":"interaction.completed","interaction":{"id":"i1","status":"completed","usage":{"total_input_tokens":3,"total_output_tokens":2,"total_tokens":5}}}`,
		} {
			fmt.Fprintf(w, "data: %s\n\n", event)
		}
	}))
	defer upstream.Close()
	testNativeProviderContract(t, upstream.URL+"/v1beta", util.GeminiProtocolInteractions)
}
