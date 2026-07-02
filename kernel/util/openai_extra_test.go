// SiYuan - Refactor your thinking
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
