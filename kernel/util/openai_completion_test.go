// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package util

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/sashabaranov/go-openai"
)

func TestOpenAIResponsesStreamPreservesOutput(t *testing.T) {
	var requestPayload map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/responses" {
			t.Errorf("unexpected path: %s", r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
			return
		}
		if err := json.NewDecoder(r.Body).Decode(&requestPayload); err != nil {
			t.Errorf("decode request: %s", err)
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = fmt.Fprint(w,
			"event: response.output_item.added\n"+
				"data: {\"type\":\"response.output_item.added\",\"output_index\":1,"+
				"\"item\":{\"id\":\"fc_1\",\"type\":\"function_call\",\"status\":\"in_progress\","+
				"\"call_id\":\"call_1\",\"name\":\"lookup\",\"arguments\":\"\"}}\n\n"+
				"event: response.function_call_arguments.delta\n"+
				"data: {\"type\":\"response.function_call_arguments.delta\",\"output_index\":1,"+
				"\"item_id\":\"fc_1\",\"delta\":\"{\\\"q\\\":\\\"x\\\"}\"}\n\n"+
				"event: response.completed\n"+
				"data: {\"type\":\"response.completed\",\"response\":{\"id\":\"resp_1\","+
				"\"object\":\"response\",\"status\":\"completed\",\"model\":\"gpt-test\","+
				"\"output\":[{\"id\":\"rs_1\",\"type\":\"reasoning\",\"encrypted_content\":\"secret\"},"+
				"{\"id\":\"fc_1\",\"type\":\"function_call\",\"status\":\"completed\","+
				"\"call_id\":\"call_1\",\"name\":\"lookup\",\"arguments\":\"{\\\"q\\\":\\\"x\\\"}\"}],"+
				"\"usage\":{\"input_tokens\":12,\"output_tokens\":7,\"total_tokens\":19,"+
				"\"input_tokens_details\":{\"cached_tokens\":3}}}}\n\n")
	}))
	defer server.Close()

	config := openai.DefaultConfig("test")
	config.BaseURL = server.URL + "/v1"
	client := openai.NewClientWithConfig(config)
	request := openai.ChatCompletionRequest{
		Model:               "gpt-test",
		Messages:            []openai.ChatCompletionMessage{{Role: openai.ChatMessageRoleUser, Content: "hello"}},
		ReasoningEffort:     "high",
		MaxCompletionTokens: 128,
		Tools: []openai.Tool{{
			Type: openai.ToolTypeFunction,
			Function: &openai.FunctionDefinition{
				Name:       "lookup",
				Parameters: map[string]any{"type": "object"},
			},
		}},
	}
	stream, err := CreateOpenAICompletionStream(
		context.Background(), client, OpenAIProtocolResponses, request, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Close()

	var toolCall openai.ToolCall
	var usage *openai.Usage
	for {
		response, receiveErr := stream.Recv()
		if receiveErr != nil {
			if receiveErr == io.EOF {
				break
			}
			t.Fatal(receiveErr)
		}
		for _, choice := range response.Choices {
			for _, delta := range choice.Delta.ToolCalls {
				if delta.ID != "" {
					toolCall.ID = delta.ID
				}
				if delta.Function.Name != "" {
					toolCall.Function.Name = delta.Function.Name
				}
				toolCall.Function.Arguments += delta.Function.Arguments
			}
		}
		if response.Usage != nil {
			usage = response.Usage
		}
	}

	if toolCall.ID != "call_1" || toolCall.Function.Name != "lookup" ||
		toolCall.Function.Arguments != "{\"q\":\"x\"}" {
		t.Fatalf("unexpected tool call: %#v", toolCall)
	}
	if usage == nil || usage.PromptTokens != 12 || usage.CompletionTokens != 7 ||
		usage.PromptTokensDetails == nil || usage.PromptTokensDetails.CachedTokens != 3 {
		t.Fatalf("unexpected usage: %#v", usage)
	}
	output, err := json.Marshal(stream.ResponseOutput())
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(output), "\"encrypted_content\":\"secret\"") {
		t.Fatalf("encrypted reasoning was not preserved: %s", output)
	}

	if requestPayload["store"] != false {
		t.Fatalf("Responses request must use store=false: %#v", requestPayload)
	}
	if requestPayload["temperature"] != float64(0) {
		t.Fatalf("Responses request must preserve temperature zero: %#v", requestPayload)
	}
	reasoning, _ := requestPayload["reasoning"].(map[string]any)
	if reasoning["effort"] != "high" || reasoning["summary"] != "auto" {
		t.Fatalf("unexpected reasoning config: %#v", reasoning)
	}
	tools, _ := requestPayload["tools"].([]any)
	functionTool, _ := tools[0].(map[string]any)
	if functionTool["type"] != "function" || functionTool["name"] != "lookup" {
		t.Fatalf("Responses function tool is not inline: %#v", functionTool)
	}
	if _, exists := functionTool["function"]; exists {
		t.Fatalf("Responses function tool contains Chat wrapper: %#v", functionTool)
	}
}

