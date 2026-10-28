// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package util

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"

	"github.com/sashabaranov/go-openai"
)

const GeminiProtocolInteractions = "gemini-interactions"
const geminiContentVersion = 1
const geminiResponseLimit = 32 * 1024 * 1024

var errGeminiInteractionIncomplete = &openai.APIError{Code: "incomplete", Type: "incomplete",
	Message: "Gemini interaction did not complete (status \"incomplete\")"}

func IsGeminiInteractionsProtocol(protocol string) bool {
	return strings.EqualFold(strings.TrimSpace(protocol), GeminiProtocolInteractions)
}

func newGeminiInteractionsHTTPClient(apiKey, baseURL string, headers ...map[string]string) *http.Client {
	merged := http.Header{}
	merged.Set("x-goog-api-client", "siyuan/"+Ver)
	if apiKey != "" {
		merged.Set("x-goog-api-key", apiKey)
	}
	if len(headers) > 0 {
		if ValidateAIProviderHeaders(headers[0]) != nil {
			return newAIProviderHTTPClient(baseURL, headers...)
		}
		for key, value := range headers[0] {
			merged.Set(key, value)
		}
	}
	values := map[string]string{}
	for key := range merged {
		values[key] = merged.Get(key)
	}
	// 凭据由源站限制的传输层注入，避免跨站重定向携带密钥。
	return newAIProviderHTTPClient(baseURL, values)
}

func geminiInteractionsEndpoint(baseURL, resource string) (string, error) {
	endpoint, err := url.Parse(strings.TrimSpace(baseURL))
	if err != nil || endpoint.Host == "" || endpoint.User != nil || endpoint.Fragment != "" ||
		(endpoint.Scheme != "http" && endpoint.Scheme != "https") {
		return "", errors.New("invalid Gemini Interactions API base URL")
	}
	path := strings.TrimRight(endpoint.Path, "/")
	if strings.HasSuffix(path, "/openai") || strings.HasSuffix(path, "/interactions") {
		return "", errors.New("Gemini Interactions requires a native API base URL ending in /v1beta or /v1")
	}
	if strings.HasSuffix(path, "/v1beta") || strings.HasSuffix(path, "/v1") {
		endpoint = endpoint.JoinPath(resource)
	} else {
		endpoint = endpoint.JoinPath("v1beta", resource)
	}
	return endpoint.String(), nil
}

func (c *AIClient) geminiInteractionsRequest(ctx context.Context, payload geminiInteractionsRequest) (*http.Response, error) {
	endpoint, err := geminiInteractionsEndpoint(c.baseURL, "interactions")
	if err != nil {
		return nil, err
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	if payload.Stream {
		req.Header.Set("Accept", "text/event-stream")
	}
	if c.geminiHTTP == nil {
		return nil, errors.New("Gemini client is missing connection settings")
	}
	resp, err := c.geminiHTTP.Do(req)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		defer resp.Body.Close()
		data, _ = io.ReadAll(io.LimitReader(resp.Body, 64*1024))
		return nil, geminiInteractionsError(data, resp.StatusCode)
	}
	return resp, nil
}

func geminiInteractionsError(data []byte, status int) error {
	var envelope struct {
		Error struct {
			Code    any    `json:"code"`
			Message string `json:"message"`
			Status  string `json:"status"`
		} `json:"error"`
	}
	data = bytes.TrimSpace(data)
	if len(data) > 0 && data[0] == '[' {
		var entries []json.RawMessage
		if json.Unmarshal(data, &entries) == nil && len(entries) > 0 {
			data = entries[0]
		}
	}
	_ = json.Unmarshal(data, &envelope)
	if envelope.Error.Message == "" {
		envelope.Error.Message = fmt.Sprintf("Gemini Interactions API request failed (HTTP %d)", status)
	}
	if code, ok := envelope.Error.Code.(float64); status == 0 && ok && code >= 400 && code < 600 {
		status = int(code)
	}
	return &openai.APIError{HTTPStatusCode: status, Type: envelope.Error.Status,
		Code: envelope.Error.Code, Message: envelope.Error.Message}
}

