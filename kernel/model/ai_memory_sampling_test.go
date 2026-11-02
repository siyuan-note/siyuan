// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAIMemoryContextBudgetCountsTokens(t *testing.T) {
	for _, protocol := range []string{util.OpenAIProtocolResponses, util.OpenAIProtocolChatCompletions} {
		t.Run(protocol, func(t *testing.T) {
			cfg := setupAIMemoryTest(t)
			cfg.Providers[0].Protocol = protocol
			cfg.Providers[0].Models[0].ContextLength = 8192
			calls := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				w.Header().Set("Content-Type", "application/json")
				if protocol == util.OpenAIProtocolResponses {
					fmt.Fprint(w, `{"id":"resp_test","status":"completed","output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"ok"}]}]}`)
				} else {
					fmt.Fprint(w, `{"choices":[{"finish_reason":"stop","message":{"role":"assistant","content":"ok"}}]}`)
				}
			}))
			defer server.Close()
			cfg.Providers[0].BaseURL = server.URL + "/v1"
			for _, prompt := range []string{strings.Repeat("hello ", 2000), strings.Repeat("中文测试", 500)} {
				if got, err := memoryComplete(context.Background(), cfg, prompt); err != nil || got != "ok" {
					t.Fatalf("in-budget token input rejected: %v", err)
				}
			}
			for _, prompt := range []string{strings.Repeat("hello ", 9000), strings.Repeat("中文测试", 3000)} {
				if _, err := memoryComplete(context.Background(), cfg, prompt); err == nil || err.Error() != "memory input exceeds selected model context budget" {
					t.Fatalf("over-budget token input accepted: %v", err)
				}
			}
			if calls != 2 {
				t.Fatalf("over-budget input reached provider: calls=%d", calls)
			}
		})
	}
}

func TestAIMemoryResponsesUsesDefaultSampling(t *testing.T) {
	for _, effort := range []string{"", "none", "low", "medium", "high", "xhigh", "max"} {
		t.Run("effort="+effort, func(t *testing.T) {
			cfg := setupAIMemoryTest(t)
			cfg.Memory.ReasoningEffort = effort
			cfg.Providers[0].Models[0].Name = "gpt-6-luna"
			calls := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				var payload map[string]any
				if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
					t.Error(err)
					return
				}
				if r.URL.Path != "/v1/responses" || payload["model"] != "gpt-6-luna" || payload["max_output_tokens"] != float64(8192) {
					t.Errorf("unexpected request metadata: %s", r.URL.Path)
				}
				for _, field := range []string{"temperature", "top_p", "text"} {
					if _, exists := payload[field]; exists {
						w.WriteHeader(http.StatusBadRequest)
						fmt.Fprint(w, `{"error":{"code":"unsupported_value","param":"temperature","message":"PRIVATE_RESPONSE"}}`)
						return
					}
				}
				if effort == "" {
					if _, exists := payload["reasoning"]; exists {
						t.Error("default reasoning was overridden")
					}
				} else if payload["reasoning"].(map[string]any)["effort"] != effort {
					t.Error("explicit reasoning effort changed")
				}
				w.Header().Set("Content-Type", "application/json")
				fmt.Fprint(w, `{"id":"resp_test","status":"completed","output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"ok"}]}]}`)
			}))
			defer server.Close()
			cfg.Providers[0].BaseURL = server.URL + "/v1"
			cfg.Providers[0].Protocol = util.OpenAIProtocolResponses
			got, err := memoryCompleteStage(context.Background(), cfg, "keywords", "PRIVATE_INPUT")
			if err != nil || got != "ok" || calls != 1 {
				t.Fatalf("unexpected memory request outcome: calls=%d err=%v", calls, err)
			}
		})
	}
}
