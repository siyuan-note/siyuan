// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/siyuan-note/siyuan/kernel/mcp/tools"
	kernelModel "github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

const (
	testToolRoundLimitMessage  = "Tool call round limit reached. Remaining tool calls were not executed; send another message to continue"
	testToolRoundLimitToolName = "test_round_limit"
)

func TestAgentChatToolRoundLimit(t *testing.T) {
	for _, protocol := range []string{"openai", util.OpenAIProtocolResponses, util.AnthropicProtocolMessages} {
		for _, tc := range []struct {
			name       string
			chunks     []string
			structured bool
			rejected   bool
			budget     int
			reasoning  string
		}{
			{name: "summary", chunks: []string{"Completed the read. ", "The edit remains unfinished."}, budget: 1},
			{name: "DSML", chunks: []string{"Preparing an edit <", "｜｜DS", "ML｜｜ calls><invoke name=\"file\">edit</invoke>"}, rejected: true, budget: 1},
			{name: "tool calls token", chunks: []string{"<|tool_", "calls|>file edit"}, rejected: true, budget: 1},
			{name: "Anthropic markup", chunks: []string{"<antml:", "invoke name=\"file\">edit</antml:invoke>"}, rejected: true, budget: 1},
			{name: "structured call", structured: true, rejected: true, budget: 1},
			{name: "unlimited", chunks: []string{"Task completed."}, budget: 0},
			{name: "below limit", chunks: []string{"Task completed."}, budget: 2},
			{name: "reasoning markup", chunks: []string{"An edit was requested."}, reasoning: "<|tool_calls|>file edit", rejected: true, budget: 1},
		} {
			if tc.reasoning != "" && protocol != "openai" {
				continue
			}
			t.Run(protocol+"/"+tc.name, func(t *testing.T) {
				executed := setupToolRoundLimitAgentTest(t, tc.budget)
				limited := tc.budget == 1
				var requests atomic.Int32
				var followup atomic.Bool
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					var payload map[string]json.RawMessage
					if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
						t.Error(err)
						return
					}
					attempt := requests.Add(1)
					if attempt > 2 && (!followup.Load() || attempt != 3) {
						t.Error("model requested again after the final summary")
						w.WriteHeader(http.StatusBadRequest)
						return
					}
					encoded, _ := json.Marshal(payload)
					if attempt == 1 || attempt == 3 || !limited {
						if len(payload["tools"]) == 0 || strings.Contains(string(encoded), "Tool call round limit reached") {
							t.Error("tools were limited before the budget was spent")
						}
					} else {
						if raw := string(payload["tools"]); raw != "" && raw != "[]" && raw != "null" {
							t.Errorf("tools remained available at the limit: %s", raw)
						}
						if !strings.Contains(string(encoded), "Tool call round limit reached") || !strings.Contains(string(encoded), "completed read") {
							t.Errorf("summary request lost the limit instruction or completed tool result: %s", encoded)
						}
					}
					tool := ""
					if attempt == 1 || (attempt == 2 && tc.structured) {
						tool = testToolRoundLimitToolName
					}
					chunks := tc.chunks
					if attempt == 3 {
						chunks = []string{"Continued normally."}
					}
					content := strings.Join(chunks, "")
					switch protocol {
					case util.AnthropicProtocolMessages:
						writeAnthropicAgentResponse(t, w, "signature", content, tool, true)
					case util.OpenAIProtocolResponses:
						flusher := prepareTestStream(t, w)
						var output []any
						if tool != "" {
							output = []any{map[string]any{"type": "function_call", "id": "fc-1", "call_id": "call-1", "name": tool, "arguments": `{"action":"list"}`, "status": "completed"}}
						} else {
							output = []any{map[string]any{"type": "message", "id": "msg-1", "role": "assistant", "status": "completed", "content": []any{map[string]any{"type": "output_text", "text": content}}}}
						}
						writeResponsesTestCompleted(t, w, flusher, "resp-1", output, 10, 5)
					default:
						flusher := prepareTestStream(t, w)
						if tool != "" {
							_, _ = fmt.Fprintf(w, "data: {\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call-1\",\"type\":\"function\",\"function\":{\"name\":%q,\"arguments\":\"{\\\"action\\\":\\\"list\\\"}\"}}]},\"finish_reason\":\"tool_calls\"}]}\n\n", tool)
							flusher.Flush()
						} else {
							if attempt == 2 && tc.reasoning != "" {
								_, _ = fmt.Fprintf(w, "data: {\"choices\":[{\"index\":0,\"delta\":{\"reasoning_content\":%q}}]}\n\n", tc.reasoning)
								flusher.Flush()
							}
							for _, chunk := range chunks {
								writeTestStreamChunk(t, w, flusher, chunk)
							}
						}
						writeTestStreamDone(t, w, flusher)
					}
				}))
				defer server.Close()
				var content strings.Builder
				errorSeen, usageSeen, doneSeen := false, false, false
				for event := range AgentChat(context.Background(), util.NewAIClientWithModel("key", server.URL+"/v1", "test-model"), protocol, "test-model", "", 0,
					testSessionID, "user-1", 1, "read and edit", nil, "English", nil, EditorContext{}, nil, false,
					time.Second, 0, "", time.Second, time.Second) {
					switch event.Type {
					case "content":
						content.WriteString(event.Token)
					case "reasoning":
						if tc.reasoning != "" && event.Token == tc.reasoning {
							t.Error("raw tool markup was exposed as reasoning")
						}
					case "done":
						doneSeen = true
					case "error":
						errorSeen = true
						if event.Error != testToolRoundLimitMessage {
							t.Errorf("unexpected interruption: %q", event.Error)
						}
					case "usage":
						usageSeen = true
					case "permission":
						if event.PermissionMode == "allowSession" {
							t.Error("round limit changed write permissions")
						}
					}
				}
				wantContent, wantDelta := strings.Join(tc.chunks, ""), 2
				if tc.rejected {
					wantContent, wantDelta = "", 1
				}
				if content.String() != wantContent || errorSeen != limited || doneSeen == limited || !usageSeen || requests.Load() != 2 || executed.Load() != 1 {
					t.Fatalf("unexpected final response: content=%q error=%v done=%v usage=%v requests=%d executed=%d", content.String(), errorSeen, doneSeen, usageSeen, requests.Load(), executed.Load())
				}
				runtime, err := loadRuntimeState(testSessionID)
				if err != nil {
					t.Fatal(err)
				}
				turn := runtime.ActiveTurn
				wantState := "finished"
				if limited {
					wantState = "interrupted"
				}
				if turn == nil || turn.State != wantState || len(turn.Delta) != wantDelta || turn.DraftContent != "" {
					t.Fatalf("unexpected saved turn: %#v", turn)
				}
				if len(turn.Delta[0].ToolCalls) != 1 || turn.Delta[0].ToolCalls[0].State != "finished" || !strings.Contains(turn.Delta[0].ToolCalls[0].Result, "completed read") {
					t.Fatalf("completed tool result was lost: %#v", turn.Delta[0])
				}
				if kernelModel.Conf.AI.Load().Agent.MaxToolCallRounds != tc.budget {
					t.Error("turn changed the global tool budget")
				}

				// 提交中断轮次后，下一条用户消息恢复工具预算，且不继承临时上限指令。
				recovered, err := GetSession(testSessionID)
				if err != nil {
					t.Fatal(err)
				}
				recovered["expectedRevision"], recovered["commitTurnID"] = int64(1), turn.TurnID
				if _, _, err = SaveSessionState(marshalSession(t, recovered)); err != nil {
					t.Fatal(err)
				}
				recovered, err = GetSession(testSessionID)
				if err != nil {
					t.Fatal(err)
				}
				recovered["entries"] = append(recovered["entries"].([]any), map[string]any{"id": "user-2", "type": "user", "content": "continue"})
				recovered["expectedRevision"] = int64(2)
				if _, _, err = SaveSessionState(marshalSession(t, recovered)); err != nil {
					t.Fatal(err)
				}
				followup.Store(true)
				doneSeen = false
				for event := range AgentChat(context.Background(), util.NewAIClientWithModel("key", server.URL+"/v1", "test-model"), protocol, "test-model", "", 0,
					testSessionID, "user-2", 3, "continue", nil, "English", nil, EditorContext{}, nil, false,
					time.Second, 0, "", time.Second, time.Second) {
					if event.Type == "error" {
						t.Fatalf("follow-up failed: %s", event.Error)
					}
					if event.Type == "done" {
						doneSeen = true
					}
				}
				if !doneSeen || requests.Load() != 3 {
					t.Fatalf("follow-up did not complete normally: done=%v requests=%d", doneSeen, requests.Load())
				}
			})
		}
	}
}

