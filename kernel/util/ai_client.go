// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package util

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"reflect"
	"strings"

	"github.com/sashabaranov/go-openai"
)

const AnthropicProtocolMessages = "anthropic-messages"

// AIClient 共享生成调用的连接配置，按协议选择独立的请求适配器。
type AIClient struct {
	*openai.Client
	baseURL       string
	anthropicHTTP *http.Client
	geminiHTTP    *http.Client
	ChatGPT       bool
}

// AIMessageContent 保存供应商原生内容，显示文本与恢复上下文分别使用各自的表示。
type AIMessageContent struct {
	Protocol string            `json:"protocol"`
	Version  int               `json:"version"`
	Blocks   []json.RawMessage `json:"blocks"`
}

func CloneAIMessageContent(content *AIMessageContent) *AIMessageContent {
	if content == nil {
		return nil
	}
	ret := *content
	ret.Blocks = CloneOpenAIResponseOutput(content.Blocks)
	return &ret
}

func IsAnthropicMessagesProtocol(protocol string) bool {
	return strings.EqualFold(strings.TrimSpace(protocol), AnthropicProtocolMessages)
}

type aiMessageContentContextKey struct{}

// ContextWithAIMessageContents 按助手消息顺序附加原生内容，图片降级不会改变消息对应关系。
func ContextWithAIMessageContents(ctx context.Context, contents []*AIMessageContent) context.Context {
	return context.WithValue(ctx, aiMessageContentContextKey{}, contents)
}

func aiMessageContents(ctx context.Context) []*AIMessageContent {
	contents, _ := ctx.Value(aiMessageContentContextKey{}).([]*AIMessageContent)
	return contents
}

func validAIToolArguments(input json.RawMessage) bool {
	input = bytes.TrimSpace(input)
	return len(input) > 0 && input[0] == '{' && json.Valid(input)
}

func equalAIToolArguments(native, projected []byte) bool {
	return validAIToolArguments(native) && validAIToolArguments(projected) && equalAIJSON(native, projected)
}

func equalAIJSON(left, right []byte) bool {
	// 会话序列化可能调整对象键顺序，结构比较需要保留数字精度。
	decode := func(data []byte) (value any, err error) {
		decoder := json.NewDecoder(bytes.NewReader(data))
		decoder.UseNumber()
		err = decoder.Decode(&value)
		return
	}
	leftValue, leftErr := decode(left)
	rightValue, rightErr := decode(right)
	return json.Valid(left) && json.Valid(right) && leftErr == nil && rightErr == nil && reflect.DeepEqual(leftValue, rightValue)
}

type aiErrorResponseTransport struct{ base openai.HTTPDoer }

func (t *aiErrorResponseTransport) Do(req *http.Request) (*http.Response, error) {
	resp, err := t.base.Do(req)
	if err != nil || resp == nil || resp.StatusCode < 400 || resp.Body == nil {
		return resp, err
	}
	data, readErr := io.ReadAll(io.LimitReader(resp.Body, 64*1024+1))
	// 保留原始响应的关闭行为，超出解析上限时继续由调用方读取。
	resp.Body = struct {
		io.Reader
		io.Closer
	}{io.MultiReader(bytes.NewReader(data), resp.Body), resp.Body}
	if readErr != nil || len(data) > 64*1024 {
		return resp, nil
	}
	var entries []json.RawMessage
	if json.Unmarshal(data, &entries) != nil || len(entries) == 0 {
		return resp, nil
	}
	var envelope struct {
		Error *openai.APIError `json:"error"`
	}
	if json.Unmarshal(entries[0], &envelope) != nil || envelope.Error == nil || envelope.Error.Message == "" {
		return resp, nil
	}
	// Google 兼容端点可能返回错误数组，转换外层形状以保留供应商的实际错误原因。
	resp.Body.Close()
	resp.Body = io.NopCloser(bytes.NewReader(entries[0]))
	resp.ContentLength = int64(len(entries[0]))
	resp.Header.Del("Content-Length")
	return resp, nil
}
