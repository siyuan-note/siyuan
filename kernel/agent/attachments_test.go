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
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/sashabaranov/go-openai"
	kernelConf "github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/mcp/tools"
	kernelModel "github.com/siyuan-note/siyuan/kernel/model"
)

func testAgentAttachment() AgentAttachment {
	return AgentAttachment{
		Type:       "image",
		Data:       []byte("image-data"),
		MIMEType:   "image/png",
		Path:       "assets/diagram.png",
		DocumentID: "20260730120000-abcdefg",
		Prompt:     "Explain the diagram",
		Detail:     "high",
		Width:      640,
		Height:     480,
	}
}

func TestBuildAttachmentMessageUsesImageContent(t *testing.T) {
	message, ok := buildAttachmentMessage([]AgentAttachment{testAgentAttachment()})
	if !ok || message.Role != openai.ChatMessageRoleUser || len(message.MultiContent) != 2 {
		t.Fatalf("unexpected attachment message: %#v", message)
	}
	if message.MultiContent[0].Type != openai.ChatMessagePartTypeText ||
		!strings.Contains(message.MultiContent[0].Text, "Explain the diagram") {
		t.Fatalf("attachment task is missing: %#v", message.MultiContent[0])
	}
	image := message.MultiContent[1]
	if image.Type != openai.ChatMessagePartTypeImageURL || image.ImageURL == nil ||
		image.ImageURL.Detail != openai.ImageURLDetailHigh ||
		image.ImageURL.URL != "data:image/png;base64,aW1hZ2UtZGF0YQ==" {
		t.Fatalf("unexpected image content: %#v", image)
	}
	encoded, err := json.Marshal(message)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(encoded), `"content":[`) || strings.Contains(string(encoded), `"content":"`) {
		t.Fatalf("attachment message was not encoded as multipart content: %s", encoded)
	}
}

func TestCheckpointRestoresAttachmentAfterToolResults(t *testing.T) {
	checkpoint := []AgentMessage{{
		Role: "assistant",
		ToolCalls: []AgentToolCall{{
			ID:          "call-image",
			Name:        "image",
			Arguments:   map[string]any{"action": "analyze"},
			Result:      "[tool_output]attached[/tool_output]",
			State:       "finished",
			Attachments: []AgentAttachment{testAgentAttachment()},
		}},
	}}
	messages := checkpointMessagesToOpenAI(checkpoint, "English", nil)
	if len(messages) != 4 {
		t.Fatalf("unexpected restored message count: %d", len(messages))
	}
	if messages[1].Role != openai.ChatMessageRoleAssistant ||
		messages[2].Role != openai.ChatMessageRoleTool ||
		!isAttachmentMessage(messages[3]) {
		t.Fatalf("attachment was not restored after tool results: %#v", messages)
	}
}

func TestAttachmentDataIsNotPersisted(t *testing.T) {
	data, err := json.Marshal(AgentToolCall{Attachments: []AgentAttachment{testAgentAttachment()}})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(data), "image-data") || !strings.Contains(string(data), "assets/diagram.png") {
		t.Fatalf("attachment persistence contains bytes or lost its descriptor: %s", data)
	}
}

func TestCompactionDoesNotCountAttachmentAsUserTurn(t *testing.T) {
	attachmentMessage, _ := buildAttachmentMessage([]AgentAttachment{testAgentAttachment()})
	messages := []openai.ChatCompletionMessage{
		{Role: openai.ChatMessageRoleSystem, Content: "system"},
		{Role: openai.ChatMessageRoleUser, Content: "first"},
		{Role: openai.ChatMessageRoleAssistant, Content: "tool call"},
		attachmentMessage,
		{Role: openai.ChatMessageRoleAssistant, Content: "first answer"},
		{Role: openai.ChatMessageRoleUser, Content: "second"},
	}
	compacted := compactMessages(messages, 2)
	if len(compacted) != len(messages) {
		t.Fatalf("attachment was counted as a logical user turn: %#v", compacted)
	}
}

