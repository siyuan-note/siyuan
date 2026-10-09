// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package agent

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/sashabaranov/go-openai"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/mcp/tools"
	kernelModel "github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestCurrentTurnCompactionBoundaries(t *testing.T) {
	history := []AgentMessage{
		{Role: "user", EntryID: "user", Content: "keep this goal"},
		{Role: "assistant", RoundID: "round-1", ToolCalls: []AgentToolCall{
			{ID: "a", State: "finished", Result: "first"}, {ID: "b", State: "finished", Result: "second"},
		}},
		{Role: "assistant", RoundID: "round-2", ToolCalls: []AgentToolCall{
			{ID: "c", State: "finished", Result: "third"}, {ID: "d", State: "pending"},
		}},
	}
	candidates, protected := compactionCandidateMessageCounts(history, 0, "openai", false, false)
	if protected || len(candidates) != 1 || candidates[0] != 2 {
		t.Fatalf("partial tool group was selected: %v protected=%v", candidates, protected)
	}
	projected := projectCompactionContext(history, 2)
	if len(projected) != 2 || projected[0].Content != history[0].Content || projected[1].RoundID != "round-2" {
		t.Fatalf("current user or retained tool group was lost: %+v", projected)
	}
	for _, state := range []string{"executing", "unknown"} {
		history[1].ToolCalls[1].State = state
		if candidates, _ = compactionCandidateMessageCounts(history, 0, "openai", false, false); len(candidates) != 0 {
			t.Fatalf("unsafe tool group %s was selected: %v", state, candidates)
		}
	}
}

func TestCurrentTurnCompactionPreservesProtectedHistory(t *testing.T) {
	for _, protocol := range []string{"openai", util.AnthropicProtocolMessages, util.OpenAIProtocolResponses} {
		t.Run(protocol, func(t *testing.T) {
			message := AgentMessage{Role: "assistant", RoundID: "round", ToolCalls: []AgentToolCall{{ID: "call", State: "finished", Result: "ok"}}}
			switch protocol {
			case "openai":
				message.ToolCalls[0].ProviderData = geminiToolCallProviderData("signature")
			case util.AnthropicProtocolMessages:
				message.NativeContent = nativeHistoryContent("signature", "ok")
			case util.OpenAIProtocolResponses:
				message.ResponseOutput = []json.RawMessage{json.RawMessage(`{"type":"reasoning","encrypted_content":"opaque"}`)}
			}
			history := []AgentMessage{{Role: "user", Content: "goal"}, message}
			if candidates, protected := compactionCandidateMessageCounts(history, 0, protocol, false, false); len(candidates) != 0 || !protected {
				t.Fatalf("protected history was selected: %v protected=%v", candidates, protected)
			}
			if protocol == util.OpenAIProtocolResponses {
				if candidates, _ := compactionCandidateMessageCounts(history, 0, protocol, true, false); len(candidates) != 1 || candidates[0] != 2 {
					t.Fatalf("native compaction did not select a complete group: %v", candidates)
				}
			}
			source, err := buildCompactionSource("", history)
			if err != nil || strings.Contains(source, "signature") || strings.Contains(source, "opaque") {
				t.Fatalf("opaque provider state entered summary input: %s %v", source, err)
			}
		})
	}
}

func TestCurrentTurnCompactionKeepsLatestImageGroup(t *testing.T) {
	history := []AgentMessage{
		{Role: "user", EntryID: "user", Content: "analyze the image"},
		{Role: "assistant", RoundID: "round-1", ToolCalls: []AgentToolCall{{ID: "text", State: "finished", Result: "old text"}}},
		{Role: "assistant", RoundID: "round-2", ToolCalls: []AgentToolCall{{ID: "image", State: "finished", Result: "attached", Attachments: []AgentAttachment{testAgentAttachment()}}}},
		{Role: "assistant", RoundID: "round-3", ToolCalls: []AgentToolCall{{ID: "later", State: "finished", Result: "later text"}}},
	}
	for _, native := range []bool{false, true} {
		candidates, _ := compactionCandidateMessageCounts(history, 0, "openai", native, false)
		if len(candidates) != 1 || candidates[0] != 2 {
			t.Fatalf("latest image group was selected for compaction: %v native=%v", candidates, native)
		}
		projected := projectCompactionContext(history, candidates[0])
		_, attachments := latestAgentMessageAttachments(projected)
		if len(attachments) != 1 {
			t.Fatal("compacted context lost the latest image")
		}
		candidates, _ = compactionCandidateMessageCounts(history, 0, "openai", native, true)
		if len(candidates) != 3 {
			t.Fatal("text-only fallback unnecessarily retained omitted images")
		}
	}
}

