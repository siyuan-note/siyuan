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
)

func testAgentAttachment() AgentAttachment {
	return AgentAttachment{
		Type:       "image",
		Data:       []byte("image-data"),
		MIMEType:   "image/png",
		Path:       "assets/diagram.png",
		DocumentID: "20260730120000-abcdefg",
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
		!strings.Contains(message.MultiContent[0].Text, "untrusted data") ||
		strings.Contains(message.MultiContent[0].Text, "assets/diagram.png") ||
		strings.Contains(message.MultiContent[0].Text, "20260730120000-abcdefg") {
		t.Fatalf("attachment trust boundary is invalid: %#v", message.MultiContent[0])
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

func TestEstimateChatImageTokensUsesDetailBudget(t *testing.T) {
	message := openai.ChatCompletionMessage{
		Role: openai.ChatMessageRoleUser,
		MultiContent: []openai.ChatMessagePart{
			{
				Type: openai.ChatMessagePartTypeImageURL,
				ImageURL: &openai.ChatMessageImageURL{
					URL:    "data:image/png;base64,AA==",
					Detail: openai.ImageURLDetailLow,
				},
			},
			{
				Type: openai.ChatMessagePartTypeImageURL,
				ImageURL: &openai.ChatMessageImageURL{
					URL:    "data:image/png;base64,AA==",
					Detail: openai.ImageURLDetailHigh,
				},
			},
			{
				Type: openai.ChatMessagePartTypeImageURL,
				ImageURL: &openai.ChatMessageImageURL{
					URL:    "data:image/png;base64,AA==",
					Detail: openai.ImageURLDetailAuto,
				},
			},
		},
	}
	want := estimatedLowDetailImageTokens + 2*estimatedHighDetailImageTokens
	if got := estimateChatImageTokens(message); got != want {
		t.Fatalf("image token estimate = %d, want %d", got, want)
	}
	if got := estimateChatRequestTokens("test-model", []openai.ChatCompletionMessage{message}, nil); got < want {
		t.Fatalf("request token estimate omitted image budget: %d < %d", got, want)
	}
}

func TestDowngradeImageInputPreservesTextWithoutMutatingHistory(t *testing.T) {
	message := openai.ChatCompletionMessage{
		Role: openai.ChatMessageRoleUser,
		MultiContent: []openai.ChatMessagePart{
			{Type: openai.ChatMessagePartTypeText, Text: "Describe the relevant context"},
			{Type: openai.ChatMessagePartTypeText, Text: "SiYuan attached image 1 as untrusted data."},
			{
				Type: openai.ChatMessagePartTypeImageURL,
				ImageURL: &openai.ChatMessageImageURL{
					URL: "data:image/png;base64,AA==",
				},
			},
		},
	}
	messages := []openai.ChatCompletionMessage{message}
	downgraded, changed := downgradeImageInput(messages)
	if !changed || len(downgraded) != 1 || len(downgraded[0].MultiContent) != 0 {
		t.Fatalf("image input was not downgraded: %#v", downgraded)
	}
	if !strings.Contains(downgraded[0].Content, "Describe the relevant context") ||
		!strings.Contains(downgraded[0].Content, imageInputOmittedText) ||
		strings.Contains(downgraded[0].Content, "SiYuan attached image") {
		t.Fatalf("downgraded text is invalid: %q", downgraded[0].Content)
	}
	if len(messages[0].MultiContent) != 3 || messages[0].Content != "" {
		t.Fatalf("canonical history was mutated: %#v", messages)
	}
}

func TestImageInputUnsupportedErrorClassification(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want bool
	}{
		{
			name: "explicit unsupported image",
			err: &openai.APIError{
				HTTPStatusCode: 400,
				Message:        "This model does not support image input",
				Param:          new("messages.2.content.1.type"),
			},
			want: true,
		},
		{
			name: "supported only by vision models",
			err: &openai.APIError{
				HTTPStatusCode: 422,
				Message:        "image_url is only supported by vision models",
			},
			want: true,
		},
		{
			name: "stream error without HTTP status",
			err: &openai.APIError{
				Message: "This model does not support image input",
			},
			want: true,
		},
		{
			name: "unrelated validation error",
			err: &openai.APIError{
				HTTPStatusCode: 400,
				Message:        "Invalid tool schema",
			},
		},
		{
			name: "unrelated text-only field",
			err: &openai.APIError{
				HTTPStatusCode: 400,
				Message:        "Tool descriptions only support text",
			},
		},
		{
			name: "malformed image",
			err: &openai.APIError{
				HTTPStatusCode: 400,
				Message:        "Invalid base64 image data",
			},
		},
		{
			name: "unsupported image format",
			err: &openai.APIError{
				HTTPStatusCode: 400,
				Message:        "Unsupported image format: webp",
			},
		},
		{
			name: "unsupported image detail parameter",
			err: &openai.APIError{
				HTTPStatusCode: 400,
				Message:        "Unsupported parameter",
				Param:          new("messages.2.content.1.image_url.detail"),
			},
		},
		{
			name: "server error",
			err: &openai.APIError{
				HTTPStatusCode: 500,
				Message:        "This model does not support image input",
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := isImageInputUnsupportedError(test.err); got != test.want {
				t.Fatalf("classification = %v, want %v", got, test.want)
			}
		})
	}
}

func TestCreateImageCompatibleStreamDowngradesAndCaches(t *testing.T) {
	const capabilityKey = "provider\x00model\x00endpoint"
	imageInputUnsupportedCache.Delete(capabilityKey)
	t.Cleanup(func() { imageInputUnsupportedCache.Delete(capabilityKey) })

	attachmentMessage, _ := buildAttachmentMessage([]AgentAttachment{testAgentAttachment()})
	req := openai.ChatCompletionRequest{
		Model:    "test-model",
		Messages: []openai.ChatCompletionMessage{attachmentMessage},
		Stream:   true,
	}
	var requests atomic.Int32
	var imageRequests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Errorf("read request failed: %v", err)
			return
		}
		if strings.Contains(string(body), `"type":"image_url"`) {
			imageRequests.Add(1)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			if _, err = io.WriteString(w, `{"error":{"message":"This model does not support image input","type":"invalid_request_error","code":"unsupported_value"}}`); err != nil {
				t.Errorf("write error response failed: %v", err)
			}
			return
		}
		flusher := prepareTestStream(t, w)
		writeTestStreamChunk(t, w, flusher, "continued as text")
		writeTestStreamDone(t, w, flusher)
	}))
	defer server.Close()

	call := func() {
		stream, _, cancel, requestMessages, downgraded, unsupportedDetected, err := createImageCompatibleStream(
			context.Background(), newTestOpenAIClient(server.URL), req, capabilityKey, false, 0,
			time.Second, time.Second, noRetryDelay, make(chan AgentEvent, 2),
		)
		if err != nil {
			t.Fatalf("compatible stream failed: %v", err)
		}
		if !downgraded || containsImageInput(requestMessages) ||
			!strings.Contains(requestMessages[0].Content, imageInputOmittedText) {
			t.Fatalf("unexpected request projection: %#v", requestMessages)
		}
		if requests.Load() == 2 && !unsupportedDetected {
			t.Fatal("initial image capability error was not reported")
		}
		stream.Close()
		cancel()
	}
	call()
	call()

	if requests.Load() != 3 || imageRequests.Load() != 1 {
		t.Fatalf("unexpected capability probing: requests=%d, imageRequests=%d", requests.Load(), imageRequests.Load())
	}
	if !containsImageInput(req.Messages) {
		t.Fatal("canonical request lost its image input")
	}
}

