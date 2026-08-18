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
	"fmt"
	"io"
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

func TestResponsesContextPreservesEncryptedReasoningAndToolOutput(t *testing.T) {
	responseOutput := []json.RawMessage{
		json.RawMessage("{\"id\":\"rs_1\",\"type\":\"reasoning\",\"encrypted_content\":\"secret\"}"),
		json.RawMessage("{\"id\":\"fc_1\",\"type\":\"function_call\",\"call_id\":\"call_1\"," +
			"\"name\":\"lookup\",\"arguments\":\"{}\"}"),
	}
	messages := []AgentMessage{{
		Role:                 "assistant",
		Content:              "fallback content must not be rebuilt",
		ResponseOutput:       responseOutput,
		ResponseOutputTokens: 42,
		ToolCalls: []AgentToolCall{{
			ID: "call_1", Name: "lookup", ArgumentsJSON: "{}", Result: "done",
		}},
	}}
	input := checkpointMessagesToOpenAIResponseInput(messages, "English", nil, nil, false)
	data, err := json.Marshal(input)
	if err != nil {
		t.Fatal(err)
	}
	payload := string(data)
	for _, expected := range []string{
		"\"encrypted_content\":\"secret\"",
		"\"type\":\"function_call\"",
		"\"type\":\"function_call_output\"",
		"\"call_id\":\"call_1\"",
		"\"output\":\"done\"",
	} {
		if !strings.Contains(payload, expected) {
			t.Fatalf("Responses context missing %s: %s", expected, payload)
		}
	}
	if strings.Contains(payload, "fallback content must not be rebuilt") {
		t.Fatalf("Responses output was duplicated as a reconstructed message: %s", payload)
	}

	restored := entriesToAgentMessages(agentMessagesToEntries(messages))
	if len(restored) != 1 || len(restored[0].ResponseOutput) != 2 || restored[0].ResponseOutputTokens != 42 {
		t.Fatalf("Responses output was lost during entry persistence: %#v", restored)
	}
}

