package util

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/sashabaranov/go-openai"
)

func writeAnthropicEvents(w http.ResponseWriter, events ...string) {
	w.Header().Set("Content-Type", "text/event-stream")
	for _, event := range events {
		_, _ = fmt.Fprintf(w, "data: %s\n\n", event)
		if flusher, ok := w.(http.Flusher); ok {
			flusher.Flush()
		}
	}
}

var anthropicToolEvents = []string{
	`{"type":"message_start","message":{"id":"msg_1","model":"test","content":[],"usage":{"input_tokens":11,"output_tokens":1,"cache_creation_input_tokens":3,"cache_read_input_tokens":7}}}`,
	`{"type":"ping"}`,
	`{"type":"future_event"}`,
	`{"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":"","signature":""}}`,
	`{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"Think"}}`,
	`{"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"signed-"}}`,
	`{"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"opaque"}}`,
	`{"type":"content_block_stop","index":0}`,
	`{"type":"content_block_start","index":1,"content_block":{"type":"redacted_thinking","data":"opaque-data"}}`,
	`{"type":"content_block_stop","index":1}`,
	`{"type":"content_block_start","index":2,"content_block":{"type":"text","text":""}}`,
	`{"type":"content_block_delta","index":2,"delta":{"type":"text_delta","text":"Checking"}}`,
	`{"type":"content_block_stop","index":2}`,
	`{"type":"content_block_start","index":3,"content_block":{"type":"tool_use","id":"tool_1","name":"lookup","input":{}}}`,
	`{"type":"content_block_delta","index":3,"delta":{"type":"input_json_delta","partial_json":"{\"q\":"}}`,
	`{"type":"content_block_delta","index":3,"delta":{"type":"input_json_delta","partial_json":"\"hello\"}"}}`,
	`{"type":"content_block_stop","index":3}`,
	`{"type":"content_block_start","index":4,"content_block":{"type":"tool_use","id":"tool_2","name":"list","input":{}}}`,
	`{"type":"content_block_stop","index":4}`,
	`{"type":"message_delta","delta":{"stop_reason":null},"usage":{"output_tokens":5}}`,
	`{"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":9}}`,
	`{"type":"message_stop"}`,
}