type geminiInteractionsRequest struct {
	Model             string            `json:"model"`
	Input             []json.RawMessage `json:"input"`
	SystemInstruction string            `json:"system_instruction,omitempty"`
	GenerationConfig  map[string]any    `json:"generation_config,omitempty"`
	Tools             []map[string]any  `json:"tools,omitempty"`
	Stream            bool              `json:"stream"`
	Store             bool              `json:"store"`
}

func geminiJSON(value any) json.RawMessage {
	data, _ := json.Marshal(value)
	return data
}

func geminiText(text string) json.RawMessage {
	return geminiJSON(map[string]string{"type": "text", "text": text})
}

func buildGeminiInteractionsRequest(ctx context.Context, request openai.ChatCompletionRequest) (ret geminiInteractionsRequest, err error) {
	// 显式关闭服务端会话存储，通过完整的原生步骤恢复本地历史。
	ret.Model, ret.Stream, ret.Store = request.Model, request.Stream, false
	ret.GenerationConfig = map[string]any{}
	if request.MaxCompletionTokens > 0 {
		ret.GenerationConfig["max_output_tokens"] = request.MaxCompletionTokens
	} else if request.MaxTokens > 0 {
		ret.GenerationConfig["max_output_tokens"] = request.MaxTokens
	}
	if len(request.Stop) > 0 {
		ret.GenerationConfig["stop_sequences"] = request.Stop
	}
	level, supported := geminiThinkingLevel(request.ReasoningEffort)
	if !supported {
		return ret, fmt.Errorf("unsupported Gemini reasoning effort %q", request.ReasoningEffort)
	}
	if level != "" {
		ret.GenerationConfig["thinking_level"] = level
	}
	if geminiThoughtSummariesRequested(ctx) {
		ret.GenerationConfig["thinking_summaries"] = "auto"
	}
	for _, tool := range request.Tools {
		if tool.Type != openai.ToolTypeFunction || tool.Function == nil || tool.Function.Name == "" {
			return ret, errors.New("Gemini Interactions only supports function tools in this client")
		}
		ret.Tools = append(ret.Tools, map[string]any{"type": "function", "name": tool.Function.Name,
			"description": tool.Function.Description, "parameters": tool.Function.Parameters})
	}
	if request.ToolChoice != nil {
		switch choice := request.ToolChoice.(type) {
		case string:
			if choice == "required" {
				choice = "any"
			}
			if choice != "auto" && choice != "any" && choice != "none" && choice != "validated" {
				return ret, errors.New("unsupported Gemini tool choice")
			}
			ret.GenerationConfig["tool_choice"] = choice
		case openai.ToolChoice:
			ret.GenerationConfig["tool_choice"] = map[string]any{"allowed_tools": map[string]any{
				"mode": "any", "tools": []string{choice.Function.Name}}}
		default:
			return ret, errors.New("unsupported Gemini tool choice")
		}
	}
	native := aiMessageContents(ctx)
	assistantIndex := 0
	pending := map[string]string{}
	for _, message := range request.Messages {
		if message.Role == openai.ChatMessageRoleTool {
			name, found := pending[message.ToolCallID]
			if !found {
				return ret, errors.New("Gemini tool result has no matching tool call")
			}
			delete(pending, message.ToolCallID)
			ret.Input = append(ret.Input, geminiJSON(map[string]any{"type": "function_result",
				"call_id": message.ToolCallID, "name": name, "result": []json.RawMessage{geminiText(message.Content)}}))
			continue
		}
		if len(pending) > 0 {
			return ret, errors.New("Gemini conversation is missing tool results")
		}
		if message.Role == "system" || message.Role == "developer" {
			if len(ret.Input) == 0 {
				if ret.SystemInstruction != "" {
					ret.SystemInstruction += "\n\n"
				}
				ret.SystemInstruction += message.Content
				continue
			}
			message.Role = "user"
		}
		if message.Role != "assistant" && message.Role != "user" {
			return ret, fmt.Errorf("unsupported Gemini message role %q", message.Role)
		}
		var steps []json.RawMessage
		if message.Role == "assistant" {
			if assistantIndex < len(native) && native[assistantIndex] != nil && IsGeminiInteractionsProtocol(native[assistantIndex].Protocol) {
				content := native[assistantIndex]
				if content.Version != geminiContentVersion {
					return ret, errors.New("unsupported Gemini conversation content version")
				}
				projection, parseErr := geminiStepsMessage(content.Blocks)
				if parseErr != nil {
					return ret, parseErr
				}
				if !equalGeminiToolCalls(projection.ToolCalls, message.ToolCalls) {
					return ret, errors.New("Gemini conversation tool calls do not match native content")
				}
				steps = CloneOpenAIResponseOutput(content.Blocks)
			}
			assistantIndex++
		}
		if steps == nil {
			parts, partsErr := geminiMessageContent(message)
			if partsErr != nil {
				return ret, partsErr
			}
			kind := "user_input"
			if message.Role == "assistant" {
				kind = "model_output"
			}
			if len(parts) > 0 {
				steps = append(steps, geminiJSON(map[string]any{"type": kind, "content": parts}))
			}
			for _, call := range message.ToolCalls {
				if message.Role != "assistant" || call.ID == "" || call.Function.Name == "" || !validAIToolArguments([]byte(call.Function.Arguments)) {
					return ret, errors.New("invalid Gemini tool call in conversation")
				}
				steps = append(steps, geminiJSON(map[string]any{"type": "function_call", "id": call.ID,
					"name": call.Function.Name, "arguments": json.RawMessage(call.Function.Arguments)}))
			}
		}
		for _, call := range message.ToolCalls {
			if _, exists := pending[call.ID]; exists {
				return ret, errors.New("duplicate Gemini tool call ID")
			}
			pending[call.ID] = call.Function.Name
		}
		ret.Input = append(ret.Input, steps...)
	}
	if len(pending) > 0 {
		return ret, errors.New("Gemini conversation is missing tool results")
	}
	return ret, nil
}