func TestAgentChatToolRoundLimitDiscardsUnvalidatedStream(t *testing.T) {
	for _, cancelStream := range []bool{false, true} {
		t.Run(fmt.Sprintf("cancel=%v", cancelStream), func(t *testing.T) {
			executed := setupToolRoundLimitAgentTest(t, 1)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			var requests atomic.Int32
			streamStarted := make(chan struct{})
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				flusher := prepareTestStream(t, w)
				if requests.Add(1) == 1 {
					_, _ = fmt.Fprintf(w, "data: {\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call-1\",\"type\":\"function\",\"function\":{\"name\":%q,\"arguments\":\"{\\\"action\\\":\\\"list\\\"}\"}}]},\"finish_reason\":\"tool_calls\"}]}\n\n", testToolRoundLimitToolName)
					flusher.Flush()
					writeTestStreamDone(t, w, flusher)
					return
				}
				writeTestStreamChunk(t, w, flusher, "<|tool_calls|>file edit")
				close(streamStarted)
				<-r.Context().Done()
			}))
			defer server.Close()
			idleTimeout := 50 * time.Millisecond
			if cancelStream {
				idleTimeout = time.Second
			}
			events := AgentChat(ctx, newTestOpenAIClient(server.URL), "openai", "test-model", "", 0,
				testSessionID, "user-1", 1, "read and edit", nil, "English", nil, EditorContext{}, nil, false,
				time.Second, 0, "", time.Second, idleTimeout)
			if cancelStream {
				select {
				case <-streamStarted:
					cancel()
				case <-time.After(5 * time.Second):
					t.Fatal("summary stream did not start")
				}
			}
			errorSeen := false
			for event := range events {
				if event.Type == "content" || event.Type == "reasoning" || event.Type == "done" {
					t.Errorf("unvalidated response was exposed: %#v", event)
				}
				if event.Type == "error" {
					errorSeen = true
				}
			}
			if !cancelStream && !errorSeen {
				t.Error("stream failure was not reported")
			}
			runtime, err := loadRuntimeState(testSessionID)
			if err != nil {
				t.Fatal(err)
			}
			turn := runtime.ActiveTurn
			if turn == nil || turn.State != "interrupted" || len(turn.Delta) != 1 || turn.DraftContent != "" || turn.DraftRoundID != "" {
				t.Fatalf("unvalidated response was checkpointed: %#v", turn)
			}
			if executed.Load() != 1 || requests.Load() != 2 {
				t.Fatalf("stream failure retried work: executed=%d requests=%d", executed.Load(), requests.Load())
			}
		})
	}
}

