// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package util

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/sashabaranov/go-openai"
)

func geminiTestRequest() openai.ChatCompletionRequest {
	return openai.ChatCompletionRequest{Model: "gemini-test", Messages: []openai.ChatCompletionMessage{{Role: "user", Content: "hello"}}}
}

func geminiTestStream(events ...string) *OpenAICompletionStream {
	var data strings.Builder
	for _, event := range events {
		fmt.Fprintf(&data, "event: ignored\r\ndata: %s\r\n\r\n", event)
	}
	scannerBody := io.NopCloser(strings.NewReader(data.String()))
	return &OpenAICompletionStream{gemini: &geminiInteractionsStream{body: scannerBody, scanner: bufio.NewScanner(scannerBody)}}
}

const geminiTestCreated = `{"event_type":"interaction.created","interaction":{"id":"i1","model":"gemini-test","status":"in_progress"}}`
const geminiTestCompleted = `{"event_type":"interaction.completed","interaction":{"id":"i1","status":"completed","usage":{"total_input_tokens":7,"total_output_tokens":20,"total_thought_tokens":22,"total_tokens":49,"total_cached_tokens":3}}}`

func TestGeminiInteractionsStreamNativeHistory(t *testing.T) {
	stream := geminiTestStream(geminiTestCreated,
		`{"event_type":"step.start","index":0,"step":{"type":"thought","extra":"retained"}}`,
		`{"event_type":"step.delta","index":0,"delta":{"type":"thought_summary","content":{"type":"text","text":"reason"}}}`,
		`{"event_type":"step.delta","index":0,"delta":{"type":"thought_signature","signature":"signed-opaque"}}`,
		`{"event_type":"step.stop","index":0}`,
		`{"event_type":"step.start","index":1,"step":{"type":"model_output"}}`,
		`{"event_type":"step.delta","index":1,"delta":{"type":"text","text":"answer"}}`,
		`{"event_type":"step.stop","index":1}`, geminiTestCompleted)
	defer stream.Close()
	text, reason, usageCount := "", "", 0
	for {
		chunk, err := stream.Recv()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		if chunk.Usage != nil {
			usageCount++
			if chunk.Usage.PromptTokens != 7 || chunk.Usage.CompletionTokens != 42 || chunk.Usage.TotalTokens != 49 ||
				chunk.Usage.CompletionTokensDetails.ReasoningTokens != 22 || chunk.Usage.PromptTokensDetails.CachedTokens != 3 {
				t.Fatalf("incorrect usage: %+v", chunk.Usage)
			}
		}
		for _, choice := range chunk.Choices {
			text += choice.Delta.Content
			reason += choice.Delta.ReasoningContent
		}
	}
	content := stream.NativeContent()
	if text != "answer" || reason != "reason" || usageCount != 1 || content == nil || len(content.Blocks) != 2 ||
		!strings.Contains(string(content.Blocks[0]), "signed-opaque") || !strings.Contains(string(content.Blocks[0]), "retained") {
		t.Fatalf("lost stream content: %q %q %+v", text, reason, content)
	}
	content.Blocks[0][0] = 'x'
	if stream.NativeContent().Blocks[0][0] != '{' {
		t.Fatal("native content was not cloned")
	}
}

