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

	"github.com/sashabaranov/go-openai"
	kernelConf "github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/mcp/tools"
	kernelModel "github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func writeAnthropicAgentResponse(t *testing.T, w http.ResponseWriter, signature, text, tool string, complete bool) {
	t.Helper()
	flusher := prepareTestStream(t, w)
	write := func(event any) {
		data, _ := json.Marshal(event)
		_, _ = fmt.Fprintf(w, "data: %s\n\n", data)
		flusher.Flush()
	}
	write(map[string]any{"type": "message_start", "message": map[string]any{
		"id": "msg", "content": []any{}, "usage": map[string]int{"input_tokens": 10, "output_tokens": 1},
	}})
	blocks := []map[string]any{{"type": "thinking", "thinking": "reasoning", "signature": signature}}
	if tool != "" {
		blocks = append(blocks, map[string]any{"type": "tool_use", "id": "native_tool", "name": tool,
			"input": map[string]string{"action": "list"}})
	} else {
		blocks = append(blocks, map[string]any{"type": "text", "text": text})
	}
	for index, block := range blocks {
		write(map[string]any{"type": "content_block_start", "index": index, "content_block": block})
		write(map[string]any{"type": "content_block_stop", "index": index})
	}
	if complete {
		reason := "end_turn"
		if tool != "" {
			reason = "tool_use"
		}
		write(map[string]any{"type": "message_delta", "delta": map[string]string{"stop_reason": reason}, "usage": map[string]int{"output_tokens": 5}})
		write(map[string]any{"type": "message_stop"})
	}
}

func TestAnthropicAgentToolHistoryRecovery(t *testing.T) {
	for _, interrupted := range []bool{false, true} {
		t.Run(fmt.Sprintf("interrupted=%v", interrupted), func(t *testing.T) {
			useTestDataDir(t)
			previous := kernelModel.Conf
			kernelModel.Conf = kernelModel.NewAppConf()
			kernelModel.Conf.AI = kernelConf.NewAI()
			kernelModel.Conf.AI.MCP = nil
			kernelModel.Conf.Variables = kernelConf.NewVariables()
			t.Cleanup(func() { kernelModel.Conf = previous })
			const toolName = "test_anthropic_history"
			var executions atomic.Int32
			tools.SetTool(toolName, &tools.Tool{Name: toolName, Source: "native", ReadOnlyHint: true,
				InputSchema:   tools.ToolSchema{Type: "object", Properties: map[string]tools.Property{"action": {Type: "string"}}},
				ActionEffects: map[string]tools.ToolEffects{"list": {LocalRead: true}},
				Handler: func(map[string]any) (tools.CallToolResult, error) {
					executions.Add(1)
					return tools.CallToolResult{Content: []tools.ContentItem{{Type: "text", Text: "found"}}}, nil
				}})
			t.Cleanup(func() { tools.RemoveTool(toolName) })
			_, err := SaveSession(marshalSession(t, map[string]any{"id": testSessionID, "title": "native",
				"createdAt": 1, "updatedAt": 1, "entries": []any{map[string]any{"id": "user-1", "type": "user", "content": "use tool"}}}))
			if err != nil {
				t.Fatal(err)
			}
			var requests atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/v1/messages" {
					t.Errorf("unexpected path %s", r.URL.Path)
				}
				var payload map[string]json.RawMessage
				if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
					t.Error(err)
				}
				n := requests.Add(1)
				if n >= 2 {
					for _, want := range []string{"signature-tool", "tool_result", "native_tool", "found"} {
						if !strings.Contains(string(payload["messages"]), want) {
							t.Errorf("native context missing %s: %s", want, payload["messages"])
						}
					}
				}
				if n == 1 {
					writeAnthropicAgentResponse(t, w, "signature-tool", "", toolName, true)
				} else if n == 2 && interrupted {
					writeAnthropicAgentResponse(t, w, "signature-incomplete", "partial", "", false)
				} else {
					if n == 3 && !interrupted && !strings.Contains(string(payload["messages"]), "signature-final") {
						t.Error("committed final thinking was not restored")
					}
					writeAnthropicAgentResponse(t, w, "signature-final", "answer", "", true)
				}
			}))
			defer server.Close()
			client := util.NewAIClientWithModel("key", server.URL+"/v1", "test")
			run := func(userID string, revision int64, message string, wantError bool) string {
				t.Helper()
				turnID, failed := "", false
				for event := range AgentChat(context.Background(), client, util.AnthropicProtocolMessages, "test", "", 0,
					testSessionID, userID, revision, message, nil, "English", nil, EditorContext{}, nil, false,
					time.Second, 0, "", time.Second, time.Second) {
					if event.Type == "turn" {
						turnID = event.TurnID
					}
					if event.Type == "error" {
						failed = true
					}
				}
				if failed != wantError || turnID == "" {
					t.Fatalf("turn failed=%v, want %v; id=%q", failed, wantError, turnID)
				}
				return turnID
			}
			turnID := run("user-1", 1, "use tool", interrupted)
			recovered, err := GetSession(testSessionID)
			if err != nil {
				t.Fatal(err)
			}
			recovered["expectedRevision"], recovered["commitTurnID"] = int64(1), turnID
			revision, canonical, err := SaveSessionState(marshalSession(t, recovered))
			if err != nil || revision != 2 {
				t.Fatalf("commit failed: %d %v", revision, err)
			}
			data, _ := json.Marshal(canonical)
			if !strings.Contains(string(data), "signature-tool") || (!interrupted && !strings.Contains(string(data), "signature-final")) {
				t.Fatalf("native blocks were lost during persistence: %s", data)
			}
			if interrupted && strings.Contains(string(data), "signature-incomplete") {
				t.Fatal("incomplete native content was committed")
			}
			canonical["entries"] = append(canonical["entries"].([]any), map[string]any{"id": "user-2", "type": "user", "content": "continue"})
			canonical["expectedRevision"] = int64(2)
			if _, err = SaveSession(marshalSession(t, canonical)); err != nil {
				t.Fatal(err)
			}
			run("user-2", 3, "continue", false)
			if executions.Load() != 1 || requests.Load() != 3 {
				t.Fatalf("tool was repeated: calls=%d requests=%d", executions.Load(), requests.Load())
			}
		})
	}
}