func TestMessageCompactionSurvivesRecoveryAndInvalidatesEdits(t *testing.T) {
	messages := []AgentMessage{
		{Role: "user", EntryID: "user", Content: "goal"},
		{Role: "assistant", RoundID: "turn_0", ToolCalls: []AgentToolCall{{ID: "call", State: "finished", Result: "complete result"}}},
	}
	state, err := newRuntimeMessageCompaction(messages, 2, "openai", "model", "scope")
	if err != nil {
		t.Fatal(err)
	}
	state.Summary = "progress"
	entries := []SessionEntry{
		{ID: "user", Type: "user", Content: "goal"},
		{ID: "assistant", Type: "assistant", RoundID: "turn_0", ToolCalls: []AgentToolCall{
			{ID: "call", State: "finished", Result: "complete result"},
		}},
	}
	entries[1].ID = "runtime_changed_entry_id"
	if !validRuntimeCompaction(entries, state) {
		t.Fatal("recovered assistant entry ID invalidated a stable compaction")
	}
	entries[0].Content = "edited goal"
	if validRuntimeCompaction(entries, state) {
		t.Fatal("edited goal reused a stale compaction")
	}
	entries[0].Content = "goal"
	entries[1].ToolCalls[0].Result = "changed result"
	if validRuntimeCompaction(entries, state) {
		t.Fatal("changed tool result reused a stale compaction")
	}
	if validRuntimeCompaction(entries[:1], state) {
		t.Fatal("regenerated history reused a compaction covering removed calls")
	}
}

func TestBatchedCompactionSummaryRespectsBudgetAndLimit(t *testing.T) {
	var requests atomic.Int32
	const limit, output = 4096, 512
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request openai.ChatCompletionRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Error(err)
			return
		}
		if estimateChatRequestTokens("test-model", request.Messages, nil) > contextInputBudget(limit, output) {
			t.Error("summary request exceeded the model input budget")
		}
		if len(request.Tools) != 0 {
			t.Error("summary request exposed executable tools")
		}
		requests.Add(1)
		writeCompactionSummaryStream(t, w, "merged progress", 100, 10)
	}))
	defer server.Close()
	count := 0
	summary, _, _, err := createBatchedCompactionSummary(context.Background(), newTestOpenAIClient(server.URL), "openai",
		"test-model", strings.Repeat("important result ", 6000), limit, output, 0, time.Second, time.Second, &count, make(chan AgentEvent, 32))
	if err != nil || summary != "merged progress" || requests.Load() < 2 || int(requests.Load()) != count {
		t.Fatalf("batched summary failed: %q %v requests=%d count=%d", summary, err, requests.Load(), count)
	}
	count = compactionMaxRequests - 1
	_, _, _, err = createBatchedCompactionSummary(context.Background(), newTestOpenAIClient(server.URL), "openai",
		"test-model", strings.Repeat("important result ", 6000), limit, output, 0, time.Second, time.Second, &count, make(chan AgentEvent, 32))
	if !errors.Is(err, errCompactionLimit) || count != compactionMaxRequests {
		t.Fatalf("summary request limit was not enforced: %v count=%d", err, count)
	}
}

func TestAgentChatCompactsCurrentTurnWithoutLosingRecovery(t *testing.T) {
	for _, withVariables := range []bool{false, true} {
		name := "plain-goal"
		if withVariables {
			name = "goal-with-variables"
		}
		t.Run(name, func(t *testing.T) { testAgentChatCompactsCurrentTurnWithoutLosingRecovery(t, withVariables) })
	}
}

