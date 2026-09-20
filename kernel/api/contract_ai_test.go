package api

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"github.com/88250/gulu"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/agent"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func aiContractConfiguration(t *testing.T) {
	t.Helper()
	previous, dir := model.Conf, util.DataDir
	model.Conf = model.NewAppConf()
	model.Conf.AI = conf.NewAI()
	model.Conf.AI.Embedding = nil
	model.Conf.AI.Rerank = nil
	util.DataDir = t.TempDir()
	t.Cleanup(func() { model.Conf = previous; util.DataDir = dir })
}

type aiUnreadBody struct{ t *testing.T }

func (body aiUnreadBody) Read([]byte) (int, error) {
	body.t.Fatal("AI request body read before provider admission")
	return 0, nil
}
func (body aiUnreadBody) Close() error { return nil }

func TestAPIContractAIProviderAdmissionBeforeBody(t *testing.T) {
	aiContractConfiguration(t)
	model.Conf.AI.Providers = nil
	engine := gin.New()
	engine.POST("/api/ai/editor/chat", aiEditorChat)
	engine.POST("/api/ai/agent/chat", agentChat)
	for _, path := range []string{"/api/ai/editor/chat", "/api/ai/agent/chat"} {
		request := httptest.NewRequest("POST", path, nil)
		request.Body = aiUnreadBody{t: t}
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, request)
		if recorder.Code != 200 || !strings.Contains(recorder.Body.String(), `"code":-1`) {
			t.Fatalf("provider admission changed: %d %s", recorder.Code, recorder.Body.String())
		}
	}
}

func TestAPIContractAIScalarCompatibility(t *testing.T) {
	compareSyncDecode(t, apicontract.AIChatGPT, "msg", true, true, []string{`{}`, `null`, `[]`, ``, `{"msg":null}`, `{"msg":1}`, `{"msg":"  "}`, `{"msg":" hello "}`, `{"msg":"x","unused":1e400}`}, func(r apicontract.AIMessageRequest) string { return r.Msg })
	compareSyncDecode(t, apicontract.AIRemoveEditorAction, "id", true, true, []string{`{}`, `{"id":null}`, `{"id":true}`, `{"id":"  "}`, `{"id":" id "}`}, func(r apicontract.AIEditorActionIDRequest) string { return r.ID })
}

func TestAPIContractAIStructErrors(t *testing.T) {
	type agentConfirmReq struct {
		ConfirmID string `json:"confirmID"`
		Approved  bool   `json:"approved"`
		Always    bool   `json:"always"`
	}
	for _, body := range []string{``, `{`, `{"approved":1}`, `{"confirmID":[]}`, `{"Approved":null}`, `{"always":true} trailing`} {
		context, _ := gin.CreateTestContext(httptest.NewRecorder())
		context.Request = httptest.NewRequest("POST", "/api/ai/agent/confirm", strings.NewReader(body))
		context.Request.Header.Set("Content-Type", "application/json")
		var original agentConfirmReq
		expected := context.ShouldBindJSON(&original)
		_, err := apicontract.AIAgentConfirm.Decode(strings.NewReader(body))
		if expected != nil {
			if err == nil || err.Error() != "invalid request: "+expected.Error() {
				t.Fatalf("struct error changed for %s: %v != %v", body, err, expected)
			}
		} else if err != nil {
			t.Fatal(err)
		}
	}
}

func TestAPIContractAIProviderDraftCompatibility(t *testing.T) {
	for _, raw := range []string{`{}`, `{"BASEURL":" url ","requestTimeout":1.0}`, `{"baseURL":false}`, `{"requestTimeout":1.5}`, `{"models":[null,{"name":"m"}]}`, `{"headers":{"test":null}}`} {
		var object map[string]any
		if err := json.Unmarshal([]byte(raw), &object); err != nil {
			t.Fatal(err)
		}
		encoded, err := gulu.JSON.MarshalJSON(object)
		if err != nil {
			t.Fatal(err)
		}
		var want conf.Provider
		expectedError := gulu.JSON.UnmarshalJSON(encoded, &want)
		request, err := apicontract.AIListModels.Decode(strings.NewReader(`{"providerConfig":` + raw + `}`))
		if err != nil {
			t.Fatal(err)
		}
		if (request.ProviderError() != nil) != (expectedError != nil) {
			t.Fatalf("provider draft acceptance changed for %s: %v != %v", raw, request.ProviderError(), expectedError)
		}
		if expectedError != nil && request.ProviderError().Error() != expectedError.Error() {
			t.Fatalf("provider draft error changed: %v != %v", request.ProviderError(), expectedError)
		}
		if expectedError == nil {
			got, _ := json.Marshal(request.ProviderConfig)
			expected, _ := json.Marshal(want)
			if string(got) != string(expected) {
				t.Fatalf("provider fields changed: %s != %s", got, expected)
			}
		}
	}
}

