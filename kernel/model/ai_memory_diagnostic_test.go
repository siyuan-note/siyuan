// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/sashabaranov/go-openai"
	"github.com/siyuan-note/siyuan/kernel/conf"
)

func TestAIMemoryModelDiagnosticWhitelist(t *testing.T) {
	secret := "PRIVATE_INPUT\nAuthorization: Bearer PRIVATE_KEY https://private.invalid/?key=PRIVATE_KEY"
	parameter := "max_completion_tokens"
	ctx := context.WithValue(context.Background(), memoryModelStageKey{}, "keywords")
	got := memoryModelDiagnostic(ctx, "openai", &openai.APIError{HTTPStatusCode: 400, Code: "unsupported_parameter", Param: &parameter, Message: secret})
	want := "stage=keywords protocol=openai category=454 http_status=400 code=unsupported_parameter parameter=max_completion_tokens"
	if got != want {
		t.Fatalf("diagnostic mismatch: %s", got)
	}
	ctx = context.WithValue(context.Background(), memoryModelStageKey{}, secret)
	for _, err := range []error{
		&openai.APIError{HTTPStatusCode: 400, HTTPStatus: secret, Code: secret, Type: secret, Param: &secret, Message: secret},
		&openai.APIError{HTTPStatusCode: 999999, Code: map[string]string{"secret": secret}, Param: &secret, Message: secret},
		&openai.RequestError{HTTPStatusCode: 422, HTTPStatus: secret, Body: []byte(secret), Err: errors.New(secret)},
		fmt.Errorf("%s: %w", secret, context.DeadlineExceeded),
	} {
		got = memoryModelDiagnostic(ctx, secret, err)
		for _, forbidden := range []string{"PRIVATE", "Authorization", "https://", "\n", "999999"} {
			if strings.Contains(got, forbidden) {
				t.Fatalf("unsafe diagnostic: %s", got)
			}
		}
		if !strings.HasPrefix(got, "stage=unknown protocol=unknown ") {
			t.Fatalf("untrusted metadata accepted: %s", got)
		}
	}
}

func TestAIMemoryModelStagePreservesPrompt(t *testing.T) {
	cfg := setupAIMemoryTest(t)
	memoryComplete = func(ctx context.Context, selected *conf.AI, prompt string) (string, error) {
		if ctx.Value(memoryModelStageKey{}) != "proposal" || selected != cfg || prompt != "PRIVATE_INPUT" {
			t.Fatal("stage wrapper changed request")
		}
		return "response", nil
	}
	if got, err := memoryCompleteStage(context.Background(), cfg, "proposal", "PRIVATE_INPUT"); err != nil || got != "response" {
		t.Fatal("stage wrapper changed result", err)
	}
}

func TestAIMemoryModelDiagnosticProtocol(t *testing.T) {
	for _, test := range []struct {
		provider conf.Provider
		want     string
	}{
		{conf.Provider{Protocol: " OPENAI-RESPONSES "}, "openai-responses"},
		{conf.Provider{Protocol: "openai", AuthType: "chatgpt"}, "chatgpt-responses"},
		{conf.Provider{}, "openai"},
	} {
		got := memoryModelDiagnostic(context.Background(), memoryModelProtocol(&test.provider), errors.New("private"))
		if !strings.Contains(got, "protocol="+test.want+" ") {
			t.Fatalf("incorrect effective protocol: %s", got)
		}
	}
}
