// SiYuan - Refactor your thinking
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

package agent

import (
	"context"
	"io"
	"strings"

	"github.com/sashabaranov/go-openai"
)

const systemPrompt = `你是思源笔记AI助手，可以搜索、读取、创建和修改用户的笔记内容。
规则：
1. 操作前先确认理解用户意图
2. 搜索结果较多时，总结要点而非逐条列出
3. 涉及删除操作时，先向用户确认
4. 使用中文回复`

const maxToolCallRounds = 5

type AgentEvent struct {
	Type      string
	Token     string
	Name      string
	Arguments map[string]interface{}
	Result    string
	Error     string
}

type UserMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

func AgentChat(ctx context.Context, client *openai.Client, model string, history []UserMessage) <-chan AgentEvent {
	ch := make(chan AgentEvent, 100)

	go func() {
		defer close(ch)

		tools := convertMCPToolsToOpenAI()
		messages := buildMessages(history)

		for round := 0; round < maxToolCallRounds; round++ {
			select {
			case <-ctx.Done():
				return
			default:
			}

			req := openai.ChatCompletionRequest{
				Model:               model,
				Messages:            messages,
				Tools:               tools,
				Stream:              true,
				Temperature:         1.0,
				MaxCompletionTokens: 4096,
			}

			stream, err := client.CreateChatCompletionStream(ctx, req)
			if err != nil {
				ch <- AgentEvent{Type: "error", Error: "API request failed: " + err.Error()}
				return
			}

			var contentBuilder strings.Builder
			var aggregatedToolCalls []openai.ToolCall

			for {
				resp, recvErr := stream.Recv()
				if recvErr != nil {
					if recvErr == io.EOF {
						break
					}
					ch <- AgentEvent{Type: "error", Error: "Stream error: " + recvErr.Error()}
					return
				}

				select {
				case <-ctx.Done():
					return
				default:
				}

				for _, choice := range resp.Choices {
					if choice.Delta.Content != "" {
						contentBuilder.WriteString(choice.Delta.Content)
						ch <- AgentEvent{Type: "content", Token: choice.Delta.Content}
					}

					for _, tcd := range choice.Delta.ToolCalls {
						idx := 0
						if tcd.Index != nil {
							idx = *tcd.Index
						}
						for len(aggregatedToolCalls) <= idx {
							aggregatedToolCalls = append(aggregatedToolCalls, openai.ToolCall{})
						}
						if tcd.ID != "" {
							aggregatedToolCalls[idx].ID = tcd.ID
							aggregatedToolCalls[idx].Type = tcd.Type
						}
						if tcd.Function.Name != "" {
							aggregatedToolCalls[idx].Function.Name = tcd.Function.Name
						}
						aggregatedToolCalls[idx].Function.Arguments += tcd.Function.Arguments
					}
				}
			}

			if len(aggregatedToolCalls) > 0 {
				if contentBuilder.Len() > 0 {
					messages = append(messages, openai.ChatCompletionMessage{
						Role:    openai.ChatMessageRoleAssistant,
						Content: contentBuilder.String(),
					})
				}
				messages = append(messages, openai.ChatCompletionMessage{
					Role:      openai.ChatMessageRoleAssistant,
					ToolCalls: aggregatedToolCalls,
				})

				for _, tc := range aggregatedToolCalls {
					args := parseToolArgs(tc.Function.Arguments)
					ch <- AgentEvent{
						Type:      "tool_call",
						Name:      tc.Function.Name,
						Arguments: args,
					}

					result := executeTool(tc)

					ch <- AgentEvent{
						Type:   "tool_result",
						Name:   tc.Function.Name,
						Result: result,
					}

					messages = append(messages, openai.ChatCompletionMessage{
						Role:       openai.ChatMessageRoleTool,
						Content:    result,
						ToolCallID: tc.ID,
					})
				}
				continue
			}

			messages = append(messages, openai.ChatCompletionMessage{
				Role:    openai.ChatMessageRoleAssistant,
				Content: contentBuilder.String(),
			})

			ch <- AgentEvent{Type: "done"}
			return
		}

		ch <- AgentEvent{Type: "done"}
	}()

	return ch
}

func buildMessages(history []UserMessage) []openai.ChatCompletionMessage {
	messages := []openai.ChatCompletionMessage{
		{Role: openai.ChatMessageRoleSystem, Content: systemPrompt},
	}
	for _, msg := range history {
		messages = append(messages, openai.ChatCompletionMessage{
			Role:    msg.Role,
			Content: msg.Content,
		})
	}
	return messages
}