func TestAPIContractAIResponses(t *testing.T) {
	aiContractConfiguration(t)
	bundle, err := apicontract.BuildBundle()
	if err != nil {
		t.Fatal(err)
	}
	engine := gin.New()
	engine.POST("/api/ai/testEmbeddingModel", testEmbeddingModel)
	engine.POST("/api/ai/testRerankModel", testRerankModel)
	engine.POST("/api/ai/testDecisionModel", testDecisionModel)
	engine.POST("/api/ai/agent/confirm", agentChatConfirm)
	engine.POST("/api/ai/agent/question", agentChatQuestion)
	engine.POST("/api/ai/agent/browserCapabilityResult", agentChatBrowserCapabilityResult)
	engine.POST("/api/ai/agent/saveSession", saveSession)
	for _, test := range []struct {
		path, body string
		status     int
		message    string
	}{
		{"/api/ai/testEmbeddingModel", "ignored", 200, "embedding model not configured"},
		{"/api/ai/testRerankModel", "ignored", 200, "rerank model not configured"},
		{"/api/ai/testDecisionModel", "ignored", 200, "decision model not configured"},
		{"/api/ai/agent/confirm", `{"confirmID":"expired"}`, 409, "agent confirmation expired"},
		{"/api/ai/agent/question", `{"questionID":"expired"}`, 409, "agent question expired"},
		{"/api/ai/agent/browserCapabilityResult", `{"callID":"expired","structuredContent":{"nested":[1,true,null]}}`, 409, "agent browser capability call expired"},
		{"/api/ai/agent/confirm", `{"approved":1}`, 200, "invalid request:"},
		{"/api/ai/agent/saveSession", `{`, 400, "invalid session data"},
	} {
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest("POST", test.path, strings.NewReader(test.body))
		request.Header.Set("Content-Type", "application/json")
		engine.ServeHTTP(recorder, request)
		if recorder.Code != test.status || !strings.Contains(recorder.Body.String(), test.message) {
			t.Fatalf("%s changed: %d %s", test.path, recorder.Code, recorder.Body.String())
		}
		if err = bundle.ValidateHTTPResponse("POST", test.path, recorder.Code, recorder.Header().Get("Content-Type"), recorder.Body.Bytes()); err != nil {
			t.Fatalf("%s: %v", test.path, err)
		}
	}
}

func TestAPIContractAISessionExtensions(t *testing.T) {
	aiContractConfiguration(t)
	engine := gin.New()
	engine.POST("/api/ai/agent/saveSession", saveSession)
	engine.POST("/api/ai/agent/getSession", getSession)
	body := `{"id":"20260913000000-abcdefg","title":"example","createdAt":1,"updatedAt":2,"entries":[{"type":"user","content":"hello","futureEntry":{"value":9007199254740993}}],"future":{"nested":[true,null,9007199254740993]}}`
	request := httptest.NewRequest("POST", "/api/ai/agent/saveSession", strings.NewReader(body))
	request.Header.Set("X-SiYuan-Agent-Checkpoint", "2")
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, request)
	if recorder.Code != 200 || !strings.Contains(recorder.Body.String(), `"revision":1`) {
		t.Fatalf("save failed: %d %s", recorder.Code, recorder.Body.String())
	}
	expected, err := agent.GetSessionState("20260913000000-abcdefg", true)
	if err != nil {
		t.Fatal(err)
	}
	recorder = httptest.NewRecorder()
	engine.ServeHTTP(recorder, httptest.NewRequest("POST", "/api/ai/agent/getSession", strings.NewReader(`{"id":"20260913000000-abcdefg"}`)))
	var response struct {
		Code int                        `json:"code"`
		Data map[string]json.RawMessage `json:"data"`
	}
	if err = json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response.Code != 0 || response.Data["future"] == nil || strings.Contains(string(response.Data["entries"]), `"id"`) {
		t.Fatalf("extension or omission changed: %s", recorder.Body.String())
	}
	want, _ := json.Marshal(expected)
	got, _ := json.Marshal(response.Data)
	if string(want) != string(got) {
		t.Fatalf("stored session wire changed:\n%s\n%s", want, got)
	}
	bundle, err := apicontract.BuildBundle()
	if err != nil {
		t.Fatal(err)
	}
	if err = bundle.ValidateHTTPResponse("POST", "/api/ai/agent/getSession", 200, recorder.Header().Get("Content-Type"), recorder.Body.Bytes()); err != nil {
		t.Fatal(err)
	}
}

