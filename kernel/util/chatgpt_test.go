package util

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/sashabaranov/go-openai"
)

func TestChatGPTRequestCapabilitiesAndToolReplay(t *testing.T) {
	data, err := chatGPTRequestBody([]byte(`{"model":"model","input":[{"type":"message","role":"system","content":"rules"},{"type":"function_call","call_id":"c","name":"query","arguments":"{}"},{"type":"function_call_output","call_id":"c","output":"ok"}],"tools":[{"type":"function","name":"query","parameters":{"type":"object"}}],"temperature":1,"top_p":0.5,"max_output_tokens":100,"user":"user","previous_response_id":"response"}`))
	if err != nil {
		t.Fatal(err)
	}
	var body map[string]any
	json.Unmarshal(data, &body)
	for _, field := range []string{"temperature", "top_p", "max_output_tokens", "user", "previous_response_id"} {
		if _, exists := body[field]; exists {
			t.Fatalf("unsupported field: %s", field)
		}
	}
	if body["stream"] != true || body["store"] != false {
		t.Fatal("wrong subscription transport")
	}
	input := body["input"].([]any)
	if input[0].(map[string]any)["role"] != "developer" || input[1].(map[string]any)["namespace"] != "siyuan" {
		t.Fatal("input not adapted")
	}
	tool := body["tools"].([]any)[0].(map[string]any)
	if tool["type"] != "namespace" || tool["name"] != "siyuan" {
		t.Fatal("tools not namespaced")
	}
	if description, ok := tool["description"].(string); !ok || strings.TrimSpace(description) == "" {
		t.Fatal("tool namespace is missing its required description")
	}
	if functions, ok := tool["tools"].([]any); !ok || len(functions) != 1 || functions[0].(map[string]any)["name"] != "query" {
		t.Fatal("namespaced tool definitions were not preserved")
	}
	if _, err = chatGPTRequestBody([]byte(`{"input":[],"tools":[{"type":"image_generation"}]}`)); err == nil {
		t.Fatal("unsupported hosted tool accepted")
	}
}

func TestChatGPTCompletionUsesStreamAndRejectsIncomplete(t *testing.T) {
	for _, terminal := range []string{"completed", "incomplete", "failed", "disconnected"} {
		t.Run(terminal, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var body map[string]any
				json.NewDecoder(r.Body).Decode(&body)
				if body["stream"] != true {
					t.Error("nonstream subscription request")
				}
				w.Header().Set("Content-Type", "text/event-stream")
				io.WriteString(w, "data: {\"type\":\"response.output_text.delta\",\"delta\":\"Title\"}\n\n")
				if terminal == "disconnected" {
					return
				}
				io.WriteString(w, "data: {\"type\":\"response."+terminal+"\",\"response\":{\"id\":\"resp\",\"status\":\""+terminal+"\",\"model\":\"model\",\"output\":[{\"type\":\"message\",\"role\":\"assistant\",\"content\":[{\"type\":\"output_text\",\"text\":\"Title\"}]}]}}\n\n")
			}))
			defer server.Close()
			client := NewAIClientWithModel("test", server.URL, "model")
			client.ChatGPT = true
			response, err := CreateOpenAICompletion(context.Background(), client, OpenAIProtocolResponses,
				openai.ChatCompletionRequest{Model: "model", Messages: []openai.ChatCompletionMessage{{Role: "user", Content: "title"}}}, nil)
			if terminal == "completed" {
				if err != nil || response.Choices[0].Message.Content != "Title" {
					t.Fatalf("completion: %+v %v", response, err)
				}
			} else if err == nil {
				t.Fatal("unfinished response accepted")
			}
		})
	}
}

