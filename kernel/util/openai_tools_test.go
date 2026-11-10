// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package util

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"

	"github.com/sashabaranov/go-openai"
)

func TestOpenAIFunctionToolsOnWire(t *testing.T) {
	for _, protocol := range []string{OpenAIProtocolChatCompletions, OpenAIProtocolResponses} {
		for _, streaming := range []bool{false, true} {
			for _, strict := range []bool{false, true} {
				t.Run(fmt.Sprintf("%s/stream=%v/strict=%v", protocol, streaming, strict), func(t *testing.T) {
					schema := map[string]any{
						"type": "object", "required": []any{"action"},
						"properties": map[string]any{
							"action": map[string]any{"type": "string", "enum": []any{"load", "save"}},
							"source": map[string]any{"type": "string", "enum": []any{"builtin"}},
						},
						"allOf": []any{map[string]any{"if": map[string]any{"properties": map[string]any{"action": map[string]any{"const": "save"}}}, "then": map[string]any{"required": []any{"source"}}}},
					}
					before, _ := json.Marshal(schema)
					calls := 0
					server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
						calls++
						var payload map[string]any
						if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
							t.Error(err)
							w.WriteHeader(http.StatusBadRequest)
							return
						}
						tool := payload["tools"].([]any)[0].(map[string]any)
						if IsOpenAIResponsesProtocol(protocol) {
							if r.URL.Path != "/v1/responses" || tool["strict"] != strict {
								t.Errorf("Responses strict flag missing or changed: %#v", tool)
							}
						} else {
							if r.URL.Path != "/v1/chat/completions" {
								t.Errorf("unexpected path: %s", r.URL.Path)
							}
							tool = tool["function"].(map[string]any)
						}
						parameters := tool["parameters"].(map[string]any)
						if _, exists := parameters["allOf"]; exists {
							t.Errorf("unsupported root constraint sent: %#v", parameters)
						}
						if !reflect.DeepEqual(parameters["required"], []any{"action"}) ||
							!reflect.DeepEqual(parameters["properties"], schema["properties"]) {
							t.Errorf("optional properties or nested constraints changed: %#v", parameters)
						}
						if IsOpenAIResponsesProtocol(protocol) {
							writeSamplingTestResponse(w, streaming)
						} else if streaming {
							w.Header().Set("Content-Type", "text/event-stream")
							_, _ = w.Write([]byte("data: {\"id\":\"chat_1\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"OK\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n"))
						} else {
							w.Header().Set("Content-Type", "application/json")
							_, _ = w.Write([]byte(`{"id":"chat_1","choices":[{"index":0,"message":{"role":"assistant","content":"OK"},"finish_reason":"stop"}]}`))
						}
					}))
					defer server.Close()
					function := &openai.FunctionDefinition{Name: "skill", Strict: strict, Parameters: schema}
					request := openai.ChatCompletionRequest{Model: "test", Messages: []openai.ChatCompletionMessage{{Role: "user", Content: "hello"}},
						Tools: []openai.Tool{{Type: openai.ToolTypeFunction, Function: function}}}
					client := NewAIClientWithModel("test", server.URL+"/v1", request.Model)
					if streaming {
						stream, err := CreateOpenAICompletionStream(context.Background(), client, protocol, request, nil)
						if err != nil {
							t.Fatal(err)
						}
						stream.Close()
					} else if _, err := CreateOpenAICompletion(context.Background(), client, protocol, request, nil); err != nil {
						t.Fatal(err)
					}
					after, _ := json.Marshal(schema)
					if calls != 1 || string(after) != string(before) || request.Tools[0].Function != function {
						t.Fatalf("request changed shared tool declaration or repeated: calls=%d schema=%s", calls, after)
					}
				})
			}
		}
	}
}

func TestOpenAIModelFunctionPreservesOtherSchemas(t *testing.T) {
	for _, schema := range []any{json.RawMessage(`{"type":"object"}`), map[string]any{"type": "string", "enum": []any{"a"}}} {
		converted := openAIModelFunction(openai.FunctionDefinition{Parameters: schema})
		if !reflect.DeepEqual(converted.Parameters, schema) {
			t.Fatalf("unrelated schema changed: %#v", converted.Parameters)
		}
	}
	tool := openai.Tool{Type: "web_search", Parameters: map[string]any{"search_context_size": "low"}}
	if got := responseTools([]openai.Tool{tool}); !reflect.DeepEqual(got[0].Parameters, tool.Parameters) {
		t.Fatalf("non-function tool changed: %#v", got)
	}
}
