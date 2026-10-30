// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/sashabaranov/go-openai"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAIMemoryModelErrorClassification(t *testing.T) {
	secret := "PRIVATE_INPUT Authorization: Bearer PRIVATE_KEY https://private.invalid/?key=PRIVATE_KEY"
	for _, test := range []struct {
		name string
		err  error
		want memoryModelError
	}{
		{"cancel", context.Canceled, 458},
		{"deadline", fmt.Errorf("%s: %w", secret, context.DeadlineExceeded), 449},
		{"connection", &url.Error{Op: secret, URL: secret, Err: &net.OpError{Op: "dial", Err: errors.New(secret)}}, 448},
		{"dns timeout", &net.DNSError{Err: secret, IsTimeout: true}, 449},
		{"authentication", &openai.APIError{HTTPStatusCode: 401, Message: secret, Code: "insufficient_quota"}, 450},
		{"permission", &openai.APIError{HTTPStatusCode: 403, Message: secret}, 451},
		{"rate", &openai.APIError{HTTPStatusCode: 429, Message: "quota " + secret}, 452},
		{"quota code", &openai.APIError{HTTPStatusCode: 429, Code: "insufficient_quota", Message: secret}, 453},
		{"quota type", &openai.APIError{Type: "insufficient_quota", Message: secret}, 453},
		{"model", &openai.APIError{HTTPStatusCode: 404, Message: secret}, 454},
		{"parameters", &openai.APIError{HTTPStatusCode: 400, Message: secret}, 454},
		{"validation", &openai.APIError{HTTPStatusCode: 422, Message: secret}, 454},
		{"server", &openai.RequestError{HTTPStatusCode: 503, Body: []byte(secret), Err: errors.New(secret)}, 455},
		{"gateway timeout", &openai.APIError{HTTPStatusCode: 504, Message: secret}, 449},
		{"response code", &openai.APIError{Code: "model_not_found", Message: secret}, 454},
		{"response rate", &openai.APIError{Code: "rate_limit_exceeded", Message: secret}, 452},
		{"response incomplete", &openai.APIError{Code: "incomplete", Message: secret}, 456},
		{"response incomplete tools", &openai.APIError{Code: "incomplete_tool_calls", Message: secret}, 456},
		{"json syntax", &json.SyntaxError{}, 456},
		{"json type", &json.UnmarshalTypeError{Value: secret}, 456},
		{"truncated", io.ErrUnexpectedEOF, 456},
		{"empty", io.EOF, 456},
		{"unknown", errors.New("quota exceeded " + secret), 457},
		{"untrusted code", &openai.APIError{Code: secret, Message: secret}, 457},
		{"unknown status", &openai.RequestError{HTTPStatusCode: 418, Body: []byte(secret)}, 457},
	} {
		t.Run(test.name, func(t *testing.T) {
			got := classifyMemoryModelError(fmt.Errorf("%s: %w", secret, test.err))
			if got != test.want {
				t.Fatalf("classification = %v, want %v", got, test.want)
			}
			if strings.Contains(got.Error(), "PRIVATE") || strings.Contains(got.Error(), "Authorization") || strings.Contains(got.Error(), "https://") {
				t.Fatal("unsafe error detail reached presentation")
			}
		})
	}
}

func TestAIMemoryProposalErrorDoesNotExposeModelOutput(t *testing.T) {
	for _, raw := range []string{`{"PRIVATE_KEY":"PRIVATE_INPUT"}`, `{"actions":"PRIVATE_INPUT"}`, `{"actions":[{"PRIVATE_INPUT":true}]}`, `null`, `{}`, `{"actions":null}`} {
		_, err := decodeMemoryProposal(raw)
		if err != memoryModelError(456) || strings.Contains(err.Error(), "PRIVATE") {
			t.Fatalf("unsafe proposal error: %v", err)
		}
	}
}

func TestAIMemoryModelHTTPErrorIsSanitized(t *testing.T) {
	for _, protocol := range []string{util.OpenAIProtocolChatCompletions, util.OpenAIProtocolResponses, util.AnthropicProtocolMessages, util.GeminiProtocolInteractions} {
		t.Run(protocol, func(t *testing.T) {
			cfg := setupAIMemoryTest(t)
			oldLog := memoryLogModelFailure
			t.Cleanup(func() { memoryLogModelFailure = oldLog })
			var diagnostics []string
			memoryLogModelFailure = func(diagnostic string) { diagnostics = append(diagnostics, diagnostic) }
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusUnauthorized)
				fmt.Fprint(w, `{"error":{"message":"PRIVATE_KEY PRIVATE_INPUT","type":"authentication_error","code":"invalid_api_key"}}`)
			}))
			defer server.Close()
			cfg.Providers[0].BaseURL = server.URL + "/v1"
			cfg.Providers[0].Protocol = protocol
			_, err := memoryCompleteStage(context.Background(), cfg, "keywords", "PRIVATE_INPUT")
			if err != memoryModelError(450) {
				t.Fatalf("unexpected safe error: %v", err)
			}
			if len(diagnostics) != 1 || !strings.Contains(diagnostics[0], "stage=keywords") || !strings.Contains(diagnostics[0], "http_status=401") || strings.Contains(diagnostics[0], "PRIVATE") {
				t.Fatalf("unsafe or missing production diagnostic: %v", diagnostics)
			}
		})
	}
}

func TestAIMemoryTaskContextFailure(t *testing.T) {
	for _, queued := range []bool{false, true} {
		for _, cancelled := range []bool{false, true} {
			t.Run(fmt.Sprintf("queued=%v/cancelled=%v", queued, cancelled), func(t *testing.T) {
				cfg := setupAIMemoryTest(t)
				ctx, cancel := context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
				wantState, wantError := "failed", memoryModelError(449)
				if cancelled {
					cancel()
					ctx, cancel = context.WithCancel(context.Background())
					cancel()
					wantState, wantError = "cancelled", memoryModelError(458)
				}
				if queued {
					for i := 0; i < cap(memoryModelSlots); i++ {
						memoryModelSlots <- struct{}{}
					}
					defer func() {
						for i := 0; i < cap(memoryModelSlots); i++ {
							<-memoryModelSlots
						}
					}()
				}
				task := &memoryTask{cancel: cancel}
				runAIMemory(ctx, cfg, apicontract.AIMemoryMaintainRequest{}, nil, false, task)
				if task.status.State != wantState || task.status.Error != wantError.Error() || task.status.OverviewPending {
					t.Fatalf("incorrect context outcome: %+v", task.status)
				}
			})
		}
	}
}
