package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/88250/lute/ast"
	"github.com/sashabaranov/go-openai"
	"github.com/siyuan-note/siyuan/kernel/mcp/tools"
	kernelModel "github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAgentInstructionsTurnSnapshot(t *testing.T) {
	setupCompactionAgentTest(t)
	kernelModel.Conf.AI.Agent.MaxToolCallRounds = 1
	initial, err := util.SaveAgentInstructions("original-workspace-preference", "missing")
	if err != nil {
		t.Fatal(err)
	}
	const toolName = "test_instruction_snapshot"
	tools.SetTool(toolName, &tools.Tool{
		Name: toolName, Source: "native", ReadOnlyHint: true,
		InputSchema:   tools.ToolSchema{Type: "object", Properties: map[string]tools.Property{}},
		ActionEffects: map[string]tools.ToolEffects{"": {LocalRead: true}},
		Handler: func(args map[string]any) (tools.CallToolResult, error) {
			_, err := util.SaveAgentInstructions("changed-workspace-preference", initial.Revision)
			return tools.CallToolResult{Content: []tools.ContentItem{{Type: "text", Text: "done"}}}, err
		},
	})
	t.Cleanup(func() { tools.RemoveTool(toolName) })
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attempt := requests.Add(1)
		var request openai.ChatCompletionRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Error(err)
			return
		}
		want, absent := "original-workspace-preference", "changed-workspace-preference"
		if attempt > 2 {
			want, absent = absent, want
		}
		if len(request.Messages) == 0 || !strings.Contains(request.Messages[0].Content, want) || strings.Contains(request.Messages[0].Content, absent) {
			t.Errorf("request %d did not retain the correct instructions", attempt)
		}
		if attempt == 2 && len(request.Tools) != 0 {
			t.Error("instructions changed tool round limit")
		}
		if attempt == 1 {
			w.Header().Set("Content-Type", "text/event-stream")
			fmt.Fprintf(w, `data: {"id":"test","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call-instructions","type":"function","function":{"name":%q,"arguments":"{}"}}]},"finish_reason":"tool_calls"}]}`+"\n\ndata: [DONE]\n\n", toolName)
			return
		}
		writeAssistantContextStream(t, w, "", "done")
	}))
	defer server.Close()
	for i := 0; i < 2; i++ {
		sessionID := ast.NewNodeID()
		session := map[string]any{"id": sessionID, "title": "instructions", "createdAt": 1, "updatedAt": 1,
			"entries": []any{map[string]any{"id": "user-1", "type": "user", "content": "test preferences"}}}
		if _, err := SaveSession(marshalSession(t, session)); err != nil {
			t.Fatal(err)
		}
		for event := range AgentChat(context.Background(), newTestOpenAIClient(server.URL), "openai", "test-model", "", 0,
			sessionID, "user-1", 1, "test preferences", nil, "English", nil, EditorContext{}, nil, false,
			time.Second, 0, "", time.Second, time.Second) {
			if event.Type == "error" {
				t.Fatal(event.Error)
			}
		}
	}
	if requests.Load() != 3 {
		t.Fatalf("expected two requests then one: %d", requests.Load())
	}
}

func TestAgentInstructionsInvalidSourceStopsTurn(t *testing.T) {
	setupCompactionAgentTest(t)
	if _, err := util.SaveAgentInstructions("valid", "missing"); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(util.AgentInstructionsPath(), []byte{255}, 0644); err != nil {
		t.Fatal(err)
	}
	errorSeen := false
	for event := range AgentChat(context.Background(), nil, "openai", "test-model", "", 0,
		"", "", 0, "test", nil, "English", nil, EditorContext{}, nil, false,
		time.Second, 0, "", time.Second, time.Second) {
		if event.Type == "error" && strings.Contains(event.Error, "AGENTS.md") {
			errorSeen = true
		}
	}
	if !errorSeen {
		t.Fatal("invalid source did not report an error before provider access")
	}
}

func TestAgentInstructionsCompactionAndBudget(t *testing.T) {
	setupCompactionAgentTest(t)
	instructions := strings.Repeat("keep-citations ", 256)
	capabilities := currentCapabilitiesForTest(t)
	checkpoint := []AgentMessage{{Role: "user", Content: "current request"}}
	for _, compaction := range []*runtimeCompaction{nil, {Summary: "previous conversation"}, {Protocol: "openai-responses", ResponseOutput: []json.RawMessage{json.RawMessage(`{"type":"compaction","encrypted_content":"opaque"}`)}}} {
		messages := checkpointMessagesToOpenAIWithSummary(checkpoint, "English", capabilities, compaction, instructions)
		if !strings.Contains(messages[0].Content, instructions) {
			t.Fatal("compaction lost instructions")
		}
		base := checkpointMessagesToOpenAIWithSummary(checkpoint, "English", capabilities, compaction)
		if estimateChatRequestTokens("test-model", messages, nil) <= estimateChatRequestTokens("test-model", base, nil) {
			t.Fatal("instructions omitted from token budget")
		}
	}
	if buildSystemPrompt("English", capabilities, " \n") != buildSystemPrompt("English", capabilities) {
		t.Fatal("empty instructions changed prompt")
	}
}
