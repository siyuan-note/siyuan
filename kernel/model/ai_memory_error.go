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

	"github.com/sashabaranov/go-openai"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
)

// 仅保留受控分类；提供方消息、响应正文、请求地址及模型内容均不进入任务状态。
type memoryModelError int

func memoryTaskContextError(status *apicontract.AIMemoryTaskData, err error) {
	status.State = "failed"
	if errors.Is(err, context.Canceled) {
		status.State = "cancelled"
	}
	status.Error = classifyMemoryModelError(err).Error()
}

func (e memoryModelError) Error() string {
	if Conf != nil {
		if message := Conf.Language(int(e)); message != "" {
			return message
		}
	}
	return fmt.Sprintf("memory model error (%d)", e)
}

func classifyMemoryModelError(err error) error {
	if errors.Is(err, context.Canceled) {
		return memoryModelError(458)
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return memoryModelError(449)
	}
	var networkError net.Error
	if errors.As(err, &networkError) {
		if networkError.Timeout() {
			return memoryModelError(449)
		}
		return memoryModelError(448)
	}
	status := 0
	var apiError *openai.APIError
	if errors.As(err, &apiError) {
		status = apiError.HTTPStatusCode
		// 额度仅依据明确的结构化代码，不从自由文本或单独的 429 推断。
		code, _ := apiError.Code.(string)
		if (status == 0 || status == http.StatusTooManyRequests) &&
			(code == "insufficient_quota" || apiError.Type == "insufficient_quota") {
			return memoryModelError(453)
		}
		if status == 0 {
			switch code {
			case "invalid_api_key":
				return memoryModelError(450)
			case "rate_limit_exceeded":
				return memoryModelError(452)
			case "model_not_found", "invalid_parameter", "unsupported_parameter", "context_length_exceeded":
				return memoryModelError(454)
			case "server_error":
				return memoryModelError(455)
			case "incomplete", "incomplete_tool_calls":
				return memoryModelError(456)
			}
		}
	}
	var requestError *openai.RequestError
	if errors.As(err, &requestError) {
		status = requestError.HTTPStatusCode
	}
	switch {
	case status == http.StatusUnauthorized:
		return memoryModelError(450)
	case status == http.StatusForbidden:
		return memoryModelError(451)
	case status == http.StatusTooManyRequests:
		return memoryModelError(452)
	case status == http.StatusRequestTimeout || status == http.StatusGatewayTimeout:
		return memoryModelError(449)
	case status >= 500 && status <= 599:
		return memoryModelError(455)
	case status == http.StatusBadRequest || status == http.StatusNotFound || status == http.StatusUnprocessableEntity:
		return memoryModelError(454)
	}
	var syntaxError *json.SyntaxError
	var typeError *json.UnmarshalTypeError
	if errors.As(err, &syntaxError) || errors.As(err, &typeError) || errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
		return memoryModelError(456)
	}
	return memoryModelError(457)
}
