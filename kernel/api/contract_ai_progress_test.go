// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/olahol/melody"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAPIContractAIActionBackgroundCompatibility(t *testing.T) {
	for _, testCase := range []struct {
		field string
		want  bool
	}{
		{"", false},
		{`,"background":false`, false},
		{`,"background":null`, false},
		{`,"background":"true"`, false},
		{`,"background":true`, true},
	} {
		body := strings.NewReader(`{"ids":[],"action":"summarize"` + testCase.field + `}`)
		request, err := apicontract.AIChatGPTWithAction.Decode(body)
		if err != nil || request.Background != testCase.want || request.IDs == nil || request.Action != "summarize" {
			t.Errorf("AI action request with %q decoded as %+v (%v)", testCase.field, request, err)
		}
	}
}

func TestAPIContractAIActionProgress(t *testing.T) {
	aiContractConfiguration(t)

	const timeout = 5 * time.Second
	started := make(chan string, 4)
	alpha, beta := make(chan struct{}), make(chan struct{})
	releaseAlpha, releaseBeta := sync.OnceFunc(func() { close(alpha) }), sync.OnceFunc(func() { close(beta) })
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		var payload struct {
			Model    string                  `json:"model"`
			Messages []model.AIEditorMessage `json:"messages"`
		}
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil || request.URL.Path != "/v1/chat/completions" ||
			payload.Model != "configured" || len(payload.Messages) != 1 || payload.Messages[0].Role != "user" {
			t.Errorf("unexpected model request: %s %+v (%v)", request.URL.Path, payload, err)
			http.Error(w, "invalid model request", http.StatusBadRequest)
			return
		}
		prompt := payload.Messages[0].Content
		started <- prompt
		finishReason := "stop"
		switch prompt {
		case "alpha":
			<-alpha
		case "beta":
			<-beta
			fallthrough
		case "failure":
			http.Error(w, "completion failed", http.StatusBadRequest)
			return
		case "background":
			finishReason = "length"
		default:
			t.Errorf("unexpected prompt %q", prompt)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprintf(w, `{"choices":[{"message":{"content":%q},"finish_reason":%q}]}`, prompt, finishReason)
	}))
	defer upstream.Close()
	ai := model.Conf.AI.Load()
	ai.Providers = []*conf.Provider{{ID: "provider", Enabled: true, BaseURL: upstream.URL + "/v1", APIKey: "key",
		RequestTimeout: 30, Models: []*conf.Model{{ID: "model", Name: "configured", Enabled: true}}}}
	ai.Editing.ModelID = "model"

	push := melody.New()
	connected := make(chan *melody.Session, 2)
	push.HandleConnect(func(session *melody.Session) {
		util.AddPushChan(session)
		connected <- session
	})
	push.HandleDisconnect(util.RemovePushChan)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		_ = push.HandleRequest(w, request)
	}))
	defer server.Close()
	defer push.Close()
	var observers []*websocket.Conn
	for _, app := range []string{"ai-progress-first", "ai-progress-second"} {
		connection, response, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http")+
			"/?app="+app+"&id=main&type=main", nil)
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		defer connection.Close()
		select {
		case <-connected:
		case <-time.After(timeout):
			t.Fatal("AI progress observer did not connect")
		}
		observers = append(observers, connection)
	}
	expectPush := func(cmd string, code int, scope string) {
		t.Helper()
		for _, connection := range observers {
			var event struct {
				Cmd  string `json:"cmd"`
				Code int    `json:"code"`
				Data struct {
					Scope string `json:"scope"`
				} `json:"data"`
			}
			if err := connection.SetReadDeadline(time.Now().Add(timeout)); err != nil {
				t.Fatal(err)
			}
			if err := connection.ReadJSON(&event); err != nil || event.Cmd != cmd || event.Code != code || event.Data.Scope != scope {
				t.Fatalf("expected push %q/%d/%q, got %+v (%v)", cmd, code, scope, event, err)
			}
		}
	}
	expectNoPush := func() {
		t.Helper()
		util.BroadcastByType("main", "ai-progress-test-marker", 0, "", nil)
		expectPush("ai-progress-test-marker", 0, "")
	}

	engine := gin.New()
	const route = "/api/ai/chatGPTWithAction"
	engine.POST(route, chatGPTWithAction)
	var requests sync.WaitGroup
	defer func() {
		releaseAlpha()
		releaseBeta()
		requests.Wait()
	}()
	start := func(prompt, background string) <-chan *httptest.ResponseRecorder {
		t.Helper()
		result := make(chan *httptest.ResponseRecorder, 1)
		requests.Go(func() {
			request := httptest.NewRequest("POST", route, strings.NewReader(fmt.Sprintf(`{"ids":[],"action":%q%s}`, prompt+"{{input}}", background)))
			recorder := httptest.NewRecorder()
			engine.ServeHTTP(recorder, request)
			result <- recorder
		})
		select {
		case got := <-started:
			if got != prompt {
				t.Fatalf("expected prompt %q, got %q", prompt, got)
			}
		case <-time.After(timeout):
			t.Fatalf("model did not receive %q", prompt)
		}
		return result
	}
	expectResult := func(result <-chan *httptest.ResponseRecorder, want string) {
		t.Helper()
		select {
		case recorder := <-result:
			var response struct {
				Code int    `json:"code"`
				Data string `json:"data"`
			}
			if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || recorder.Code != 200 ||
				response.Code != 0 || response.Data != want {
				t.Fatalf("unexpected response %d %s (%v)", recorder.Code, recorder.Body.String(), err)
			}
		case <-time.After(timeout):
			t.Fatal("AI request did not return")
		}
	}

	first := start("alpha", "")
	expectPush("progress", util.PushProgressCodeEndless, "ai")
	second := start("beta", `,"background":false`)
	expectPush("progress", util.PushProgressCodeEndless, "ai")

	releaseAlpha()
	expectResult(first, "alpha")
	expectNoPush()
	expectResult(start("background", `,"background":true`), "background")
	expectNoPush()
	expectResult(start("failure", `,"background":true`), "")
	expectNoPush()

	releaseBeta()
	expectResult(second, "")
	expectPush("msg", -1, "")
	expectPush("progress", util.PushProgressCodeEnd, "ai")
	expectNoPush()
}