func TestGeminiInteractionsStreamOptionalInteractionID(t *testing.T) {
	for _, test := range []struct {
		name      string
		created   string
		completed string
		wantID    string
	}{
		{name: "empty", created: `"id":"",`, completed: `"id":"",`},
		{name: "omitted"},
		{name: "created-only", created: `"id":"i1",`, wantID: "i1"},
		{name: "completed-only", completed: `"id":"i1",`, wantID: "i1"},
	} {
		t.Run(test.name, func(t *testing.T) {
			stream := geminiTestStream(
				`{"event_type":"interaction.created","interaction":{`+test.created+`"status":"in_progress","object":"interaction","model":"gemini-4-argon"}}`,
				`{"event_type":"step.start","index":0,"step":{"type":"thought"}}`,
				`{"event_type":"step.delta","index":0,"delta":{"type":"thought_summary","content":{"type":"text","text":"reason"}}}`,
				`{"event_type":"step.delta","index":0,"delta":{"type":"thought_signature","signature":"opaque"}}`,
				`{"event_type":"step.stop","index":0}`,
				`{"event_type":"step.start","index":1,"step":{"type":"function_call","id":"call1","name":"lookup","arguments":{}}}`,
				`{"event_type":"step.stop","index":1}`,
				`{"event_type":"interaction.completed","interaction":{`+test.completed+`"status":"requires_action"}}`)
			defer stream.Close()
			reasoning, calls := "", 0
			for {
				chunk, err := stream.Recv()
				if errors.Is(err, io.EOF) {
					break
				}
				if err != nil {
					t.Fatal(err)
				}
				for _, choice := range chunk.Choices {
					reasoning += choice.Delta.ReasoningContent
					calls += len(choice.Delta.ToolCalls)
					if len(choice.Delta.ToolCalls) > 0 && (choice.FinishReason != openai.FinishReasonToolCalls || chunk.ID != test.wantID) {
						t.Fatalf("invalid terminal tool response: %+v", chunk)
					}
				}
			}
			native := stream.NativeContent()
			if reasoning != "reason" || calls != 1 || native == nil || len(native.Blocks) != 2 ||
				!strings.Contains(string(native.Blocks[0]), "opaque") {
				t.Fatalf("lost stateless output: reasoning=%q calls=%d native=%+v", reasoning, calls, native)
			}
		})
	}
}

func TestGeminiInteractionsParallelToolsAndReplay(t *testing.T) {
	stream := geminiTestStream(geminiTestCreated,
		`{"event_type":"step.start","index":0,"step":{"type":"thought","signature":"opaque"}}`,
		`{"event_type":"step.stop","index":0}`,
		`{"event_type":"step.start","index":1,"step":{"type":"function_call","id":"a","name":"lookup","arguments":{}}}`,
		`{"event_type":"step.start","index":2,"step":{"type":"function_call","id":"b","name":"lookup","arguments":{}}}`,
		`{"event_type":"step.delta","index":1,"delta":{"type":"arguments_delta","arguments":"{\"n\":"}}`,
		`{"event_type":"step.delta","index":2,"delta":{"type":"arguments_delta","arguments":"{\"n\":2}"}}`,
		`{"event_type":"step.stop","index":2}`,
		`{"event_type":"step.delta","index":1,"delta":{"type":"arguments_delta","arguments":"9007199254740993}"}}`,
		`{"event_type":"step.stop","index":1}`,
		`{"event_type":"interaction.completed","interaction":{"id":"i1","status":"requires_action"}}`)
	defer stream.Close()
	var calls []openai.ToolCall
	for {
		chunk, err := stream.Recv()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		for _, choice := range chunk.Choices {
			if len(choice.Delta.ToolCalls) > 0 && choice.FinishReason != openai.FinishReasonToolCalls {
				t.Fatal("premature tools")
			}
			calls = append(calls, choice.Delta.ToolCalls...)
		}
	}
	if len(calls) != 2 || calls[0].ID != "a" || calls[1].ID != "b" {
		t.Fatalf("unexpected calls: %+v", calls)
	}
	request := geminiTestRequest()
	request.Messages = append(request.Messages, openai.ChatCompletionMessage{Role: "assistant", ToolCalls: calls},
		openai.ChatCompletionMessage{Role: "tool", ToolCallID: "b", Content: "two"},
		openai.ChatCompletionMessage{Role: "tool", ToolCallID: "a", Content: "one"})
	ctx := ContextWithAIMessageContents(context.Background(), []*AIMessageContent{stream.NativeContent()})
	payload, err := buildGeminiInteractionsRequest(ctx, request)
	if err != nil {
		t.Fatal(err)
	}
	if payload.Store || len(payload.Input) != 6 || !strings.Contains(string(payload.Input[1]), "opaque") ||
		!strings.Contains(string(payload.Input[4]), `"call_id":"b"`) || !strings.Contains(string(payload.Input[4]), `"name":"lookup"`) {
		t.Fatalf("lost native replay: %+v", payload)
	}
	for _, mutation := range []string{"version", "arguments", "missing-result", "duplicate-result", "unmatched-result"} {
		t.Run(mutation, func(t *testing.T) {
			copyRequest := request
			copyRequest.Messages = append([]openai.ChatCompletionMessage(nil), request.Messages...)
			copyRequest.Messages[1].ToolCalls = append([]openai.ToolCall(nil), calls...)
			native := stream.NativeContent()
			switch mutation {
			case "version":
				native.Version++
			case "arguments":
				copyRequest.Messages[1].ToolCalls[0].Function.Arguments = `{"n":9007199254740992}`
			case "missing-result":
				copyRequest.Messages = copyRequest.Messages[:3]
			case "duplicate-result":
				copyRequest.Messages = append(copyRequest.Messages, copyRequest.Messages[2])
			case "unmatched-result":
				copyRequest.Messages[2].ToolCallID = "unknown"
			}
			ctx := ContextWithAIMessageContents(context.Background(), []*AIMessageContent{native})
			if _, err := buildGeminiInteractionsRequest(ctx, copyRequest); err == nil {
				t.Fatal("invalid native history accepted")
			}
		})
	}
}

