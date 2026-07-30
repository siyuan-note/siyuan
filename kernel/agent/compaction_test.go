// SiYuan - Refactor your thinking
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
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	kernelConf "github.com/siyuan-note/siyuan/kernel/conf"
	kernelModel "github.com/siyuan-note/siyuan/kernel/model"
)

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
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprint(w, `{
			"id":"summary-1",
			"object":"chat.completion",
			"choices":[{"index":0,"message":{"role":"assistant","content":"Persisted summary"},"finish_reason":"stop"}],
			"usage":{"prompt_tokens":12,"completion_tokens":3,"total_tokens":15}
		}`)
	}))
	defer server.Close()

	summary, promptTokens, completionTokens, err := createCompactionSummary(
		context.Background(), newTestOpenAIClient(server.URL), "test-model", "history", 512, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	if summary != "Persisted summary" || promptTokens != 12 || completionTokens != 3 {
		t.Fatalf("unexpected summary response: %q, %d, %d", summary, promptTokens, completionTokens)
	}
	if _, ok := request["tools"]; ok {
		t.Fatalf("compaction request exposed tools: %#v", request)
	}
	if numberToInt64(request["max_completion_tokens"]) != 512 {
		t.Fatalf("compaction output was not bounded: %#v", request)
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
	if err := beginRuntimeTurn(testSessionID, turn, false); err != nil {
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
	useTestDataDir(t)
	originalConf := kernelModel.Conf
	kernelModel.Conf = kernelModel.NewAppConf()
	kernelModel.Conf.AI = kernelConf.NewAI()
	kernelModel.Conf.AI.MCP = nil
	kernelModel.Conf.AI.Agent.MaxCompletionTokens = 512
	kernelModel.Conf.Variables = kernelConf.NewVariables()
	t.Cleanup(func() { kernelModel.Conf = originalConf })

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
	requestTools := convertMCPToolsToOpenAI()
	fullTokens := estimateChatRequestTokens(
		"test-model", checkpointMessagesToOpenAI(checkpoint, "English", nil), requestTools)
	recentTokens := estimateChatRequestTokens(
		"test-model", checkpointMessagesToOpenAI(entriesToAgentMessages(entries[2:]), "English", nil), requestTools)
	targetBudget := fullTokens - 512
	minimumCompactedBudget := recentTokens + compactionSummaryOverhead + compactionSummaryMinTokens
	if targetBudget < minimumCompactedBudget {
		targetBudget = minimumCompactedBudget
	}
	contextLimit := targetBudget + 1024
	for contextInputBudget(contextLimit, 512) < targetBudget {
		contextLimit++
	}
	if fullTokens <= contextInputBudget(contextLimit, 512) {
		t.Fatalf("test context does not require compaction: full=%d, budget=%d", fullTokens,
			contextInputBudget(contextLimit, 512))
	}

	requestCount := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestCount++
		var payload map[string]any
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatal(err)
		}
		if stream, _ := payload["stream"].(bool); !stream {
			w.Header().Set("Content-Type", "application/json")
			_, _ = fmt.Fprint(w, `{
				"id":"summary-1",
				"object":"chat.completion",
				"choices":[{"index":0,"message":{"role":"assistant","content":"The old task is complete and its result is retained"},"finish_reason":"stop"}],
				"usage":{"prompt_tokens":100,"completion_tokens":12,"total_tokens":112}
			}`)
			return
		}
		flusher := prepareTestStream(t, w)
		writeTestStreamChunk(t, w, flusher, "current task continued")
		writeTestStreamDone(t, w, flusher)
	}))
	defer server.Close()

	events := AgentChat(
		context.Background(), newTestOpenAIClient(server.URL), "test-model", contextLimit, testSessionID,
		"user-2", 1, "start the current task", "English", nil, EditorContext{}, nil, false,
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
	if requestCount != 2 || !doneSeen {
		t.Fatalf("unexpected compaction request flow: requests=%d, done=%v", requestCount, doneSeen)
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
