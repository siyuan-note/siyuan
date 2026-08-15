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
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"

	"github.com/sashabaranov/go-openai"
)

const (
	OpenAIProtocolChatCompletions = "openai"
	OpenAIProtocolResponses       = "openai-responses"
)

func IsOpenAIResponsesProtocol(protocol string) bool {
	return strings.EqualFold(strings.TrimSpace(protocol), OpenAIProtocolResponses)
}

// OpenAICompletionStream 将 Chat Completions 与 Responses 的流式输出统一为 Chat 增量，
// 让现有上层渲染、重试和工具执行逻辑保持一致。
type OpenAICompletionStream struct {
	chat              *openai.ChatCompletionStream
	responses         *openai.ResponseStream
	pending           []openai.ChatCompletionStreamResponse
	responseOutput    []json.RawMessage
	responseContent   strings.Builder
	responseToolCalls map[int]openai.ToolCall
	responsesDone     bool
}

func CreateOpenAICompletionStream(ctx context.Context, client *openai.Client, protocol string,
	request openai.ChatCompletionRequest, responseInput []any) (*OpenAICompletionStream, error) {
	if !IsOpenAIResponsesProtocol(protocol) {
		stream, err := client.CreateChatCompletionStream(ctx, request)
		if err != nil {
			return nil, err
		}
		return &OpenAICompletionStream{chat: stream}, nil
	}

	stream, err := client.CreateResponseStream(ctx, responseRequestFromChat(request, responseInput))
	if err != nil {
		return nil, err
	}
	return &OpenAICompletionStream{
		responses:         stream,
		responseToolCalls: map[int]openai.ToolCall{},
	}, nil
}

func CreateOpenAICompletion(ctx context.Context, client *openai.Client, protocol string,
	request openai.ChatCompletionRequest, responseInput []any) (openai.ChatCompletionResponse, error) {
	if !IsOpenAIResponsesProtocol(protocol) {
		return client.CreateChatCompletion(ctx, request)
	}
	response, err := client.CreateResponse(ctx, responseRequestFromChat(request, responseInput))
	if err != nil {
		return openai.ChatCompletionResponse{}, err
	}
	if err = responseResultError(response); err != nil {
		return openai.ChatCompletionResponse{}, err
	}
	return responseToChatCompletion(response), nil
}

func CompactOpenAIResponse(ctx context.Context, client *openai.Client, request openai.ChatCompletionRequest,
	responseInput []any) ([]json.RawMessage, *openai.ResponseUsage, error) {
	responseRequest := openai.CompactResponseRequest{
		Model:        request.Model,
		Input:        responseInput,
		Instructions: firstSystemMessage(request.Messages),
	}
	compaction, err := client.CompactResponse(ctx, responseRequest)
	if err != nil {
		return nil, nil, err
	}
	output, err := MarshalOpenAIResponseOutput(compaction.Output)
	if err != nil {
		return nil, compaction.Usage, err
	}
	if len(output) == 0 {
		return nil, compaction.Usage, errors.New("response compaction returned no output")
	}
	return output, compaction.Usage, nil
}

func MarshalOpenAIResponseOutput(output []any) ([]json.RawMessage, error) {
	if len(output) == 0 {
		return nil, nil
	}
	ret := make([]json.RawMessage, 0, len(output))
	for _, item := range output {
		data, err := json.Marshal(item)
		if err != nil {
			return nil, err
		}
		ret = append(ret, json.RawMessage(data))
	}
	return ret, nil
}

func CloneOpenAIResponseOutput(output []json.RawMessage) []json.RawMessage {
	if len(output) == 0 {
		return nil
	}
	ret := make([]json.RawMessage, len(output))
	for i, item := range output {
		ret[i] = append(json.RawMessage(nil), item...)
	}
	return ret
}

func ChatMessagesToOpenAIResponseInput(messages []openai.ChatCompletionMessage) []any {
	input := make([]any, 0, len(messages))
	systemSkipped := false
	for _, message := range messages {
		if message.Role == openai.ChatMessageRoleSystem && !systemSkipped {
			systemSkipped = true
			continue
		}
		input = appendChatMessageToResponseInput(input, message)
	}
	return input
}