func TestGeminiInteractionsRejectIncompleteStreams(t *testing.T) {
	for name, events := range map[string][]string{
		"null-created":          {`{"event_type":"interaction.created","interaction":null}`},
		"missing-created-body":  {`{"event_type":"interaction.created"}`},
		"duplicate-created":     {geminiTestCreated, geminiTestCreated},
		"created-with-output":   {`{"event_type":"interaction.created","interaction":{"id":"i1","steps":[{"type":"thought"}]}}`},
		"null-completed":        {geminiTestCreated, `{"event_type":"interaction.completed","interaction":null}`},
		"mismatched-id":         {geminiTestCreated, `{"event_type":"interaction.completed","interaction":{"id":"different","status":"completed"}}`},
		"eof":                   {geminiTestCreated},
		"done-without-terminal": {geminiTestCreated, `[DONE]`},
		"missing-start":         {geminiTestCompleted},
		"missing-step-stop":     {geminiTestCreated, `{"event_type":"step.start","index":0,"step":{"type":"model_output"}}`, geminiTestCompleted},
		"unmatched-delta":       {geminiTestCreated, `{"event_type":"step.delta","index":1,"delta":{"type":"text","text":"bad"}}`},
		"unknown-step":          {geminiTestCreated, `{"event_type":"step.start","index":0,"step":{"type":"unknown"}}`},
		"invalid-arguments":     {geminiTestCreated, `{"event_type":"step.start","index":0,"step":{"type":"function_call","id":"a","name":"f","arguments":{}}}`, `{"event_type":"step.delta","index":0,"delta":{"type":"arguments_delta","arguments":"{"}}`, `{"event_type":"step.stop","index":0}`},
		"incomplete":            {geminiTestCreated, `{"event_type":"interaction.completed","interaction":{"id":"i1","status":"incomplete"}}`},
		"failed":                {geminiTestCreated, `{"event_type":"interaction.completed","interaction":{"id":"i1","status":"failed","errors":[{"code":"INTERNAL","message":"upstream failed"}]}}`},
		"error":                 {geminiTestCreated, `{"event_type":"error","error":{"code":429,"message":"quota","status":"RESOURCE_EXHAUSTED"}}`},
	} {
		t.Run(name, func(t *testing.T) {
			stream := geminiTestStream(events...)
			defer stream.Close()
			for {
				chunk, err := stream.Recv()
				if errors.Is(err, io.EOF) {
					t.Fatal("invalid stream succeeded")
				}
				if err != nil {
					break
				}
				for _, choice := range chunk.Choices {
					if len(choice.Delta.ToolCalls) > 0 {
						t.Fatal("incomplete tool delivered")
					}
				}
			}
			if stream.NativeContent() != nil {
				t.Fatal("incomplete native history exposed")
			}
		})
	}
}

