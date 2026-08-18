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
	kernelConf "github.com/siyuan-note/siyuan/kernel/conf"
	kernelModel "github.com/siyuan-note/siyuan/kernel/model"
)

func TestResponsesTokenBudgetIncludesOpaqueOutput(t *testing.T) {
	messages := []openai.ChatCompletionMessage{
		{Role: openai.ChatMessageRoleSystem, Content: "instructions"},
		{Role: openai.ChatMessageRoleAssistant, Content: "visible"},
	}
	checkpointMessages := []AgentMessage{{
		Role:                 "assistant",
		Content:              "visible",
		ResponseOutput:       []json.RawMessage{json.RawMessage(`{"type":"reasoning"}`)},
		ResponseOutputTokens: 1000,
	}}
	chatTokens := estimateProtocolRequestTokens(
		"test-model", "openai", messages, checkpointMessages, nil, nil)
	responseTokens := estimateProtocolRequestTokens(
		"test-model", "openai-responses", messages, checkpointMessages, nil, nil)
	if responseTokens < chatTokens+900 {
		t.Fatalf("Responses output was omitted from the token budget: chat=%d responses=%d", chatTokens, responseTokens)
	}

	compaction := &runtimeCompaction{
		Protocol:             "openai-responses",
		ResponseOutput:       []json.RawMessage{json.RawMessage(`{"type":"compaction"}`)},
		ResponseOutputTokens: 600,
	}
	compactedTokens := estimateProtocolRequestTokens(
		"test-model", "openai-responses", messages[:1], nil, compaction, nil)
	baseTokens := estimateChatRequestTokens("test-model", messages[:1], nil)
	if compactedTokens < baseTokens+600 {
		t.Fatalf("opaque compaction was omitted from the token budget: base=%d compacted=%d", baseTokens, compactedTokens)
	}
}

func TestResponsesCompactionPreservesOpaqueOutput(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/responses/compact" {
			t.Errorf("unexpected path: %s", r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
			return
		}
		var payload map[string]any
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Errorf("decode request: %s", err)
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		for _, unsupported := range []string{"store", "include", "tools", "reasoning"} {
			if _, exists := payload[unsupported]; exists {
				t.Errorf("compaction request contains unsupported field %s: %#v", unsupported, payload)
			}
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprint(w, "{\"id\":\"cmp_1\",\"object\":\"response.compaction\","+
			"\"output\":[{\"type\":\"compaction\",\"encrypted_content\":\"opaque\"}],"+
			"\"usage\":{\"input_tokens\":20,\"output_tokens\":4,\"total_tokens\":24}}")
	}))
	defer server.Close()

	request := openai.ChatCompletionRequest{
		Model:    "test-model",
		Messages: []openai.ChatCompletionMessage{{Role: openai.ChatMessageRoleSystem, Content: "instructions"}},
	}
	output, promptTokens, completionTokens, err := createResponseCompaction(
		context.Background(), newTestOpenAIClient(server.URL), request,
		[]any{openai.ResponseInputMessage{Type: "message", Role: "user", Content: "history"}},
		0, time.Second, make(chan AgentEvent, 1))
	if err != nil {
		t.Fatal(err)
	}
	if promptTokens != 20 || completionTokens != 4 {
		t.Fatalf("unexpected compaction usage: %d/%d", promptTokens, completionTokens)
	}
	data, err := json.Marshal(output)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), "\"encrypted_content\":\"opaque\"") {
		t.Fatalf("opaque compaction output was lost: %s", data)
	}

	entries := []SessionEntry{
		{ID: "user-1", Type: "user", Content: "old"},
		{ID: "assistant-1", Type: "assistant", Content: "old answer"},
		{ID: "user-2", Type: "user", Content: "continue"},
	}
	compaction, err := newRuntimeResponseCompaction(entries, 2, output, 4)
	if err != nil || !validRuntimeCompaction(entries, compaction) || compaction.ResponseOutputTokens != 4 {
		t.Fatalf("response compaction is invalid: %#v, err=%v", compaction, err)
	}
	input := checkpointMessagesToOpenAIResponseInput(
		entriesToAgentMessages(entries[2:]), "English", nil, compaction, false)
	data, err = json.Marshal(input)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), "\"encrypted_content\":\"opaque\"") ||
		!strings.Contains(string(data), "\"content\":\"continue\"") {
		t.Fatalf("compacted response input is incomplete: %s", data)
	}
}

