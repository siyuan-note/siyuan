// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	kernelConf "github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/mcp/tools"
	kernelModel "github.com/siyuan-note/siyuan/kernel/model"
)

const testGeminiThoughtSignatureFallback = "skip_thought_signature_validator"

func TestAgentChatPreservesUnindexedParallelGeminiToolCalls(t *testing.T) {
	useTestDataDir(t)
	originalConf := kernelModel.Conf
	kernelModel.Conf = kernelModel.NewAppConf()
	kernelModel.Conf.AI = kernelConf.NewAI()
	kernelModel.Conf.AI.MCP = nil
	kernelModel.Conf.AI.Agent.MaxToolCallRounds = 1
	kernelModel.Conf.Variables = kernelConf.NewVariables()
	t.Cleanup(func() { kernelModel.Conf = originalConf })

	const (
		toolName         = "test_gemini_parallel_context"
		firstCallID      = "call-first"
		secondCallID     = "call-second"
		thoughtSignature = "gemini-parallel-signature"
		firstArguments   = `{"value":"first"}`
		secondArguments  = `{"value":"second"}`
	)
	var executed atomic.Int32
	tools.SetTool(toolName, &tools.Tool{
		Name:         toolName,
		Source:       "native",
		ReadOnlyHint: true,
		InputSchema: tools.ToolSchema{
			Type: "object",
			Properties: map[string]tools.Property{
				"value": {Type: "string"},
			},
			Required: []string{"value"},
		},
		ActionEffects: map[string]tools.ToolEffects{
			"": {LocalRead: true},
		},
		Handler: func(args map[string]any) (tools.CallToolResult, error) {
			value, _ := args["value"].(string)
			if value != "first" && value != "second" {
				t.Errorf("unexpected tool value: %q", value)
			}
			executed.Add(1)
			return tools.CallToolResult{Content: []tools.ContentItem{{Type: "text", Text: "ok"}}}, nil
		},
	})
	t.Cleanup(func() { tools.RemoveTool(toolName) })

	session := map[string]any{
		"id":        testSessionID,
		"title":     "parallel Gemini tools test",
		"createdAt": int64(1),
		"updatedAt": int64(1),
		"entries":   []any{map[string]any{"id": "user-1", "type": "user", "content": "use both tools"}},
	}
	if revision, err := SaveSession(marshalSession(t, session)); err != nil || revision != 1 {
		t.Fatalf("save initial session failed: revision=%d, err=%v", revision, err)
	}

	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attempt := requests.Add(1)
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Errorf("read request failed: %v", err)
			return
		}
		switch attempt {
		case 1:
			flusher := prepareTestStream(t, w)
			chunk := fmt.Sprintf(
				`data: {"id":"chatcmpl-tools","object":"chat.completion.chunk","created":1,"model":"test-model","choices":[{"index":0,"delta":{"tool_calls":[{"id":%q,"type":"function","function":{"name":%q,"arguments":%q},"extra_content":{"google":{"thought_signature":%q}}},{"id":%q,"type":"function","function":{"name":%q,"arguments":%q}}]},"finish_reason":"tool_calls"}]}`+"\n\n",
				firstCallID, toolName, firstArguments, thoughtSignature,
				secondCallID, toolName, secondArguments,
			)
			if _, err = io.WriteString(w, chunk); err != nil {
				t.Errorf("write tool response failed: %v", err)
				return
			}
			flusher.Flush()
			writeTestStreamDone(t, w, flusher)
		case 2:
			assertParallelGeminiToolHistory(t, body, toolName, firstCallID, secondCallID,
				firstArguments, secondArguments, thoughtSignature)
			writeAssistantContextStream(t, w, "", "done")
		default:
			t.Errorf("unexpected request attempt: %d", attempt)
		}
	}))
	defer server.Close()

	events := AgentChat(
		context.Background(), newTestGeminiOpenAIClient(server.URL), "openai", "models/gemini-3.7-flash", "", 0,
		testSessionID, "user-1", 1,
		"use both tools", nil, "English", nil, EditorContext{}, nil, false, time.Second, 0, "", time.Second, time.Second,
	)
	for event := range events {
		if event.Type == "error" {
			t.Fatalf("agent turn failed: %s", event.Error)
		}
	}
	if requests.Load() != 2 || executed.Load() != 2 {
		t.Fatalf("unexpected request or execution count: requests=%d, executed=%d", requests.Load(), executed.Load())
	}
}

func assertParallelGeminiToolHistory(t *testing.T, body []byte, toolName, firstCallID, secondCallID,
	firstArguments, secondArguments, thoughtSignature string) {
	t.Helper()
	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		t.Fatal(err)
	}
	messages, _ := payload["messages"].([]any)
	wantArguments := map[string]string{firstCallID: firstArguments, secondCallID: secondArguments}
	wantSignatures := map[string]string{
		firstCallID:  thoughtSignature,
		secondCallID: testGeminiThoughtSignatureFallback,
	}
	foundCalls := map[string]bool{}
	foundResults := map[string]bool{}
	for _, rawMessage := range messages {
		message, _ := rawMessage.(map[string]any)
		if message["role"] == "assistant" {
			toolCalls, _ := message["tool_calls"].([]any)
			for _, rawToolCall := range toolCalls {
				toolCall, _ := rawToolCall.(map[string]any)
				callID, _ := toolCall["id"].(string)
				function, _ := toolCall["function"].(map[string]any)
				if _, ok := wantArguments[callID]; !ok || function["name"] != toolName {
					continue
				}
				if function["arguments"] != wantArguments[callID] {
					t.Errorf("unexpected arguments for %s: %v", callID, function["arguments"])
				}
				if signature := geminiThoughtSignatureForTest(toolCall); signature != wantSignatures[callID] {
					t.Errorf("unexpected signature for %s: %q", callID, signature)
				}
				foundCalls[callID] = true
			}
		}
		if message["role"] == "tool" {
			callID, _ := message["tool_call_id"].(string)
			if _, ok := wantArguments[callID]; ok {
				foundResults[callID] = true
			}
		}
	}
	for callID := range wantArguments {
		if !foundCalls[callID] || !foundResults[callID] {
			t.Errorf("parallel tool history is incomplete for %s", callID)
		}
	}
}