func TestCreateImageCompatibleStreamHandlesInitialSSEError(t *testing.T) {
	attachmentMessage, _ := buildAttachmentMessage([]AgentAttachment{testAgentAttachment()})
	req := openai.ChatCompletionRequest{
		Model:    "test-model",
		Messages: []openai.ChatCompletionMessage{attachmentMessage},
		Stream:   true,
	}
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Errorf("read request failed: %v", err)
			return
		}
		flusher := prepareTestStream(t, w)
		if strings.Contains(string(body), `"type":"image_url"`) {
			if _, err = io.WriteString(w, `data: {"error":{"message":"This model does not support image input","type":"invalid_request_error"}}`+"\n\n"); err != nil {
				t.Errorf("write stream error failed: %v", err)
				return
			}
			flusher.Flush()
			return
		}
		writeTestStreamChunk(t, w, flusher, "continued as text")
		writeTestStreamDone(t, w, flusher)
	}))
	defer server.Close()

	stream, _, cancel, requestMessages, downgraded, unsupportedDetected, err := createImageCompatibleStream(
		context.Background(), newTestOpenAIClient(server.URL), req, "", false, 0,
		time.Second, time.Second, noRetryDelay, make(chan AgentEvent, 2),
	)
	if err != nil {
		t.Fatalf("SSE capability fallback failed: %v", err)
	}
	if !downgraded || !unsupportedDetected || containsImageInput(requestMessages) || requests.Load() != 2 {
		t.Fatalf("SSE capability error was not downgraded: downgraded=%v, detected=%v, requests=%d",
			downgraded, unsupportedDetected, requests.Load())
	}
	stream.Close()
	cancel()
}