func geminiMessageContent(message openai.ChatCompletionMessage) ([]json.RawMessage, error) {
	var parts []json.RawMessage
	if message.Content != "" {
		parts = append(parts, geminiText(message.Content))
	}
	for _, part := range message.MultiContent {
		switch part.Type {
		case openai.ChatMessagePartTypeText:
			parts = append(parts, geminiText(part.Text))
		case openai.ChatMessagePartTypeImageURL:
			if part.ImageURL == nil || part.ImageURL.URL == "" {
				return nil, errors.New("missing Gemini image source")
			}
			image := map[string]string{"type": "image", "uri": part.ImageURL.URL}
			if after, ok := strings.CutPrefix(part.ImageURL.URL, "data:"); ok {
				mime, data, ok := strings.Cut(after, ";base64,")
				if !ok || !strings.HasPrefix(mime, "image/") || data == "" {
					return nil, errors.New("unsupported Gemini image data URL")
				}
				image = map[string]string{"type": "image", "mime_type": mime, "data": data}
			}
			parts = append(parts, geminiJSON(image))
		default:
			return nil, errors.New("unsupported Gemini input content")
		}
	}
	return parts, nil
}

type geminiStep struct {
	Type      string            `json:"type"`
	Content   []json.RawMessage `json:"content"`
	Summary   []json.RawMessage `json:"summary"`
	Signature string            `json:"signature"`
	ID        string            `json:"id"`
	Name      string            `json:"name"`
	Arguments json.RawMessage   `json:"arguments"`
}

func equalGeminiToolCalls(left, right []openai.ToolCall) bool {
	if len(left) != len(right) {
		return false
	}
	for i, call := range left {
		other := right[i]
		if call.ID != other.ID || call.Function.Name != other.Function.Name ||
			!equalAIToolArguments([]byte(call.Function.Arguments), []byte(other.Function.Arguments)) {
			return false
		}
	}
	return true
}

func geminiContentText(parts []json.RawMessage) (string, error) {
	var text strings.Builder
	for _, raw := range parts {
		var part struct {
			Type string `json:"type"`
			Text string `json:"text"`
		}
		if json.Unmarshal(raw, &part) != nil || part.Type != "text" {
			return "", errors.New("unsupported Gemini output content")
		}
		text.WriteString(part.Text)
	}
	return text.String(), nil
}