func TestGeminiInteractionsRequestAndHTTP(t *testing.T) {
	for _, version := range []string{"v1", "v1beta"} {
		t.Run(version, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/proxy/"+version+"/interactions" || r.URL.Query().Get("route") != "native" ||
					r.Header.Get("x-goog-api-key") != "overridden" || r.Header.Get("X-Custom") != "value" || r.Header.Get("x-goog-api-client") != "siyuan/"+Ver {
					t.Errorf("unexpected request: %s %v", r.URL, r.Header)
				}
				var payload map[string]json.RawMessage
				if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
					t.Error(err)
				}
				if string(payload["store"]) != "false" || string(payload["stream"]) != "false" || string(payload["system_instruction"]) != `"system"` ||
					strings.Contains(string(payload["generation_config"]), "temperature") || !strings.Contains(string(payload["generation_config"]), `"max_output_tokens":1024`) ||
					!strings.Contains(string(payload["input"]), `"data":"aGVsbG8="`) || !strings.Contains(string(payload["tools"]), `"type":"function"`) {
					t.Errorf("unexpected payload: %+v", payload)
				}
				fmt.Fprint(w, `{"id":"i1","status":"completed","steps":[{"type":"model_output","content":[{"type":"text","text":"answer"}]}]}`)
			}))
			defer server.Close()
			request := geminiTestRequest()
			request.MaxCompletionTokens, request.Temperature = 1024, 0.7
			request.Messages = append([]openai.ChatCompletionMessage{{Role: "system", Content: "system"}}, request.Messages...)
			request.Messages[1].MultiContent = []openai.ChatMessagePart{{Type: openai.ChatMessagePartTypeImageURL,
				ImageURL: &openai.ChatMessageImageURL{URL: "data:image/png;base64,aGVsbG8="}}}
			request.Tools = []openai.Tool{{Type: openai.ToolTypeFunction, Function: &openai.FunctionDefinition{Name: "lookup", Parameters: map[string]string{"type": "object"}}}}
			client := NewAIClientWithModel("key", server.URL+"/proxy/"+version+"?route=native", request.Model,
				map[string]string{"X-Goog-Api-Key": "overridden", "X-Custom": "value"})
			result, err := CreateOpenAICompletion(context.Background(), client, GeminiProtocolInteractions, request, nil)
			if err != nil || result.Choices[0].Message.Content != "answer" {
				t.Fatalf("completion: %+v %v", result, err)
			}
		})
	}
}

func TestGeminiInteractionsErrorsModelsAndProbe(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/models") {
			if r.URL.Query().Get("pageToken") == "" {
				fmt.Fprint(w, `{"models":[{"name":"models/gemini-test","inputTokenLimit":100000}],"nextPageToken":"next"}`)
			} else {
				fmt.Fprint(w, `{"models":[{"name":"models/gemini-test"},{"name":"models/gemini-other"}]}`)
			}
			return
		}
		calls.Add(1)
		w.WriteHeader(400)
		fmt.Fprint(w, `[{"error":{"code":400,"message":"This model only supports Interactions API.","status":"INVALID_ARGUMENT"}}]`)
	}))
	defer server.Close()
	models, err := ListProviderModels("", server.URL, GeminiProtocolInteractions, 5)
	if err != nil || len(models) != 2 || models[0].ID != "gemini-test" || models[0].ContextLength != 100000 {
		t.Fatalf("models: %+v %v", models, err)
	}
	_, matched, err := TestModel("", server.URL, GeminiProtocolInteractions, "gemini-test", 5)
	if err == nil || matched || calls.Load() != 1 || !strings.Contains(err.Error(), "only supports Interactions") {
		t.Fatalf("probe: %v %v", matched, err)
	}
	client := NewAIClientWithModel("", server.URL, "gemini-test")
	_, err = CreateOpenAICompletion(context.Background(), client, OpenAIProtocolChatCompletions, geminiTestRequest(), nil)
	var apiErr *openai.APIError
	if !errors.As(err, &apiErr) || apiErr.HTTPStatusCode != 400 || !strings.Contains(apiErr.Message, "only supports Interactions") {
		t.Fatalf("compatibility error lost: %v", err)
	}
}