func testAgentChatCompactsCurrentTurnWithoutLosingRecovery(t *testing.T, withVariables bool) {
	setupCompactionAgentTest(t)
	rawGoal := "complete the whole task"
	if withVariables {
		rawGoal = "complete $WORKSPACE task"
		kernelModel.Conf.Variables.Items = []*conf.Variable{{Name: "WORKSPACE", Value: "the whole"}}
	}
	const toolName = "test_current_turn_compaction"
	var executions atomic.Int32
	tool := &tools.Tool{
		Name: toolName, Source: "native", ReadOnlyHint: true,
		InputSchema:   tools.ToolSchema{Type: "object", Properties: map[string]tools.Property{"value": {Type: "string"}}},
		ActionEffects: map[string]tools.ToolEffects{"": {LocalRead: true}},
		Handler: func(args map[string]any) (tools.CallToolResult, error) {
			executions.Add(1)
			return tools.CallToolResult{Content: []tools.ContentItem{{Type: "text", Text: fmt.Sprint(args["value"]) + strings.Repeat(" important result", 3000)}}}, nil
		},
	}
	if err := tools.SetTool(toolName, tool); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { tools.RemoveTool(toolName) })
	kernelModel.Conf.AI.Agent.CapabilityPolicy = &conf.CapabilityPolicy{Default: "deny", Overrides: map[string]string{tools.CapabilityIDForTool(tool): "allow"}}
	if _, _, err := SaveSessionState(marshalSession(t, map[string]any{"id": testSessionID, "title": "long task", "entries": []SessionEntry{{ID: "user", Type: "user", Content: rawGoal}}})); err != nil {
		t.Fatal(err)
	}
	var modelRequests, summaryRequests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request openai.ChatCompletionRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Error(err)
			return
		}
		if len(request.Tools) == 0 {
			summaryRequests.Add(1)
			writeCompactionSummaryStream(t, w, "earlier tool progress retained", 100, 10)
			return
		}
		calls := map[string]bool{}
		for _, message := range request.Messages {
			for _, call := range message.ToolCalls {
				calls[call.ID] = true
			}
			if message.Role == "tool" {
				if !calls[message.ToolCallID] {
					t.Error("tool result has no matching call")
				}
				delete(calls, message.ToolCallID)
			}
		}
		if len(calls) != 0 {
			t.Error("tool call has no matching result")
		}
		count := modelRequests.Add(1)
		if count == 5 || count == 6 {
			data, _ := json.Marshal(request.Messages)
			containsSummary := strings.Contains(string(data), "earlier tool progress retained")
			if count == 5 && !containsSummary {
				t.Error("continued session did not reuse its persisted summary")
			}
			if count == 6 && (containsSummary || strings.Contains(string(data), "result-1")) {
				t.Error("regeneration reused obsolete summary or tool history")
			}
		}
		flusher := prepareTestStream(t, w)
		if count <= 3 {
			_, _ = fmt.Fprintf(w, "data: {\"id\":\"tools\",\"object\":\"chat.completion.chunk\",\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call-%d\",\"type\":\"function\",\"function\":{\"name\":%q,\"arguments\":%q}}]},\"finish_reason\":\"tool_calls\"}]}\n\n", count, toolName, fmt.Sprintf(`{"value":"result-%d"}`, count))
			flusher.Flush()
		} else {
			writeTestStreamChunk(t, w, flusher, "task finished")
		}
		writeTestStreamDone(t, w, flusher)
	}))
	defer server.Close()
	for event := range AgentChat(context.Background(), newTestOpenAIClient(server.URL), "openai", "test-model", "scope", 10000,
		testSessionID, "user", 1, rawGoal, nil, "English", nil, EditorContext{}, nil, false,
		time.Second, 0, "", time.Second, time.Second) {
		if event.Type == "error" {
			t.Fatalf("long current turn failed: %s", event.Error)
		}
	}
	if executions.Load() != 3 || modelRequests.Load() != 4 || summaryRequests.Load() == 0 {
		t.Fatalf("unexpected long task: executions=%d model=%d summary=%d", executions.Load(), modelRequests.Load(), summaryRequests.Load())
	}
	recovered, err := GetSession(testSessionID)
	if err != nil {
		t.Fatal(err)
	}
	data, _ := json.Marshal(recovered)
	var session struct {
		Entries []SessionEntry `json:"entries"`
	}
	if err = json.Unmarshal(data, &session); err != nil {
		t.Fatal(err)
	}
	if len(session.Entries) != 5 {
		t.Fatalf("recovery lost original assistant messages: %+v", session.Entries)
	}
	for i := 1; i <= 3; i++ {
		if len(session.Entries[i].ToolCalls) != 1 || !strings.Contains(session.Entries[i].ToolCalls[0].Result, fmt.Sprintf("result-%d", i)) {
			t.Fatalf("recovery lost original tool result %d", i)
		}
	}
	runtime, err := loadRuntimeState(testSessionID)
	if err != nil || !validRuntimeCompaction(session.Entries, runtime.Compaction) {
		t.Fatalf("recovered history could not reuse compaction: %+v %v", runtime, err)
	}
	if _, _, err = SaveSessionState(marshalSession(t, recovered)); err != nil {
		t.Fatal(err)
	}
	canonical, err := GetSessionState(testSessionID, false)
	if err != nil || len(canonical["entries"].([]any)) != 5 {
		t.Fatalf("committing recovery lost original history: %+v %v", canonical, err)
	}
	canonical["entries"] = append(canonical["entries"].([]any), map[string]any{"id": "user-2", "type": "user", "content": "continue"})
	revision, _, err := SaveSessionState(marshalSession(t, canonical))
	if err != nil {
		t.Fatal(err)
	}
	for event := range AgentChat(context.Background(), newTestOpenAIClient(server.URL), "openai", "test-model", "scope", 10000,
		testSessionID, "user-2", revision, "continue", nil, "English", nil, EditorContext{}, nil, false,
		time.Second, 0, "", time.Second, time.Second) {
		if event.Type == "error" {
			t.Fatalf("continued turn failed: %s", event.Error)
		}
	}
	recovered, err = GetSession(testSessionID)
	if err != nil {
		t.Fatal(err)
	}
	revision, _, err = SaveSessionState(marshalSession(t, recovered))
	if err != nil {
		t.Fatal(err)
	}
	for event := range AgentChat(context.Background(), newTestOpenAIClient(server.URL), "openai", "test-model", "scope", 10000,
		testSessionID, "user", revision, "edited task", nil, "English", nil, EditorContext{}, nil, true,
		time.Second, 0, "", time.Second, time.Second) {
		if event.Type == "error" {
			t.Fatalf("regenerated turn failed: %s", event.Error)
		}
	}
	if executions.Load() != 3 || modelRequests.Load() != 6 {
		t.Fatalf("continuation repeated tool execution: executions=%d requests=%d", executions.Load(), modelRequests.Load())
	}
}

