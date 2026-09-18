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
	"reflect"
	"strings"

	"github.com/sashabaranov/go-openai"
)

const anthropicContentVersion = 1

type anthropicMessage struct {
	Role    string            `json:"role"`
	Content []json.RawMessage `json:"content"`
}

type anthropicRequest struct {
	Model        string             `json:"model"`
	MaxTokens    int                `json:"max_tokens"`
	Messages     []anthropicMessage `json:"messages"`
	System       []json.RawMessage  `json:"system,omitempty"`
	Stream       bool               `json:"stream,omitempty"`
	Temperature  *float32           `json:"temperature,omitempty"`
	Tools        []anthropicTool    `json:"tools,omitempty"`
	ToolChoice   any                `json:"tool_choice,omitempty"`
	Thinking     *anthropicThinking `json:"thinking,omitempty"`
	OutputConfig map[string]string  `json:"output_config,omitempty"`
	Stop         []string           `json:"stop_sequences,omitempty"`
}

type anthropicTool struct {
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	InputSchema any    `json:"input_schema"`
}

type anthropicThinking struct {
	Type         string `json:"type"`
	BudgetTokens int    `json:"budget_tokens,omitempty"`
}

type anthropicUsage struct {
	InputTokens         int `json:"input_tokens"`
	OutputTokens        int `json:"output_tokens"`
	CacheCreationTokens int `json:"cache_creation_input_tokens"`
	CacheReadTokens     int `json:"cache_read_input_tokens"`
}

func (u anthropicUsage) chatUsage() openai.Usage {
	input := u.InputTokens + u.CacheCreationTokens + u.CacheReadTokens
	return openai.Usage{PromptTokens: input, CompletionTokens: u.OutputTokens, TotalTokens: input + u.OutputTokens,
		PromptTokensDetails: &openai.PromptTokensDetails{CachedTokens: u.CacheReadTokens}}
}

