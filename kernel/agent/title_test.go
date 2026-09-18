// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package agent

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestGenerateTitleDisablesReasoningWithinOutputBudget(t *testing.T) {
	var request map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Errorf("decode title request: %v", err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"Reasoning Compatibility"}}]}`))
	}))
	defer server.Close()

	title := GenerateTitle(util.NewAIClientWithModel("test", server.URL+"/v1", "test-model"), server.URL+"/v1",
		util.OpenAIProtocolChatCompletions, "test-model", "Investigate reasoning output", "en")
	if title != "Reasoning Compatibility" {
		t.Fatalf("title = %q", title)
	}
	if request["max_completion_tokens"] != float64(50) || request["reasoning_effort"] != "none" {
		t.Fatalf("unexpected title request: %#v", request)
	}
}

func TestGenerateTitleRetriesWithoutReasoningForLegacyEndpoint(t *testing.T) {
	requests := make([]map[string]any, 0, 2)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request map[string]any
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Errorf("decode title request: %v", err)
			return
		}
		requests = append(requests, request)
		if len(requests) == 1 {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"error":{"message":"reasoning_effort is unsupported"}}`))
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"Legacy Endpoint"}}]}`))
	}))
	defer server.Close()

	title := GenerateTitle(util.NewAIClientWithModel("test", server.URL+"/v1", "test-model"), server.URL+"/v1",
		util.OpenAIProtocolChatCompletions, "test-model", "Investigate legacy endpoint", "en")
	if title != "Legacy Endpoint" || len(requests) != 2 {
		t.Fatalf("title = %q, requests = %d", title, len(requests))
	}
	if requests[1]["reasoning_effort"] != nil || requests[1]["max_completion_tokens"] != float64(512) {
		t.Fatalf("unexpected retry request: %#v", requests[1])
	}
}

func TestGenerateTitleRetriesWithoutReasoningForResponsesEndpoint(t *testing.T) {
	requests := make([]map[string]any, 0, 2)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/responses" {
			t.Errorf("unexpected Responses path: %s", r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
			return
		}
		var request map[string]any
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Errorf("decode title request: %v", err)
			return
		}
		requests = append(requests, request)
		w.Header().Set("Content-Type", "application/json")
		if len(requests) == 1 {
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"error":{"message":"reasoning.effort is unsupported","param":"reasoning.effort","type":"invalid_request_error"}}`))
			return
		}
		_, _ = w.Write([]byte(`{"id":"resp_1","object":"response","status":"completed","model":"test-model","output":[{"id":"msg_1","type":"message","status":"completed","role":"assistant","content":[{"type":"output_text","text":"Responses Endpoint","annotations":[]}]}]}`))
	}))
	defer server.Close()

	title := GenerateTitle(util.NewAIClientWithModel("test", server.URL+"/v1", "test-model"), server.URL+"/v1",
		util.OpenAIProtocolResponses, "test-model", "Investigate Responses endpoint", "en")
	if title != "Responses Endpoint" || len(requests) != 2 {
		t.Fatalf("title = %q, requests = %d", title, len(requests))
	}
	initialReasoning, ok := requests[0]["reasoning"].(map[string]any)
	if !ok || initialReasoning["effort"] != "none" || requests[0]["max_output_tokens"] != float64(50) {
		t.Fatalf("unexpected initial Responses request: %#v", requests[0])
	}
	if requests[1]["reasoning"] != nil || requests[1]["max_output_tokens"] != float64(512) {
		t.Fatalf("unexpected retry Responses request: %#v", requests[1])
	}
}

func TestGenerateTitleRetriesWhenReasoningExhaustsInitialBudget(t *testing.T) {
	requests := make([]map[string]any, 0, 2)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request map[string]any
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Errorf("decode title request: %v", err)
			return
		}
		requests = append(requests, request)
		w.Header().Set("Content-Type", "application/json")
		if len(requests) == 1 {
			_, _ = w.Write([]byte(`{"choices":[{"message":{"reasoning_content":"thinking"},"finish_reason":"length"}]}`))
			return
		}
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"Reasoning Budget"},"finish_reason":"stop"}]}`))
	}))
	defer server.Close()

	title := GenerateTitle(util.NewAIClientWithModel("test", server.URL+"/v1", "test-model"), server.URL+"/v1",
		util.OpenAIProtocolChatCompletions, "test-model", "Investigate title token budget", "en")
	if title != "Reasoning Budget" || len(requests) != 2 {
		t.Fatalf("title = %q, requests = %d", title, len(requests))
	}
	if requests[1]["reasoning_effort"] != nil || requests[1]["max_completion_tokens"] != float64(512) {
		t.Fatalf("unexpected retry request: %#v", requests[1])
	}
}

func TestGenerateTitleDoesNotRetryUnrelatedProviderError(t *testing.T) {
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		requests++
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadGateway)
		_, _ = w.Write([]byte(`{"error":{"message":"upstream unavailable"}}`))
	}))
	defer server.Close()

	title := GenerateTitle(util.NewAIClientWithModel("test", server.URL+"/v1", "test-model"), server.URL+"/v1",
		util.OpenAIProtocolChatCompletions, "test-model", "Investigate provider failure", "en")
	if title != "Investigate provider failure" || requests != 1 {
		t.Fatalf("title = %q, requests = %d", title, requests)
	}
}

func TestGenerateTitleDoesNotRetryReasoningErrorFromUnavailableProvider(t *testing.T) {
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		requests++
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadGateway)
		_, _ = w.Write([]byte(`{"error":{"message":"reasoning_effort validation is temporarily unavailable","param":"reasoning_effort"}}`))
	}))
	defer server.Close()

	title := GenerateTitle(util.NewAIClientWithModel("test", server.URL+"/v1", "test-model"), server.URL+"/v1",
		util.OpenAIProtocolChatCompletions, "test-model", "Investigate provider failure", "en")
	if title != "Investigate provider failure" || requests != 1 {
		t.Fatalf("title = %q, requests = %d", title, requests)
	}
}