func TestBatchedCompactionSummaryRejectsPartialFailure(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if requests.Add(1) == 1 {
			writeCompactionSummaryStream(t, w, "partial summary must not be committed", 100, 10)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = fmt.Fprint(w, `{"error":{"message":"summary access denied","type":"authentication_error"}}`)
	}))
	defer server.Close()
	count := 0
	summary, _, _, err := createBatchedCompactionSummary(context.Background(), newTestOpenAIClient(server.URL), "openai",
		"test-model", strings.Repeat("important result ", 6000), 4096, 512, 0, time.Second, time.Second, &count, make(chan AgentEvent, 32))
	if !errors.Is(err, errCompactionSummaryFailed) || summary != "" || !strings.Contains(err.Error(), "summary access denied") || requests.Load() != 2 {
		t.Fatalf("partial summary was accepted: %q %v requests=%d", summary, err, requests.Load())
	}
}

func TestCompactionRequestBudgetIncludesRetries(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		requests.Add(1)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = fmt.Fprint(w, `{"error":{"message":"temporary failure","type":"server_error"}}`)
	}))
	defer server.Close()
	count := compactionMaxRequests - 1
	_, _, _, err := createBatchedCompactionSummary(context.Background(), newTestOpenAIClient(server.URL), "openai",
		"test-model", "history", 4096, 512, 3, time.Second, time.Second, &count, make(chan AgentEvent, 32))
	if !errors.Is(err, errCompactionLimit) || requests.Load() != 1 || count != compactionMaxRequests {
		t.Fatalf("summary retries bypassed the budget: %v requests=%d count=%d", err, requests.Load(), count)
	}
	count = compactionMaxRequests - 1
	ctx := context.WithValue(context.Background(), compactionRequestBudgetKey{}, &count)
	_, _, _, err = createResponseCompaction(ctx, newTestOpenAIClient(server.URL), openai.ChatCompletionRequest{Model: "test-model"},
		nil, 3, time.Second, make(chan AgentEvent, 32))
	if !errors.Is(err, errCompactionLimit) || requests.Load() != 2 || count != compactionMaxRequests {
		t.Fatalf("native retries bypassed the budget: %v requests=%d count=%d", err, requests.Load(), count)
	}
}