func TestAttachmentRequestSurfacesUpstreamError(t *testing.T) {
	originalConf := kernelModel.Conf
	kernelModel.Conf = kernelModel.NewAppConf()
	t.Cleanup(func() { kernelModel.Conf = originalConf })

	attachmentMessage, _ := buildAttachmentMessage([]AgentAttachment{testAgentAttachment()})
	err := &openai.APIError{Message: "image input is not supported"}
	message := getAgentRequestErrorMessage(err, []openai.ChatCompletionMessage{attachmentMessage})
	if !strings.Contains(message, err.Message) {
		t.Fatalf("upstream attachment error was hidden: %q", message)
	}
}

func TestAgentChatSendsToolAttachmentToCurrentModel(t *testing.T) {
	useTestDataDir(t)
	originalConf := kernelModel.Conf
	kernelModel.Conf = kernelModel.NewAppConf()
	kernelModel.Conf.AI = kernelConf.NewAI()
	kernelModel.Conf.AI.MCP = nil
	kernelModel.Conf.AI.Agent.MaxToolCallRounds = 3
	kernelModel.Conf.Variables = kernelConf.NewVariables()
	t.Cleanup(func() { kernelModel.Conf = originalConf })

	const toolName = "test_current_model_image"
	tools.SetTool(toolName, &tools.Tool{
		Name:   toolName,
		Source: "native",
		InputSchema: tools.ToolSchema{
			Type: "object",
			Properties: map[string]tools.Property{
				"action": {Type: "string"},
			},
		},
		ActionEffects: map[string]tools.ToolEffects{
			"list": {LocalRead: true},
		},
		Handler: func(args map[string]any) (tools.CallToolResult, error) {
			return tools.CallToolResult{
				Content: []tools.ContentItem{{Type: "text", Text: `{"attached":true}`}},
				ModelAttachments: []tools.ModelAttachment{{
					Type:       "image",
					Data:       []byte("image"),
					MIMEType:   "image/png",
					Path:       "assets/image.png",
					DocumentID: "20260730120000-abcdefg",
					Prompt:     "Describe it",
					Width:      10,
					Height:     10,
				}},
			}, nil
		},
	})
	t.Cleanup(func() { tools.RemoveTool(toolName) })

	session := map[string]any{
		"id":        testSessionID,
		"title":     "attachment test",
		"createdAt": int64(1),
		"updatedAt": int64(1),
		"entries":   []any{map[string]any{"id": "user-1", "type": "user", "content": "look at the image"}},
	}
	if revision, err := SaveSession(marshalSession(t, session)); err != nil || revision != 1 {
		t.Fatalf("save initial session failed: revision=%d, err=%v", revision, err)
	}

	var requests atomic.Int32
	var attachmentSeen atomic.Bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attempt := requests.Add(1)
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Errorf("read request failed: %v", err)
			return
		}
		flusher := prepareTestStream(t, w)
		if attempt == 1 {
			toolCallChunk := fmt.Sprintf(
				`data: {"id":"chatcmpl-test","object":"chat.completion.chunk","created":1,"model":"test-model","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call-image","type":"function","function":{"name":%q,"arguments":"{\"action\":\"list\"}"}}]},"finish_reason":"tool_calls"}]}`+"\n\n",
				toolName,
			)
			if _, err = io.WriteString(w, toolCallChunk); err != nil {
				t.Errorf("write tool call failed: %v", err)
				return
			}
			flusher.Flush()
			writeTestStreamDone(t, w, flusher)
			return
		}
		if strings.Contains(string(body), `"url":"data:image/png;base64,aW1hZ2U="`) {
			attachmentSeen.Store(true)
		}
		writeTestStreamChunk(t, w, flusher, "image understood")
		writeTestStreamDone(t, w, flusher)
	}))
	defer server.Close()

	events := AgentChat(
		context.Background(), newTestOpenAIClient(server.URL), "test-model", 0, testSessionID, "user-1", 1,
		"look at the image", "English", nil, EditorContext{}, nil, false, time.Second, 0, "", time.Second, time.Second,
	)
	doneSeen := false
	for event := range events {
		if event.Type == "done" {
			doneSeen = true
		}
	}
	if requests.Load() != 2 || !attachmentSeen.Load() || !doneSeen {
		t.Fatalf(
			"attachment did not reach current model: requests=%d, attachmentSeen=%v, doneSeen=%v",
			requests.Load(), attachmentSeen.Load(), doneSeen,
		)
	}
}