func TestGeminiInteractionsRedirectAndCancellation(t *testing.T) {
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("x-goog-api-key") != "" || r.Header.Get("X-Secret") != "" {
			t.Error("credentials escaped origin")
		}
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer target.Close()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL, http.StatusTemporaryRedirect)
	}))
	defer server.Close()
	client := NewAIClientWithModel("secret", server.URL, "test", map[string]string{"X-Secret": "private"})
	_, _ = CreateOpenAICompletion(context.Background(), client, GeminiProtocolInteractions, geminiTestRequest(), nil)
	started := make(chan struct{})
	stall := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprintf(w, "data: %s\n\n", geminiTestCreated)
		w.(http.Flusher).Flush()
		close(started)
		<-r.Context().Done()
	}))
	defer stall.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	stream, err := CreateOpenAICompletionStream(ctx, NewAIClientWithModel("", stall.URL, "test"), GeminiProtocolInteractions, geminiTestRequest(), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Close()
	<-started
	if _, err = stream.Recv(); err != nil {
		t.Fatal(err)
	}
	cancel()
	finished := make(chan error, 1)
	go func() { _, err := stream.Recv(); finished <- err }()
	select {
	case err = <-finished:
		if err == nil || errors.Is(err, io.EOF) {
			t.Fatalf("cancellation succeeded: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("cancellation did not close stream")
	}
}

func TestGeminiInteractionsCompletedToolArgumentsUseStructuralEquality(t *testing.T) {
	stream := geminiTestStream(geminiTestCreated,
		`{"event_type":"step.start","index":0,"step":{"type":"function_call","id":"call","name":"lookup","arguments":{"a":9007199254740993,"b":2}}}`,
		`{"event_type":"step.stop","index":0}`,
		`{"event_type":"interaction.completed","interaction":{"id":"i1","status":"requires_action","steps":[{"type":"function_call","id":"call","name":"lookup","arguments":{"b":2,"a":9007199254740993}}]}}`)
	defer stream.Close()
	var calls []openai.ToolCall
	for {
		chunk, err := stream.Recv()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		for _, choice := range chunk.Choices {
			calls = append(calls, choice.Delta.ToolCalls...)
		}
	}
	if len(calls) != 1 || !strings.Contains(calls[0].Function.Arguments, "9007199254740993") {
		t.Fatalf("tool arguments changed: %+v", calls)
	}
}

func TestGeminiInteractionsProbeAcceptsOnlyValidatedTerminalResponses(t *testing.T) {
	for _, tc := range []struct {
		name        string
		events      []string
		wantMatched bool
	}{
		{"output-budget", []string{geminiTestCreated,
			`{"event_type":"step.start","index":0,"step":{"type":"thought","signature":"opaque"}}`,
			`{"event_type":"step.stop","index":0}`,
			`{"event_type":"interaction.completed","interaction":{"id":"i1","status":"incomplete"}}`}, true},
		{"disconnected", []string{geminiTestCreated}, false},
		{"failed", []string{geminiTestCreated,
			`{"event_type":"interaction.completed","interaction":{"id":"i1","status":"failed"}}`}, false},
		{"error-with-incomplete", []string{geminiTestCreated,
			`{"event_type":"interaction.completed","interaction":{"id":"i1","status":"incomplete","errors":[{"code":"internal_error","message":"failed"}]}}`}, false},
		{"unfinished-step", []string{geminiTestCreated,
			`{"event_type":"step.start","index":0,"step":{"type":"model_output"}}`,
			`{"event_type":"interaction.completed","interaction":{"id":"i1","status":"incomplete"}}`}, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			requests := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if strings.HasSuffix(r.URL.Path, "/models") {
					fmt.Fprint(w, `{"models":[{"name":"models/gemini-test"}]}`)
					return
				}
				requests++
				var payload struct {
					Store            *bool `json:"store"`
					GenerationConfig struct {
						MaxOutputTokens int `json:"max_output_tokens"`
					} `json:"generation_config"`
				}
				if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
					t.Error(err)
				}
				if payload.Store == nil || *payload.Store || payload.GenerationConfig.MaxOutputTokens != 256 {
					t.Errorf("probe budget or persistence changed: %+v", payload)
				}
				w.Header().Set("Content-Type", "text/event-stream")
				for _, event := range tc.events {
					fmt.Fprintf(w, "data: %s\n\n", event)
				}
			}))
			defer server.Close()
			_, matched, err := TestModel("", server.URL, GeminiProtocolInteractions, "gemini-test", 5)
			if matched != tc.wantMatched || (err == nil) != tc.wantMatched || requests != 1 {
				t.Fatalf("matched=%v err=%v requests=%d", matched, err, requests)
			}
		})
	}
}