func TestAgentChatResponsesToolContextSurvivesCommit(t *testing.T) {
	useTestDataDir(t)
	originalConf := kernelModel.Conf
	kernelModel.Conf = kernelModel.NewAppConf()
	kernelModel.Conf.AI = kernelConf.NewAI()
	kernelModel.Conf.AI.MCP = nil
	kernelModel.Conf.AI.Agent.MaxToolCallRounds = 2
	kernelModel.Conf.Variables = kernelConf.NewVariables()
	t.Cleanup(func() { kernelModel.Conf = originalConf })

	const (
		toolName   = "test_responses_context"
		toolCallID = "call-responses"
		arguments  = `{"action":"list"}`
	)
	tools.SetTool(toolName, &tools.Tool{
		Name:         toolName,
		Source:       "native",
		ReadOnlyHint: true,
		InputSchema: tools.ToolSchema{
			Type: "object",
			Properties: map[string]tools.Property{
				"action": {Type: "string"},
			},
		},
		ActionEffects: map[string]tools.ToolEffects{
			"list": {LocalRead: true},
		},
		Handler: func(map[string]any) (tools.CallToolResult, error) {
			return tools.CallToolResult{
				Content: []tools.ContentItem{{Type: "text", Text: `{"ok":true}`}},
			}, nil
		},
	})
	t.Cleanup(func() { tools.RemoveTool(toolName) })

	session := map[string]any{
		"id":        testSessionID,
		"title":     "Responses context test",
		"createdAt": int64(1),
		"updatedAt": int64(1),
		"entries":   []any{map[string]any{"id": "user-1", "type": "user", "content": "use the tool"}},
	}
	if revision, err := SaveSession(marshalSession(t, session)); err != nil || revision != 1 {
		t.Fatalf("save initial session failed: revision=%d, err=%v", revision, err)
	}

	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/responses" {
			t.Errorf("unexpected Responses path: %s", r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
			return
		}
		var request map[string]any
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Errorf("decode Responses request failed: %v", err)
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		inputData, err := json.Marshal(request["input"])
		if err != nil {
			t.Errorf("encode Responses input failed: %v", err)
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		input := string(inputData)
		attempt := requests.Add(1)
		flusher := prepareTestStream(t, w)
		switch attempt {
		case 1:
			writeResponsesTestEvent(t, w, flusher, "response.output_item.added", map[string]any{
				"type": "response.output_item.added", "output_index": 1,
				"item": map[string]any{
					"id": "fc-1", "type": "function_call", "status": "in_progress",
					"call_id": toolCallID, "name": toolName, "arguments": "",
				},
			})
			writeResponsesTestEvent(t, w, flusher, "response.function_call_arguments.delta", map[string]any{
				"type": "response.function_call_arguments.delta", "output_index": 1,
				"item_id": "fc-1", "delta": arguments,
			})
			writeResponsesTestCompleted(t, w, flusher, "resp-tool", []any{
				map[string]any{"id": "rs-1", "type": "reasoning", "encrypted_content": "secret-tool"},
				map[string]any{
					"id": "fc-1", "type": "function_call", "status": "completed",
					"call_id": toolCallID, "name": toolName, "arguments": arguments,
				},
			}, 20, 12)
		case 2:
			for _, expected := range []string{
				`"encrypted_content":"secret-tool"`, `"type":"function_call_output"`,
				`"call_id":"call-responses"`,
			} {
				if !strings.Contains(input, expected) {
					t.Errorf("second Responses request missing %s: %s", expected, input)
				}
			}
			toolOutputFound := false
			if items, ok := request["input"].([]any); ok {
				for _, raw := range items {
					item, ok := raw.(map[string]any)
					if !ok || item["type"] != "function_call_output" || item["call_id"] != toolCallID {
						continue
					}
					output, _ := item["output"].(string)
					toolOutputFound = strings.Contains(output, `"ok":true`)
				}
			}
			if !toolOutputFound {
				t.Errorf("second Responses request missing tool output: %s", input)
			}
			writeResponsesTestEvent(t, w, flusher, "response.reasoning_summary_text.delta", map[string]any{
				"type": "response.reasoning_summary_text.delta", "output_index": 0, "delta": "summary one",
			})
			writeResponsesTestEvent(t, w, flusher, "response.output_text.delta", map[string]any{
				"type": "response.output_text.delta", "output_index": 1, "delta": "first answer",
			})
			writeResponsesTestCompleted(t, w, flusher, "resp-final", []any{
				map[string]any{
					"id": "rs-2", "type": "reasoning", "encrypted_content": "secret-final",
					"summary": []any{map[string]any{"type": "summary_text", "text": "summary one"}},
				},
				map[string]any{
					"id": "msg-1", "type": "message", "role": "assistant", "status": "completed",
					"content": []any{map[string]any{"type": "output_text", "text": "first answer"}},
				},
			}, 40, 8)
		case 3:
			for _, expected := range []string{
				`"encrypted_content":"secret-tool"`, `"encrypted_content":"secret-final"`,
				`"type":"function_call_output"`, `"content":"continue"`,
			} {
				if !strings.Contains(input, expected) {
					t.Errorf("committed Responses context missing %s: %s", expected, input)
				}
			}
			writeResponsesTestEvent(t, w, flusher, "response.output_text.delta", map[string]any{
				"type": "response.output_text.delta", "output_index": 0, "delta": "second answer",
			})
			writeResponsesTestCompleted(t, w, flusher, "resp-second", []any{
				map[string]any{
					"id": "msg-2", "type": "message", "role": "assistant", "status": "completed",
					"content": []any{map[string]any{"type": "output_text", "text": "second answer"}},
				},
			}, 50, 4)
		default:
			t.Errorf("unexpected Responses request attempt: %d", attempt)
		}
	}))
	defer server.Close()

	firstTurnID := ""
	events := AgentChat(
		context.Background(), newTestOpenAIClient(server.URL), "openai-responses", "test-model", "", 0,
		testSessionID, "user-1", 1, "use the tool", nil, "English", nil, EditorContext{}, nil, false,
		time.Second, 0, "", time.Second, time.Second,
	)
	for event := range events {
		if event.Type == "turn" {
			firstTurnID = event.TurnID
		}
		if event.Type == "error" {
			t.Fatalf("first Responses agent turn failed: %s", event.Error)
		}
	}
	if firstTurnID == "" {
		t.Fatal("first Responses agent turn did not expose its turn ID")
	}

	recovered, err := GetSession(testSessionID)
	if err != nil {
		t.Fatal(err)
	}
	recovered["expectedRevision"] = int64(1)
	recovered["commitTurnID"] = firstTurnID
	revision, canonical, err := SaveSessionState(marshalSession(t, recovered))
	if err != nil || revision != 2 {
		t.Fatalf("commit Responses agent turn failed: revision=%d, err=%v", revision, err)
	}
	canonicalData, err := json.Marshal(canonical)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(canonicalData), "secret-tool") ||
		!strings.Contains(string(canonicalData), "responseOutputTokens") {
		t.Fatalf("Responses output was lost during runtime commit: %s", canonicalData)
	}

	entries := canonical["entries"].([]any)
	canonical["entries"] = append(entries, map[string]any{
		"id": "user-2", "type": "user", "content": "continue",
	})
	canonical["expectedRevision"] = int64(2)
	if revision, err = SaveSession(marshalSession(t, canonical)); err != nil || revision != 3 {
		t.Fatalf("save Responses follow-up failed: revision=%d, err=%v", revision, err)
	}

	events = AgentChat(
		context.Background(), newTestOpenAIClient(server.URL), "openai-responses", "test-model", "", 0,
		testSessionID, "user-2", 3, "continue", nil, "English", nil, EditorContext{}, nil, false,
		time.Second, 0, "", time.Second, time.Second,
	)
	for event := range events {
		if event.Type == "error" {
			t.Fatalf("second Responses agent turn failed: %s", event.Error)
		}
	}
	if requests.Load() != 3 {
		t.Fatalf("unexpected Responses request count: %d", requests.Load())
	}
}

