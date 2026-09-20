package util

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/sashabaranov/go-openai"
)

type anthropicStream struct {
	body       io.ReadCloser
	scanner    *bufio.Scanner
	response   anthropicResponse
	block      map[string]json.RawMessage
	blockType  string
	blockIndex int
	arguments  strings.Builder
	text       strings.Builder
	thinking   strings.Builder
	signature  strings.Builder
	started    bool
	done       bool
	content    *AIMessageContent
}

func createAnthropicStream(ctx context.Context, client *AIClient, request openai.ChatCompletionRequest) (*OpenAICompletionStream, error) {
	request.Stream = true
	payload, err := buildAnthropicRequest(ctx, request)
	if err != nil {
		return nil, err
	}
	response, err := client.anthropicRequest(ctx, http.MethodPost, "messages", payload)
	if err != nil {
		return nil, err
	}
	scanner := bufio.NewScanner(response.Body)
	scanner.Buffer(make([]byte, 64*1024), 32*1024*1024)
	return &OpenAICompletionStream{anthropic: &anthropicStream{body: response.Body, scanner: scanner}}, nil
}

// readEvent 读取完整 SSE 事件，保留多行 data，并让心跳返回上层重置空闲计时器。
func (s *anthropicStream) readEvent() ([]byte, error) {
	var data bytes.Buffer
	for s.scanner.Scan() {
		line := strings.TrimSuffix(s.scanner.Text(), "\r")
		if line == "" {
			return bytes.TrimSuffix(data.Bytes(), []byte("\n")), nil
		}
		if strings.HasPrefix(line, "data:") {
			data.WriteString(strings.TrimPrefix(strings.TrimPrefix(line, "data:"), " "))
			data.WriteByte('\n')
			if data.Len() > 32*1024*1024 {
				return nil, errors.New("Anthropic stream event is too large")
			}
		}
	}
	if err := s.scanner.Err(); err != nil {
		return nil, err
	}
	return nil, errors.New("Anthropic stream ended before message_stop")
}