func appendChatMessageToResponseInput(input []any, message openai.ChatCompletionMessage) []any {
	switch message.Role {
	case openai.ChatMessageRoleTool:
		return append(input, openai.ResponseFunctionCallOutput{
			Type:   "function_call_output",
			CallID: message.ToolCallID,
			Output: message.Content,
		})
	case openai.ChatMessageRoleAssistant:
		if message.Content != "" {
			input = append(input, openai.ResponseInputMessage{
				Type:    "message",
				Role:    openai.ChatMessageRoleAssistant,
				Content: message.Content,
			})
		}
		for _, toolCall := range message.ToolCalls {
			input = append(input, map[string]any{
				"type":      "function_call",
				"call_id":   toolCall.ID,
				"name":      toolCall.Function.Name,
				"arguments": toolCall.Function.Arguments,
			})
		}
		return input
	}

	content := any(message.Content)
	if len(message.MultiContent) > 0 {
		parts := make([]any, 0, len(message.MultiContent))
		for _, part := range message.MultiContent {
			switch part.Type {
			case openai.ChatMessagePartTypeText:
				parts = append(parts, openai.ResponseInputText{Type: "input_text", Text: part.Text})
			case openai.ChatMessagePartTypeImageURL:
				if part.ImageURL != nil {
					parts = append(parts, openai.ResponseInputImage{
						Type:     "input_image",
						ImageURL: part.ImageURL.URL,
						Detail:   string(part.ImageURL.Detail),
					})
				}
			}
		}
		content = parts
	}
	return append(input, openai.ResponseInputMessage{
		Type:    "message",
		Role:    message.Role,
		Content: content,
	})
}

func responseRequestFromChat(request openai.ChatCompletionRequest, responseInput []any) openai.CreateResponseRequest {
	if responseInput == nil {
		responseInput = ChatMessagesToOpenAIResponseInput(request.Messages)
	}
	store := false
	responseRequest := openai.CreateResponseRequest{
		Model:             request.Model,
		Input:             responseInput,
		Instructions:      firstSystemMessage(request.Messages),
		MaxOutputTokens:   max(request.MaxCompletionTokens, request.MaxTokens),
		Store:             &store,
		Include:           []openai.ResponseInclude{openai.ResponseIncludeReasoningEncryptedContent},
		Tools:             responseTools(request.Tools),
		ToolChoice:        responseToolChoice(request.ToolChoice),
		ParallelToolCalls: boolPointer(request.ParallelToolCalls),
		User:              request.User,
	}
	temperature := request.Temperature
	responseRequest.Temperature = &temperature
	if request.TopP != 0 {
		topP := request.TopP
		responseRequest.TopP = &topP
	}
	if request.ReasoningEffort != "" {
		responseRequest.Reasoning = &openai.ResponseReasoning{
			Effort:  request.ReasoningEffort,
			Summary: "auto",
		}
	}
	if request.ResponseFormat != nil {
		responseRequest.Text = responseTextConfig(request.ResponseFormat)
	}
	return responseRequest
}

func firstSystemMessage(messages []openai.ChatCompletionMessage) string {
	for _, message := range messages {
		if message.Role == openai.ChatMessageRoleSystem {
			return message.Content
		}
	}
	return ""
}

func responseTools(tools []openai.Tool) []openai.ResponseTool {
	if len(tools) == 0 {
		return nil
	}
	ret := make([]openai.ResponseTool, 0, len(tools))
	for _, tool := range tools {
		if tool.Type == openai.ToolTypeFunction && tool.Function != nil {
			ret = append(ret, openai.NewResponseFunctionTool(*tool.Function))
			continue
		}
		ret = append(ret, openai.ResponseTool{Type: tool.Type, Parameters: tool.Parameters})
	}
	return ret
}

func responseToolChoice(choice any) any {
	toolChoice, ok := choice.(openai.ToolChoice)
	if !ok || toolChoice.Type != openai.ToolTypeFunction {
		return choice
	}
	return map[string]any{"type": "function", "name": toolChoice.Function.Name}
}

func boolPointer(value any) *bool {
	switch typed := value.(type) {
	case bool:
		return &typed
	case *bool:
		return typed
	default:
		return nil
	}
}

func responseTextConfig(format *openai.ChatCompletionResponseFormat) *openai.ResponseTextConfig {
	if format == nil {
		return nil
	}
	responseFormat := &openai.ResponseTextFormat{Type: string(format.Type)}
	if format.JSONSchema != nil {
		responseFormat.Name = format.JSONSchema.Name
		responseFormat.Description = format.JSONSchema.Description
		responseFormat.Schema = format.JSONSchema.Schema
		responseFormat.Strict = format.JSONSchema.Strict
	}
	return &openai.ResponseTextConfig{Format: responseFormat}
}

