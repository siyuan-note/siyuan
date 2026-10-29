// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package agent

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	kernelConf "github.com/siyuan-note/siyuan/kernel/conf"
	kernelModel "github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAgentChatOutputLimitReportsInterruption(t *testing.T) {
	for _, tc := range []struct {
		name      string
		content   string
		reasoning string
		toolCalls string
		finish    string
		protocol  string
	}{
		{name: "reasoning only", reasoning: "unfinished reasoning", finish: "length"},
		{name: "partial answer", content: "partial answer", reasoning: "reasoning", finish: "length"},
		{name: "truncated tool call", content: "preparing", toolCalls: `,"tool_calls":[{"index":0,"id":"call-1","type":"function","function":{"name":"file","arguments":"{"}}]`, finish: "length"},
		{name: "normal completion", content: "complete answer", finish: "stop"},
		{name: "responses output limit", content: "partial answer", finish: "length", protocol: "openai-responses"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			useTestDataDir(t)
			originalConf := kernelModel.Conf
			kernelModel.Conf = kernelModel.NewAppConf()
			kernelModel.Conf.AI.Store(kernelConf.NewAI())
			kernelModel.Conf.AI.Load().MCP = nil
			kernelModel.Conf.Variables.Store(kernelConf.NewVariables())
			t.Cleanup(func() { kernelModel.Conf = originalConf })
			originalLangs := util.Langs
			util.Langs = map[string]map[int]string{"en": {297: "Output reached the max completion tokens limit"}}
			t.Cleanup(func() { util.Langs = originalLangs })
			session := map[string]any{
				"id": testSessionID, "title": "output limit", "createdAt": int64(1), "updatedAt": int64(1),
				"entries": []any{map[string]any{"id": "user-1", "type": "user", "content": "hello"}},
			}
			if _, _, err := SaveSessionState(marshalSession(t, session)); err != nil {
				t.Fatal(err)
			}
			var requests atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				requests.Add(1)
				flusher := prepareTestStream(t, w)
				if tc.protocol == "openai-responses" {
					writeResponsesTestEvent(t, w, flusher, "response.incomplete", map[string]any{
						"type": "response.incomplete",
						"response": map[string]any{
							"id": "resp-limit", "status": "incomplete",
							"incomplete_details": map[string]any{"reason": "max_output_tokens"},
							"output": []any{map[string]any{
								"id": "msg-limit", "type": "message", "role": "assistant", "status": "incomplete",
								"content": []any{map[string]any{"type": "output_text", "text": tc.content}},
							}},
							"usage": map[string]any{"input_tokens": 10, "output_tokens": 8192, "total_tokens": 8202},
						},
					})
					return
				}
				_, _ = fmt.Fprintf(w, "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":%q,\"reasoning_content\":%q%s},\"finish_reason\":%q}]}\n\n",
					tc.content, tc.reasoning, tc.toolCalls, tc.finish)
				// 用量可在结束原因之后单独到达，不能丢失结束状态。
				_, _ = io.WriteString(w, "data: {\"choices\":[],\"usage\":{\"prompt_tokens\":10,\"completion_tokens\":8192,\"total_tokens\":8202}}\n\n")
				flusher.Flush()
				writeTestStreamDone(t, w, flusher)
			}))
			defer server.Close()
			protocol := tc.protocol
			if protocol == "" {
				protocol = "openai"
			}
			events := AgentChat(context.Background(), newTestOpenAIClient(server.URL), protocol, "test-model", "", 0,
				testSessionID, "user-1", 1, "hello", nil, "English", nil, EditorContext{}, nil, false,
				time.Second, 3, "", time.Second, time.Second)
			errorSeen, doneSeen, usageSeen := false, false, false
			for event := range events {
				switch event.Type {
				case "error":
					errorSeen = true
					if event.Error != "Output reached the max completion tokens limit" {
						t.Fatalf("unexpected stop reason: %q", event.Error)
					}
				case "done":
					doneSeen = true
				case "usage":
					usageSeen = event.CompletionTokens == 8192
				case "tool_call", "tool_result", "confirm":
					t.Fatalf("truncated tool call was dispatched: %#v", event)
				}
			}
			limited := tc.finish == "length"
			if errorSeen != limited || doneSeen == limited || !usageSeen || requests.Load() != 1 {
				t.Fatalf("unexpected termination: error=%v done=%v usage=%v requests=%d", errorSeen, doneSeen, usageSeen, requests.Load())
			}
			runtime, err := loadRuntimeState(testSessionID)
			if err != nil {
				t.Fatal(err)
			}
			state := "finished"
			if limited {
				state = "interrupted"
			}
			if runtime.ActiveTurn == nil || runtime.ActiveTurn.State != state {
				t.Fatalf("unexpected turn: %#v", runtime.ActiveTurn)
			}
			delta := runtime.ActiveTurn.Delta
			if len(delta) != 1 || delta[0].Content != tc.content || delta[0].ReasoningContent != tc.reasoning || len(delta[0].ToolCalls) != 0 {
				t.Fatalf("partial response was not preserved: %#v", delta)
			}
			if tc.protocol == "openai-responses" && (len(delta[0].ResponseOutput) != 1 || delta[0].ResponseOutputTokens != 8192) {
				t.Fatalf("native response context was not preserved: %#v", delta[0])
			}
		})
	}
}