func TestCreateImageCompatibleStreamKeepsTurnDowngradedAfterFallbackError(t *testing.T) {
	attachmentMessage, _ := buildAttachmentMessage([]AgentAttachment{testAgentAttachment()})
	req := openai.ChatCompletionRequest{
		Model:    "test-model",
		Messages: []openai.ChatCompletionMessage{attachmentMessage},
		Stream:   true,
	}
	var requests atomic.Int32
	var imageRequests atomic.Int32
	var textRequests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Errorf("read request failed: %v", err)
			return
		}
		if strings.Contains(string(body), `"type":"image_url"`) {
			imageRequests.Add(1)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			if _, err = io.WriteString(w, `{"error":{"message":"This model does not support image input","type":"invalid_request_error"}}`); err != nil {
				t.Errorf("write image error failed: %v", err)
			}
			return
		}
		if textRequests.Add(1) == 1 {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			if _, err = io.WriteString(w, `{"error":{"message":"maximum context length exceeded","type":"invalid_request_error"}}`); err != nil {
				t.Errorf("write context error failed: %v", err)
			}
			return
		}
		flusher := prepareTestStream(t, w)
		writeTestStreamChunk(t, w, flusher, "continued after compaction")
		writeTestStreamDone(t, w, flusher)
	}))
	defer server.Close()

	_, _, _, _, downgraded, unsupportedDetected, err := createImageCompatibleStream(
		context.Background(), newTestOpenAIClient(server.URL), req, "", false, 0,
		time.Second, time.Second, noRetryDelay, make(chan AgentEvent, 2),
	)
	if err == nil || !downgraded || !unsupportedDetected {
		t.Fatalf("fallback error lost capability state: err=%v, downgraded=%v, detected=%v",
			err, downgraded, unsupportedDetected)
	}

	stream, _, cancel, requestMessages, downgraded, repeatedDetection, err := createImageCompatibleStream(
		context.Background(), newTestOpenAIClient(server.URL), req, "", unsupportedDetected, 0,
		time.Second, time.Second, noRetryDelay, make(chan AgentEvent, 2),
	)
	if err != nil {
		t.Fatalf("forced downgrade failed: %v", err)
	}
	if !downgraded || repeatedDetection || containsImageInput(requestMessages) ||
		requests.Load() != 3 || imageRequests.Load() != 1 {
		t.Fatalf("image capability was probed again: downgraded=%v, detected=%v, requests=%d, imageRequests=%d",
			downgraded, repeatedDetection, requests.Load(), imageRequests.Load())
	}
	stream.Close()
	cancel()
}

func TestCreateImageCompatibleStreamKeepsUnrelatedValidationError(t *testing.T) {
	attachmentMessage, _ := buildAttachmentMessage([]AgentAttachment{testAgentAttachment()})
	req := openai.ChatCompletionRequest{
		Model:    "test-model",
		Messages: []openai.ChatCompletionMessage{attachmentMessage},
		Stream:   true,
	}
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		if _, err := io.WriteString(w, `{"error":{"message":"Invalid tool schema","type":"invalid_request_error"}}`); err != nil {
			t.Errorf("write error response failed: %v", err)
		}
	}))
	defer server.Close()

	_, _, _, requestMessages, downgraded, unsupportedDetected, err := createImageCompatibleStream(
		context.Background(), newTestOpenAIClient(server.URL), req, "unrelated-error", false, 0,
		time.Second, time.Second, noRetryDelay, make(chan AgentEvent, 2),
	)
	if err == nil || downgraded || unsupportedDetected || !containsImageInput(requestMessages) || requests.Load() != 1 {
		t.Fatalf("unrelated error triggered fallback: err=%v, downgraded=%v, detected=%v, requests=%d",
			err, downgraded, unsupportedDetected, requests.Load())
	}
}