func setupCompactionAgentTest(t *testing.T) {
	t.Helper()
	useTestDataDir(t)
	originalConf := kernelModel.Conf
	kernelModel.Conf = kernelModel.NewAppConf()
	kernelModel.Conf.AI = kernelConf.NewAI()
	kernelModel.Conf.AI.MCP = nil
	kernelModel.Conf.AI.Agent.MaxCompletionTokens = 512
	kernelModel.Conf.Variables = kernelConf.NewVariables()
	t.Cleanup(func() { kernelModel.Conf = originalConf })
}

func currentCapabilitiesForTest(t *testing.T) *capabilitySet {
	t.Helper()
	capabilities, err := buildCapabilitySet(nil, capabilityAccessContext{})
	if err != nil {
		t.Fatal(err)
	}
	return capabilities
}

func compactionTestContextLimit(t *testing.T, fullTokens, compactedBaseTokens int) int {
	t.Helper()
	targetBudget := fullTokens - 512
	minimumCompactedBudget := compactedBaseTokens + compactionSummaryOverhead + compactionSummaryMinTokens
	if targetBudget < minimumCompactedBudget {
		targetBudget = minimumCompactedBudget
	}
	if fullTokens <= targetBudget {
		t.Fatalf("test context does not require compaction: full=%d, budget=%d", fullTokens, targetBudget)
	}
	contextLimit := targetBudget + 1024
	for contextInputBudget(contextLimit, 512) < targetBudget {
		contextLimit++
	}
	return contextLimit
}

func writeCompactionSummaryStream(t *testing.T, w http.ResponseWriter, content string, promptTokens, completionTokens int) {
	t.Helper()
	flusher := prepareTestStream(t, w)
	writeTestStreamChunk(t, w, flusher, content)
	if _, err := fmt.Fprintf(w,
		"data: {\"id\":\"chatcmpl-summary\",\"object\":\"chat.completion.chunk\",\"created\":1,"+
			"\"model\":\"test-model\",\"choices\":[],\"usage\":{\"prompt_tokens\":%d,\"completion_tokens\":%d,"+
			"\"total_tokens\":%d}}\n\n",
		promptTokens, completionTokens, promptTokens+completionTokens); err != nil {
		t.Fatalf("write summary usage failed: %v", err)
	}
	flusher.Flush()
	writeTestStreamDone(t, w, flusher)
}

func compactionTestEntries() []SessionEntry {
	return []SessionEntry{
		{ID: "user-1", Type: "user", Content: "inspect document"},
		{
			ID:      "assistant-1",
			Type:    "assistant",
			Content: "inspection complete",
			ToolCalls: []AgentToolCall{{
				ID:        "call-1",
				Name:      "block",
				Arguments: map[string]any{"action": "get", "id": "20260730120000-abcdefg"},
				Result:    "important result",
				State:     "finished",
			}},
		},
		{ID: "thinking-1", Type: "thinking", Content: "UI-only state"},
		{ID: "user-2", Type: "user", Content: "continue"},
	}
}

func TestRuntimeCompactionValidationUsesModelContextProjection(t *testing.T) {
	entries := compactionTestEntries()
	compaction, err := newRuntimeCompaction(entries, 3, "Task and tool result retained")
	if err != nil {
		t.Fatal(err)
	}
	if !validRuntimeCompaction(entries, compaction) {
		t.Fatal("new compaction state was not valid")
	}

	entries[2].Content = "changed UI-only state"
	if !validRuntimeCompaction(entries, compaction) {
		t.Fatal("UI-only entry invalidated model context compaction")
	}

	entries[1].ToolCalls[0].Result = "changed result"
	if validRuntimeCompaction(entries, compaction) {
		t.Fatal("changed tool result did not invalidate compaction")
	}
}