func TestAnthropicStreamAndNativeHistory(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/gateway/v1/messages" || r.Header.Get("x-api-key") != "override-key" ||
			r.Header.Get("anthropic-version") != "2023-06-01" || r.Header.Get("X-Custom") != "custom" {
			t.Errorf("unexpected request path or headers: %s %v", r.URL.Path, r.Header)
		}
		var request anthropicRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Error(err)
		}
		if !request.Stream || request.MaxTokens != 4096 || request.Model != "test" {
			t.Errorf("unexpected request: %+v", request)
		}
		writeAnthropicEvents(w, anthropicToolEvents...)
	}))
	defer server.Close()
	client := NewAIClientWithModel("key", server.URL+"/gateway", "test", map[string]string{
		"X-Api-Key": "override-key", "X-Custom": "custom",
	})
	stream, err := CreateOpenAICompletionStream(context.Background(), client, AnthropicProtocolMessages,
		openai.ChatCompletionRequest{Model: "test", Messages: []openai.ChatCompletionMessage{{Role: "user", Content: "hello"}}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Close()
	var text, thinking string
	calls := map[int]openai.ToolCall{}
	var usages []openai.Usage
	for {
		part, receiveErr := stream.Recv()
		if errors.Is(receiveErr, io.EOF) {
			break
		}
		if receiveErr != nil {
			t.Fatal(receiveErr)
		}
		if part.Usage != nil {
			usages = append(usages, *part.Usage)
		}
		for _, choice := range part.Choices {
			text += choice.Delta.Content
			thinking += choice.Delta.ReasoningContent
			for _, delta := range choice.Delta.ToolCalls {
				call := calls[*delta.Index]
				if delta.ID != "" {
					call.ID = delta.ID
				}
				call.Function.Name += delta.Function.Name
				call.Function.Arguments += delta.Function.Arguments
				calls[*delta.Index] = call
			}
		}
	}
	if text != "Checking" || thinking != "Think" || len(calls) != 2 ||
		calls[3].Function.Arguments != `{"q":"hello"}` || calls[4].Function.Arguments != `{}` {
		t.Fatalf("unexpected stream projection: %s %s %+v", text, thinking, calls)
	}
	if len(usages) != 1 || usages[0].PromptTokens != 21 || usages[0].CompletionTokens != 9 ||
		usages[0].TotalTokens != 30 || usages[0].PromptTokensDetails.CachedTokens != 7 {
		t.Fatalf("cumulative usage was not merged: %+v", usages)
	}
	native := stream.NativeContent()
	if native == nil || len(native.Blocks) != 5 || !strings.Contains(string(native.Blocks[0]), "signed-opaque") {
		t.Fatalf("missing native thinking: %+v", native)
	}
	persisted, _ := json.Marshal(native)
	var restored AIMessageContent
	if err = json.Unmarshal(persisted, &restored); err != nil {
		t.Fatal(err)
	}
	request := openai.ChatCompletionRequest{Model: "test", Messages: []openai.ChatCompletionMessage{
		{Role: "system", Content: "instructions"},
		{Role: "user", Content: "hello"},
		{Role: "assistant", Content: text, ToolCalls: []openai.ToolCall{calls[3], calls[4]}},
		{Role: "tool", ToolCallID: "tool_1", Content: "found"},
		{Role: "tool", ToolCallID: "tool_2", Content: "listed"},
	}}
	payload, err := buildAnthropicRequest(ContextWithAIMessageContents(context.Background(), []*AIMessageContent{&restored}), request)
	if err != nil {
		t.Fatal(err)
	}
	if len(payload.Messages) != 3 || len(payload.Messages[2].Content) != 2 ||
		!reflect.DeepEqual(payload.Messages[1].Content, restored.Blocks) {
		t.Fatalf("native history or grouped tool results changed: %+v", payload.Messages)
	}
	copy := stream.NativeContent()
	copy.Blocks[0][0] = 'x'
	if !json.Valid(stream.NativeContent().Blocks[0]) {
		t.Fatal("native content was not cloned")
	}
}

func TestAnthropicMessagesImagesAndThinking(t *testing.T) {
	request := openai.ChatCompletionRequest{Model: "claude-sonnet-4-6", MaxCompletionTokens: 8192,
		Temperature: 1.7, ReasoningEffort: "medium", Messages: []openai.ChatCompletionMessage{
			{Role: "system", Content: "system"}, {Role: "system", Content: "summary"},
			{Role: "user", MultiContent: []openai.ChatMessagePart{
				{Type: openai.ChatMessagePartTypeText, Text: "look"},
				{Type: openai.ChatMessagePartTypeImageURL, ImageURL: &openai.ChatMessageImageURL{URL: "data:image/png;base64,aGVsbG8="}},
				{Type: openai.ChatMessagePartTypeImageURL, ImageURL: &openai.ChatMessageImageURL{URL: "https://example.com/image.png"}},
			}},
		}, Tools: []openai.Tool{{Type: openai.ToolTypeFunction, Function: &openai.FunctionDefinition{
			Name: "search", Parameters: map[string]any{"type": "object"},
		}}}}
	payload, err := buildAnthropicRequest(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	if len(payload.System) != 2 || len(payload.Messages[0].Content) != 3 || payload.Thinking.Type != "adaptive" ||
		payload.OutputConfig["effort"] != "medium" || payload.Temperature != nil || len(payload.Tools) != 1 {
		t.Fatalf("unexpected native request: %+v", payload)
	}
	data, _ := json.Marshal(payload)
	for _, expected := range []string{`"media_type":"image/png"`, `"type":"url"`, `"input_schema"`, `"max_tokens":8192`} {
		if !strings.Contains(string(data), expected) {
			t.Errorf("missing %s: %s", expected, data)
		}
	}
	for _, forbidden := range []string{"reasoning_effort", "max_completion_tokens", "stream_options", "image_url"} {
		if strings.Contains(string(data), forbidden) {
			t.Errorf("OpenAI field leaked into native request: %s", forbidden)
		}
	}
	request.Model = "claude-sonnet-4-5"
	payload, err = buildAnthropicRequest(context.Background(), request)
	if err != nil || payload.Thinking.Type != "enabled" || payload.Thinking.BudgetTokens != 4096 {
		t.Fatalf("legacy thinking: %+v %v", payload, err)
	}
	request.ReasoningEffort = "none"
	payload, err = buildAnthropicRequest(context.Background(), request)
	if err != nil || payload.Thinking.Type != "disabled" || *payload.Temperature != 1 {
		t.Fatalf("disabled thinking: %+v %v", payload, err)
	}
}

func TestAnthropicIncompleteStreams(t *testing.T) {
	for _, tc := range []struct {
		name   string
		events []string
	}{
		{"empty", nil},
		{"missing stop", anthropicToolEvents[:len(anthropicToolEvents)-1]},
		{"missing block stop", append(append([]string(nil), anthropicToolEvents[:16]...), `{"type":"message_stop"}`)},
		{"truncated tools", append(append([]string(nil), anthropicToolEvents[:19]...),
			`{"type":"message_delta","delta":{"stop_reason":"max_tokens"}}`, `{"type":"message_stop"}`)},
		{"malformed input", []string{anthropicToolEvents[0],
			`{"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"a","name":"search","input":{}}}`,
			`{"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{"}}`,
			`{"type":"content_block_stop","index":0}`}},
		{"unsigned thinking", []string{anthropicToolEvents[0], anthropicToolEvents[3], anthropicToolEvents[4], anthropicToolEvents[7],
			`{"type":"message_delta","delta":{"stop_reason":"end_turn"}}`, `{"type":"message_stop"}`}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				writeAnthropicEvents(w, tc.events...)
			}))
			defer server.Close()
			stream, err := createAnthropicStream(context.Background(), NewAIClientWithModel("", server.URL, "test"),
				openai.ChatCompletionRequest{Model: "test", Messages: []openai.ChatCompletionMessage{{Role: "user", Content: "test"}}})
			if err != nil {
				t.Fatal(err)
			}
			defer stream.Close()
			for i := 0; i < 100; i++ {
				_, err = stream.Recv()
				if err != nil {
					break
				}
			}
			if err == nil || errors.Is(err, io.EOF) || stream.NativeContent() != nil {
				t.Fatalf("incomplete stream was accepted: %v", err)
			}
		})
	}
}

