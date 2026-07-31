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
	"io"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/sashabaranov/go-openai"
	kernelConf "github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/mcp/tools"
	kernelModel "github.com/siyuan-note/siyuan/kernel/model"
)

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
		argumentsJSON        = "{\n  \"action\": \"list\",\n  \"limit\": 9007199254740993\n}"
		toolReasoning        = "I need to call the test tool."
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
				`data: {"id":"chatcmpl-tool","object":"chat.completion.chunk","created":1,"model":"test-model","choices":[{"index":0,"delta":{"reasoning_content":%q,"tool_calls":[{"index":0,"id":%q,"type":"function","function":{"name":%q,"arguments":%q}}]},"finish_reason":"tool_calls"}]}`+"\n\n",
				toolReasoning, toolCallID, toolName, argumentsJSON,
			)
			if _, err = io.WriteString(w, chunk); err != nil {
				t.Errorf("write tool response failed: %v", err)
				return
			}
			flusher.Flush()
			writeTestStreamDone(t, w, flusher)
		case 2:
			assertRestoredAssistantContext(t, request.Messages, toolName, toolCallID, argumentsJSON, toolReasoning, "")
			writeAssistantContextStream(t, w, firstFinalReasoning, "first answer")
		case 3:
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
		context.Background(), newTestOpenAIClient(server.URL), "test-model", "", 0, testSessionID, "user-1", 1,
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
		context.Background(), newTestOpenAIClient(server.URL), "test-model", "", 0, testSessionID, "user-2", 3,
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
			toolAssistantFound = message.ReasoningContent == toolReasoning &&
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