func TestCompactionSourceMergesPreviousSummaryAndCompleteToolResult(t *testing.T) {
	messages := entriesToAgentMessages(compactionTestEntries()[:3])
	source, err := buildCompactionSource("Earlier task state", messages)
	if err != nil {
		t.Fatal(err)
	}
	for _, expected := range []string{"Earlier task state", "important result", "20260730120000-abcdefg"} {
		if !strings.Contains(source, expected) {
			t.Fatalf("compaction source omitted %q: %s", expected, source)
		}
	}
}

func TestCheckpointMessagesInjectCompactionWithoutChangingHistory(t *testing.T) {
	checkpoint := []AgentMessage{{Role: "user", Content: "recent", EntryID: "user-2"}}
	compaction := &runtimeCompaction{Summary: "Earlier completed work"}
	messages := checkpointMessagesToOpenAIWithSummary(checkpoint, "English", nil, compaction)
	if len(messages) != 3 || messages[1].Role != "system" ||
		!strings.Contains(messages[1].Content, compaction.Summary) ||
		messages[2].Role != "user" || messages[2].Content == "" {
		t.Fatalf("unexpected compacted model context: %#v", messages)
	}
	if len(checkpoint) != 1 || checkpoint[0].Content != "recent" {
		t.Fatalf("checkpoint history was changed: %#v", checkpoint)
	}
}

func TestCreateCompactionSummaryDoesNotSendTools(t *testing.T) {
	var request map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Fatal(err)
		}
		writeCompactionSummaryStream(t, w, "Persisted summary", 12, 3)
	}))
	defer server.Close()

	summary, promptTokens, completionTokens, err := createCompactionSummary(
		context.Background(), newTestOpenAIClient(server.URL), "test-model", "history", 512, 0,
		time.Second, time.Second, make(chan AgentEvent, 1))
	if err != nil {
		t.Fatal(err)
	}
	if summary != "Persisted summary" || promptTokens != 12 || completionTokens != 3 {
		t.Fatalf("unexpected summary response: %q, %d, %d", summary, promptTokens, completionTokens)
	}
	if _, ok := request["tools"]; ok {
		t.Fatalf("compaction request exposed tools: %#v", request)
	}
	if stream, _ := request["stream"].(bool); !stream {
		t.Fatalf("compaction request was not streamed: %#v", request)
	}
	if numberToInt64(request["max_completion_tokens"]) != 512 {
		t.Fatalf("compaction output was not bounded: %#v", request)
	}
}

func TestCreateCompactionSummaryPreservesProviderError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = fmt.Fprint(w, `{"error":{"message":"summary access denied","type":"authentication_error"}}`)
	}))
	defer server.Close()

	_, _, _, err := createCompactionSummary(
		context.Background(), newTestOpenAIClient(server.URL), "test-model", "history", 512, 0,
		time.Second, time.Second, make(chan AgentEvent, 1))
	if err == nil {
		t.Fatal("summary request unexpectedly succeeded")
	}
	if errors.Is(err, errContextCannotBeCompacted) {
		t.Fatalf("provider error was misclassified as a context capacity error: %v", err)
	}
	if classifyRetry(err) != "fatal" || !strings.Contains(err.Error(), "summary access denied") {
		t.Fatalf("provider error was not preserved: %v", err)
	}
}