func TestAnthropicNonStreamingAndErrors(t *testing.T) {
	for _, status := range []int{200, 401, 429, 529} {
		t.Run(fmt.Sprint(status), func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(status)
				if status != 200 {
					_, _ = fmt.Fprint(w, `{"type":"error","error":{"type":"overloaded_error","message":"try later"}}`)
					return
				}
				_, _ = fmt.Fprint(w, `{"id":"msg","model":"test","content":[{"type":"text","text":"title"}],"stop_reason":"end_turn","usage":{"input_tokens":5,"output_tokens":2}}`)
			}))
			defer server.Close()
			response, err := CreateOpenAICompletion(context.Background(), NewAIClientWithModel("", server.URL, "test"),
				AnthropicProtocolMessages, openai.ChatCompletionRequest{Model: "test", Messages: []openai.ChatCompletionMessage{{Role: "user", Content: "title"}}}, nil)
			if status == 200 {
				if err != nil || response.Choices[0].Message.Content != "title" || response.Usage.TotalTokens != 7 {
					t.Fatalf("unexpected completion: %+v %v", response, err)
				}
			} else {
				var apiErr *openai.APIError
				if !errors.As(err, &apiErr) || apiErr.HTTPStatusCode != status || apiErr.Message != "try later" {
					t.Fatalf("unexpected error: %v", err)
				}
			}
		})
	}
}

