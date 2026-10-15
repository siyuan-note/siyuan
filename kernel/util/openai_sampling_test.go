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
	"reflect"
	"testing"

	"github.com/sashabaranov/go-openai"
)

func TestOpenAIResponsesSamplingCompatibility(t *testing.T) {
	for _, streaming := range []bool{false, true} {
		for _, tc := range []struct {
			name        string
			temperature float32
			rejected    []string
		}{
			{name: "supported zero"},
			{name: "supported nonzero", temperature: 0.7},
			{name: "temperature rejected", temperature: 1, rejected: []string{"temperature"}},
			{name: "top_p rejected", rejected: []string{"top_p"}},
			{name: "both rejected", rejected: []string{"temperature", "top_p"}},
		} {
			t.Run(fmt.Sprintf("stream=%v/%s", streaming, tc.name), func(t *testing.T) {
				var payloads []map[string]any
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					if r.URL.Path != "/v1/responses" {
						t.Errorf("unexpected path: %s", r.URL.Path)
					}
					var payload map[string]any
					if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
						t.Errorf("decode request: %s", err)
					}
					payloads = append(payloads, payload)
					if index := len(payloads) - 1; index < len(tc.rejected) {
						writeUnsupportedSamplingParameter(w, tc.rejected[index])
						return
					}
					writeSamplingTestResponse(w, streaming)
				}))
				defer server.Close()

				request := openai.ChatCompletionRequest{
					Model:               "gateway-custom-model",
					Messages:            []openai.ChatCompletionMessage{{Role: "user", Content: "hello"}},
					Temperature:         tc.temperature,
					TopP:                0.8,
					ReasoningEffort:     "high",
					MaxCompletionTokens: 128,
					Tools: []openai.Tool{{Type: openai.ToolTypeFunction, Function: &openai.FunctionDefinition{
						Name: "lookup", Parameters: map[string]any{"type": "object"},
					}}},
				}
				ctx := ContextWithOpenAIResponsesBaseURL(context.Background(), "https://api.openai.com/v1")
				client := NewAIClientWithModel("test", server.URL+"/v1", request.Model)
				if err := runSamplingTestCompletion(ctx, client, request, streaming); err != nil {
					t.Fatal(err)
				}
				if len(payloads) != len(tc.rejected)+1 {
					t.Fatalf("unexpected requests: %#v", payloads)
				}
				if temperature, present := payloads[0]["temperature"].(float64); !present || float32(temperature) != tc.temperature {
					t.Fatalf("temperature was not preserved: %#v", payloads[0])
				}
				if topP, present := payloads[0]["top_p"].(float64); !present || float32(topP) != request.TopP {
					t.Fatalf("top_p was not preserved: %#v", payloads[0])
				}
				if payloads[0]["reasoning"].(map[string]any)["effort"] != "high" ||
					payloads[0]["max_output_tokens"] != float64(128) {
					t.Fatalf("unexpected reasoning or output budget: %#v", payloads[0])
				}
				expected := payloads[0]
				for index, parameter := range tc.rejected {
					delete(expected, parameter)
					if !reflect.DeepEqual(payloads[index+1], expected) {
						t.Fatalf("retry changed unrelated fields: got=%#v want=%#v", payloads[index+1], expected)
					}
				}
			})
		}
	}
}

func TestOmitUnsupportedResponseSamplingParameterRejectsOtherErrors(t *testing.T) {
	parameter := "temperature"
	otherParameter := "reasoning.effort"
	for _, err := range []error{
		nil,
		errors.New("temperature is not supported"),
		context.DeadlineExceeded,
		&openai.APIError{HTTPStatusCode: 401, Code: "unsupported_parameter", Param: &parameter},
		&openai.APIError{HTTPStatusCode: 429, Code: "unsupported_parameter", Param: &parameter},
		&openai.APIError{HTTPStatusCode: 500, Code: "unsupported_parameter", Param: &parameter},
		&openai.APIError{HTTPStatusCode: 400, Code: "unsupported_value", Param: &parameter},
		&openai.APIError{HTTPStatusCode: 400, Code: "unsupported_parameter", Param: &otherParameter},
		&openai.APIError{HTTPStatusCode: 400, Code: "unsupported_parameter"},
		&openai.APIError{HTTPStatusCode: 400, Message: "temperature is not supported", Param: &parameter},
	} {
		t.Run(fmt.Sprintf("%v", err), func(t *testing.T) {
			temperature, topP := float32(0), float32(0.8)
			request := openai.CreateResponseRequest{Temperature: &temperature, TopP: &topP}
			if omitUnsupportedResponseSamplingParameter(&request, err) || request.Temperature == nil || request.TopP == nil {
				t.Fatalf("unrelated error changed sampling: error=%v request=%#v", err, request)
			}
		})
	}
}

func TestOpenAIResponsesSamplingRepeatedRejectionStops(t *testing.T) {
	for _, streaming := range []bool{false, true} {
		t.Run(fmt.Sprintf("stream=%v", streaming), func(t *testing.T) {
			attempts := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				attempts++
				writeUnsupportedSamplingParameter(w, "temperature")
			}))
			defer server.Close()
			err := runSamplingTestCompletion(context.Background(), NewAIClientWithModel("test", server.URL+"/v1", "test-model"),
				openai.ChatCompletionRequest{Model: "test-model", Temperature: 1}, streaming)
			if err == nil || attempts != 2 {
				t.Fatalf("repeated rejection did not stop: attempts=%d err=%v", attempts, err)
			}
		})
	}
}

