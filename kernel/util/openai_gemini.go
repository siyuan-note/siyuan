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
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"

	"github.com/sashabaranov/go-openai"
)

const (
	// Google 允许没有原始签名的历史函数调用使用该占位值跳过校验。
	geminiThoughtSignatureValidatorSkip = "skip_thought_signature_validator"
	maxGeminiStreamLineBytes            = 32 * 1024 * 1024
)

type geminiThoughtSignatureContextKey struct{}

// GeminiThoughtSignatureState 保存同一次 Agent 请求中的 Gemini 工具调用签名。
// 签名是不透明值，只按工具调用 ID 写入和读取，不进行解码或修改。
type GeminiThoughtSignatureState struct {
	mu         sync.RWMutex
	signatures map[string]string
}

func NewGeminiThoughtSignatureState() *GeminiThoughtSignatureState {
	return &GeminiThoughtSignatureState{signatures: map[string]string{}}
}

func ContextWithGeminiThoughtSignatureState(ctx context.Context, state *GeminiThoughtSignatureState) context.Context {
	if state == nil {
		return ctx
	}
	return context.WithValue(ctx, geminiThoughtSignatureContextKey{}, state)
}

func (s *GeminiThoughtSignatureState) Set(callID, signature string) {
	if s == nil || callID == "" || signature == "" {
		return
	}
	s.mu.Lock()
	if s.signatures == nil {
		s.signatures = map[string]string{}
	}
	s.signatures[callID] = signature
	s.mu.Unlock()
}

func (s *GeminiThoughtSignatureState) Get(callID string) string {
	if s == nil || callID == "" {
		return ""
	}
	s.mu.RLock()
	signature := s.signatures[callID]
	s.mu.RUnlock()
	return signature
}

func geminiThoughtSignatureStateFromContext(ctx context.Context) *GeminiThoughtSignatureState {
	state, _ := ctx.Value(geminiThoughtSignatureContextKey{}).(*GeminiThoughtSignatureState)
	return state
}

func isGoogleGeminiOpenAICompatibleEndpoint(apiBaseURL, model string) bool {
	parsed, err := url.Parse(strings.TrimSpace(apiBaseURL))
	if err != nil || !strings.EqualFold(parsed.Hostname(), "generativelanguage.googleapis.com") {
		return false
	}
	if !strings.Contains(strings.ToLower(parsed.Path), "/openai") {
		return false
	}
	normalizedModel := strings.ToLower(strings.TrimSpace(model))
	if slash := strings.LastIndex(normalizedModel, "/"); slash >= 0 {
		normalizedModel = normalizedModel[slash+1:]
	}
	return strings.HasPrefix(normalizedModel, "gemini-")
}

// WrapGeminiThoughtSignatureTransport 为 Google OpenAI 兼容端点补充工具调用签名往返支持。
// 该函数导出仅用于 Agent 集成测试构造本地上游，生产代码通过 NewOpenAIClientWithModel 使用。
func WrapGeminiThoughtSignatureTransport(base openai.HTTPDoer) openai.HTTPDoer {
	return &geminiThoughtSignatureTransport{base: base}
}

type geminiThoughtSignatureTransport struct {
	base openai.HTTPDoer
}

func (t *geminiThoughtSignatureTransport) Do(req *http.Request) (*http.Response, error) {
	state := geminiThoughtSignatureStateFromContext(req.Context())
	isChatRequest := req.Method == http.MethodPost && strings.Contains(req.URL.Path, "chat/completions")
	if state != nil && isChatRequest {
		injectGeminiThoughtSignatures(req, state)
	}

	resp, err := t.base.Do(req)
	if err != nil || state == nil || !isChatRequest || resp == nil || resp.Body == nil {
		return resp, err
	}
	resp.Body = &geminiThoughtSignatureReadCloser{
		ReadCloser:  resp.Body,
		state:       state,
		callIDs:     map[string]string{},
		pendingSigs: map[string]string{},
	}
	return resp, nil
}

func injectGeminiThoughtSignatures(req *http.Request, state *GeminiThoughtSignatureState) {
	if req.Body == nil {
		return
	}
	body, err := io.ReadAll(req.Body)
	if err != nil {
		return
	}
	if err = req.Body.Close(); err != nil {
		restoreOpenAIRequestBody(req, body)
		return
	}

	var payload map[string]any
	if err = json.Unmarshal(body, &payload); err != nil {
		restoreOpenAIRequestBody(req, body)
		return
	}
	messages, _ := payload["messages"].([]any)
	changed := false
	for _, rawMessage := range messages {
		message, _ := rawMessage.(map[string]any)
		if message["role"] != openai.ChatMessageRoleAssistant {
			continue
		}
		toolCalls, _ := message["tool_calls"].([]any)
		for _, rawToolCall := range toolCalls {
			toolCall, _ := rawToolCall.(map[string]any)
			if !isGeminiFunctionToolCall(toolCall) {
				continue
			}
			if geminiThoughtSignatureFromToolCall(toolCall) != "" {
				continue
			}
			callID, _ := toolCall["id"].(string)
			signature := state.Get(callID)
			if signature == "" {
				signature = geminiThoughtSignatureValidatorSkip
			}
			setGeminiThoughtSignature(toolCall, signature)
			changed = true
		}
	}
	if !changed {
		restoreOpenAIRequestBody(req, body)
		return
	}
	merged, err := json.Marshal(payload)
	if err != nil {
		restoreOpenAIRequestBody(req, body)
		return
	}
	restoreOpenAIRequestBody(req, merged)
}