func TestAnthropicModelsPagination(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.URL.Path != "/anthropic/v1/models" || r.Header.Get("x-api-key") != "key" || r.Header.Get("anthropic-version") == "" {
			t.Errorf("unexpected model request: %s %v", r.URL.Path, r.Header)
		}
		if r.URL.Query().Get("after_id") == "" {
			_, _ = fmt.Fprint(w, `{"data":[{"id":"first","max_input_tokens":200000}],"has_more":true,"last_id":"first"}`)
		} else {
			if r.URL.Query().Get("after_id") != "first" {
				t.Error("unexpected cursor")
			}
			_, _ = fmt.Fprint(w, `{"data":[{"id":"second","max_input_tokens":null}],"has_more":false,"last_id":"second"}`)
		}
	}))
	defer server.Close()
	models, err := ListProviderModels("key", server.URL+"/anthropic", AnthropicProtocolMessages, 5)
	if err != nil || calls != 2 || len(models) != 2 || models[0].ContextLength != 200000 || models[1].ContextLength != 0 {
		t.Fatalf("unexpected model list: %+v %v", models, err)
	}
}

func TestAnthropicEndpointPrefixes(t *testing.T) {
	for _, tc := range []struct{ base, prefix string }{
		{"https://api.anthropic.com", "https://api.anthropic.com/v1/"},
		{"https://api.anthropic.com/v1/", "https://api.anthropic.com/v1/"},
		{"https://api.deepseek.com/anthropic", "https://api.deepseek.com/anthropic/v1/"},
		{"https://api.deepseek.com/anthropic/", "https://api.deepseek.com/anthropic/v1/"},
		{"https://api.deepseek.com/anthropic/v1", "https://api.deepseek.com/anthropic/v1/"},
		{"https://gateway.example.com/custom", "https://gateway.example.com/custom/v1/"},
		{"https://gateway.example.com/custom/v1/", "https://gateway.example.com/custom/v1/"},
		{"https://gateway.example.com/a%2Fb", "https://gateway.example.com/a%2Fb/v1/"},
	} {
		for _, resource := range []string{"messages", "models"} {
			got, err := anthropicEndpoint(tc.base, resource)
			if err != nil || got != tc.prefix+resource {
				t.Errorf("endpoint for %s %s: %q, %v", tc.base, resource, got, err)
			}
		}
	}
	got, err := anthropicEndpoint("https://gateway.example.com/anthropic?route=custom", "messages")
	if err != nil || got != "https://gateway.example.com/anthropic/v1/messages?route=custom" {
		t.Fatalf("query parameters changed: %q %v", got, err)
	}
}

func TestAnthropicCancellationAndCredentialRedirect(t *testing.T) {
	t.Run("cancel", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			writeAnthropicEvents(w, anthropicToolEvents[0])
			<-r.Context().Done()
		}))
		defer server.Close()
		ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
		defer cancel()
		stream, err := createAnthropicStream(ctx, NewAIClientWithModel("", server.URL, "test"), openai.ChatCompletionRequest{
			Model: "test", Messages: []openai.ChatCompletionMessage{{Role: "user", Content: "hello"}},
		})
		if err != nil {
			t.Fatal(err)
		}
		defer stream.Close()
		_, _ = stream.Recv()
		_, err = stream.Recv()
		if err == nil || ctx.Err() == nil {
			t.Fatalf("stream was not canceled: %v", err)
		}
	})
	t.Run("redirect", func(t *testing.T) {
		target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Header.Get("x-api-key") != "" || r.Header.Get("X-Secret") != "" {
				t.Error("provider credentials crossed origins")
			}
			_, _ = fmt.Fprint(w, `{"data":[],"has_more":false}`)
		}))
		defer target.Close()
		origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			http.Redirect(w, r, target.URL, http.StatusTemporaryRedirect)
		}))
		defer origin.Close()
		_, err := ListProviderModels("key", origin.URL, AnthropicProtocolMessages, 5, map[string]string{"X-Secret": "private"})
		if err != nil {
			t.Fatal(err)
		}
	})
}

