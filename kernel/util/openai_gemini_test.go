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

package util

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestIsGoogleGeminiOpenAICompatibleEndpoint(t *testing.T) {
	tests := []struct {
		baseURL string
		model   string
		want    bool
	}{
		{"https://generativelanguage.googleapis.com/v1beta/openai", "gemini-3.5-flash", true},
		{"https://GENERATIVELANGUAGE.GOOGLEAPIS.COM/v1beta/openai/", "GEMINI-3-pro", true},
		{"https://generativelanguage.googleapis.com/v1beta", "gemini-3.5-flash", false},
		{"https://example.com/v1beta/openai", "gemini-3.5-flash", false},
		{"https://generativelanguage.googleapis.com/v1beta/openai", "gpt-5", false},
		{"not a URL", "gemini-3.5-flash", false},
	}
	for _, test := range tests {
		if got := isGoogleGeminiOpenAICompatibleEndpoint(test.baseURL, test.model); got != test.want {
			t.Errorf("isGoogleGeminiOpenAICompatibleEndpoint(%q, %q) = %v, want %v",
				test.baseURL, test.model, got, test.want)
		}
	}
}

func TestGeminiThoughtSignatureTransportRoundTrip(t *testing.T) {
	const (
		existingCallID    = "call-existing"
		existingSignature = "existing-signature"
		legacyCallID      = "call-legacy"
		newCallID         = "call-new"
		newSignature      = "new-signature"
	)

	var captured map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Errorf("read request failed: %v", err)
			return
		}
		if err = json.Unmarshal(body, &captured); err != nil {
			t.Errorf("decode request failed: %v", err)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = io.WriteString(w,
			`data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"`+newCallID+
				`","type":"function","function":{"name":"document","arguments":"{}"}}]}}]}`+"\n\n")
		_, _ = io.WriteString(w,
			`data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"extra_content":{"google":`+
				`{"thought_signature":"`+newSignature+`"}}}]}}]}`+"\n\n")
		_, _ = io.WriteString(w, "data: [DONE]\n\n")
	}))
	defer server.Close()

	state := NewGeminiThoughtSignatureState()
	state.Set(existingCallID, existingSignature)
	ctx := ContextWithGeminiThoughtSignatureState(context.Background(), state)
	body := `{"model":"gemini-3.5-flash","messages":[` +
		`{"role":"assistant","tool_calls":[` +
		`{"id":"` + existingCallID + `","type":"function","function":{"name":"document","arguments":"{}"}},` +
		`{"id":"` + legacyCallID + `","type":"function","function":{"name":"block","arguments":"{}"}}]},` +
		`{"role":"tool","tool_call_id":"` + existingCallID + `","content":"ok"}]}`
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, server.URL+"/v1/chat/completions", strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	transport := WrapGeminiThoughtSignatureTransport(server.Client())
	resp, err := transport.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = io.Copy(io.Discard, resp.Body); err != nil {
		t.Fatal(err)
	}
	if err = resp.Body.Close(); err != nil {
		t.Fatal(err)
	}

	toolCalls := captured["messages"].([]any)[0].(map[string]any)["tool_calls"].([]any)
	if got := geminiThoughtSignatureFromToolCall(toolCalls[0].(map[string]any)); got != existingSignature {
		t.Fatalf("actual thought signature = %q, want %q", got, existingSignature)
	}
	if got := geminiThoughtSignatureFromToolCall(toolCalls[1].(map[string]any)); got != geminiThoughtSignatureValidatorSkip {
		t.Fatalf("legacy thought signature = %q, want fallback", got)
	}
	if got := state.Get(newCallID); got != newSignature {
		t.Fatalf("captured thought signature = %q, want %q", got, newSignature)
	}
}

func TestGeminiThoughtSignatureTransportWithoutStatePassesThrough(t *testing.T) {
	var received []byte
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		received, _ = io.ReadAll(r.Body)
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{}`)
	}))
	defer server.Close()

	body := `{"messages":[{"role":"assistant","tool_calls":[{"id":"call-1","type":"function",` +
		`"function":{"name":"document","arguments":"{}"}}]}]}`
	req, err := http.NewRequest(http.MethodPost, server.URL+"/v1/chat/completions", strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	resp, err := WrapGeminiThoughtSignatureTransport(server.Client()).Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if string(received) != body {
		t.Fatalf("request without state changed: %s", received)
	}
}
