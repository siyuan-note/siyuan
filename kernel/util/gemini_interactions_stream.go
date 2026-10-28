// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package util

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"

	"github.com/sashabaranov/go-openai"
)

type geminiStreamingStep struct {
	raw       map[string]json.RawMessage
	kind      string
	text      strings.Builder
	arguments strings.Builder
	signature strings.Builder
	summary   []json.RawMessage
	stopped   bool
}

type geminiInteractionsStream struct {
	body     io.ReadCloser
	scanner  *bufio.Scanner
	response geminiInteraction
	steps    []*geminiStreamingStep
	size     int
	started  bool
	done     bool
	content  *AIMessageContent
}

func createGeminiInteractionsStream(ctx context.Context, client *AIClient, request openai.ChatCompletionRequest) (*OpenAICompletionStream, error) {
	request.Stream = true
	payload, err := buildGeminiInteractionsRequest(ctx, request)
	if err != nil {
		return nil, err
	}
	resp, err := client.geminiInteractionsRequest(ctx, payload)
	if err != nil {
		return nil, err
	}
	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 64*1024), geminiResponseLimit)
	return &OpenAICompletionStream{gemini: &geminiInteractionsStream{body: resp.Body, scanner: scanner}}, nil
}

func (s *geminiInteractionsStream) readEvent() ([]byte, error) {
	var data bytes.Buffer
	for s.scanner.Scan() {
		line := s.scanner.Text()
		if line == "" {
			return bytes.TrimSuffix(data.Bytes(), []byte("\n")), nil
		}
		if after, ok := strings.CutPrefix(line, "data:"); ok {
			data.WriteString(strings.TrimPrefix(after, " "))
			data.WriteByte('\n')
			if data.Len() > geminiResponseLimit {
				return nil, errors.New("Gemini stream event is too large")
			}
		}
	}
	if err := s.scanner.Err(); err != nil {
		return nil, err
	}
	return nil, errors.New("Gemini stream ended before interaction.completed")
}