func (s *anthropicStream) recv() (openai.ChatCompletionStreamResponse, error) {
	ret := openai.ChatCompletionStreamResponse{Object: "chat.completion.chunk", ID: s.response.ID, Model: s.response.Model}
	if s.done {
		return ret, io.EOF
	}
	data, err := s.readEvent()
	if err != nil || len(data) == 0 {
		return ret, err
	}
	var event struct {
		Type         string                     `json:"type"`
		Index        int                        `json:"index"`
		Message      *anthropicResponse         `json:"message"`
		ContentBlock map[string]json.RawMessage `json:"content_block"`
		Delta        struct {
			Type        string `json:"type"`
			Text        string `json:"text"`
			Thinking    string `json:"thinking"`
			Signature   string `json:"signature"`
			PartialJSON string `json:"partial_json"`
			StopReason  string `json:"stop_reason"`
		} `json:"delta"`
		Usage json.RawMessage `json:"usage"`
	}
	if err = json.Unmarshal(data, &event); err != nil {
		return ret, fmt.Errorf("invalid Anthropic stream event: %w", err)
	}
	delta := openai.ChatCompletionStreamChoiceDelta{}
	switch event.Type {
	case "error":
		return ret, anthropicError(data, 0)
	case "message_start":
		if s.started || event.Message == nil || len(event.Message.Content) != 0 {
			return ret, errors.New("invalid Anthropic message_start")
		}
		s.started = true
		s.response = *event.Message
	case "content_block_start":
		if !s.started || s.block != nil || event.ContentBlock == nil || event.Index != len(s.response.Content) {
			return ret, errors.New("invalid Anthropic content block order")
		}
		s.block, s.blockIndex = event.ContentBlock, event.Index
		s.arguments.Reset()
		s.text.Reset()
		s.thinking.Reset()
		s.signature.Reset()
		if json.Unmarshal(s.block["type"], &s.blockType) != nil {
			return ret, errors.New("missing Anthropic content block type")
		}
		switch s.blockType {
		case "text":
			_ = json.Unmarshal(s.block["text"], &delta.Content)
			s.text.WriteString(delta.Content)
		case "thinking":
			_ = json.Unmarshal(s.block["thinking"], &delta.ReasoningContent)
			s.thinking.WriteString(delta.ReasoningContent)
			var signature string
			_ = json.Unmarshal(s.block["signature"], &signature)
			s.signature.WriteString(signature)
		case "tool_use":
			call := openai.ToolCall{Index: &event.Index, Type: openai.ToolTypeFunction}
			_ = json.Unmarshal(s.block["id"], &call.ID)
			_ = json.Unmarshal(s.block["name"], &call.Function.Name)
			if call.ID == "" || call.Function.Name == "" {
				return ret, errors.New("incomplete Anthropic tool call identity")
			}
			delta.ToolCalls = []openai.ToolCall{call}
		case "redacted_thinking":
		default:
			return ret, fmt.Errorf("unsupported Anthropic content block %q", s.blockType)
		}
	case "content_block_delta":
		if s.block == nil || event.Index != s.blockIndex {
			return ret, errors.New("Anthropic content delta has no matching block")
		}
		switch event.Delta.Type {
		case "text_delta":
			if s.blockType != "text" {
				return ret, errors.New("Anthropic text delta has an incompatible block")
			}
			s.appendString("text", event.Delta.Text)
			delta.Content = event.Delta.Text
		case "thinking_delta":
			if s.blockType != "thinking" {
				return ret, errors.New("Anthropic thinking delta has an incompatible block")
			}
			s.appendString("thinking", event.Delta.Thinking)
			delta.ReasoningContent = event.Delta.Thinking
		case "signature_delta":
			if s.blockType != "thinking" {
				return ret, errors.New("Anthropic signature delta has an incompatible block")
			}
			s.appendString("signature", event.Delta.Signature)
		case "input_json_delta":
			if s.blockType != "tool_use" {
				return ret, errors.New("Anthropic input delta has an incompatible block")
			}
			s.arguments.WriteString(event.Delta.PartialJSON)
			if s.arguments.Len() > 32*1024*1024 {
				return ret, errors.New("Anthropic tool input is too large")
			}
			delta.ToolCalls = []openai.ToolCall{{Index: &event.Index,
				Function: openai.FunctionCall{Arguments: event.Delta.PartialJSON}}}
		}
	case "content_block_stop":
		if s.block == nil || event.Index != s.blockIndex {
			return ret, errors.New("Anthropic content stop has no matching block")
		}
		if s.blockType == "text" {
			s.block["text"] = anthropicJSON(s.text.String())
		} else if s.blockType == "thinking" {
			s.block["thinking"] = anthropicJSON(s.thinking.String())
			s.block["signature"] = anthropicJSON(s.signature.String())
		}
		if s.blockType == "tool_use" {
			if s.arguments.Len() > 0 {
				s.block["input"] = json.RawMessage(s.arguments.String())
			} else {
				delta.ToolCalls = []openai.ToolCall{{Index: &event.Index,
					Function: openai.FunctionCall{Arguments: string(s.block["input"])}}}
			}
			if !validAnthropicToolInput(s.block["input"]) {
				return ret, errors.New("Anthropic tool input is not a complete JSON object")
			}
		}
		s.response.Content = append(s.response.Content, anthropicJSON(s.block))
		s.block = nil
	case "message_delta":
		if !s.started || s.block != nil {
			return ret, errors.New("invalid Anthropic message_delta order")
		}
		if event.Delta.StopReason != "" {
			s.response.StopReason = event.Delta.StopReason
		}
		if len(event.Usage) > 0 && string(event.Usage) != "null" {
			// 用量字段为累计值，未出现的字段保留 message_start 中的值。
			if err = json.Unmarshal(event.Usage, &s.response.Usage); err != nil {
				return ret, err
			}
		}
	case "message_stop":
		if !s.started || s.block != nil {
			return ret, errors.New("Anthropic message stopped with an incomplete content block")
		}
		completion, completionErr := anthropicCompletion(s.response)
		if completionErr != nil {
			return ret, completionErr
		}
		s.done = true
		if len(s.response.Content) > 0 {
			s.content = &AIMessageContent{Protocol: AnthropicProtocolMessages, Version: anthropicContentVersion,
				Blocks: CloneOpenAIResponseOutput(s.response.Content)}
		}
		ret.Usage = &completion.Usage
		ret.Choices = []openai.ChatCompletionStreamChoice{{Index: 0, FinishReason: completion.Choices[0].FinishReason}}
		return ret, nil
	}
	if delta.Content != "" || delta.ReasoningContent != "" || len(delta.ToolCalls) > 0 {
		ret.Choices = []openai.ChatCompletionStreamChoice{{Index: 0, Delta: delta}}
	}
	return ret, nil
}

func (s *anthropicStream) appendString(field, value string) {
	switch field {
	case "text":
		s.text.WriteString(value)
	case "thinking":
		s.thinking.WriteString(value)
	case "signature":
		s.signature.WriteString(value)
	}
}