func setupToolRoundLimitAgentTest(t *testing.T, budget int) *atomic.Int32 {
	t.Helper()
	setupCompactionAgentTest(t)
	useTestToolRoundLimitLanguage(t)
	kernelModel.Conf.AI.Load().Agent.MaxToolCallRounds = budget
	var executed atomic.Int32
	tools.SetTool(testToolRoundLimitToolName, &tools.Tool{
		Name: testToolRoundLimitToolName, Source: "native", ReadOnlyHint: true,
		InputSchema:   tools.ToolSchema{Type: "object", Properties: map[string]tools.Property{"action": {Type: "string"}}},
		ActionEffects: map[string]tools.ToolEffects{"list": {LocalRead: true}},
		Handler: func(map[string]any) (tools.CallToolResult, error) {
			executed.Add(1)
			return tools.CallToolResult{Content: []tools.ContentItem{{Type: "text", Text: "completed read"}}}, nil
		},
	})
	t.Cleanup(func() { tools.RemoveTool(testToolRoundLimitToolName) })
	if _, _, err := SaveSessionState(marshalSession(t, map[string]any{
		"id": testSessionID, "title": "round limit", "createdAt": 1, "updatedAt": 1,
		"entries": []any{map[string]any{"id": "user-1", "type": "user", "content": "read and edit"}},
	})); err != nil {
		t.Fatal(err)
	}
	return &executed
}

func useTestToolRoundLimitLanguage(t *testing.T) {
	t.Helper()
	originalLangs := util.Langs
	util.Langs = map[string]map[int]string{"en": {440: testToolRoundLimitMessage}}
	t.Cleanup(func() { util.Langs = originalLangs })
}
