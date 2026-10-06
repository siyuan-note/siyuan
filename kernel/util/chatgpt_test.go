package util

import (
	"context"
	"encoding/json"
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

func TestChatGPTTransportRejectsNonPublicRoutes(t *testing.T) {
	transport := &chatGPTTransport{}
	for _, endpoint := range []string{"https://api.openai.com/v1/responses/compact", "https://chatgpt.com/backend-api/codex/responses", "https://untrusted.example/responses"} {
		request, _ := http.NewRequest("POST", endpoint, strings.NewReader("{}"))
		if _, err := transport.Do(request); err == nil {
			t.Fatal("untrusted endpoint accepted")
		}
	}
}
