// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

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

func TestExtraBodyForModel(t *testing.T) {
	cases := []struct {
		model string
		want  map[string]any
	}{
		{"MiniMax-M3", map[string]any{"reasoning_split": true}},
		{"minimax-m1", map[string]any{"reasoning_split": true}},
		{"MINIMAX-M3", map[string]any{"reasoning_split": true}}, // 大小写不敏感
		{"abab-6.5-chat", map[string]any{"reasoning_split": true}},
		{"ABAB-7", map[string]any{"reasoning_split": true}},
		{"gpt-4o", nil},
		{"deepseek-chat", nil},
		{"claude-3.5-sonnet", nil},
		{"qwen-max", nil},
		{"", nil},
	}
	for _, tc := range cases {
		got := ExtraBodyForModel(tc.model)
		if !extraEqual(got, tc.want) {
			t.Errorf("ExtraBodyForModel(%q) = %v, want %v", tc.model, got, tc.want)
		}
	}
}

func extraEqual(a, b map[string]any) bool {
	if len(a) != len(b) {
		return false
	}
	for k, v := range a {
		if b[k] != v {
			return false
		}
	}
	return true
}

func TestExtraBodyTransport_ChatPostMerged(t *testing.T) {
	// 拦截 chat/completions POST 请求，验证 extraBody 字段被合并进请求体。
	var captured map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(body, &captured)
		w.Header().Set("Content-Type", "application/json")
		// 返回一个合法的最小 chat completion 响应。
		w.Write([]byte(`{"id":"1","object":"chat.completion","choices":[{"index":0,"message":{"role":"assistant","content":"hi"},"finish_reason":"stop"}]}`))
	}))
	defer server.Close()

	transport := &extraBodyTransport{
		base:      server.Client(),
		extraBody: map[string]any{"reasoning_split": true},
	}

	body := `{"model":"minimax-m3","messages":[{"role":"user","content":"hi"}]}`
	req, _ := http.NewRequest(http.MethodPost, server.URL+"/v1/chat/completions", strings.NewReader(body))
	resp, err := transport.Do(req)
	if err != nil {
		t.Fatalf("Do failed: %v", err)
	}
	defer resp.Body.Close()

	if captured["reasoning_split"] != true {
		t.Fatalf("expected reasoning_split=true in merged body, got %v", captured["reasoning_split"])
	}
	if captured["model"] != "minimax-m3" {
		t.Fatalf("expected model preserved, got %v", captured["model"])
	}
}

func TestExtraBodyTransportTemperatureOverride(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload map[string]json.RawMessage
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Error(err)
		}
		if string(payload["temperature"]) != "0.5" || string(payload["seed"]) != "9007199254740993" {
			t.Errorf("extra body temperature must take precedence: %#v", payload)
		}
		w.Write([]byte(`{}`))
	}))
	defer server.Close()
	transport := &extraBodyTransport{base: server.Client(), extraBody: map[string]any{"temperature": 0.5}}
	ctx := ContextWithOpenAIChatTemperature(context.Background(), 0)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, server.URL+"/v1/chat/completions", strings.NewReader(`{"model":"test","seed":9007199254740993}`))
	if err != nil {
		t.Fatal(err)
	}
	resp, err := transport.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
}

func TestExtraBodyTransport_NonChatPassthrough(t *testing.T) {
	// 非 chat 请求（如 GET /v1/models）应原样透传，不注入任何字段。
	var receivedBody []byte
	var method string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		method = r.Method
		receivedBody, _ = io.ReadAll(r.Body)
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"data":[{"id":"gpt-4o"}]}`))
	}))
	defer server.Close()

	transport := &extraBodyTransport{
		base:      server.Client(),
		extraBody: map[string]any{"reasoning_split": true},
	}

	origBody := `{"hello":"world"}`
	req, _ := http.NewRequest(http.MethodGet, server.URL+"/v1/models", strings.NewReader(origBody))
	req = req.WithContext(ContextWithOpenAIChatTemperature(context.Background(), 0))
	resp, err := transport.Do(req)
	if err != nil {
		t.Fatalf("Do failed: %v", err)
	}
	defer resp.Body.Close()

	if method != http.MethodGet {
		t.Fatalf("expected GET passthrough, got %s", method)
	}
	if string(receivedBody) != origBody {
		t.Fatalf("non-chat body should pass through unchanged, got %q", string(receivedBody))
	}
}

func TestExtraBodyTransport_InvalidJSONPassthrough(t *testing.T) {
	// 请求体不是合法 JSON 时，应原样透传原始 body，不破坏请求。
	var receivedBody []byte
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		receivedBody, _ = io.ReadAll(r.Body)
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{}`))
	}))
	defer server.Close()

	transport := &extraBodyTransport{
		base:      server.Client(),
		extraBody: map[string]any{"reasoning_split": true},
	}

	origBody := `not-valid-json`
	req, _ := http.NewRequest(http.MethodPost, server.URL+"/v1/chat/completions", strings.NewReader(origBody))
	resp, err := transport.Do(req)
	if err != nil {
		t.Fatalf("Do failed: %v", err)
	}
	defer resp.Body.Close()

	if string(receivedBody) != origBody {
		t.Fatalf("invalid JSON body should pass through unchanged, got %q want %q", string(receivedBody), origBody)
	}
}

func TestExtraBodyTransport_EmptyExtraPassthrough(t *testing.T) {
	// extraBody 为空时，即便是 chat POST 也应原样透传（不经过合并逻辑）。
	var receivedBody []byte
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		receivedBody, _ = io.ReadAll(r.Body)
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{}`))
	}))
	defer server.Close()

	transport := &extraBodyTransport{
		base:      server.Client(),
		extraBody: nil,
	}

	origBody := `{"model":"gpt-4o"}`
	req, _ := http.NewRequest(http.MethodPost, server.URL+"/v1/chat/completions", strings.NewReader(origBody))
	resp, err := transport.Do(req)
	if err != nil {
		t.Fatalf("Do failed: %v", err)
	}
	defer resp.Body.Close()

	if string(receivedBody) != origBody {
		t.Fatalf("empty extraBody should pass through unchanged, got %q", string(receivedBody))
	}
}