func TestAnthropicTitleAndCompaction(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload map[string]json.RawMessage
		_ = json.NewDecoder(r.Body).Decode(&payload)
		if r.URL.Path != "/v1/messages" || len(payload["system"]) == 0 {
			t.Errorf("unexpected native summary request: %s %s", r.URL.Path, payload["system"])
		}
		if string(payload["stream"]) == "true" {
			writeAnthropicAgentResponse(t, w, "summary-signature", "summary", "", true)
		} else {
			_, _ = fmt.Fprint(w, `{"content":[{"type":"text","text":"Native title"}],"stop_reason":"end_turn","usage":{}}`)
		}
	}))
	defer server.Close()
	client := util.NewAIClientWithModel("", server.URL, "test")
	if title := GenerateTitle(client, server.URL, util.AnthropicProtocolMessages, "test", "hello", "en"); title != "Native title" {
		t.Fatalf("unexpected title %q", title)
	}
	summary, input, output, err := createProtocolCompactionSummary(context.Background(), client, util.AnthropicProtocolMessages,
		"test", "history", 1024, 0, time.Second, time.Second, make(chan AgentEvent, 8))
	if err != nil || summary != "summary" || input != 10 || output != 5 {
		t.Fatalf("unexpected summary %q %d %d %v", summary, input, output, err)
	}
	content := &util.AIMessageContent{Protocol: util.AnthropicProtocolMessages, Version: 1,
		Blocks: []json.RawMessage{json.RawMessage(`{"type":"thinking","thinking":"visible","signature":"opaque"}`)}}
	messages := []AgentMessage{{Role: "assistant", Content: "answer", NativeContent: content}}
	source, err := buildCompactionSource("", messages)
	if err != nil || strings.Contains(source, "opaque") || messages[0].NativeContent == nil {
		t.Fatalf("compaction changed native history or included opaque data: %s %v", source, err)
	}
	for _, protocol := range []string{util.OpenAIProtocolChatCompletions, util.OpenAIProtocolResponses} {
		if runtimeCompactionMatchesProtocol(&runtimeCompaction{Protocol: util.AnthropicProtocolMessages}, protocol) {
			t.Fatal("native compaction was reused for a different protocol")
		}
	}
}