func responseToChatCompletion(response openai.CreateResponseResponse) openai.ChatCompletionResponse {
	refusal := responseRefusalText(response)
	message := openai.ChatCompletionMessage{
		Role:    openai.ChatMessageRoleAssistant,
		Content: responseDisplayText(response),
		Refusal: refusal,
	}
	for index, raw := range response.Output {
		item, ok := responseOutputItem(raw)
		if !ok {
			continue
		}
		switch item.Type {
		case "function_call":
			idx := index
			message.ToolCalls = append(message.ToolCalls, openai.ToolCall{
				Index: &idx,
				ID:    item.CallID,
				Type:  openai.ToolTypeFunction,
				Function: openai.FunctionCall{
					Name:      item.Name,
					Arguments: item.Arguments,
				},
			})
		case "reasoning":
			for _, summary := range item.Summary {
				message.ReasoningContent += summary.Text
			}
		}
	}
	finishReason := responseFinishReason(response)
	if len(message.ToolCalls) > 0 && finishReason == openai.FinishReasonStop {
		finishReason = openai.FinishReasonToolCalls
	}
	return openai.ChatCompletionResponse{
		ID:      response.ID,
		Object:  "chat.completion",
		Created: response.Created,
		Model:   response.Model,
		Choices: []openai.ChatCompletionChoice{{
			Index:        0,
			Message:      message,
			FinishReason: finishReason,
		}},
		Usage: responseUsageToChat(response.Usage),
	}
}

func responseOutputItem(raw any) (openai.ResponseOutputItem, bool) {
	data, err := json.Marshal(raw)
	if err != nil {
		return openai.ResponseOutputItem{}, false
	}
	var item openai.ResponseOutputItem
	if err = json.Unmarshal(data, &item); err != nil {
		return openai.ResponseOutputItem{}, false
	}
	return item, true
}

func responseFinishReason(response openai.CreateResponseResponse) openai.FinishReason {
	if response.Status == openai.ResponseStatusIncomplete && response.IncompleteDetails != nil {
		switch response.IncompleteDetails.Reason {
		case "max_output_tokens":
			return openai.FinishReasonLength
		case "content_filter":
			return openai.FinishReasonContentFilter
		}
	}
	return openai.FinishReasonStop
}

func responseUsageToChat(usage *openai.ResponseUsage) openai.Usage {
	if usage == nil {
		return openai.Usage{}
	}
	ret := openai.Usage{
		PromptTokens:     usage.InputTokens,
		CompletionTokens: usage.OutputTokens,
		TotalTokens:      usage.TotalTokens,
	}
	if usage.InputTokensDetails != nil {
		ret.PromptTokensDetails = &openai.PromptTokensDetails{CachedTokens: usage.InputTokensDetails.CachedTokens}
	}
	if usage.OutputTokensDetails != nil {
		ret.CompletionTokensDetails = &openai.CompletionTokensDetails{
			ReasoningTokens: usage.OutputTokensDetails.ReasoningTokens,
		}
	}
	return ret
}