func newAnthropicHTTPClient(apiKey, baseURL string, headers ...map[string]string) *http.Client {
	merged := http.Header{}
	merged.Set("anthropic-version", "2023-06-01")
	if apiKey != "" {
		endpoint, _ := url.Parse(strings.TrimSpace(baseURL))
		if endpoint != nil && strings.EqualFold(endpoint.Hostname(), "openrouter.ai") {
			merged.Set("Authorization", "Bearer "+apiKey)
		} else {
			merged.Set("x-api-key", apiKey)
		}
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
	// 默认凭据也由源站限制的传输层注入，重定向不会把密钥带到其他站点。
	return newAIProviderHTTPClient(baseURL, values)
}

func anthropicEndpoint(baseURL, resource string) (string, error) {
	endpoint, err := url.Parse(strings.TrimSpace(baseURL))
	if err != nil || endpoint.Host == "" || (endpoint.Scheme != "http" && endpoint.Scheme != "https") {
		return "", errors.New("invalid Anthropic API base URL")
	}
	// 与 Anthropic SDK 一样在基础地址后追加版本路径，同时兼容已包含 /v1 的配置。
	if strings.HasSuffix(strings.TrimRight(endpoint.Path, "/"), "/v1") {
		endpoint = endpoint.JoinPath(resource)
	} else {
		endpoint = endpoint.JoinPath("v1", resource)
	}
	return endpoint.String(), nil
}

func (c *AIClient) anthropicRequest(ctx context.Context, method, resource string, payload any) (*http.Response, error) {
	if c.anthropicHTTP == nil {
		return nil, errors.New("Anthropic client is missing connection settings")
	}
	endpoint, err := anthropicEndpoint(c.baseURL, resource)
	if err != nil {
		return nil, err
	}
	var body io.Reader
	if payload != nil {
		data, marshalErr := json.Marshal(payload)
		if marshalErr != nil {
			return nil, marshalErr
		}
		body = bytes.NewReader(data)
	}
	req, err := http.NewRequestWithContext(ctx, method, endpoint, body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.anthropicHTTP.Do(req)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		defer resp.Body.Close()
		data, _ := io.ReadAll(io.LimitReader(resp.Body, 64*1024))
		return nil, anthropicError(data, resp.StatusCode)
	}
	return resp, nil
}

func anthropicError(data []byte, status int) error {
	var envelope struct {
		Error struct {
			Type    string `json:"type"`
			Message string `json:"message"`
		} `json:"error"`
	}
	_ = json.Unmarshal(data, &envelope)
	if envelope.Error.Message == "" {
		envelope.Error.Message = fmt.Sprintf("Anthropic API request failed (HTTP %d)", status)
	}
	return &openai.APIError{HTTPStatusCode: status, Type: envelope.Error.Type,
		Code: envelope.Error.Type, Message: envelope.Error.Message}
}

func anthropicJSON(value any) json.RawMessage {
	data, _ := json.Marshal(value)
	return data
}

func anthropicText(text string) json.RawMessage {
	return anthropicJSON(struct {
		Type string `json:"type"`
		Text string `json:"text"`
	}{"text", text})
}

func buildAnthropicRequest(ctx context.Context, request openai.ChatCompletionRequest) (ret anthropicRequest, err error) {
	ret.Model, ret.Stream = request.Model, request.Stream
	ret.MaxTokens = request.MaxCompletionTokens
	if ret.MaxTokens <= 0 {
		ret.MaxTokens = request.MaxTokens
	}
	if ret.MaxTokens <= 0 {
		// Messages 必须指定输出上限，配置为自动时使用保守的默认预算。
		ret.MaxTokens = 4096
	}
	temperature := max(float32(0), min(float32(1), request.Temperature))
	ret.Temperature = &temperature
	if anthropicFixedSampling(request.Model) {
		ret.Temperature = nil
	}
	ret.Stop = request.Stop
	if err = configureAnthropicThinking(&ret, request.ReasoningEffort); err != nil {
		return
	}
	for _, tool := range request.Tools {
		if tool.Type != openai.ToolTypeFunction || tool.Function == nil {
			return ret, errors.New("Anthropic Messages only supports function tools in this client")
		}
		ret.Tools = append(ret.Tools, anthropicTool{tool.Function.Name, tool.Function.Description, tool.Function.Parameters})
	}
	if request.ToolChoice != nil {
		switch choice := request.ToolChoice.(type) {
		case string:
			kind := choice
			if kind == "required" {
				kind = "any"
			}
			ret.ToolChoice = map[string]string{"type": kind}
		case openai.ToolChoice:
			ret.ToolChoice = map[string]string{"type": "tool", "name": choice.Function.Name}
		default:
			return ret, errors.New("unsupported Anthropic tool choice")
		}
	}
	native := aiMessageContents(ctx)
	assistantIndex := 0
	for _, message := range request.Messages {
		if message.Role == openai.ChatMessageRoleSystem || message.Role == "developer" {
			if message.Content != "" {
				if len(ret.Messages) == 0 {
					ret.System = append(ret.System, anthropicText(message.Content))
				} else {
					ret.appendMessage("user", []json.RawMessage{anthropicText(message.Content)})
				}
			}
			continue
		}
		blocks, blockErr := anthropicMessageBlocks(message)
		if blockErr != nil {
			return ret, blockErr
		}
		role := message.Role
		if role == openai.ChatMessageRoleTool {
			role = "user"
		}
		if role == "assistant" {
			if assistantIndex < len(native) && native[assistantIndex] != nil &&
				IsAnthropicMessagesProtocol(native[assistantIndex].Protocol) {
				content := native[assistantIndex]
				if content.Version != anthropicContentVersion {
					return ret, errors.New("unsupported Anthropic conversation content version")
				}
				if err = validateAnthropicHistory(content.Blocks, message.ToolCalls); err != nil {
					return ret, err
				}
				blocks = CloneOpenAIResponseOutput(content.Blocks)
			}
			assistantIndex++
		}
		if role != "assistant" && role != "user" {
			return ret, fmt.Errorf("unsupported Anthropic message role %q", role)
		}
		if len(blocks) == 0 {
			blocks = []json.RawMessage{anthropicText(" ")}
		}
		ret.appendMessage(role, blocks)
	}
	return ret, validateAnthropicToolResults(ret.Messages)
}

func (r *anthropicRequest) appendMessage(role string, blocks []json.RawMessage) {
	if len(r.Messages) > 0 && r.Messages[len(r.Messages)-1].Role == role {
		r.Messages[len(r.Messages)-1].Content = append(r.Messages[len(r.Messages)-1].Content, blocks...)
	} else {
		r.Messages = append(r.Messages, anthropicMessage{role, blocks})
	}
}

func configureAnthropicThinking(request *anthropicRequest, effort string) error {
	effort = strings.ToLower(strings.TrimSpace(effort))
	if effort == "" {
		return nil
	}
	if effort == "none" {
		model := strings.ToLower(request.Model)
		if strings.Contains(model, "claude-mythos") || strings.Contains(model, "claude-fable") {
			request.Thinking = &anthropicThinking{Type: "adaptive"}
			request.OutputConfig = map[string]string{"effort": "low"}
		} else {
			request.Thinking = &anthropicThinking{Type: "disabled"}
		}
		return nil
	}
	budgets := map[string]int{"low": 1024, "medium": 4096, "high": 8192, "xhigh": 16384, "max": 32768}
	budget, ok := budgets[effort]
	if !ok {
		return fmt.Errorf("unsupported Anthropic reasoning effort %q", effort)
	}
	model := strings.ToLower(request.Model)
	if anthropicLegacyThinking(model) {
		// 思考预算包含在输出上限中，为可见回答保留至少一半预算。
		budget = min(budget, request.MaxTokens/2)
		if budget < 1024 {
			return errors.New("Anthropic thinking requires an output token limit of at least 2048")
		}
		request.Thinking = &anthropicThinking{Type: "enabled", BudgetTokens: budget}
	} else {
		if effort == "xhigh" && (strings.Contains(model, "claude-opus-4-6") || strings.Contains(model, "claude-sonnet-4-6")) {
			effort = "max"
		}
		request.Thinking = &anthropicThinking{Type: "adaptive"}
		request.OutputConfig = map[string]string{"effort": effort}
	}
	request.Temperature = nil
	return nil
}

func anthropicLegacyThinking(model string) bool {
	model = strings.ToLower(model)
	for _, prefix := range []string{"claude-3-7", "claude-sonnet-4-5", "claude-opus-4-5", "claude-haiku-4-5",
		"claude-opus-4-1", "claude-sonnet-4-202", "claude-opus-4-202"} {
		if strings.Contains(model, prefix) {
			return true
		}
	}
	return model == "claude-sonnet-4" || model == "claude-opus-4"
}

func anthropicFixedSampling(model string) bool {
	model = strings.ToLower(model)
	return strings.Contains(model, "claude-") && !anthropicLegacyThinking(model) &&
		!strings.Contains(model, "claude-3") && !strings.Contains(model, "claude-opus-4-6") &&
		!strings.Contains(model, "claude-sonnet-4-6")
}

func anthropicMessageBlocks(message openai.ChatCompletionMessage) ([]json.RawMessage, error) {
	if message.Role == openai.ChatMessageRoleTool {
		return []json.RawMessage{anthropicJSON(map[string]any{
			"type": "tool_result", "tool_use_id": message.ToolCallID, "content": message.Content,
		})}, nil
	}
	var blocks []json.RawMessage
	if message.Content != "" {
		blocks = append(blocks, anthropicText(message.Content))
	}
	for _, part := range message.MultiContent {
		switch part.Type {
		case openai.ChatMessagePartTypeText:
			blocks = append(blocks, anthropicText(part.Text))
		case openai.ChatMessagePartTypeImageURL:
			if part.ImageURL == nil {
				return nil, errors.New("missing Anthropic image source")
			}
			source := map[string]string{"type": "url", "url": part.ImageURL.URL}
			if strings.HasPrefix(part.ImageURL.URL, "data:") {
				meta, data, ok := strings.Cut(strings.TrimPrefix(part.ImageURL.URL, "data:"), ";base64,")
				if !ok || data == "" || (meta != "image/png" && meta != "image/jpeg" && meta != "image/gif" && meta != "image/webp") {
					return nil, errors.New("unsupported Anthropic image data URL")
				}
				source = map[string]string{"type": "base64", "media_type": meta, "data": data}
			}
			blocks = append(blocks, anthropicJSON(map[string]any{"type": "image", "source": source}))
		default:
			return nil, errors.New("unsupported Anthropic input content")
		}
	}
	for _, call := range message.ToolCalls {
		input := json.RawMessage(call.Function.Arguments)
		if !validAnthropicToolInput(input) || call.ID == "" || call.Function.Name == "" {
			return nil, errors.New("invalid Anthropic tool call in conversation")
		}
		blocks = append(blocks, anthropicJSON(map[string]any{
			"type": "tool_use", "id": call.ID, "name": call.Function.Name, "input": input,
		}))
	}
	return blocks, nil
}

func validAnthropicToolInput(input json.RawMessage) bool {
	input = bytes.TrimSpace(input)
	return len(input) > 0 && input[0] == '{' && json.Valid(input)
}

type anthropicContentBlock struct {
	Type      string          `json:"type"`
	Text      string          `json:"text"`
	Thinking  string          `json:"thinking"`
	Signature string          `json:"signature"`
	Data      string          `json:"data"`
	ID        string          `json:"id"`
	Name      string          `json:"name"`
	Input     json.RawMessage `json:"input"`
	ToolUseID string          `json:"tool_use_id"`
}

func validateAnthropicHistory(blocks []json.RawMessage, calls []openai.ToolCall) error {
	if len(blocks) == 0 {
		return errors.New("empty Anthropic conversation content")
	}
	callIndex := 0
	callIDs := map[string]bool{}
	for _, raw := range blocks {
		var block anthropicContentBlock
		if json.Unmarshal(raw, &block) != nil {
			return errors.New("invalid Anthropic conversation content")
		}
		switch block.Type {
		case "text":
		case "thinking":
			if block.Signature == "" {
				return errors.New("Anthropic thinking signature is missing")
			}
		case "redacted_thinking":
			if block.Data == "" {
				return errors.New("Anthropic redacted thinking is missing")
			}
		case "tool_use":
			if block.ID == "" || block.Name == "" || callIDs[block.ID] || !validAnthropicToolInput(block.Input) || callIndex >= len(calls) ||
				block.ID != calls[callIndex].ID || block.Name != calls[callIndex].Function.Name {
				return errors.New("Anthropic conversation tool calls do not match native content")
			}
			callIDs[block.ID] = true
			if !equalAnthropicToolInput(block.Input, []byte(calls[callIndex].Function.Arguments)) {
				return errors.New("Anthropic conversation tool arguments do not match native content")
			}
			callIndex++
		default:
			return fmt.Errorf("unsupported Anthropic content block %q", block.Type)
		}
	}
	if callIndex != len(calls) {
		return errors.New("Anthropic conversation is missing native tool calls")
	}
	return nil
}

func equalAnthropicToolInput(native, projected []byte) bool {
	// 会话序列化可能调整对象键顺序，比较结构时保留数字精度和原生内容本身。
	decode := func(data []byte) (value any, err error) {
		if !validAnthropicToolInput(data) {
			return nil, errors.New("invalid Anthropic tool input")
		}
		decoder := json.NewDecoder(bytes.NewReader(data))
		decoder.UseNumber()
		err = decoder.Decode(&value)
		return
	}
	nativeValue, nativeErr := decode(native)
	projectedValue, projectedErr := decode(projected)
	return nativeErr == nil && projectedErr == nil && reflect.DeepEqual(nativeValue, projectedValue)
}

func validateAnthropicToolResults(messages []anthropicMessage) error {
	pending := map[string]bool{}
	for _, message := range messages {
		for _, raw := range message.Content {
			var block anthropicContentBlock
			if err := json.Unmarshal(raw, &block); err != nil {
				return err
			}
			if block.Type == "tool_result" {
				if message.Role != "user" || !pending[block.ToolUseID] {
					return errors.New("Anthropic tool result has no matching tool call")
				}
				delete(pending, block.ToolUseID)
			} else if message.Role == "user" && len(pending) > 0 {
				return errors.New("Anthropic tool results must precede other user content")
			} else if block.Type == "tool_use" {
				if message.Role != "assistant" || pending[block.ID] {
					return errors.New("invalid Anthropic tool call order")
				}
				pending[block.ID] = true
			}
		}
	}
	if len(pending) > 0 {
		return errors.New("Anthropic conversation is missing tool results")
	}
	return nil
}

type anthropicResponse struct {
	ID         string            `json:"id"`
	Model      string            `json:"model"`
	Content    []json.RawMessage `json:"content"`
	StopReason string            `json:"stop_reason"`
	Usage      anthropicUsage    `json:"usage"`
}

func anthropicCompletion(response anthropicResponse) (openai.ChatCompletionResponse, error) {
	message := openai.ChatCompletionMessage{Role: "assistant"}
	for i, raw := range response.Content {
		var block anthropicContentBlock
		if err := json.Unmarshal(raw, &block); err != nil {
			return openai.ChatCompletionResponse{}, err
		}
		switch block.Type {
		case "text":
			message.Content += block.Text
		case "thinking":
			message.ReasoningContent += block.Thinking
		case "tool_use":
			index := i
			message.ToolCalls = append(message.ToolCalls, openai.ToolCall{Index: &index, ID: block.ID,
				Type: openai.ToolTypeFunction, Function: openai.FunctionCall{Name: block.Name, Arguments: string(block.Input)}})
		}
	}
	if len(response.Content) > 0 {
		if err := validateAnthropicHistory(response.Content, message.ToolCalls); err != nil {
			return openai.ChatCompletionResponse{}, err
		}
	}
	finish, err := anthropicFinishReason(response.StopReason, len(message.ToolCalls) > 0)
	if err != nil {
		return openai.ChatCompletionResponse{}, err
	}
	return openai.ChatCompletionResponse{ID: response.ID, Model: response.Model, Object: "chat.completion",
		Choices: []openai.ChatCompletionChoice{{Index: 0, Message: message, FinishReason: finish}},
		Usage:   response.Usage.chatUsage()}, nil
}

func anthropicFinishReason(reason string, tools bool) (openai.FinishReason, error) {
	if tools && reason != "tool_use" {
		return "", errors.New("Anthropic response ended with incomplete tool use")
	}
	switch reason {
	case "end_turn", "stop_sequence":
		return openai.FinishReasonStop, nil
	case "tool_use":
		if !tools {
			return "", errors.New("Anthropic tool_use stop reason has no tool calls")
		}
		return openai.FinishReasonToolCalls, nil
	case "max_tokens":
		return openai.FinishReasonLength, nil
	case "refusal":
		return openai.FinishReasonContentFilter, nil
	default:
		return "", fmt.Errorf("unsupported Anthropic stop reason %q", reason)
	}
}

func createAnthropicCompletion(ctx context.Context, client *AIClient, request openai.ChatCompletionRequest) (openai.ChatCompletionResponse, error) {
	request.Stream = false
	payload, err := buildAnthropicRequest(ctx, request)
	if err != nil {
		return openai.ChatCompletionResponse{}, err
	}
	resp, err := client.anthropicRequest(ctx, http.MethodPost, "messages", payload)
	if err != nil {
		return openai.ChatCompletionResponse{}, err
	}
	defer resp.Body.Close()
	var response anthropicResponse
	if err = json.NewDecoder(io.LimitReader(resp.Body, 32*1024*1024)).Decode(&response); err != nil {
		return openai.ChatCompletionResponse{}, err
	}
	return anthropicCompletion(response)
}