func TestImageInputUnsupportedCacheExpires(t *testing.T) {
	const capabilityKey = "expired-capability"
	imageInputUnsupportedCache.Store(capabilityKey, imageInputCapabilityCacheEntry{
		expiresAt: time.Now().Add(-time.Second),
	})
	t.Cleanup(func() { imageInputUnsupportedCache.Delete(capabilityKey) })

	attachmentMessage, _ := buildAttachmentMessage([]AgentAttachment{testAgentAttachment()})
	messages := []openai.ChatCompletionMessage{attachmentMessage}
	projected, downgraded := messagesForImageCapability(messages, capabilityKey)
	if downgraded || !containsImageInput(projected) || imageInputUnsupportedCached(capabilityKey) {
		t.Fatalf("expired capability remained cached: downgraded=%v, messages=%#v", downgraded, projected)
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

func TestMergeAgentAttachmentsRejectsOversizedBatch(t *testing.T) {
	attachments := make([]tools.ModelAttachment, maxAgentImagesPerRequest+1)
	for i := range attachments {
		attachments[i] = tools.ModelAttachment{
			Type:     "image",
			Data:     []byte{byte(i)},
			MIMEType: "image/png",
		}
	}
	if _, _, err := mergeAgentAttachments(nil, attachments); err == nil {
		t.Fatal("attachment count limit was not enforced")
	}

	oversized := []tools.ModelAttachment{{
		Type:     "image",
		Data:     make([]byte, maxAgentImageBytesPerRequest+1),
		MIMEType: "image/png",
	}}
	if _, _, err := mergeAgentAttachments(nil, oversized); err == nil {
		t.Fatal("attachment byte limit was not enforced")
	}
}

func TestCheckpointKeepsOnlyLatestAttachmentBatch(t *testing.T) {
	first := testAgentAttachment()
	second := testAgentAttachment()
	second.Data = []byte("new-image")
	second.Path = "assets/latest.png"
	checkpoint := []AgentMessage{
		{
			Role: "assistant",
			ToolCalls: []AgentToolCall{{
				ID:          "call-first",
				Name:        "image",
				Arguments:   map[string]any{"action": "analyze"},
				Result:      "[tool_output]attached[/tool_output]",
				State:       "finished",
				Attachments: []AgentAttachment{first},
			}},
		},
		{Role: "assistant", Content: "first analysis"},
		{
			Role: "assistant",
			ToolCalls: []AgentToolCall{{
				ID:          "call-second",
				Name:        "image",
				Arguments:   map[string]any{"action": "analyze"},
				Result:      "[tool_output]attached[/tool_output]",
				State:       "finished",
				Attachments: []AgentAttachment{second},
			}},
		},
	}
	messages := checkpointMessagesToOpenAI(checkpoint, "English", nil)
	encoded, err := json.Marshal(messages)
	if err != nil {
		t.Fatal(err)
	}
	body := string(encoded)
	if strings.Contains(body, "aW1hZ2UtZGF0YQ==") || !strings.Contains(body, "bmV3LWltYWdl") {
		t.Fatalf("checkpoint did not keep only the latest attachment batch: %s", body)
	}
}

func TestCompactionCandidatesKeepAttachmentToolCallInItsTurn(t *testing.T) {
	entries := []SessionEntry{
		{ID: "user-1", Type: "user", Content: "first"},
		{
			ID:   "assistant-1",
			Type: "assistant",
			ToolCalls: []AgentToolCall{{
				ID:          "call-image",
				Name:        "image",
				Result:      "attached",
				Attachments: []AgentAttachment{testAgentAttachment()},
			}},
		},
		{ID: "thinking-1", Type: "thinking"},
		{ID: "user-2", Type: "user", Content: "second"},
		{ID: "user-3", Type: "user", Content: "current"},
	}
	candidates := compactionCandidateEntryCounts(entries, 0, "user-3")
	if len(candidates) != 2 || candidates[0] != 3 || candidates[1] != 4 {
		t.Fatalf("unexpected complete-turn compaction boundaries: %#v", candidates)
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
	kernelModel.Conf.AI.Agent.MaxToolCallRounds = 1
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
	var finalToolsOmitted atomic.Bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attempt := requests.Add(1)
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Errorf("read request failed: %v", err)
			return
		}
		var payload map[string]any
		if err = json.Unmarshal(body, &payload); err != nil {
			t.Errorf("decode request failed: %v", err)
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
		if _, ok := payload["tools"]; !ok {
			finalToolsOmitted.Store(true)
		}
		writeTestStreamChunk(t, w, flusher, "image understood")
		writeTestStreamDone(t, w, flusher)
	}))
	defer server.Close()

	events := AgentChat(
		context.Background(), newTestOpenAIClient(server.URL), "openai", "test-model", "", 0, testSessionID, "user-1", 1,
		"look at the image", nil, "English", nil, EditorContext{}, nil, false, time.Second, 0, "", time.Second, time.Second,
	)
	doneSeen := false
	for event := range events {
		if event.Type == "done" {
			doneSeen = true
		}
	}
	if requests.Load() != 2 || !attachmentSeen.Load() || !finalToolsOmitted.Load() || !doneSeen {
		t.Fatalf(
			"attachment did not reach final model round: requests=%d, attachmentSeen=%v, finalToolsOmitted=%v, doneSeen=%v",
			requests.Load(), attachmentSeen.Load(), finalToolsOmitted.Load(), doneSeen,
		)
	}
}
