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

const systemPrompt = `You are a SiYuan AI assistant. You can search, read, create, and modify the user's notes.

Rules:
1. Confirm the user's intent before taking action
2. Summarize key points instead of listing everything when there are many search results
3. Ask for confirmation before deleting anything`

const maxToolCallRounds = 5

var confirmChannels = make(map[string]chan bool)

func ConfirmSession(id string, approved bool) {
	ch, ok := confirmChannels[id]
	if ok {
		ch <- approved
	}
}

type AgentEvent struct {
	Type             string
	Token            string
	Name             string
	Arguments        map[string]interface{}
	Result           string
	Reasoning        string
	ConfirmID        string
	Error            string
	PromptTokens     int
	CompletionTokens int
}

type UserMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type Reference struct {
	ID    string `json:"id"`
	Title string `json:"title"`
}

func AgentChat(ctx context.Context, client *openai.Client, model string, history []UserMessage, language string, references []Reference) <-chan AgentEvent {
	ch := make(chan AgentEvent, 100)

	go func() {
		defer close(ch)

		tools := convertMCPToolsToOpenAI()
		messages := buildMessages(history, language, references)
		var totalPrompt, totalCompletion int

		for round := 0; round < maxToolCallRounds; round++ {
			select {
			case <-ctx.Done():
				return
			default:
			}

			if round == 0 {
				ch <- AgentEvent{Type: "thinking", Reasoning: "analyzing"}
			} else {
				ch <- AgentEvent{Type: "thinking", Reasoning: "processing"}
			}

			req := openai.ChatCompletionRequest{
				Model:               model,
				Messages:            messages,
				Tools:               tools,
				Stream:              true,
				StreamOptions:       &openai.StreamOptions{IncludeUsage: true},
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

				if resp.Usage != nil {
					totalPrompt += resp.Usage.PromptTokens
					totalCompletion += resp.Usage.CompletionTokens
				}
			}

			if len(aggregatedToolCalls) > 0 {
				messages = append(messages, openai.ChatCompletionMessage{
					Role:      openai.ChatMessageRoleAssistant,
					Content:   contentBuilder.String(),
					ToolCalls: aggregatedToolCalls,
				})

				for _, tc := range aggregatedToolCalls {
					args := parseToolArgs(tc.Function.Arguments)
					action := ""
					if a, ok := args["action"]; ok {
						action, _ = a.(string)
					}

					ch <- AgentEvent{
						Type:      "tool_call",
						Name:      tc.Function.Name,
						Arguments: args,
					}

					if needsConfirm(tc.Function.Name, action) {
						confirmID := tc.ID
						ch <- AgentEvent{Type: "confirm", Name: tc.Function.Name, Arguments: args, ConfirmID: confirmID}
						ch2 := make(chan bool, 1)
						confirmChannels[confirmID] = ch2
						select {
						case approved := <-ch2:
							delete(confirmChannels, confirmID)
							if !approved {
								ch <- AgentEvent{Type: "tool_result", Name: tc.Function.Name, Result: "User rejected this operation"}
								messages = append(messages, openai.ChatCompletionMessage{
									Role:       openai.ChatMessageRoleTool,
									Content:    "User rejected this operation",
									ToolCallID: tc.ID,
								})
								continue
							}
						case <-ctx.Done():
							delete(confirmChannels, confirmID)
							return
						}
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

			content := contentBuilder.String()
			if content == "" {
				content = " "
			}
			messages = append(messages, openai.ChatCompletionMessage{
				Role:    openai.ChatMessageRoleAssistant,
				Content: content,
			})

			ch <- AgentEvent{Type: "usage", PromptTokens: totalPrompt, CompletionTokens: totalCompletion}
			ch <- AgentEvent{Type: "done"}
			return
		}

		ch <- AgentEvent{Type: "usage", PromptTokens: totalPrompt, CompletionTokens: totalCompletion}
		ch <- AgentEvent{Type: "done"}
	}()

	return ch
}

func GenerateTitle(client *openai.Client, model string, msg string) string {
	if len(msg) > 500 {
		msg = msg[:500]
	}
	resp, err := client.CreateChatCompletion(context.Background(), openai.ChatCompletionRequest{
		Model: model,
		Messages: []openai.ChatCompletionMessage{
			{Role: openai.ChatMessageRoleSystem, Content: "Generate a short conversation title (max 10 words) based on the user's first message. Return ONLY the title, no quotes, no punctuation at the end."},
			{Role: openai.ChatMessageRoleUser, Content: msg},
		},
		MaxTokens: 30,
	})
	if err != nil || len(resp.Choices) == 0 {
		if len(msg) > 30 {
			return msg[:30] + "..."
		}
		return msg
	}
	title := strings.TrimSpace(resp.Choices[0].Message.Content)
	if title == "" {
		if len(msg) > 30 {
			return msg[:30] + "..."
		}
		return msg
	}
	return title
}

var safeActions = map[string]bool{
	"get": true, "get_kramdown": true, "get_children": true, "breadcrumb": true,
	"tree_stat": true,
	"list": true, "search_docs": true, "fulltext": true, "backlinks": true,
	"mentions": true, "labels": true, "status": true, "version": true,
	"current_time": true, "workspace": true, "md": true, "query": true,
}

func needsConfirm(toolName string, action string) bool {
	if action == "" {
		return false
	}
	if safeActions[action] {
		return false
	}
	if toolName == "sync" && action == "status" {
		return false
	}
	return true
}

func buildMessages(history []UserMessage, language string, references []Reference) []openai.ChatCompletionMessage {
	var prompt = systemPrompt + "\n\nReply in " + langName(language) + "."
	if len(references) > 0 {
		prompt += "\n\nThe user has referenced the following content blocks:\n"
		for _, ref := range references {
			prompt += "- " + ref.Title + " (id: " + ref.ID + ")\n"
		}
		prompt += "Use the block tools to fetch their actual content before responding."
	}
	messages := []openai.ChatCompletionMessage{
		{Role: openai.ChatMessageRoleSystem, Content: prompt},
	}
	for _, msg := range history {
		messages = append(messages, openai.ChatCompletionMessage{
			Role:    msg.Role,
			Content: msg.Content,
		})
	}
	return messages
}

func langName(lang string) string {
	switch lang {
	case "zh_CN":
		return "Chinese (简体中文)"
	case "zh_CHT":
		return "Traditional Chinese (繁體中文)"
	case "ja_JP":
		return "Japanese"
	case "ko_KR":
		return "Korean"
	case "fr_FR":
		return "French"
	case "de_DE":
		return "German"
	case "es_ES":
		return "Spanish"
	case "it_IT":
		return "Italian"
	case "pt_BR":
		return "Portuguese"
	case "ru_RU":
		return "Russian"
	case "ar_SA":
		return "Arabic"
	case "he_IL":
		return "Hebrew"
	case "hi_IN":
		return "Hindi"
	case "id_ID":
		return "Indonesian"
	case "nl_NL":
		return "Dutch"
	case "pl_PL":
		return "Polish"
	case "th_TH":
		return "Thai"
	case "tr_TR":
		return "Turkish"
	case "uk_UA":
		return "Ukrainian"
	case "sk_SK":
		return "Slovak"
	default:
		return "English"
	}
}