func writeResponsesTestEvent(t *testing.T, w http.ResponseWriter, flusher http.Flusher, eventType string, event any) {
	t.Helper()
	data, err := json.Marshal(event)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = fmt.Fprintf(w, "event: %s\ndata: %s\n\n", eventType, data); err != nil {
		t.Errorf("write Responses event failed: %v", err)
		return
	}
	flusher.Flush()
}

func writeResponsesTestCompleted(t *testing.T, w http.ResponseWriter, flusher http.Flusher, id string,
	output []any, inputTokens, outputTokens int) {
	t.Helper()
	writeResponsesTestEvent(t, w, flusher, "response.completed", map[string]any{
		"type": "response.completed",
		"response": map[string]any{
			"id": id, "object": "response", "status": "completed", "model": "test-model", "output": output,
			"usage": map[string]any{
				"input_tokens": inputTokens, "output_tokens": outputTokens,
				"total_tokens": inputTokens + outputTokens,
			},
		},
	})
}

func TestAgentChatRestoresCompleteAssistantContextAfterCommit(t *testing.T) {
	useTestDataDir(t)
	originalConf := kernelModel.Conf
	kernelModel.Conf = kernelModel.NewAppConf()
	kernelModel.Conf.AI = kernelConf.NewAI()
	kernelModel.Conf.AI.MCP = nil
	kernelModel.Conf.AI.Agent.MaxToolCallRounds = 2
	kernelModel.Conf.Variables = kernelConf.NewVariables()
	t.Cleanup(func() { kernelModel.Conf = originalConf })

	const (
		toolName             = "test_assistant_context"
		toolCallID           = "call-original"
		thoughtSignature     = "gemini-thought-signature"
		argumentsJSON        = "{\n  \"action\": \"list\",\n  \"limit\": 9007199254740993\n}"
		toolReasoning        = "I need to call the test tool."
		taggedToolReasoning  = "<thought>" + toolReasoning + "</thought>"
		firstFinalReasoning  = "The tool result is sufficient."
		secondFinalReasoning = "I can answer from the restored context."
	)
	tools.SetTool(toolName, &tools.Tool{
		Name:         toolName,
		Source:       "native",
		ReadOnlyHint: true,
		InputSchema: tools.ToolSchema{
			Type: "object",
			Properties: map[string]tools.Property{
				"action": {Type: "string"},
				"limit":  {Type: "integer"},
			},
		},
		ActionEffects: map[string]tools.ToolEffects{
			"list": {LocalRead: true},
		},
		Handler: func(map[string]any) (tools.CallToolResult, error) {
			return tools.CallToolResult{
				Content: []tools.ContentItem{{Type: "text", Text: `{"ok":true}`}},
			}, nil
		},
	})
	t.Cleanup(func() { tools.RemoveTool(toolName) })

	session := map[string]any{
		"id":        testSessionID,
		"title":     "assistant context test",
		"createdAt": int64(1),
		"updatedAt": int64(1),
		"entries":   []any{map[string]any{"id": "user-1", "type": "user", "content": "use the tool"}},
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
		var request openai.ChatCompletionRequest
		if err = json.Unmarshal(body, &request); err != nil {
			t.Errorf("decode request failed: %v", err)
			return
		}

		switch attempt {
		case 1:
			flusher := prepareTestStream(t, w)
			chunk := fmt.Sprintf(
				`data: {"id":"chatcmpl-tool","object":"chat.completion.chunk","created":1,"model":"test-model","choices":[{"index":0,"delta":{"content":%q,"tool_calls":[{"index":0,"id":%q,"function":{"name":%q,"arguments":%q},"extra_content":{"google":{"thought_signature":%q}}}]},"finish_reason":"tool_calls"}]}`+"\n\n",
				taggedToolReasoning, toolCallID, toolName, argumentsJSON, thoughtSignature,
			)
			if _, err = io.WriteString(w, chunk); err != nil {
				t.Errorf("write tool response failed: %v", err)
				return
			}
			flusher.Flush()
			writeTestStreamDone(t, w, flusher)
		case 2:
			assertGeminiThoughtSignatureInRequest(t, body, toolCallID, thoughtSignature)
			assertRestoredAssistantContext(t, request.Messages, toolName, toolCallID, argumentsJSON, toolReasoning, "")
			writeAssistantContextStream(t, w, firstFinalReasoning, "first answer")
		case 3:
			assertGeminiThoughtSignatureInRequest(t, body, toolCallID, thoughtSignature)
			assertRestoredAssistantContext(
				t, request.Messages, toolName, toolCallID, argumentsJSON, toolReasoning, firstFinalReasoning,
			)
			writeAssistantContextStream(t, w, secondFinalReasoning, "second answer")
		default:
			t.Errorf("unexpected request attempt: %d", attempt)
		}
	}))
	defer server.Close()

	firstTurnID := ""
	events := AgentChat(
		context.Background(), newTestGeminiOpenAIClient(server.URL), "openai", "models/gemini-3.5-flash", "", 0,
		testSessionID, "user-1", 1,
		"use the tool", nil, "English", nil, EditorContext{}, nil, false, time.Second, 0, "", time.Second, time.Second,
	)
	for event := range events {
		if event.Type == "turn" {
			firstTurnID = event.TurnID
		}
		if event.Type == "error" {
			t.Fatalf("first agent turn failed: %s", event.Error)
		}
	}
	if firstTurnID == "" {
		t.Fatal("first agent turn did not expose its turn ID")
	}

	recovered, err := GetSession(testSessionID)
	if err != nil {
		t.Fatal(err)
	}
	recovered["expectedRevision"] = int64(1)
	recovered["commitTurnID"] = firstTurnID
	revision, canonical, err := SaveSessionState(marshalSession(t, recovered))
	if err != nil || revision != 2 {
		t.Fatalf("commit first agent turn failed: revision=%d, err=%v", revision, err)
	}
	canonicalJSON, err := json.Marshal(canonical)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(canonicalJSON), `"thoughtSignature":"`+thoughtSignature+`"`) {
		t.Fatalf("thought signature was not persisted: %s", canonicalJSON)
	}

	entries := canonical["entries"].([]any)
	canonical["entries"] = append(entries, map[string]any{
		"id": "user-2", "type": "user", "content": "continue",
	})
	canonical["expectedRevision"] = int64(2)
	revision, err = SaveSession(marshalSession(t, canonical))
	if err != nil || revision != 3 {
		t.Fatalf("save follow-up user message failed: revision=%d, err=%v", revision, err)
	}

	events = AgentChat(
		context.Background(), newTestGeminiOpenAIClient(server.URL), "openai", "models/gemini-3.5-flash", "", 0,
		testSessionID, "user-2", 3,
		"continue", nil, "English", nil, EditorContext{}, nil, false, time.Second, 0, "", time.Second, time.Second,
	)
	for event := range events {
		if event.Type == "error" {
			t.Fatalf("second agent turn failed: %s", event.Error)
		}
	}
	if requests.Load() != 3 {
		t.Fatalf("unexpected request count: %d", requests.Load())
	}

	runtime, err := loadRuntimeState(testSessionID)
	if err != nil {
		t.Fatal(err)
	}
	if runtime.ActiveTurn == nil || len(runtime.ActiveTurn.Delta) != 1 ||
		runtime.ActiveTurn.Delta[0].ReasoningContent != secondFinalReasoning {
		t.Fatalf("follow-up reasoning was not checkpointed: %#v", runtime.ActiveTurn)
	}
}