func TestChatGPTCompletionWithStreamedOutputItems(t *testing.T) {
	for _, scenario := range []string{"text", "refusal", "missing-item", "mismatch", "missing-index", "api-key"} {
		t.Run(scenario, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.Header().Set("Content-Type", "text/event-stream")
				deltaType, contentType, field := "output_text", "output_text", "text"
				if scenario == "refusal" {
					deltaType, contentType, field = "refusal", "refusal", "refusal"
				}
				fmt.Fprintf(w, "data: {\"type\":\"response.%s.delta\",\"output_index\":0,\"content_index\":0,\"delta\":\"OK\"}\n\n", deltaType)
				if scenario != "missing-item" {
					index, text := 0, "OK"
					if scenario == "missing-index" {
						index = 1
					}
					if scenario == "mismatch" {
						text = "different"
					}
					fmt.Fprintf(w, "data: {\"type\":\"response.output_item.done\",\"output_index\":%d,\"item\":{\"id\":\"message\",\"type\":\"message\",\"status\":\"completed\",\"role\":\"assistant\",\"content\":[{\"type\":\"%s\",\"%s\":\"%s\"}]}}\n\n", index, contentType, field, text)
				}
				io.WriteString(w, "data: {\"type\":\"response.completed\",\"response\":{\"id\":\"response\",\"status\":\"completed\",\"model\":\"model\",\"usage\":{\"input_tokens\":2,\"output_tokens\":1,\"total_tokens\":3}}}\n\n")
			}))
			defer server.Close()
			client := NewAIClientWithModel("test", server.URL, "model")
			client.ChatGPT = scenario != "api-key"
			if scenario == "api-key" {
				stream, err := CreateOpenAICompletionStream(context.Background(), client, OpenAIProtocolResponses,
					openai.ChatCompletionRequest{Model: "model"}, nil)
				if err != nil {
					t.Fatal(err)
				}
				defer stream.Close()
				for {
					_, err = stream.Recv()
					if err != nil {
						break
					}
				}
				if err == io.EOF || !strings.Contains(err.Error(), "does not match") {
					t.Fatalf("API key stream lost its terminal validation: %v", err)
				}
				return
			}
			response, err := CreateOpenAICompletion(context.Background(), client, OpenAIProtocolResponses,
				openai.ChatCompletionRequest{Model: "model"}, nil)
			if scenario == "text" || scenario == "refusal" {
				if err != nil || len(response.Choices) != 1 || response.Choices[0].Message.Content != "OK" || response.Usage.TotalTokens != 3 {
					t.Fatalf("streamed items did not complete correctly: %+v %v", response, err)
				}
			} else if err == nil {
				t.Fatal("inconsistent terminal output was accepted")
			}
		})
	}
}

func TestChatGPTStreamedOutputPreservesToolAndReasoning(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		io.WriteString(w, `data: {"type":"response.output_item.done","output_index":0,"item":{"id":"reasoning","type":"reasoning","encrypted_content":"encrypted-reasoning"}}

data: {"type":"response.output_text.delta","output_index":1,"content_index":0,"delta":"Checking"}

data: {"type":"response.output_item.done","output_index":1,"item":{"id":"message","type":"message","status":"completed","role":"assistant","content":[{"type":"output_text","text":"Checking"}]}}

data: {"type":"response.output_item.added","output_index":2,"item":{"id":"function","type":"function_call","status":"in_progress","call_id":"call","namespace":"siyuan","name":"lookup","arguments":""}}

data: {"type":"response.function_call_arguments.delta","output_index":2,"delta":"{}"}

data: {"type":"response.output_item.done","output_index":2,"item":{"id":"function","type":"function_call","status":"completed","call_id":"call","namespace":"siyuan","name":"lookup","arguments":"{}"}}

data: {"type":"response.completed","response":{"id":"response","status":"completed","model":"model","output":[]}}

`)
	}))
	defer server.Close()
	client := NewAIClientWithModel("test", server.URL, "model")
	client.ChatGPT = true
	stream, err := CreateOpenAICompletionStream(context.Background(), client, OpenAIProtocolResponses, openai.ChatCompletionRequest{Model: "model"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Close()
	var text, arguments strings.Builder
	var finish openai.FinishReason
	for {
		chunk, err := stream.Recv()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		for _, choice := range chunk.Choices {
			text.WriteString(choice.Delta.Content)
			for _, call := range choice.Delta.ToolCalls {
				arguments.WriteString(call.Function.Arguments)
			}
			if choice.FinishReason != "" {
				finish = choice.FinishReason
			}
		}
	}
	output := stream.ResponseOutput()
	if len(output) != 3 || !strings.Contains(string(output[0]), `"encrypted_content":"encrypted-reasoning"`) ||
		!strings.Contains(string(output[2]), `"namespace":"siyuan"`) || text.String() != "Checking" || arguments.String() != "{}" || finish != openai.FinishReasonToolCalls {
		t.Fatalf("streamed output was not preserved: %s %q %q %s", output, text.String(), arguments.String(), finish)
	}
}

func TestChatGPTTransportRejectsNonPublicRoutes(t *testing.T) {
	transport := &chatGPTTransport{}
	for _, endpoint := range []string{"https://api.openai.com/v1/responses/compact", "https://chatgpt.com/backend-api/codex/responses", "https://untrusted.example/responses"} {
		request, _ := http.NewRequest("POST", endpoint, strings.NewReader("{}"))
		if _, err := transport.Do(request); err == nil {
			t.Fatal("untrusted endpoint accepted")
		}
	}
}
