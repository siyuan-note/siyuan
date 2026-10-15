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
	"github.com/siyuan-note/siyuan/kernel/util"
)

func writeGeminiAgentResponse(t *testing.T, w http.ResponseWriter, signature, text, tool string, complete bool) {
	t.Helper()
	flusher := prepareTestStream(t, w)
	write := func(event any) {
		data, _ := json.Marshal(event)
		fmt.Fprintf(w, "data: %s\n\n", data)
		flusher.Flush()
	}
	write(map[string]any{"event_type": "interaction.created", "interaction": map[string]string{"id": "i1", "model": "test", "status": "in_progress"}})
	steps := []map[string]any{{"type": "thought", "signature": signature, "summary": []any{map[string]string{"type": "text", "text": "reasoning"}}}}
	status := "completed"
	if tool != "" {
		steps = append(steps, map[string]any{"type": "function_call", "id": "native_tool", "name": tool, "arguments": map[string]string{"action": "list"}})
		status = "requires_action"
	} else {
		steps = append(steps, map[string]any{"type": "model_output", "content": []any{map[string]string{"type": "text", "text": text}}})
	}
	for index, step := range steps {
		write(map[string]any{"event_type": "step.start", "index": index, "step": step})
		write(map[string]any{"event_type": "step.stop", "index": index})
	}
	if complete {
		write(map[string]any{"event_type": "interaction.completed", "interaction": map[string]any{"id": "i1", "status": status,
			"usage": map[string]int{"total_input_tokens": 10, "total_output_tokens": 5, "total_tokens": 15}}})
	}
}

func TestGeminiAgentToolHistoryRecovery(t *testing.T) {
	testNativeAgentToolHistoryRecovery(t, util.GeminiProtocolInteractions, "/v1/interactions", "input", "function_result", writeGeminiAgentResponse)
}

func TestGeminiIncompleteToolDoesNotExecute(t *testing.T) {
	testNativeIncompleteToolDoesNotExecute(t, util.GeminiProtocolInteractions, writeGeminiAgentResponse)
}

func TestGeminiIncompleteOutputDoesNotRetry(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		w.Header().Set("Content-Type", "text/event-stream")
		for _, event := range []string{
			`{"event_type":"interaction.created","interaction":{"id":"i1","status":"in_progress"}}`,
			`{"event_type":"step.start","index":0,"step":{"type":"thought","signature":"opaque"}}`,
			`{"event_type":"step.stop","index":0}`,
			`{"event_type":"interaction.completed","interaction":{"id":"i1","status":"incomplete"}}`,
		} {
			fmt.Fprintf(w, "data: %s\n\n", event)
		}
	}))
	defer server.Close()
	stream, _, cancel, err := createProtocolStreamWithRetry(context.Background(), util.NewAIClientWithModel("", server.URL, "test"),
		util.GeminiProtocolInteractions, openai.ChatCompletionRequest{Model: "test", Messages: []openai.ChatCompletionMessage{{Role: "user", Content: "hello"}}},
		nil, 2, time.Second, time.Second, noRetryDelay, make(chan AgentEvent, 8))
	if cancel != nil {
		defer cancel()
	}
	if stream != nil {
		defer stream.Close()
	}
	if err == nil || requests.Load() != 1 {
		t.Fatalf("incomplete output was accepted or retried: requests=%d error=%v", requests.Load(), err)
	}
}

func TestGeminiTitleAndCompaction(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload map[string]json.RawMessage
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Error(err)
		}
		if r.URL.Path != "/v1beta/interactions" || len(payload["system_instruction"]) == 0 || string(payload["store"]) != "false" {
			t.Errorf("unexpected native summary request: %s %+v", r.URL.Path, payload)
		}
		if string(payload["stream"]) == "true" {
			writeGeminiAgentResponse(t, w, "summary-signature", "summary", "", true)
		} else {
			fmt.Fprint(w, `{"id":"i1","status":"completed","steps":[{"type":"model_output","content":[{"type":"text","text":"Native title"}]}]}`)
		}
	}))
	defer server.Close()
	client := util.NewAIClientWithModel("", server.URL, "test")
	if title := GenerateTitle(client, server.URL, util.GeminiProtocolInteractions, "test", "hello", "en"); title != "Native title" {
		t.Fatalf("title: %q", title)
	}
	summary, input, output, err := createProtocolCompactionSummary(context.Background(), client, util.GeminiProtocolInteractions,
		"test", "history", 1024, 0, time.Second, time.Second, make(chan AgentEvent, 8))
	if err != nil || summary != "summary" || input != 10 || output != 5 {
		t.Fatalf("summary: %q %d %d %v", summary, input, output, err)
	}
	content := &util.AIMessageContent{Protocol: util.GeminiProtocolInteractions, Version: 1,
		Blocks: []json.RawMessage{json.RawMessage(`{"type":"thought","signature":"opaque"}`)}}
	messages := []AgentMessage{{Role: "assistant", Content: "answer", NativeContent: content}}
	source, err := buildCompactionSource("", messages)
	if err != nil || strings.Contains(source, "opaque") || messages[0].NativeContent == nil {
		t.Fatalf("summary leaked native data: %s %v", source, err)
	}
	for _, protocol := range []string{util.OpenAIProtocolChatCompletions, util.OpenAIProtocolResponses, util.AnthropicProtocolMessages} {
		if runtimeCompactionMatchesProtocol(&runtimeCompaction{Protocol: util.GeminiProtocolInteractions}, protocol) ||
			runtimeCompactionMatchesProtocol(&runtimeCompaction{Protocol: protocol}, util.GeminiProtocolInteractions) {
			t.Fatal("native compaction was reused across protocols")
		}
	}
	before := estimateProtocolRequestTokens("test", util.GeminiProtocolInteractions, nil, nil, nil, nil)
	content.Blocks = []json.RawMessage{json.RawMessage(fmt.Sprintf(`{"type":"thought","signature":%q}`, strings.Repeat("opaque", 1000)))}
	after := estimateProtocolRequestTokens("test", util.GeminiProtocolInteractions, nil, messages, nil, nil)
	if after <= before {
		t.Fatal("native content was omitted from context estimate")
	}
}
