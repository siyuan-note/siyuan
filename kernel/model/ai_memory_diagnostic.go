// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"

	"github.com/sashabaranov/go-openai"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type memoryModelStageKey struct{}

func memoryModelProtocol(provider *conf.Provider) string {
	if provider.AuthType == "chatgpt" {
		return "chatgpt-responses"
	}
	return provider.Protocol
}

func memoryCompleteStage(ctx context.Context, cfg *conf.AI, stage, prompt string) (string, error) {
	return memoryComplete(context.WithValue(ctx, memoryModelStageKey{}, stage), cfg, prompt)
}

var memoryLogModelFailure = func(diagnostic string) {
	logging.LogErrorf("AI memory model failure [%s]", diagnostic)
}

// 诊断只允许固定枚举和 HTTP 状态；未知字段省略，不能把提供方自由文本或请求内容写入日志。
func memoryModelDiagnostic(ctx context.Context, protocol string, err error) string {
	stage, _ := ctx.Value(memoryModelStageKey{}).(string)
	if !slices.Contains([]string{"keywords", "proposal", "overview", "translation", "proposal_decode"}, stage) {
		stage = "unknown"
	}
	protocol = strings.ToLower(strings.TrimSpace(protocol))
	if protocol == "" {
		protocol = util.OpenAIProtocolChatCompletions
	}
	if !slices.Contains([]string{util.OpenAIProtocolChatCompletions, util.OpenAIProtocolResponses, util.AnthropicProtocolMessages, util.GeminiProtocolInteractions, "chatgpt-responses"}, protocol) {
		protocol = "unknown"
	}
	category, ok := err.(memoryModelError)
	if !ok {
		category = classifyMemoryModelError(err).(memoryModelError)
	}
	status, code, parameter := 0, "unknown", "unknown"
	var apiError *openai.APIError
	if errors.As(err, &apiError) {
		status = apiError.HTTPStatusCode
		value, _ := apiError.Code.(string)
		if slices.Contains([]string{"invalid_api_key", "authentication_error", "permission_error", "rate_limit_exceeded", "rate_limit_error", "insufficient_quota", "model_not_found", "invalid_parameter", "unsupported_parameter", "unsupported_value", "context_length_exceeded", "invalid_request_error", "server_error", "overloaded_error", "incomplete", "incomplete_tool_calls"}, value) {
			code = value
		}
		if apiError.Param != nil && slices.Contains([]string{"model", "messages", "input", "max_tokens", "max_completion_tokens", "max_output_tokens", "reasoning", "reasoning_effort", "reasoning.effort", "temperature", "top_p", "response_format", "stream", "store"}, *apiError.Param) {
			parameter = *apiError.Param
		}
	}
	var requestError *openai.RequestError
	if errors.As(err, &requestError) {
		status = requestError.HTTPStatusCode
	}
	if status < 100 || status > 599 {
		status = 0
	}
	return fmt.Sprintf("stage=%s protocol=%s category=%d http_status=%d code=%s parameter=%s", stage, protocol, category, status, code, parameter)
}