func isGeminiFunctionToolCall(toolCall map[string]any) bool {
	toolType, _ := toolCall["type"].(string)
	if toolType != "" && toolType != string(openai.ToolTypeFunction) {
		return false
	}
	_, hasFunction := toolCall["function"].(map[string]any)
	return hasFunction
}

func restoreOpenAIRequestBody(req *http.Request, body []byte) {
	req.Body = io.NopCloser(bytes.NewReader(body))
	req.ContentLength = int64(len(body))
	req.GetBody = func() (io.ReadCloser, error) {
		return io.NopCloser(bytes.NewReader(body)), nil
	}
}

func geminiThoughtSignatureFromToolCall(toolCall map[string]any) string {
	extraContent, _ := toolCall["extra_content"].(map[string]any)
	google, _ := extraContent["google"].(map[string]any)
	signature, _ := google["thought_signature"].(string)
	return signature
}

func setGeminiThoughtSignature(toolCall map[string]any, signature string) {
	extraContent, _ := toolCall["extra_content"].(map[string]any)
	if extraContent == nil {
		extraContent = map[string]any{}
		toolCall["extra_content"] = extraContent
	}
	google, _ := extraContent["google"].(map[string]any)
	if google == nil {
		google = map[string]any{}
		extraContent["google"] = google
	}
	google["thought_signature"] = signature
}

type geminiThoughtSignatureReadCloser struct {
	io.ReadCloser
	state            *GeminiThoughtSignatureState
	pending          []byte
	discardUntilLine bool
	callIDs          map[string]string
	pendingSigs      map[string]string
}

func (r *geminiThoughtSignatureReadCloser) Read(p []byte) (n int, err error) {
	n, err = r.ReadCloser.Read(p)
	if n > 0 {
		r.consume(p[:n])
	}
	if err == io.EOF && len(r.pending) > 0 && !r.discardUntilLine {
		r.captureLine(r.pending)
		r.pending = nil
	}
	return
}

func (r *geminiThoughtSignatureReadCloser) consume(data []byte) {
	for len(data) > 0 {
		newline := bytes.IndexByte(data, '\n')
		if newline < 0 {
			if r.discardUntilLine {
				return
			}
			if len(r.pending)+len(data) > maxGeminiStreamLineBytes {
				r.pending = nil
				r.discardUntilLine = true
				return
			}
			r.pending = append(r.pending, data...)
			return
		}

		part := data[:newline]
		data = data[newline+1:]
		if r.discardUntilLine {
			r.discardUntilLine = false
			continue
		}
		if len(r.pending)+len(part) > maxGeminiStreamLineBytes {
			r.pending = nil
			continue
		}
		r.pending = append(r.pending, part...)
		r.captureLine(r.pending)
		r.pending = r.pending[:0]
	}
}

func (r *geminiThoughtSignatureReadCloser) captureLine(line []byte) {
	line = bytes.TrimSpace(line)
	if len(line) == 0 {
		return
	}
	if bytes.HasPrefix(line, []byte("data:")) {
		line = bytes.TrimSpace(bytes.TrimPrefix(line, []byte("data:")))
	}
	if len(line) == 0 || bytes.Equal(line, []byte("[DONE]")) {
		return
	}
	if !bytes.Contains(line, []byte(`"tool_calls"`)) {
		return
	}

	var response geminiChatResponse
	if json.Unmarshal(line, &response) != nil {
		return
	}
	for _, choice := range response.Choices {
		r.captureToolCalls(choice.Index, choice.Delta.ToolCalls)
		r.captureToolCalls(choice.Index, choice.Message.ToolCalls)
	}
}

func (r *geminiThoughtSignatureReadCloser) captureToolCalls(choiceIndex int, toolCalls []geminiChatToolCall) {
	for position, toolCall := range toolCalls {
		toolIndex := position
		if toolCall.Index != nil {
			toolIndex = *toolCall.Index
		}
		key := strconv.Itoa(choiceIndex) + ":" + strconv.Itoa(toolIndex)
		if toolCall.ID != "" {
			r.callIDs[key] = toolCall.ID
			if signature := r.pendingSigs[key]; signature != "" {
				r.state.Set(toolCall.ID, signature)
				delete(r.pendingSigs, key)
			}
		}

		signature := toolCall.ExtraContent.Google.ThoughtSignature
		if signature == "" {
			continue
		}
		callID := toolCall.ID
		if callID == "" {
			callID = r.callIDs[key]
		}
		if callID == "" {
			r.pendingSigs[key] = signature
			continue
		}
		r.state.Set(callID, signature)
	}
}

type geminiChatResponse struct {
	Choices []struct {
		Index   int               `json:"index"`
		Delta   geminiChatMessage `json:"delta"`
		Message geminiChatMessage `json:"message"`
	} `json:"choices"`
}

type geminiChatMessage struct {
	ToolCalls []geminiChatToolCall `json:"tool_calls"`
}

type geminiChatToolCall struct {
	Index        *int   `json:"index,omitempty"`
	ID           string `json:"id,omitempty"`
	ExtraContent struct {
		Google struct {
			ThoughtSignature string `json:"thought_signature,omitempty"`
		} `json:"google,omitempty"`
	} `json:"extra_content,omitempty"`
}