func geminiStepsMessage(steps []json.RawMessage) (message openai.ChatCompletionMessage, err error) {
	message.Role = "assistant"
	if len(steps) == 0 {
		return message, errors.New("Gemini interaction contains no output steps")
	}
	seen := map[string]bool{}
	for _, raw := range steps {
		var step geminiStep
		if err = json.Unmarshal(raw, &step); err != nil {
			return
		}
		switch step.Type {
		case "model_output":
			var text string
			text, err = geminiContentText(step.Content)
			message.Content += text
		case "thought":
			var text string
			text, err = geminiContentText(step.Summary)
			message.ReasoningContent += text
		case "function_call":
			if step.ID == "" || step.Name == "" || seen[step.ID] || !validAIToolArguments(step.Arguments) {
				return message, errors.New("invalid Gemini function call")
			}
			seen[step.ID] = true
			index := len(message.ToolCalls)
			message.ToolCalls = append(message.ToolCalls, openai.ToolCall{Index: &index, ID: step.ID,
				Type: openai.ToolTypeFunction, Function: openai.FunctionCall{Name: step.Name, Arguments: string(step.Arguments)}})
		default:
			return message, fmt.Errorf("unsupported Gemini step %q", step.Type)
		}
		if err != nil {
			return
		}
	}
	return
}

type geminiInteraction struct {
	ID     string            `json:"id"`
	Model  string            `json:"model"`
	Status string            `json:"status"`
	Steps  []json.RawMessage `json:"steps"`
	Usage  struct {
		Input   int `json:"total_input_tokens"`
		Output  int `json:"total_output_tokens"`
		Thought int `json:"total_thought_tokens"`
		Total   int `json:"total_tokens"`
		Cached  int `json:"total_cached_tokens"`
	} `json:"usage"`
	Errors []struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"errors"`
}

func geminiInteractionCompletion(response geminiInteraction) (ret openai.ChatCompletionResponse, err error) {
	if len(response.Errors) > 0 {
		return ret, &openai.APIError{Type: response.Errors[0].Code, Code: response.Errors[0].Code, Message: response.Errors[0].Message}
	}
	if response.Status == "incomplete" {
		if len(response.Steps) > 0 {
			partial, parseErr := geminiStepsMessage(response.Steps)
			if parseErr != nil {
				return ret, parseErr
			}
			if len(partial.ToolCalls) > 0 {
				return ret, &openai.APIError{Code: "incomplete_tool_calls", Type: "incomplete",
					Message: "Gemini interaction ended with incomplete tool calls"}
			}
		}
		return ret, errGeminiInteractionIncomplete
	}
	if response.Status != "completed" && response.Status != "requires_action" {
		return ret, fmt.Errorf("Gemini interaction did not complete (status %q)", response.Status)
	}
	message, err := geminiStepsMessage(response.Steps)
	if err != nil {
		return ret, err
	}
	finish := openai.FinishReasonStop
	if len(message.ToolCalls) > 0 {
		if response.Status != "requires_action" {
			return ret, errors.New("Gemini interaction has tool calls without requires_action status")
		}
		finish = openai.FinishReasonToolCalls
	} else if response.Status == "requires_action" {
		return ret, errors.New("Gemini interaction requires action without function calls")
	}
	output := response.Usage.Output + response.Usage.Thought
	ret = openai.ChatCompletionResponse{ID: response.ID, Model: response.Model, Object: "chat.completion",
		Choices: []openai.ChatCompletionChoice{{Index: 0, Message: message, FinishReason: finish}},
		Usage: openai.Usage{PromptTokens: response.Usage.Input, CompletionTokens: output, TotalTokens: response.Usage.Total,
			PromptTokensDetails:     &openai.PromptTokensDetails{CachedTokens: response.Usage.Cached},
			CompletionTokensDetails: &openai.CompletionTokensDetails{ReasoningTokens: response.Usage.Thought}}}
	return ret, nil
}

func createGeminiInteractionCompletion(ctx context.Context, client *AIClient, request openai.ChatCompletionRequest) (openai.ChatCompletionResponse, error) {
	request.Stream = false
	payload, err := buildGeminiInteractionsRequest(ctx, request)
	if err != nil {
		return openai.ChatCompletionResponse{}, err
	}
	resp, err := client.geminiInteractionsRequest(ctx, payload)
	if err != nil {
		return openai.ChatCompletionResponse{}, err
	}
	defer resp.Body.Close()
	var interaction geminiInteraction
	if err = json.NewDecoder(io.LimitReader(resp.Body, geminiResponseLimit)).Decode(&interaction); err != nil {
		return openai.ChatCompletionResponse{}, err
	}
	return geminiInteractionCompletion(interaction)
}