func TestAPIContractAIEditorSSE(t *testing.T) {
	aiContractConfiguration(t)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"hello\",\"reasoning_content\":\"reason\"},\"finish_reason\":\"length\"}]}\n\ndata: [DONE]\n\n")
	}))
	defer upstream.Close()
	model.Conf.AI.Providers = []*conf.Provider{{ID: "provider", Enabled: true, BaseURL: upstream.URL + "/v1", Protocol: "openai", APIKey: "test", Models: []*conf.Model{{ID: "model", Name: "model", Enabled: true}}}}
	model.Conf.AI.Editing.ModelID = "model"
	engine := gin.New()
	engine.POST("/api/ai/editor/chat", aiEditorChat)
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, httptest.NewRequest("POST", "/api/ai/editor/chat", strings.NewReader(`{"taskID":"task","input":"hello"}`)))
	bundle, err := apicontract.BuildBundle()
	if err != nil {
		t.Fatal(err)
	}
	if err = bundle.ValidateHTTPResponse("POST", "/api/ai/editor/chat", recorder.Code, recorder.Header().Get("Content-Type"), recorder.Body.Bytes()); err != nil {
		t.Fatalf("%v: %s", err, recorder.Body.String())
	}
	for _, frame := range strings.Split(strings.TrimSpace(recorder.Body.String()), "\n\n") {
		lines := strings.SplitN(frame, "\n", 2)
		if len(lines) != 2 {
			t.Fatalf("invalid frame: %s", frame)
		}
		name := strings.TrimPrefix(lines[0], "event:")
		payload := strings.TrimPrefix(lines[1], "data:")
		if err = bundle.ValidateSSEEvent("POST", "/api/ai/editor/chat", name, []byte(payload)); err != nil {
			t.Fatalf("%s: %v", name, err)
		}
	}
	if !strings.Contains(recorder.Body.String(), "event:content") || !strings.Contains(recorder.Body.String(), "event:done") {
		t.Fatalf("stream did not complete: %s", recorder.Body.String())
	}
}

func TestAPIContractAIOAuthContent(t *testing.T) {
	aiContractConfiguration(t)
	engine := gin.New()
	engine.GET("/api/ai/mcp/oauth/callback/:flowID", mcpOAuthCallback)
	bundle, err := apicontract.BuildBundle()
	if err != nil {
		t.Fatal(err)
	}
	for _, remote := range []bool{false, true} {
		request := httptest.NewRequest("GET", "/api/ai/mcp/oauth/callback/missing?code=unused&state=missing", nil)
		request.RemoteAddr = "127.0.0.1:1234"
		if remote {
			request.RemoteAddr = "192.0.2.1:1234"
		}
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, request)
		want := 400
		if remote {
			want = 403
		}
		if recorder.Code != want {
			t.Fatalf("callback status changed: %d %s", recorder.Code, recorder.Body.String())
		}
		if err = bundle.ValidateHTTPResponse("GET", "/api/ai/mcp/oauth/callback/:flowID", recorder.Code, recorder.Header().Get("Content-Type"), recorder.Body.Bytes()); err != nil {
			t.Fatal(err)
		}
		if !remote && (recorder.Header().Get("Cache-Control") != "no-store" || recorder.Header().Get("Referrer-Policy") != "no-referrer") {
			t.Fatal("callback security headers changed")
		}
	}
}

func TestAPIContractAIEditorStreamCancellation(t *testing.T) {
	aiContractConfiguration(t)
	closed := make(chan struct{})
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"hello\"}}]}\n\n")
		w.(http.Flusher).Flush()
		<-r.Context().Done()
		close(closed)
	}))
	defer upstream.Close()
	model.Conf.AI.Providers = []*conf.Provider{{ID: "provider", Enabled: true, BaseURL: upstream.URL + "/v1", Protocol: "openai", APIKey: "test", Models: []*conf.Model{{ID: "model", Name: "model", Enabled: true}}}}
	model.Conf.AI.Editing.ModelID = "model"
	engine := gin.New()
	engine.POST("/api/ai/editor/chat", aiEditorChat)
	server := httptest.NewServer(engine)
	defer server.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, "POST", server.URL+"/api/ai/editor/chat", strings.NewReader(`{"input":"hello"}`))
	if err != nil {
		t.Fatal(err)
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = bufio.NewReader(response.Body).ReadString('\n'); err != nil {
		t.Fatal(err)
	}
	cancel()
	response.Body.Close()
	select {
	case <-closed:
	case <-time.After(3 * time.Second):
		t.Fatal("editor stream cancellation did not close upstream")
	}
}