func TestAnthropicStreamRetryBeforeOutput(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if requests.Add(1) == 1 {
			w.Header().Set("Content-Type", "text/event-stream")
			_, _ = fmt.Fprint(w, "data: {\"type\":\"message_start\",\"message\":{\"content\":[]}}\n\n"+
				"data: {\"type\":\"error\",\"error\":{\"type\":\"overloaded_error\",\"message\":\"busy\"}}\n\n")
			return
		}
		writeAnthropicAgentResponse(t, w, "signature", "answer", "", true)
	}))
	defer server.Close()
	stream, _, cancel, err := createProtocolStreamWithRetry(context.Background(), util.NewAIClientWithModel("", server.URL, "test"),
		util.AnthropicProtocolMessages, openai.ChatCompletionRequest{Model: "test", Messages: []openai.ChatCompletionMessage{{Role: "user", Content: "hello"}}},
		nil, 1, time.Second, time.Second, noRetryDelay, make(chan AgentEvent, 8))
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Close()
	defer cancel()
	if requests.Load() != 2 || classifyRetry(&openai.APIError{HTTPStatusCode: 529}) != "server_error" {
		t.Fatal("Anthropic overload was not retried")
	}
}

func nativeHistoryContent(signature, text string) *util.AIMessageContent {
	thinking, _ := json.Marshal(map[string]string{"type": "thinking", "thinking": "reason", "signature": signature})
	content, _ := json.Marshal(map[string]string{"type": "text", "text": text})
	return &util.AIMessageContent{Protocol: util.AnthropicProtocolMessages, Version: 1,
		Blocks: []json.RawMessage{thinking, content}}
}

func TestAnthropicCompactionPreservesRecentNativeHistory(t *testing.T) {
	setupCompactionAgentTest(t)
	entries := []SessionEntry{
		{ID: "user-1", Type: "user", Content: "old task"},
		{ID: "assistant-1", Type: "assistant", Content: strings.Repeat("old result ", 12000)},
		{ID: "user-2", Type: "user", Content: "recent task"},
		{ID: "assistant-2", Type: "assistant", Content: "recent answer", NativeContent: nativeHistoryContent("recent-signature", "recent answer")},
		{ID: "user-3", Type: "user", Content: "continue"},
	}
	if _, err := SaveSession(marshalSession(t, map[string]any{"id": testSessionID, "title": "compact", "entries": entries})); err != nil {
		t.Fatal(err)
	}
	capabilities := currentCapabilitiesForTest(t)
	checkpoint := entriesToAgentMessages(entries)
	full := estimateProtocolRequestTokens("test", util.AnthropicProtocolMessages, checkpointMessagesToOpenAI(checkpoint, "English", nil), checkpoint, nil, capabilities.definitions)
	recent := entriesToAgentMessages(entries[2:])
	base := estimateProtocolRequestTokens("test", util.AnthropicProtocolMessages, checkpointMessagesToOpenAI(recent, "English", nil), recent, nil, capabilities.definitions)
	limit := compactionTestContextLimit(t, full, base)
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request map[string]json.RawMessage
		_ = json.NewDecoder(r.Body).Decode(&request)
		if requests.Add(1) == 1 {
			if strings.Contains(string(request["messages"]), "recent-signature") {
				t.Error("summary received opaque signatures")
			}
			writeAnthropicAgentResponse(t, w, "summary-signature", "old task summarized", "", true)
		} else {
			if !strings.Contains(string(request["messages"]), "recent-signature") ||
				!strings.Contains(string(request["system"]), "old task summarized") {
				t.Errorf("compaction lost native history or summary: %+v", request)
			}
			writeAnthropicAgentResponse(t, w, "answer-signature", "done", "", true)
		}
	}))
	defer server.Close()
	for event := range AgentChat(context.Background(), util.NewAIClientWithModel("", server.URL, "test"), util.AnthropicProtocolMessages,
		"test", "", limit, testSessionID, "user-3", 1, "continue", nil, "English", nil, EditorContext{}, nil, false,
		time.Second, 0, "", time.Second, time.Second) {
		if event.Type == "error" {
			t.Fatalf("native compaction failed: %s", event.Error)
		}
	}
	runtime, err := loadRuntimeState(testSessionID)
	if err != nil || requests.Load() != 2 || runtime.Compaction == nil || runtime.Compaction.CoveredEntryCount != 2 ||
		!validRuntimeCompaction(entries, runtime.Compaction) {
		t.Fatalf("unexpected compaction: %+v %v requests=%d", runtime, err, requests.Load())
	}
}

