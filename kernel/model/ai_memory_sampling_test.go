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
	"testing"

	"github.com/siyuan-note/siyuan/kernel/util"
)

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