func TestCompactionSummaryRejectsTruncatedOutput(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		flusher := prepareTestStream(t, w)
		writeTestStreamChunk(t, w, flusher, "incomplete summary")
		_, _ = fmt.Fprint(w, "data: {\"id\":\"summary\",\"object\":\"chat.completion.chunk\",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"length\"}]}\n\n")
		flusher.Flush()
		writeTestStreamDone(t, w, flusher)
	}))
	defer server.Close()
	summary, _, _, err := createProtocolCompactionSummary(context.Background(), newTestOpenAIClient(server.URL), util.OpenAIProtocolChatCompletions,
		"test-model",
		"history", 512, 0, time.Second, time.Second, make(chan AgentEvent, 32))
	if err == nil || summary != "" {
		t.Fatalf("truncated summary was accepted: %q %v", summary, err)
	}
}

func TestAgentChatReusesOnlyCompatibleCompaction(t *testing.T) {
	for _, name := range []string{"legacy", "same-scope", "other-model", "other-provider"} {
		t.Run(name, func(t *testing.T) {
			setupCompactionAgentTest(t)
			kernelModel.Conf.AI.Agent.CapabilityPolicy = &conf.CapabilityPolicy{Default: "deny"}
			entries := []SessionEntry{
				{ID: "old-user", Type: "user", Content: "old task"},
				{ID: "old-answer", Type: "assistant", Content: strings.Repeat("old result ", 12000)},
				{ID: "current-user", Type: "user", Content: "continue"},
			}
			if _, _, err := SaveSessionState(marshalSession(t, map[string]any{"id": testSessionID, "title": "compatibility", "entries": entries})); err != nil {
				t.Fatal(err)
			}
			state, err := newRuntimeMessageCompaction(entriesToAgentMessages(entries), 2, "openai", "test-model", compactionScopeKey("openai", "test-model", "provider"))
			if name == "legacy" {
				state, err = newRuntimeProtocolSummaryCompaction(entries, 2, "original summary", util.OpenAIProtocolChatCompletions)
			}
			if err != nil {
				t.Fatal(err)
			}
			state.Summary = "original summary"
			if err = writeRuntimeLocked(testSessionID, &agentRuntime{Compaction: state}); err != nil {
				t.Fatal(err)
			}
			model, provider := "test-model", "provider"
			if name == "other-model" {
				model = "other-model"
			} else if name == "other-provider" {
				provider = "other-provider"
			}
			var summaries atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var request openai.ChatCompletionRequest
				if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
					t.Error(err)
					return
				}
				if strings.HasPrefix(request.Messages[0].Content, "Summarize the supplied earlier conversation") {
					summaries.Add(1)
					writeCompactionSummaryStream(t, w, "replacement summary", 100, 10)
					return
				}
				data, _ := json.Marshal(request.Messages)
				expected := "original summary"
				if name == "other-model" || name == "other-provider" {
					expected = "replacement summary"
					if strings.Contains(string(data), "original summary") {
						t.Error("incompatible summary was reused")
					}
				}
				if !strings.Contains(string(data), expected) {
					t.Errorf("model request omitted %s", expected)
				}
				flusher := prepareTestStream(t, w)
				writeTestStreamChunk(t, w, flusher, "continued")
				writeTestStreamDone(t, w, flusher)
			}))
			defer server.Close()
			for event := range AgentChat(context.Background(), newTestOpenAIClient(server.URL), "openai", model, provider, 10000,
				testSessionID, "current-user", 1, "continue", nil, "English", nil, EditorContext{}, nil, false,
				time.Second, 0, "", time.Second, time.Second) {
				if event.Type == "error" {
					t.Fatalf("compatible history could not continue: %s", event.Error)
				}
			}
			if (name == "legacy" || name == "same-scope") && summaries.Load() != 0 {
				t.Fatal("compatible summary was needlessly rebuilt")
			}
		})
	}
}