func TestRuntimeCompactionPersistsBesideActiveTurn(t *testing.T) {
	useTestDataDir(t)
	entries := compactionTestEntries()
	session := map[string]any{
		"id":        testSessionID,
		"title":     "compaction",
		"createdAt": int64(1),
		"updatedAt": int64(1),
		"entries":   entries,
	}
	if _, err := SaveSession(marshalSession(t, session)); err != nil {
		t.Fatal(err)
	}
	turn := &agentRuntimeTurn{
		TurnID:       "20260730120001-abcdefg",
		Mode:         "append",
		UserEntryID:  "user-2",
		BaseRevision: 1,
		State:        "running",
		UpdatedAt:    time.Now().UnixMilli(),
	}
	if err := beginRuntimeTurn(testSessionID, turn); err != nil {
		t.Fatal(err)
	}
	compaction, err := newRuntimeCompaction(entries, 3, "Persisted summary")
	if err != nil {
		t.Fatal(err)
	}
	if err := saveRuntimeCompaction(testSessionID, compaction); err != nil {
		t.Fatal(err)
	}
	runtime, err := loadRuntimeState(testSessionID)
	if err != nil {
		t.Fatal(err)
	}
	if runtime.ActiveTurn == nil || runtime.ActiveTurn.TurnID != turn.TurnID ||
		!validRuntimeCompaction(entries, runtime.Compaction) {
		t.Fatalf("runtime compaction did not persist beside the active turn: %#v", runtime)
	}
}

func TestAgentChatCompactsBeforeSendingOversizedContext(t *testing.T) {
	setupCompactionAgentTest(t)

	entries := []SessionEntry{
		{ID: "user-1", Type: "user", Content: "complete the old task"},
		{ID: "assistant-1", Type: "assistant", Content: strings.Repeat("important old result ", 8000)},
		{ID: "user-2", Type: "user", Content: "start the current task"},
	}
	session := map[string]any{
		"id":        testSessionID,
		"title":     "compaction",
		"createdAt": int64(1),
		"updatedAt": int64(1),
		"entries":   entries,
	}
	if _, err := SaveSession(marshalSession(t, session)); err != nil {
		t.Fatal(err)
	}

	checkpoint := entriesToAgentMessages(entries)
	requestTools := currentCapabilitiesForTest(t).definitions
	fullTokens := estimateChatRequestTokens(
		"test-model", checkpointMessagesToOpenAI(checkpoint, "English", nil), requestTools)
	recentTokens := estimateChatRequestTokens(
		"test-model", checkpointMessagesToOpenAI(entriesToAgentMessages(entries[2:]), "English", nil), requestTools)
	contextLimit := compactionTestContextLimit(t, fullTokens, recentTokens)
	if fullTokens <= contextInputBudget(contextLimit, 512) {
		t.Fatalf("test context does not require compaction: full=%d, budget=%d", fullTokens,
			contextInputBudget(contextLimit, 512))
	}

	var requestCount atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		count := requestCount.Add(1)
		var payload map[string]any
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatal(err)
		}
		if count == 1 {
			writeCompactionSummaryStream(t, w, "The old task is complete and its result is retained", 100, 12)
			return
		}
		flusher := prepareTestStream(t, w)
		writeTestStreamChunk(t, w, flusher, "current task continued")
		writeTestStreamDone(t, w, flusher)
	}))
	defer server.Close()

	events := AgentChat(
		context.Background(), newTestOpenAIClient(server.URL), "openai", "test-model", "", contextLimit, testSessionID,
		"user-2", 1, "start the current task", nil, "English", nil, EditorContext{}, nil, false,
		time.Second, 0, "", time.Second, time.Second,
	)
	doneSeen := false
	for event := range events {
		if event.Type == "error" {
			t.Fatalf("agent returned an error after proactive compaction: %s", event.Error)
		}
		if event.Type == "done" {
			doneSeen = true
		}
	}
	if requestCount.Load() != 2 || !doneSeen {
		t.Fatalf("unexpected compaction request flow: requests=%d, done=%v", requestCount.Load(), doneSeen)
	}
	runtime, err := loadRuntimeState(testSessionID)
	if err != nil {
		t.Fatal(err)
	}
	if runtime.Compaction == nil || runtime.Compaction.CoveredEntryCount != 2 ||
		!validRuntimeCompaction(entries, runtime.Compaction) {
		t.Fatalf("proactive compaction was not persisted: %#v", runtime.Compaction)
	}
	canonical, err := GetSessionState(testSessionID, false)
	if err != nil {
		t.Fatal(err)
	}
	if persistedEntries := canonical["entries"].([]any); len(persistedEntries) != len(entries) {
		t.Fatalf("compaction changed visible history: %#v", persistedEntries)
	}
}