func (s *geminiInteractionsStream) recv() (ret openai.ChatCompletionStreamResponse, err error) {
	ret = openai.ChatCompletionStreamResponse{Object: "chat.completion.chunk", ID: s.response.ID, Model: s.response.Model}
	if s.done {
		return ret, io.EOF
	}
	data, err := s.readEvent()
	if err != nil || len(data) == 0 {
		return ret, err
	}
	var event struct {
		Type        string                     `json:"event_type"`
		Index       *int                       `json:"index"`
		Interaction json.RawMessage            `json:"interaction"`
		Step        map[string]json.RawMessage `json:"step"`
		Delta       struct {
			Type      string          `json:"type"`
			Text      string          `json:"text"`
			Signature string          `json:"signature"`
			Arguments string          `json:"arguments"`
			Content   json.RawMessage `json:"content"`
		} `json:"delta"`
	}
	if err = json.Unmarshal(data, &event); err != nil {
		return ret, fmt.Errorf("invalid Gemini stream event: %w", err)
	}
	if event.Type == "error" {
		return ret, geminiInteractionsError(data, 0)
	}
	if !s.started && event.Type != "interaction.created" {
		return ret, errors.New("Gemini stream is missing interaction.created")
	}
	delta := openai.ChatCompletionStreamChoiceDelta{}
	switch event.Type {
	case "interaction.created":
		var created *geminiInteraction
		if s.started || json.Unmarshal(event.Interaction, &created) != nil || created == nil || len(created.Steps) != 0 {
			return ret, errors.New("invalid Gemini interaction.created")
		}
		// store=false 的响应可能没有交互 ID，通过当前流及步骤顺序关联后续事件。
		s.response = *created
		s.started = true
	case "step.start", "step.delta", "step.stop":
		s.size += len(data)
		if s.size > geminiResponseLimit {
			return ret, errors.New("Gemini interaction output is too large")
		}
		if event.Index == nil || *event.Index < 0 {
			return ret, errors.New("missing Gemini step index")
		}
		index := *event.Index
		if event.Type == "step.start" {
			if index != len(s.steps) || event.Step == nil {
				return ret, errors.New("invalid Gemini step order")
			}
			step := &geminiStreamingStep{raw: event.Step}
			var initial geminiStep
			if json.Unmarshal(geminiJSON(event.Step), &initial) != nil {
				return ret, errors.New("invalid Gemini step")
			}
			step.kind = initial.Type
			switch step.kind {
			case "model_output":
				delta.Content, err = geminiContentText(initial.Content)
			case "thought":
				delta.ReasoningContent, err = geminiContentText(initial.Summary)
				step.summary = initial.Summary
				step.signature.WriteString(initial.Signature)
			case "function_call":
				if initial.ID == "" || initial.Name == "" {
					return ret, errors.New("incomplete Gemini function call identity")
				}
			default:
				return ret, fmt.Errorf("unsupported Gemini step %q", step.kind)
			}
			if err != nil {
				return ret, err
			}
			s.steps = append(s.steps, step)
			break
		}
		if index >= len(s.steps) || s.steps[index].stopped {
			return ret, errors.New("Gemini step event has no active matching step")
		}
		step := s.steps[index]
		if event.Type == "step.stop" {
			switch step.kind {
			case "model_output":
				var content []json.RawMessage
				if raw := step.raw["content"]; len(raw) > 0 {
					if err = json.Unmarshal(raw, &content); err != nil {
						return ret, err
					}
				}
				if step.text.Len() > 0 {
					content = append(content, geminiText(step.text.String()))
				}
				step.raw["content"] = geminiJSON(content)
			case "thought":
				if step.signature.Len() > 0 {
					step.raw["signature"] = geminiJSON(step.signature.String())
				}
				if len(step.summary) > 0 {
					step.raw["summary"] = geminiJSON(step.summary)
				}
			case "function_call":
				if step.arguments.Len() > 0 {
					step.raw["arguments"] = json.RawMessage(step.arguments.String())
				}
				if !validAIToolArguments(step.raw["arguments"]) {
					return ret, errors.New("Gemini function arguments are not a complete JSON object")
				}
			}
			step.stopped = true
			break
		}
		switch event.Delta.Type {
		case "text":
			if step.kind != "model_output" {
				return ret, errors.New("Gemini text delta has an incompatible step")
			}
			step.text.WriteString(event.Delta.Text)
			delta.Content = event.Delta.Text
		case "thought_summary":
			if step.kind != "thought" {
				return ret, errors.New("Gemini thought summary has an incompatible step")
			}
			delta.ReasoningContent, err = geminiContentText([]json.RawMessage{event.Delta.Content})
			if err != nil {
				return ret, err
			}
			step.summary = append(step.summary, event.Delta.Content)
		case "thought_signature":
			if step.kind != "thought" {
				return ret, errors.New("Gemini thought signature has an incompatible step")
			}
			step.signature.WriteString(event.Delta.Signature)
		case "arguments_delta":
			if step.kind != "function_call" {
				return ret, errors.New("Gemini arguments delta has an incompatible step")
			}
			step.arguments.WriteString(event.Delta.Arguments)
		default:
			return ret, fmt.Errorf("unsupported Gemini delta %q", event.Delta.Type)
		}
	case "interaction.completed":
		var completed *geminiInteraction
		if json.Unmarshal(event.Interaction, &completed) != nil || completed == nil ||
			(completed.ID != "" && s.response.ID != "" && completed.ID != s.response.ID) {
			return ret, errors.New("invalid Gemini interaction.completed")
		}
		if s.response.ID == "" {
			s.response.ID = completed.ID
		}
		for _, step := range s.steps {
			if !step.stopped {
				return ret, errors.New("Gemini interaction ended with an incomplete step")
			}
			s.response.Steps = append(s.response.Steps, geminiJSON(step.raw))
		}
		// 终止事件可附带完整步骤，校验一致后保留其原生表示。
		if len(completed.Steps) > 0 {
			streamed, streamedErr := geminiStepsMessage(s.response.Steps)
			final, finalErr := geminiStepsMessage(completed.Steps)
			if streamedErr != nil || finalErr != nil || streamed.Content != final.Content ||
				streamed.ReasoningContent != final.ReasoningContent || !equalGeminiToolCalls(streamed.ToolCalls, final.ToolCalls) {
				return ret, errors.New("Gemini completed steps do not match streamed steps")
			}
			s.response.Steps = completed.Steps
		}
		s.response.Status, s.response.Usage, s.response.Errors = completed.Status, completed.Usage, completed.Errors
		completion, completionErr := geminiInteractionCompletion(s.response)
		if completionErr != nil {
			return ret, completionErr
		}
		s.done = true
		s.content = &AIMessageContent{Protocol: GeminiProtocolInteractions, Version: geminiContentVersion,
			Blocks: CloneOpenAIResponseOutput(s.response.Steps)}
		// 只有完整且成功的终止事件才能向 Agent 交付工具调用。
		ret.ID = s.response.ID
		ret.Usage = &completion.Usage
		ret.Choices = []openai.ChatCompletionStreamChoice{{Index: 0, FinishReason: completion.Choices[0].FinishReason,
			Delta: openai.ChatCompletionStreamChoiceDelta{ToolCalls: completion.Choices[0].Message.ToolCalls}}}
		return ret, nil
	case "interaction.status_update":
	default:
		return ret, fmt.Errorf("unsupported Gemini stream event %q", event.Type)
	}
	ret.ID, ret.Model = s.response.ID, s.response.Model
	if delta.Content != "" || delta.ReasoningContent != "" {
		ret.Choices = []openai.ChatCompletionStreamChoice{{Index: 0, Delta: delta}}
	}
	return ret, nil
}