func TestOpenAIResponsesStreamRequiresTerminalEvent(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = fmt.Fprint(w, "event: response.created\n"+
			"data: {\"type\":\"response.created\",\"response\":{\"id\":\"resp_1\"}}\n\n")
	}))
	defer server.Close()

	config := openai.DefaultConfig("test")
	config.BaseURL = server.URL + "/v1"
	stream, err := CreateOpenAICompletionStream(context.Background(), openai.NewClientWithConfig(config),
		OpenAIProtocolResponses, openai.ChatCompletionRequest{Model: "gpt-test"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Close()
	if _, err = stream.Recv(); err != nil {
		t.Fatalf("receive progress event: %v", err)
	}
	_, err = stream.Recv()
	if err == nil || errors.Is(err, io.EOF) || !strings.Contains(err.Error(), "terminal event") {
		t.Fatalf("unexpected truncated stream error: %v", err)
	}
}

func TestOpenAIResponsesStreamReturnsTypedError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = fmt.Fprint(w, "event: error\n"+
			"data: {\"type\":\"error\",\"code\":\"invalid_request_error\","+
			"\"message\":\"invalid input\"}\n\n")
	}))
	defer server.Close()

	config := openai.DefaultConfig("test")
	config.BaseURL = server.URL + "/v1"
	stream, err := CreateOpenAICompletionStream(context.Background(), openai.NewClientWithConfig(config),
		OpenAIProtocolResponses, openai.ChatCompletionRequest{Model: "gpt-test"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Close()
	_, err = stream.Recv()
	var apiErr *openai.APIError
	if !errors.As(err, &apiErr) || apiErr.Code != "invalid_request_error" || apiErr.Message != "invalid input" {
		t.Fatalf("unexpected Responses stream error: %#v", err)
	}
}

func TestOpenAIResponsesStreamRejectsIncompleteFunctionCall(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = fmt.Fprint(w,
			"event: response.output_item.added\n"+
				"data: {\"type\":\"response.output_item.added\",\"output_index\":0,"+
				"\"item\":{\"id\":\"fc_1\",\"type\":\"function_call\",\"status\":\"in_progress\","+
				"\"call_id\":\"call_1\",\"name\":\"lookup\",\"arguments\":\"\"}}\n\n"+
				"event: response.function_call_arguments.delta\n"+
				"data: {\"type\":\"response.function_call_arguments.delta\",\"output_index\":0,"+
				"\"item_id\":\"fc_1\",\"delta\":\"{\\\"q\\\":\"}\n\n"+
				"event: response.incomplete\n"+
				"data: {\"type\":\"response.incomplete\",\"response\":{\"id\":\"resp_1\","+
				"\"status\":\"incomplete\",\"incomplete_details\":{\"reason\":\"max_output_tokens\"},"+
				"\"output\":[{\"id\":\"fc_1\",\"type\":\"function_call\",\"status\":\"incomplete\","+
				"\"call_id\":\"call_1\",\"name\":\"lookup\",\"arguments\":\"{\\\"q\\\":\"}]}}\n\n")
	}))
	defer server.Close()

	config := openai.DefaultConfig("test")
	config.BaseURL = server.URL + "/v1"
	stream, err := CreateOpenAICompletionStream(context.Background(), openai.NewClientWithConfig(config),
		OpenAIProtocolResponses, openai.ChatCompletionRequest{Model: "gpt-test"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Close()
	for i := 0; i < 2; i++ {
		if _, err = stream.Recv(); err != nil {
			t.Fatalf("receive partial function event %d: %v", i, err)
		}
	}
	if _, err = stream.Recv(); err == nil || !strings.Contains(err.Error(), "incomplete function call") {
		t.Fatalf("unexpected incomplete function call result: %v", err)
	}
}

func TestOpenAIResponsesIncompleteContentFilter(t *testing.T) {
	textResponse := openai.CreateResponseResponse{
		Status:            openai.ResponseStatusIncomplete,
		IncompleteDetails: &openai.ResponseIncompleteDetails{Reason: "content_filter"},
		Output: []any{map[string]any{
			"type": "message", "role": "assistant", "status": "incomplete",
			"content": []any{map[string]any{"type": "output_text", "text": "partial"}},
		}},
	}
	converted := responseToChatCompletion(textResponse)
	if len(converted.Choices) != 1 || converted.Choices[0].FinishReason != openai.FinishReasonContentFilter ||
		converted.Choices[0].Message.Content != "partial" {
		t.Fatalf("unexpected content-filter response: %#v", converted)
	}

	toolResponse := openai.CreateResponseResponse{
		Status:            openai.ResponseStatusIncomplete,
		IncompleteDetails: &openai.ResponseIncompleteDetails{Reason: "content_filter"},
		Output: []any{map[string]any{
			"type": "function_call", "status": "completed", "call_id": "call_1",
			"name": "lookup", "arguments": "{}",
		}},
	}
	if err := responseResultError(toolResponse); err == nil || !strings.Contains(err.Error(), "incomplete function call") {
		t.Fatalf("unexpected incomplete tool response result: %v", err)
	}
}

func TestOpenAIResponsesNonStreamFailure(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprint(w, "{\"id\":\"resp_1\",\"status\":\"failed\","+
			"\"error\":{\"code\":\"model_error\",\"message\":\"generation failed\"}}")
	}))
	defer server.Close()

	config := openai.DefaultConfig("test")
	config.BaseURL = server.URL + "/v1"
	_, err := CreateOpenAICompletion(context.Background(), openai.NewClientWithConfig(config),
		OpenAIProtocolResponses, openai.ChatCompletionRequest{Model: "gpt-test"}, nil)
	if err == nil || !strings.Contains(err.Error(), "generation failed") {
		t.Fatalf("unexpected failed response error: %v", err)
	}
}