func TestAgentChatRegenerateCompactionUsesTruncatedEditedHistory(t *testing.T) {
	setupCompactionAgentTest(t)
	const (
		originalTarget  = "ORIGINAL_TARGET_PROMPT_DO_NOT_SEND"
		editedTarget    = "EDITED_TARGET_PROMPT_MUST_SEND"
		editedBlockHTML = `<div data-node-id="edited">EDITED_TARGET_PROMPT_MUST_SEND</div>`
		staleAnswer     = "STALE_REGENERATED_ANSWER_DO_NOT_SEND"
		futureTurn      = "FUTURE_TURN_DO_NOT_SEND"
	)
	entries := []SessionEntry{
		{ID: "user-1", Type: "user", Content: "complete the old task"},
		{ID: "assistant-1", Type: "assistant", Content: strings.Repeat("important old result ", 8000)},
		{ID: "user-2", Type: "user", Content: originalTarget},
		{ID: "assistant-2", Type: "assistant", Content: staleAnswer},
		{ID: "user-3", Type: "user", Content: futureTurn},
		{ID: "assistant-3", Type: "assistant", Content: "future answer"},
	}
	session := map[string]any{
		"id":        testSessionID,
		"title":     "regenerate compaction",
		"createdAt": int64(1),
		"updatedAt": int64(1),
		"entries":   entries,
	}
	if _, err := SaveSession(marshalSession(t, session)); err != nil {
		t.Fatal(err)
	}

	regenerateCheckpoint := entriesToAgentMessages(entries[:2])
	regenerateCheckpoint = append(regenerateCheckpoint,
		newAgentUserMessage(editedTarget, "user-2", nil, EditorContext{}))
	requestTools := currentCapabilitiesForTest(t).definitions
	fullTokens := estimateChatRequestTokens(
		"test-model", checkpointMessagesToOpenAI(regenerateCheckpoint, "English", nil), requestTools)
	recentTokens := estimateChatRequestTokens(
		"test-model", checkpointMessagesToOpenAI(regenerateCheckpoint[2:], "English", nil), requestTools)
	contextLimit := compactionTestContextLimit(t, fullTokens, recentTokens)

	var requestCount atomic.Int32
	modelPayload := make(chan string, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		count := requestCount.Add(1)
		var payload map[string]any
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatal(err)
		}
		if count == 1 {
			writeCompactionSummaryStream(t, w, "The old task is complete", 100, 8)
			return
		}
		data, err := json.Marshal(payload)
		if err != nil {
			t.Fatal(err)
		}
		modelPayload <- string(data)
		flusher := prepareTestStream(t, w)
		writeTestStreamChunk(t, w, flusher, "new answer")
		writeTestStreamDone(t, w, flusher)
	}))
	defer server.Close()

	events := AgentChat(
		context.Background(), newTestOpenAIClient(server.URL), "openai", "test-model", "", contextLimit, testSessionID,
		"user-2", 1, editedTarget, new(editedBlockHTML), "English", nil, EditorContext{}, nil, true,
		time.Second, 0, "", time.Second, time.Second,
	)
	for event := range events {
		if event.Type == "error" {
			t.Fatalf("regenerate returned an error after compaction: %s", event.Error)
		}
	}
	if requestCount.Load() != 2 {
		t.Fatalf("unexpected regenerate request count: %d", requestCount.Load())
	}
	payload := <-modelPayload
	if !strings.Contains(payload, editedTarget) {
		t.Fatalf("edited target was omitted from regenerated context: %s", payload)
	}
	for _, excluded := range []string{originalTarget, staleAnswer, futureTurn} {
		if strings.Contains(payload, excluded) {
			t.Fatalf("truncated regenerate history %q was reintroduced: %s", excluded, payload)
		}
	}
	runtime, err := loadRuntimeState(testSessionID)
	if err != nil {
		t.Fatal(err)
	}
	if runtime.ActiveTurn == nil {
		t.Fatal("regenerate runtime turn was not persisted")
	}
	if runtime.ActiveTurn.UserBlockHTML == nil || *runtime.ActiveTurn.UserBlockHTML != editedBlockHTML {
		t.Fatalf("regenerate runtime lost edited block HTML: %#v", runtime.ActiveTurn)
	}
	deltaJSON, err := json.Marshal(runtime.ActiveTurn.Delta)
	if err != nil {
		t.Fatal(err)
	}
	for _, excluded := range []string{staleAnswer, futureTurn} {
		if strings.Contains(string(deltaJSON), excluded) {
			t.Fatalf("truncated regenerate history %q was persisted in the turn delta: %s", excluded, deltaJSON)
		}
	}
}