func TestAnthropicRegenerateUsesEditedHistory(t *testing.T) {
	setupCompactionAgentTest(t)
	entries := []SessionEntry{
		{ID: "user-1", Type: "user", Content: "first"},
		{ID: "assistant-1", Type: "assistant", Content: "first answer", NativeContent: nativeHistoryContent("retained-signature", "first answer")},
		{ID: "user-2", Type: "user", Content: "obsolete prompt"},
		{ID: "assistant-2", Type: "assistant", Content: "obsolete answer", NativeContent: nativeHistoryContent("obsolete-signature", "obsolete answer")},
	}
	if _, err := SaveSession(marshalSession(t, map[string]any{"id": testSessionID, "title": "regenerate", "entries": entries})); err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request map[string]json.RawMessage
		_ = json.NewDecoder(r.Body).Decode(&request)
		messages := string(request["messages"])
		if !strings.Contains(messages, "retained-signature") || !strings.Contains(messages, "edited prompt") || strings.Contains(messages, "obsolete") {
			t.Errorf("regeneration did not project edited native history: %s", messages)
		}
		writeAnthropicAgentResponse(t, w, "new-signature", "new answer", "", true)
	}))
	defer server.Close()
	for event := range AgentChat(context.Background(), util.NewAIClientWithModel("", server.URL, "test"), util.AnthropicProtocolMessages,
		"test", "", 0, testSessionID, "user-2", 1, "edited prompt", nil, "English", nil, EditorContext{}, nil, true,
		time.Second, 0, "", time.Second, time.Second) {
		if event.Type == "error" {
			t.Fatalf("native regeneration failed: %s", event.Error)
		}
	}
}

func TestAnthropicIncompleteToolDoesNotExecute(t *testing.T) {
	setupCompactionAgentTest(t)
	const toolName = "test_anthropic_incomplete"
	var executed atomic.Int32
	tools.SetTool(toolName, &tools.Tool{Name: toolName, Source: "native", ReadOnlyHint: true,
		InputSchema:   tools.ToolSchema{Type: "object", Properties: map[string]tools.Property{"action": {Type: "string"}}},
		ActionEffects: map[string]tools.ToolEffects{"list": {LocalRead: true}},
		Handler: func(map[string]any) (tools.CallToolResult, error) {
			executed.Add(1)
			return tools.CallToolResult{}, nil
		}})
	t.Cleanup(func() { tools.RemoveTool(toolName) })
	if _, err := SaveSession(marshalSession(t, map[string]any{"id": testSessionID, "entries": []SessionEntry{
		{ID: "user-1", Type: "user", Content: "use tool"},
	}})); err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeAnthropicAgentResponse(t, w, "signature", "", toolName, false)
	}))
	defer server.Close()
	failed := false
	for event := range AgentChat(context.Background(), util.NewAIClientWithModel("", server.URL, "test"), util.AnthropicProtocolMessages,
		"test", "", 0, testSessionID, "user-1", 1, "use tool", nil, "English", nil, EditorContext{}, nil, false,
		time.Second, 2, "", time.Second, time.Second) {
		if event.Type == "error" {
			failed = true
		}
	}
	if !failed || executed.Load() != 0 {
		t.Fatalf("incomplete response executed a tool: failed=%v executions=%d", failed, executed.Load())
	}
}