func TestChatMessagesToOpenAIResponseInput(t *testing.T) {
	input := ChatMessagesToOpenAIResponseInput([]openai.ChatCompletionMessage{
		{Role: openai.ChatMessageRoleSystem, Content: "instructions"},
		{
			Role:    openai.ChatMessageRoleAssistant,
			Content: "working",
			ToolCalls: []openai.ToolCall{{
				ID:   "call_1",
				Type: openai.ToolTypeFunction,
				Function: openai.FunctionCall{
					Name:      "lookup",
					Arguments: "{}",
				},
			}},
		},
		{Role: openai.ChatMessageRoleTool, ToolCallID: "call_1", Content: "done"},
	})
	data, err := json.Marshal(input)
	if err != nil {
		t.Fatal(err)
	}
	payload := string(data)
	for _, expected := range []string{
		"\"type\":\"function_call\"",
		"\"call_id\":\"call_1\"",
		"\"type\":\"function_call_output\"",
		"\"output\":\"done\"",
	} {
		if !strings.Contains(payload, expected) {
			t.Fatalf("response input missing %s: %s", expected, payload)
		}
	}
	if strings.Contains(payload, "instructions") {
		t.Fatalf("the first system message must be sent as top-level instructions: %s", payload)
	}
}

func TestModelFallsBackToResponses(t *testing.T) {
	var responsesCalled bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/models":
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusNotFound)
			_, _ = fmt.Fprint(w, "{\"error\":{\"message\":\"unsupported\"}}")
		case "/v1/responses":
			responsesCalled = true
			w.Header().Set("Content-Type", "application/json")
			_, _ = fmt.Fprint(w, "{\"id\":\"resp_1\",\"object\":\"response\",\"status\":\"completed\","+
				"\"model\":\"gpt-test\",\"output\":[{\"type\":\"message\",\"role\":\"assistant\","+
				"\"content\":[{\"type\":\"output_text\",\"text\":\"1\"}]}]}")
		default:
			t.Errorf("unexpected path: %s", r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()

	available, matched, err := TestModel(
		"test", server.URL+"/v1", OpenAIProtocolResponses, "gpt-test", 5)
	if err != nil {
		t.Fatal(err)
	}
	if len(available) != 0 || !matched || !responsesCalled {
		t.Fatalf("unexpected model test result: available=%v, matched=%v, responses=%v",
			available, matched, responsesCalled)
	}
}