func TestAgentChatNativeCompactsCurrentTurn(t *testing.T) {
	for _, failCompaction := range []bool{false, true} {
		name := "success"
		if failCompaction {
			name = "native-failure-preserves-history"
		}
		t.Run(name, func(t *testing.T) { testAgentChatNativeCompactsCurrentTurn(t, failCompaction) })
	}
}

func testAgentChatNativeCompactsCurrentTurn(t *testing.T, failCompaction bool) {
	setupCompactionAgentTest(t)
	const toolName = "test_native_current_compaction"
	var executions atomic.Int32
	tool := &tools.Tool{
		Name: toolName, Source: "native", ReadOnlyHint: true, InputSchema: tools.ToolSchema{Type: "object"},
		ActionEffects: map[string]tools.ToolEffects{"": {LocalRead: true}},
		Handler: func(map[string]any) (tools.CallToolResult, error) {
			executions.Add(1)
			return tools.CallToolResult{Content: []tools.ContentItem{{Type: "text", Text: strings.Repeat("native tool result ", 7000)}}}, nil
		},
	}
	if err := tools.SetTool(toolName, tool); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { tools.RemoveTool(toolName) })
	kernelModel.Conf.AI.Agent.CapabilityPolicy = &conf.CapabilityPolicy{Default: "deny", Overrides: map[string]string{tools.CapabilityIDForTool(tool): "allow"}}
	if _, _, err := SaveSessionState(marshalSession(t, map[string]any{"id": testSessionID, "title": "native task", "entries": []SessionEntry{{ID: "user", Type: "user", Content: "complete task"}}})); err != nil {
		t.Fatal(err)
	}
	var requests, compactions atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload map[string]json.RawMessage
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Error(err)
			return
		}
		if r.URL.Path == "/v1/responses/compact" {
			compactions.Add(1)
			for _, expected := range []string{"signed-reasoning", "function_call", "function_call_output", "call-native"} {
				if !strings.Contains(string(payload["input"]), expected) {
					t.Errorf("native compaction lost %s", expected)
				}
			}
			w.Header().Set("Content-Type", "application/json")
			if failCompaction {
				w.WriteHeader(http.StatusBadRequest)
				_, _ = fmt.Fprint(w, `{"error":{"message":"compaction endpoint unavailable","type":"invalid_request_error"}}`)
				return
			}
			_, _ = fmt.Fprint(w, `{"output":[{"type":"compaction","encrypted_content":"native-summary"}],"usage":{"input_tokens":100,"output_tokens":10}}`)
			return
		}
		if r.URL.Path != "/v1/responses" {
			t.Errorf("unexpected path: %s", r.URL.Path)
			return
		}
		flusher := prepareTestStream(t, w)
		if requests.Add(1) == 1 {
			writeResponsesTestEvent(t, w, flusher, "response.output_item.added", map[string]any{
				"type": "response.output_item.added", "output_index": 1,
				"item": map[string]any{"id": "function", "type": "function_call", "call_id": "call-native", "name": toolName, "arguments": ""},
			})
			writeResponsesTestEvent(t, w, flusher, "response.function_call_arguments.delta", map[string]any{
				"type": "response.function_call_arguments.delta", "output_index": 1, "item_id": "function", "delta": "{}",
			})
			writeResponsesTestCompleted(t, w, flusher, "tool-response", []any{
				map[string]any{"type": "reasoning", "id": "reasoning", "encrypted_content": "signed-reasoning"},
				map[string]any{"type": "function_call", "id": "function", "call_id": "call-native", "name": toolName, "arguments": "{}", "status": "completed"},
			}, 100, 20)
		} else {
			if !strings.Contains(string(payload["input"]), "native-summary") {
				t.Error("native compaction was not reused in the continuation")
			}
			writeResponsesTestEvent(t, w, flusher, "response.output_text.delta", map[string]any{"type": "response.output_text.delta", "output_index": 0, "delta": "done"})
			writeResponsesTestCompleted(t, w, flusher, "done-response", []any{
				map[string]any{"type": "message", "id": "answer", "role": "assistant", "status": "completed", "content": []any{map[string]any{"type": "output_text", "text": "done"}}},
			}, 100, 10)
		}
	}))
	defer server.Close()
	ctx := util.ContextWithOpenAIResponsesBaseURL(context.Background(), "https://api.openai.com/v1")
	errorSeen := false
	for event := range AgentChat(ctx, newTestOpenAIClient(server.URL), util.OpenAIProtocolResponses, "test-model", "scope", 7000,
		testSessionID, "user", 1, "complete task", nil, "English", nil, EditorContext{}, nil, false,
		time.Second, 0, "", time.Second, time.Second) {
		if event.Type == "error" {
			errorSeen = true
			if !failCompaction {
				t.Fatalf("native current turn failed: %s", event.Error)
			}
		}
	}
	expectedRequests, expectedEntries := int32(2), 3
	if failCompaction {
		expectedRequests, expectedEntries = 1, 2
	}
	if errorSeen != failCompaction || executions.Load() != 1 || requests.Load() != expectedRequests || compactions.Load() != 1 {
		t.Fatalf("unexpected native compaction flow: executions=%d requests=%d compactions=%d", executions.Load(), requests.Load(), compactions.Load())
	}
	recovered, err := GetSession(testSessionID)
	if err != nil || len(recovered["entries"].([]any)) != expectedEntries {
		t.Fatalf("native compaction lost visible history: %v", err)
	}
}

