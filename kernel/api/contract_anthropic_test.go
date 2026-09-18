package api

import (
	"encoding/json"
	"fmt"
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

func TestAPIContractAnthropicGenerationAndModels(t *testing.T) {
	aiContractConfiguration(t)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("x-api-key") != "key" || r.Header.Get("anthropic-version") == "" || r.Header.Get("X-Custom") != "configured" {
			t.Errorf("provider headers missing: %v", r.Header)
		}
		if r.URL.Path == "/v1/models" {
			_, _ = fmt.Fprint(w, `{"data":[{"id":"test","max_input_tokens":200000}],"has_more":false}`)
			return
		}
		if r.URL.Path != "/v1/messages" {
			t.Errorf("unexpected upstream path: %s", r.URL.Path)
		}
		var request struct {
			Stream bool `json:"stream"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Error(err)
		}
		if !request.Stream {
			_, _ = fmt.Fprint(w, `{"content":[{"type":"text","text":"answer"}],"stop_reason":"end_turn","usage":{}}`)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		for _, event := range []string{
			`{"type":"message_start","message":{"content":[],"usage":{"input_tokens":3,"output_tokens":1}}}`,
			`{"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":"reason","signature":"signed"}}`,
			`{"type":"content_block_stop","index":0}`,
			`{"type":"content_block_start","index":1,"content_block":{"type":"text","text":"answer"}}`,
			`{"type":"content_block_stop","index":1}`,
			`{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":2}}`,
			`{"type":"message_stop"}`,
		} {
			_, _ = fmt.Fprintf(w, "data: %s\n\n", event)
		}
	}))
	defer upstream.Close()
	provider := &conf.Provider{ID: "provider", Enabled: true, BaseURL: upstream.URL + "/v1",
		Protocol: util.AnthropicProtocolMessages, APIKey: "key", RequestTimeout: 5,
		Headers: map[string]string{"X-Custom": "configured"}, Models: []*conf.Model{{ID: "model", Name: "test", Enabled: true}}}
	model.Conf.AI.Providers = []*conf.Provider{provider}
	model.Conf.AI.Editing.ModelID = "model"
	engine := gin.New()
	engine.POST("/api/ai/editor/chat", aiEditorChat)
	engine.POST("/api/ai/chatGPT", chatGPT)
	engine.POST("/api/ai/listModels", listModels)
	engine.POST("/api/ai/testModel", testModel)
	bundle, err := apicontract.BuildBundle()
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		path string
		body any
		want string
	}{
		{"/api/ai/listModels", map[string]any{"provider": "provider"}, `"test"`},
		{"/api/ai/testModel", map[string]any{"providerConfig": provider, "model": "test"}, `"matched":true`},
		{"/api/ai/chatGPT", map[string]any{"msg": "hello"}, "answer"},
		{"/api/ai/editor/chat", map[string]any{"taskID": "task", "input": "hello"}, "event:done"},
	} {
		t.Run(tc.path, func(t *testing.T) {
			body, _ := json.Marshal(tc.body)
			request := httptest.NewRequest("POST", tc.path, strings.NewReader(string(body)))
			request.Header.Set("Content-Type", "application/json")
			recorder := httptest.NewRecorder()
			engine.ServeHTTP(recorder, request)
			if recorder.Code != 200 || !strings.Contains(recorder.Body.String(), tc.want) {
				t.Fatalf("unexpected response %d %s", recorder.Code, recorder.Body.String())
			}
			if err := bundle.ValidateHTTPResponse("POST", tc.path, recorder.Code, recorder.Header().Get("Content-Type"), recorder.Body.Bytes()); err != nil {
				t.Fatal(err)
			}
			if tc.path == "/api/ai/editor/chat" {
				for _, frame := range strings.Split(strings.TrimSpace(recorder.Body.String()), "\n\n") {
					lines := strings.SplitN(frame, "\n", 2)
					if len(lines) != 2 {
						t.Fatalf("invalid SSE frame: %s", frame)
					}
					if err := bundle.ValidateSSEEvent("POST", tc.path, strings.TrimPrefix(lines[0], "event:"), []byte(strings.TrimPrefix(lines[1], "data:"))); err != nil {
						t.Fatal(err)
					}
				}
				if !strings.Contains(recorder.Body.String(), "event:reasoning") || strings.Contains(recorder.Body.String(), "signed") {
					t.Fatal("editor reasoning projection exposed a signature or omitted reasoning")
				}
			}
		})
	}
}

func TestAPIContractAnthropicSessionContent(t *testing.T) {
	aiContractConfiguration(t)
	engine := gin.New()
	engine.POST("/api/ai/agent/saveSession", saveSession)
	engine.POST("/api/ai/agent/getSession", getSession)
	bundle, err := apicontract.BuildBundle()
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct{ path, body string }{
		{"/api/ai/agent/saveSession", `{"id":"20260918000000-abcdefg","entries":[{"type":"assistant","content":"answer","nativeContent":{"protocol":"anthropic-messages","version":1,"blocks":[{"type":"thinking","thinking":"reason","signature":"opaque"},{"type":"text","text":"answer"}]}}]}`},
		{"/api/ai/agent/getSession", `{"id":"20260918000000-abcdefg"}`},
	} {
		request := httptest.NewRequest("POST", tc.path, strings.NewReader(tc.body))
		request.Header.Set("X-SiYuan-Agent-Checkpoint", "2")
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, request)
		if recorder.Code != 200 || !strings.Contains(recorder.Body.String(), `"code":0`) {
			t.Fatalf("unexpected session response: %s", recorder.Body.String())
		}
		if err := bundle.ValidateHTTPResponse("POST", tc.path, recorder.Code, recorder.Header().Get("Content-Type"), recorder.Body.Bytes()); err != nil {
			t.Fatal(err)
		}
		if tc.path == "/api/ai/agent/getSession" && !strings.Contains(recorder.Body.String(), `"signature":"opaque"`) {
			t.Fatalf("native content was not preserved: %s", recorder.Body.String())
		}
	}
}