func TestAgentChatRetriesOverflowAfterProactiveCompaction(t *testing.T) {
	setupCompactionAgentTest(t)
	entries := []SessionEntry{
		{ID: "user-1", Type: "user", Content: "first completed task"},
		{ID: "assistant-1", Type: "assistant", Content: strings.Repeat("first result ", 6000)},
		{ID: "user-2", Type: "user", Content: "second completed task"},
		{ID: "assistant-2", Type: "assistant", Content: strings.Repeat("second result ", 6000)},
		{ID: "user-3", Type: "user", Content: "current task"},
	}
	session := map[string]any{
		"id":        testSessionID,
		"title":     "overflow fallback",
		"createdAt": int64(1),
		"updatedAt": int64(1),
		"entries":   entries,
	}
	if _, err := SaveSession(marshalSession(t, session)); err != nil {
		t.Fatal(err)
	}

	requestTools := currentCapabilitiesForTest(t).definitions
	fullTokens := estimateChatRequestTokens(
		"test-model", checkpointMessagesToOpenAI(entriesToAgentMessages(entries), "English", nil), requestTools)
	afterFirstTokens := estimateChatRequestTokens(
		"test-model", checkpointMessagesToOpenAI(entriesToAgentMessages(entries[2:]), "English", nil), requestTools)
	contextLimit := compactionTestContextLimit(t, fullTokens, afterFirstTokens)

	var requestCount atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		count := requestCount.Add(1)
		var payload map[string]any
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatal(err)
		}
		switch count {
		case 1:
			writeCompactionSummaryStream(t, w, "The first task is complete", 90, 8)
		case 2:
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			_, _ = fmt.Fprint(w,
				`{"error":{"message":"maximum context length exceeded","type":"invalid_request_error",`+
					`"code":"context_length_exceeded"}}`)
		case 3:
			writeCompactionSummaryStream(t, w, "Both earlier tasks are complete", 100, 9)
		case 4:
			flusher := prepareTestStream(t, w)
			writeTestStreamChunk(t, w, flusher, "current task continued")
			writeTestStreamDone(t, w, flusher)
		default:
			t.Fatalf("unexpected request %d: %#v", count, payload)
		}
	}))
	defer server.Close()

	events := AgentChat(
		context.Background(), newTestOpenAIClient(server.URL), "openai", "test-model", "", contextLimit, testSessionID,
		"user-3", 1, "current task", nil, "English", nil, EditorContext{}, nil, false,
		time.Second, 0, "", time.Second, time.Second,
	)
	doneSeen := false
	for event := range events {
		if event.Type == "error" {
			t.Fatalf("overflow fallback returned an error: %s", event.Error)
		}
		if event.Type == "done" {
			doneSeen = true
		}
	}
	if requestCount.Load() != 4 || !doneSeen {
		t.Fatalf("unexpected overflow fallback flow: requests=%d, done=%v", requestCount.Load(), doneSeen)
	}
	runtime, err := loadRuntimeState(testSessionID)
	if err != nil {
		t.Fatal(err)
	}
	if runtime.Compaction == nil || runtime.Compaction.CoveredEntryCount != 4 {
		t.Fatalf("overflow fallback did not extend the compaction boundary: %#v", runtime.Compaction)
	}
}