func (stream *OpenAICompletionStream) Recv() (openai.ChatCompletionStreamResponse, error) {
	if stream.chat != nil {
		return stream.chat.Recv()
	}
	if stream.responses == nil {
		return openai.ChatCompletionStreamResponse{}, io.EOF
	}
	if len(stream.pending) > 0 {
		response := stream.pending[0]
		stream.pending = stream.pending[1:]
		return response, nil
	}
	if stream.responsesDone {
		return openai.ChatCompletionStreamResponse{}, io.EOF
	}

	for {
		event, err := stream.responses.Recv()
		if err != nil {
			if errors.Is(err, io.EOF) {
				return openai.ChatCompletionStreamResponse{}, errors.New("response stream ended before a terminal event")
			}
			return openai.ChatCompletionStreamResponse{}, err
		}
		response := openai.ChatCompletionStreamResponse{Object: "chat.completion.chunk"}
		switch event.Type {
		case openai.ResponseStreamEventOutputTextDelta:
			stream.responseContent.WriteString(event.Delta)
			response.Choices = []openai.ChatCompletionStreamChoice{{
				Index: 0,
				Delta: openai.ChatCompletionStreamChoiceDelta{Content: event.Delta},
			}}
			return response, nil
		case openai.ResponseStreamEventRefusalDelta:
			stream.responseContent.WriteString(event.Delta)
			response.Choices = []openai.ChatCompletionStreamChoice{{
				Index: 0,
				Delta: openai.ChatCompletionStreamChoiceDelta{Content: event.Delta, Refusal: event.Delta},
			}}
			return response, nil
		case openai.ResponseStreamEventReasoningSummaryTextDelta, openai.ResponseStreamEventReasoningTextDelta:
			response.Choices = []openai.ChatCompletionStreamChoice{{
				Index: 0,
				Delta: openai.ChatCompletionStreamChoiceDelta{ReasoningContent: event.Delta},
			}}
			return response, nil
		case openai.ResponseStreamEventOutputItemAdded:
			if event.Item == nil || event.Item.Type != "function_call" {
				return response, nil
			}
			index := event.OutputIndex
			call := openai.ToolCall{
				Index: &index,
				ID:    event.Item.CallID,
				Type:  openai.ToolTypeFunction,
				Function: openai.FunctionCall{
					Name:      event.Item.Name,
					Arguments: event.Item.Arguments,
				},
			}
			stream.responseToolCalls[index] = call
			response.Choices = []openai.ChatCompletionStreamChoice{{
				Index: 0,
				Delta: openai.ChatCompletionStreamChoiceDelta{ToolCalls: []openai.ToolCall{call}},
			}}
			return response, nil
		case openai.ResponseStreamEventFunctionArgumentsDelta:
			index := event.OutputIndex
			call := stream.responseToolCalls[index]
			call.Index = &index
			call.Type = openai.ToolTypeFunction
			call.Function.Arguments += event.Delta
			stream.responseToolCalls[index] = call
			response.Choices = []openai.ChatCompletionStreamChoice{{
				Index: 0,
				Delta: openai.ChatCompletionStreamChoiceDelta{ToolCalls: []openai.ToolCall{{
					Index: &index,
					Type:  openai.ToolTypeFunction,
					Function: openai.FunctionCall{
						Arguments: event.Delta,
					},
				}}},
			}}
			return response, nil
		case openai.ResponseStreamEventCompleted, openai.ResponseStreamEventIncomplete:
			if event.Response == nil {
				return openai.ChatCompletionStreamResponse{}, errors.New("response stream terminal event is missing response")
			}
			if err = stream.queueResponseTerminal(*event.Response); err != nil {
				return openai.ChatCompletionStreamResponse{}, err
			}
			stream.responsesDone = true
			response = stream.pending[0]
			stream.pending = stream.pending[1:]
			return response, nil
		case openai.ResponseStreamEventFailed:
			return openai.ChatCompletionStreamResponse{}, responseEventError(event, "response failed")
		case openai.ResponseStreamEventError:
			return openai.ChatCompletionStreamResponse{}, responseEventError(event, "response stream failed")
		}
		return response, nil
	}
}