func newTestGeminiOpenAIClient(serverURL string) *openai.Client {
	config := openai.DefaultConfig("test-key")
	config.BaseURL = serverURL + "/v1"
	config.HTTPClient = util.WrapGeminiThoughtSignatureTransport(http.DefaultClient)
	return openai.NewClientWithConfig(config)
}

func assertGeminiThoughtSignatureInRequest(t *testing.T, body []byte, callID, want string) {
	t.Helper()
	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		t.Fatal(err)
	}
	messages, _ := payload["messages"].([]any)
	for _, rawMessage := range messages {
		message, _ := rawMessage.(map[string]any)
		toolCalls, _ := message["tool_calls"].([]any)
		for _, rawToolCall := range toolCalls {
			toolCall, _ := rawToolCall.(map[string]any)
			if toolCall["id"] == callID {
				if got := geminiThoughtSignatureForTest(toolCall); got != want {
					t.Fatalf("thought signature = %q, want %q", got, want)
				}
				return
			}
		}
	}
	t.Fatalf("tool call %q was not found in request", callID)
}

func geminiThoughtSignatureForTest(toolCall map[string]any) string {
	extraContent, _ := toolCall["extra_content"].(map[string]any)
	google, _ := extraContent["google"].(map[string]any)
	signature, _ := google["thought_signature"].(string)
	return signature
}

