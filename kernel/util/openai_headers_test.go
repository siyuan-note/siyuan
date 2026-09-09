package util

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/sashabaranov/go-openai"
)

func TestAIProviderHeadersRequests(t *testing.T) {
	for _, protocol := range []string{OpenAIProtocolChatCompletions, OpenAIProtocolResponses} {
		t.Run(protocol, func(t *testing.T) {
			paths := map[string]int{}
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				paths[r.URL.Path]++
				if r.Header.Get("X-Api-Key") != "custom-key" || r.Header.Get("Authorization") != "custom-auth" ||
					r.UserAgent() != "custom-agent" {
					t.Error("provider headers missing or default headers not overridden")
				}
				w.Header().Set("Content-Type", "application/json")
				switch r.URL.Path {
				case "/v1/models":
					io.WriteString(w, `{"data":[{"id":"MiniMax-M3","context_length":12345}]}`)
				case "/v1/responses":
					w.Header().Set("Content-Type", "text/event-stream")
					io.WriteString(w, "event: response.completed\ndata: {\"type\":\"response.completed\",\"response\":{\"id\":\"resp_1\",\"status\":\"completed\",\"output\":[]}}\n\n")
				default:
					io.WriteString(w, `{"choices":[{"message":{"role":"assistant","content":"ok"},"finish_reason":"stop"}]}`)
				}
			}))
			defer server.Close()
			headers := map[string]string{"x-api-key": "custom-key", "authorization": "custom-auth", "User-Agent": "custom-agent"}
			models, err := ListAvailableModelsWithContext("key", server.URL+"/v1", 5, headers)
			if err != nil || len(models) != 1 || models[0].ContextLength != 12345 {
				t.Fatalf("list models: %v, %v", models, err)
			}
			_, matched, err := TestModel("key", server.URL+"/v1", protocol, "MiniMax-M3", 5, headers)
			if err != nil || !matched {
				t.Fatalf("test model: matched=%v, err=%v", matched, err)
			}
			endpoint := "/v1/chat/completions"
			if protocol == OpenAIProtocolResponses {
				endpoint = "/v1/responses"
			}
			if paths["/v1/models"] != 2 || paths[endpoint] != 1 {
				t.Fatalf("unexpected requests: %v", paths)
			}
		})
	}
}

func TestAIProviderHeadersStreamingAndImages(t *testing.T) {
	for _, protocol := range []string{OpenAIProtocolChatCompletions, OpenAIProtocolResponses} {
		t.Run(protocol, func(t *testing.T) {
			seen := false
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				seen = true
				if r.Header.Get("X-Route") != "original" {
					t.Error("client did not retain its own header snapshot")
				}
				w.Header().Set("Content-Type", "text/event-stream")
				io.WriteString(w, "data: [DONE]\n\n")
			}))
			defer server.Close()
			headers := map[string]string{"X-Route": "original"}
			client := NewOpenAIClientWithModel("key", server.URL+"/v1", "MiniMax-M3", headers)
			headers["X-Route"] = "changed"
			stream, err := CreateOpenAICompletionStream(context.Background(), client, protocol, openai.ChatCompletionRequest{
				Model: "MiniMax-M3", Messages: []openai.ChatCompletionMessage{{Role: "user", Content: "hi"}},
			}, nil)
			if err != nil {
				t.Fatal(err)
			}
			stream.Close()
			if !seen {
				t.Fatal("stream request missing")
			}
		})
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/images/generations" || r.Header.Get("X-Route") != "image" {
			t.Error("image request missing provider headers")
		}
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, `{"data":[]}`)
	}))
	defer server.Close()
	adapter := NewOpenAIImageAdapter("key", server.URL+"/v1", "image-model", 5, map[string]string{"X-Route": "image"})
	if _, err := adapter.client.CreateImage(context.Background(), openai.ImageRequest{Prompt: "hi", Model: "image-model"}); err != nil {
		t.Fatal(err)
	}
}

func TestAIProviderHeadersRedirectAndValidation(t *testing.T) {
	destination := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Secret") != "" || r.Header.Get("Authorization") != "" {
			t.Error("provider credentials leaked across origins")
		}
	}))
	defer destination.Close()
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Secret") != "secret" {
			t.Error("source header missing")
		}
		if r.URL.Path == "/" {
			http.Redirect(w, r, "/next", http.StatusFound)
		} else {
			http.Redirect(w, r, destination.URL, http.StatusFound)
		}
	}))
	defer source.Close()
	client := newAIProviderHTTPClient(source.URL, map[string]string{"X-Secret": "secret", "Authorization": "secret"})
	response, err := client.Get(source.URL)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	for _, headers := range []map[string]string{
		{"Bad Name": "secret"}, {"X-Test": "secret\r\ninjected: true"}, {"X-Test": "a", "x-test": "b"},
	} {
		client = newAIProviderHTTPClient(source.URL, headers)
		if _, err = client.Get(source.URL); err == nil || strings.Contains(err.Error(), "secret") {
			t.Fatalf("expected validation error without header values, got %v", err)
		}
	}
}