func (stream *OpenAICompletionStream) queueResponseTerminal(response openai.CreateResponseResponse) error {
	if err := responseResultError(response); err != nil {
		return err
	}
	terminalToolCalls := map[int]struct{}{}
	for index, raw := range response.Output {
		item, ok := responseOutputItem(raw)
		if !ok || item.Type != "function_call" {
			continue
		}
		if item.Status == "incomplete" || item.Status == "in_progress" ||
			(response.Status == openai.ResponseStatusIncomplete && item.Status != "completed") {
			return errors.New("response ended with an incomplete function call")
		}
		terminalToolCalls[index] = struct{}{}
	}
	for index := range stream.responseToolCalls {
		if _, ok := terminalToolCalls[index]; !ok {
			return errors.New("streamed function call is missing from the terminal response")
		}
	}
	output, err := MarshalOpenAIResponseOutput(response.Output)
	if err != nil {
		return err
	}
	stream.responseOutput = output

	for index, raw := range response.Output {
		item, ok := responseOutputItem(raw)
		if !ok || item.Type != "function_call" {
			continue
		}
		current := stream.responseToolCalls[index]
		if current.ID != "" && item.CallID != "" && current.ID != item.CallID {
			return errors.New("streamed function call ID does not match the terminal response")
		}
		if current.Function.Name != "" && item.Name != "" && current.Function.Name != item.Name {
			return errors.New("streamed function name does not match the terminal response")
		}
		if current.Function.Arguments != item.Arguments &&
			!strings.HasPrefix(item.Arguments, current.Function.Arguments) {
			return errors.New("streamed function arguments do not match the terminal response")
		}
		delta := openai.ToolCall{Type: openai.ToolTypeFunction}
		deltaIndex := index
		delta.Index = &deltaIndex
		changed := false
		if current.ID == "" && item.CallID != "" {
			delta.ID = item.CallID
			changed = true
		}
		if current.Function.Name == "" && item.Name != "" {
			delta.Function.Name = item.Name
			changed = true
		}
		if current.Function.Arguments != item.Arguments && strings.HasPrefix(item.Arguments, current.Function.Arguments) {
			delta.Function.Arguments = strings.TrimPrefix(item.Arguments, current.Function.Arguments)
			changed = delta.Function.Arguments != "" || changed
		}
		if changed {
			stream.pending = append(stream.pending, openai.ChatCompletionStreamResponse{
				Object: "chat.completion.chunk",
				Choices: []openai.ChatCompletionStreamChoice{{
					Index: 0,
					Delta: openai.ChatCompletionStreamChoiceDelta{ToolCalls: []openai.ToolCall{delta}},
				}},
			})
		}
	}

	fullContent := responseDisplayText(response)
	if currentContent := stream.responseContent.String(); fullContent != currentContent &&
		!strings.HasPrefix(fullContent, currentContent) {
		return errors.New("streamed response text does not match the terminal response")
	}
	if currentContent := stream.responseContent.String(); fullContent != currentContent && strings.HasPrefix(fullContent, currentContent) {
		missing := strings.TrimPrefix(fullContent, currentContent)
		if missing != "" {
			stream.pending = append(stream.pending, openai.ChatCompletionStreamResponse{
				Object: "chat.completion.chunk",
				Choices: []openai.ChatCompletionStreamChoice{{
					Index: 0,
					Delta: openai.ChatCompletionStreamChoiceDelta{Content: missing},
				}},
			})
		}
	}

	finishReason := responseFinishReason(response)
	if hasResponseFunctionCall(response.Output) && finishReason == openai.FinishReasonStop {
		finishReason = openai.FinishReasonToolCalls
	}
	usage := responseUsageToChat(response.Usage)
	stream.pending = append(stream.pending, openai.ChatCompletionStreamResponse{
		ID:      response.ID,
		Object:  "chat.completion.chunk",
		Created: response.Created,
		Model:   response.Model,
		Choices: []openai.ChatCompletionStreamChoice{{Index: 0, FinishReason: finishReason}},
		Usage:   &usage,
	})
	return nil
}

func responseDisplayText(response openai.CreateResponseResponse) string {
	if text := response.GetOutputText(); text != "" {
		return text
	}
	return responseRefusalText(response)
}

func responseRefusalText(response openai.CreateResponseResponse) string {
	var refusal strings.Builder
	for _, raw := range response.Output {
		item, ok := responseOutputItem(raw)
		if !ok {
			continue
		}
		for _, content := range item.Content {
			if content.Type == "refusal" {
				refusal.WriteString(content.Refusal)
			}
		}
	}
	return refusal.String()
}

func responseResultError(response openai.CreateResponseResponse) error {
	if response.Error != nil && response.Error.Message != "" {
		return &openai.APIError{Code: response.Error.Code, Message: response.Error.Message}
	}
	if response.Status == openai.ResponseStatusIncomplete && hasResponseFunctionCall(response.Output) {
		return errors.New("response ended with an incomplete function call")
	}
	switch response.Status {
	case "", openai.ResponseStatusCompleted, openai.ResponseStatusIncomplete:
		return nil
	default:
		return fmt.Errorf("response returned status %s", response.Status)
	}
}

func hasResponseFunctionCall(output []any) bool {
	for _, raw := range output {
		item, ok := responseOutputItem(raw)
		if ok && item.Type == "function_call" {
			return true
		}
	}
	return false
}

func responseEventError(event openai.ResponseStreamEvent, fallback string) error {
	if event.Error != nil && event.Error.Message != "" {
		return &openai.APIError{Code: event.Error.Code, Message: event.Error.Message}
	}
	if event.Response != nil && event.Response.Error != nil && event.Response.Error.Message != "" {
		return &openai.APIError{Code: event.Response.Error.Code, Message: event.Response.Error.Message}
	}
	if event.Message != "" {
		return &openai.APIError{Code: event.Code, Message: event.Message}
	}
	return errors.New(fallback)
}

func (stream *OpenAICompletionStream) ResponseOutput() []json.RawMessage {
	return CloneOpenAIResponseOutput(stream.responseOutput)
}

func (stream *OpenAICompletionStream) Close() {
	if stream.chat != nil {
		stream.chat.Close()
	}
	if stream.responses != nil {
		stream.responses.Close()
	}
}