func TestOpenAIResponsesSamplingDoesNotReplayStartedResponses(t *testing.T) {
	for _, streaming := range []bool{false, true} {
		t.Run(fmt.Sprintf("stream=%v", streaming), func(t *testing.T) {
			attempts := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				attempts++
				if streaming {
					w.Header().Set("Content-Type", "text/event-stream")
					_, _ = io.WriteString(w, "event: error\ndata: {\"type\":\"error\",\"code\":\"unsupported_parameter\",\"param\":\"temperature\",\"message\":\"temperature is not supported\"}\n\n")
				} else {
					w.Header().Set("Content-Type", "application/json")
					_, _ = io.WriteString(w, `{"id":"resp_1","status":"failed","error":{"code":"unsupported_parameter","message":"temperature is not supported"}}`)
				}
			}))
			defer server.Close()
			err := runSamplingTestCompletion(context.Background(), NewAIClientWithModel("test", server.URL+"/v1", "test-model"),
				openai.ChatCompletionRequest{Model: "test-model", Temperature: 1}, streaming)
			if err == nil || attempts != 1 {
				t.Fatalf("started response was retried: attempts=%d err=%v", attempts, err)
			}
		})
	}
}

func TestModelResponsesSamplingAndMinimumBudget(t *testing.T) {
	attempts := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/models":
			w.Header().Set("Content-Type", "application/json")
			_, _ = io.WriteString(w, `{"object":"list","data":[{"id":"gpt-6-luna","object":"model"}]}`)
		case "/v1/responses":
			attempts++
			var payload map[string]any
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Errorf("decode request: %s", err)
			}
			if payload["max_output_tokens"] != float64(16) {
				t.Errorf("invalid Responses probe budget: %#v", payload)
			}
			if _, present := payload["temperature"]; present {
				writeUnsupportedSamplingParameter(w, "temperature")
				return
			}
			w.Header().Set("Content-Type", "text/event-stream")
			_, _ = io.WriteString(w, "event: response.incomplete\ndata: {\"type\":\"response.incomplete\",\"response\":{\"id\":\"resp_1\",\"status\":\"incomplete\",\"output\":[],\"incomplete_details\":{\"reason\":\"max_output_tokens\"}}}\n\n")
		default:
			t.Errorf("unexpected path: %s", r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()
	available, matched, err := TestModel("test", server.URL+"/v1", OpenAIProtocolResponses, "gpt-6-luna", 5)
	if err != nil || !matched || attempts != 2 || len(available) != 1 || available[0] != "gpt-6-luna" {
		t.Fatalf("unexpected probe result: available=%v matched=%v attempts=%d err=%v", available, matched, attempts, err)
	}
}

func TestModelChatSamplingAndBudgetUnchanged(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/v1/models" {
			_, _ = io.WriteString(w, `{"object":"list","data":[{"id":"test-model","object":"model"}]}`)
			return
		}
		if r.URL.Path != "/v1/chat/completions" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		var payload map[string]any
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Errorf("decode request: %s", err)
		}
		if payload["max_completion_tokens"] != float64(1) || payload["temperature"] != float64(1) {
			t.Errorf("Chat probe parameters changed: %#v", payload)
		}
		_, _ = io.WriteString(w, `{"id":"chat_1","object":"chat.completion","model":"test-model","choices":[{"index":0,"message":{"role":"assistant","content":"1"},"finish_reason":"stop"}]}`)
	}))
	defer server.Close()
	_, matched, err := TestModel("test", server.URL+"/v1", OpenAIProtocolChatCompletions, "test-model", 5)
	if err != nil || !matched {
		t.Fatalf("Chat probe failed: matched=%v err=%v", matched, err)
	}
}

func runSamplingTestCompletion(ctx context.Context, client *AIClient, request openai.ChatCompletionRequest, streaming bool) error {
	if !streaming {
		_, err := CreateOpenAICompletion(ctx, client, OpenAIProtocolResponses, request, nil)
		return err
	}
	stream, err := CreateOpenAICompletionStream(ctx, client, OpenAIProtocolResponses, request, nil)
	if err != nil {
		return err
	}
	defer stream.Close()
	for {
		_, err = stream.Recv()
		if errors.Is(err, io.EOF) {
			return nil
		}
		if err != nil {
			return err
		}
	}
}

func writeUnsupportedSamplingParameter(w http.ResponseWriter, parameter string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusBadRequest)
	_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]any{
		"message": fmt.Sprintf("'%s' is not supported with this model", parameter),
		"type":    "invalid_request_error", "param": parameter, "code": "unsupported_parameter",
	}})
}

func writeSamplingTestResponse(w http.ResponseWriter, streaming bool) {
	response := `{"id":"resp_1","object":"response","status":"completed","model":"gateway-custom-model","output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"ok"}]}]}`
	if streaming {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = fmt.Fprintf(w, "event: response.completed\ndata: {\"type\":\"response.completed\",\"response\":%s}\n\n", response)
	} else {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, response)
	}
}