func TestAgentChatCanceledCompactionKeepsCurrentTurn(t *testing.T) {
	setupCompactionAgentTest(t)
	kernelModel.Conf.AI.Agent.CapabilityPolicy = &conf.CapabilityPolicy{Default: "deny"}
	result := strings.Repeat("completed operation result ", 6000)
	entries := []SessionEntry{
		{ID: "user", Type: "user", Content: "complete the task"},
		{ID: "assistant", Type: "assistant", RoundID: "old-round", ToolCalls: []AgentToolCall{{ID: "already-executed", Name: "test", Result: result, State: "finished"}}},
	}
	if _, _, err := SaveSessionState(marshalSession(t, map[string]any{"id": testSessionID, "title": "interrupted compaction", "entries": entries})); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		requests.Add(1)
		cancel()
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer server.Close()
	for range AgentChat(ctx, newTestOpenAIClient(server.URL), "openai", "test-model", "scope", 10000,
		testSessionID, "user", 1, "complete the task", nil, "English", nil, EditorContext{}, nil, false,
		time.Second, 0, "", time.Second, time.Second) {
	}
	runtime, err := loadRuntimeState(testSessionID)
	if err != nil || runtime.Compaction != nil || runtime.ActiveTurn == nil || runtime.ActiveTurn.State != "interrupted" ||
		len(runtime.ActiveTurn.Delta) != 1 || runtime.ActiveTurn.Delta[0].ToolCalls[0].Result != result || requests.Load() != 1 {
		t.Fatalf("canceled compaction lost completed operations: %+v %v requests=%d", runtime, err, requests.Load())
	}
}