func assertRestoredAssistantContext(
	t *testing.T,
	messages []openai.ChatCompletionMessage,
	toolName, toolCallID, argumentsJSON, toolReasoning, finalReasoning string,
) {
	t.Helper()
	toolAssistantFound := false
	finalAssistantFound := finalReasoning == ""
	for _, message := range messages {
		if message.Role != openai.ChatMessageRoleAssistant {
			continue
		}
		if len(message.ToolCalls) == 1 && message.ToolCalls[0].Function.Name == toolName {
			toolAssistantFound = message.Content == "" && message.ReasoningContent == toolReasoning &&
				message.ToolCalls[0].ID == toolCallID &&
				message.ToolCalls[0].Function.Arguments == argumentsJSON
		}
		if finalReasoning != "" && message.Content == "first answer" {
			finalAssistantFound = message.ReasoningContent == finalReasoning
		}
	}
	if !toolAssistantFound || !finalAssistantFound {
		t.Errorf("assistant context was not restored exactly: %#v", messages)
	}
}

func writeAssistantContextStream(t *testing.T, w http.ResponseWriter, reasoning, content string) {
	t.Helper()
	flusher := prepareTestStream(t, w)
	chunk := fmt.Sprintf(
		`data: {"id":"chatcmpl-final","object":"chat.completion.chunk","created":1,"model":"test-model","choices":[{"index":0,"delta":{"reasoning_content":%q,"content":%q},"finish_reason":"stop"}]}`+"\n\n",
		reasoning, content,
	)
	if _, err := io.WriteString(w, chunk); err != nil {
		t.Errorf("write assistant response failed: %v", err)
		return
	}
	flusher.Flush()
	writeTestStreamDone(t, w, flusher)
}
