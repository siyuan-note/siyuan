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
		{"https://generativelanguage.googleapis.com/v1beta/openai", "models/gemini-3.5-flash", true},
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

func TestGeminiThinkingLevel(t *testing.T) {
	tests := []struct {
		effort string
		level  string
		ok     bool
	}{
		{"", "", true},
		{"none", "low", true},
		{"low", "low", true},
		{"medium", "medium", true},
		{"high", "high", true},
		{"xhigh", "high", true},
		{"max", "high", true},
		{"unsupported", "", false},
	}
	for _, test := range tests {
		level, ok := geminiThinkingLevel(test.effort)
		if level != test.level || ok != test.ok {
			t.Errorf("geminiThinkingLevel(%q) = %q, %v", test.effort, level, ok)
		}
	}
}

func TestConfigureGeminiThoughtSummariesScope(t *testing.T) {
	gemini3 := map[string]any{"model": "models/gemini-3.5-flash"}
	changed, configured := configureGeminiThoughtSummaries(gemini3)
	if !changed || !configured {
		t.Fatal("Gemini 3 thought summaries were not configured")
	}
	thinkingConfig := gemini3["extra_body"].(map[string]any)["google"].(map[string]any)["thinking_config"].(map[string]any)
	if thinkingConfig["include_thoughts"] != true {
		t.Fatalf("unexpected Gemini 3 thinking config: %#v", thinkingConfig)
	}
	if _, hasLevel := thinkingConfig["thinking_level"]; hasLevel {
		t.Fatalf("default Gemini thinking level must remain model-defined: %#v", thinkingConfig)
	}

	gemini25 := map[string]any{"model": "models/gemini-2.5-flash", "reasoning_effort": "high"}
	changed, configured = configureGeminiThoughtSummaries(gemini25)
	if changed || configured || gemini25["reasoning_effort"] != "high" {
		t.Fatalf("Gemini 2.5 request was changed: %#v", gemini25)
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
	ctx = ContextWithGeminiThoughtSummaries(ctx)
	body := `{"model":"models/gemini-3.5-flash","reasoning_effort":"high","messages":[` +
		`{"role":"assistant","tool_calls":[` +
		`{"id":"` + existingCallID + `","type":"function","function":{"name":"document","arguments":"{}"}},` +
		`{"id":"` + legacyCallID + `","type":"","function":{"name":"block","arguments":"{}"}}]},` +
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
	if _, exists := captured["reasoning_effort"]; exists {
		t.Fatal("reasoning_effort must be removed when Gemini thought summaries are enabled")
	}
	extraBody := captured["extra_body"].(map[string]any)
	google := extraBody["google"].(map[string]any)
	thinkingConfig := google["thinking_config"].(map[string]any)
	if thinkingConfig["include_thoughts"] != true || thinkingConfig["thinking_level"] != "high" {
		t.Fatalf("unexpected Gemini thinking config: %#v", thinkingConfig)
	}
	if !state.TaggedSummariesAvailable() {
		t.Fatal("Gemini tagged thought summaries were not enabled")
	}
}

func TestGeminiThoughtSummariesAreOptIn(t *testing.T) {
	var received []byte
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		received, _ = io.ReadAll(r.Body)
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{}`)
	}))
	defer server.Close()

	body := `{"model":"models/gemini-3.5-flash","messages":[{"role":"user","content":"hello"}]}`
	state := NewGeminiThoughtSignatureState()
	ctx := ContextWithGeminiThoughtSignatureState(context.Background(), state)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, server.URL+"/v1/chat/completions", strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	resp, err := WrapGeminiThoughtSignatureTransport(server.Client()).Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if string(received) != body {
		t.Fatalf("request without summary opt-in changed: %s", received)
	}
	if state.TaggedSummariesAvailable() {
		t.Fatal("Gemini tagged thought summaries were enabled without opt-in")
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