func TestAnthropicNativeVersionAndProtocolProjection(t *testing.T) {
	native := &AIMessageContent{Protocol: AnthropicProtocolMessages, Version: 99,
		Blocks: []json.RawMessage{json.RawMessage(`{"type":"text","text":"native"}`)}}
	request := openai.ChatCompletionRequest{Model: "test", Messages: []openai.ChatCompletionMessage{
		{Role: "user", Content: "hello"}, {Role: "assistant", Content: "answer"}, {Role: "user", Content: "continue"},
	}}
	ctx := ContextWithAIMessageContents(context.Background(), []*AIMessageContent{native})
	if _, err := buildAnthropicRequest(ctx, request); err == nil || !strings.Contains(err.Error(), "version") || native.Version != 99 {
		t.Fatalf("unknown native format was not preserved: %v", err)
	}
	for _, protocol := range []string{OpenAIProtocolChatCompletions, OpenAIProtocolResponses} {
		t.Run(protocol, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				data, _ := io.ReadAll(r.Body)
				if strings.Contains(string(data), "native") || !strings.Contains(string(data), "answer") {
					t.Errorf("native metadata crossed protocols or visible history was lost: %s", data)
				}
				if protocol == OpenAIProtocolChatCompletions {
					_, _ = fmt.Fprint(w, `{"choices":[{"message":{"role":"assistant","content":"done"},"finish_reason":"stop"}]}`)
				} else {
					_, _ = fmt.Fprint(w, `{"status":"completed","output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"done"}]}]}`)
				}
			}))
			defer server.Close()
			response, err := CreateOpenAICompletion(ctx, NewAIClientWithModel("", server.URL, "test"), protocol, request, nil)
			if err != nil || len(response.Choices) != 1 || response.Choices[0].Message.Content != "done" {
				t.Fatalf("cross-protocol completion failed: %+v %v", response, err)
			}
		})
	}
}

func TestAnthropicRestoredToolArguments(t *testing.T) {
	const nativeBlock = `{"type":"tool_use","id":"call","name":"lookup","input":{"nested":{"z":9007199254740993,"a":"value"},"first":true}}`
	for _, tc := range []struct {
		name      string
		arguments string
		valid     bool
	}{
		{"reordered", `{"first":true,"nested":{"a":"value","z":9007199254740993}}`, true},
		{"escaped", `{"first":true,"nested":{"a":"\u0076alue","z":9007199254740993}}`, true},
		{"rounded number", `{"first":true,"nested":{"a":"value","z":9007199254740992}}`, false},
		{"changed value", `{"first":false,"nested":{"a":"value","z":9007199254740993}}`, false},
		{"invalid JSON", `{"first":true} {}`, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			native := &AIMessageContent{Protocol: AnthropicProtocolMessages, Version: 1,
				Blocks: []json.RawMessage{json.RawMessage(nativeBlock)}}
			request := openai.ChatCompletionRequest{Model: "test", Messages: []openai.ChatCompletionMessage{
				{Role: "user", Content: "lookup"},
				{Role: "assistant", ToolCalls: []openai.ToolCall{{ID: "call", Type: openai.ToolTypeFunction,
					Function: openai.FunctionCall{Name: "lookup", Arguments: tc.arguments}}}},
				{Role: "tool", ToolCallID: "call", Content: "found"},
			}}
			payload, err := buildAnthropicRequest(ContextWithAIMessageContents(context.Background(), []*AIMessageContent{native}), request)
			if (err == nil) != tc.valid {
				t.Fatalf("unexpected history validation: %v", err)
			}
			if tc.valid && string(payload.Messages[1].Content[0]) != nativeBlock {
				t.Fatal("native block changed during comparison")
			}
		})
	}
}
