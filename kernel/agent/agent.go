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
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/sashabaranov/go-openai"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/siyuan/kernel/util"
)

const systemPrompt = `You are a SiYuan AI assistant. You help users manage their notes, documents, and knowledge base through the tools provided.

## Domain Concepts
- Block: the fundamental unit. Everything in SiYuan is a block with a unique ID, including documents themselves. A document block (type: NodeDocument) is the root block of a document. All content blocks (headings, paragraphs, lists, code, tables, etc.) live as children under a document block, forming a tree. Use block.get to read any block by its ID, block.get_children to browse sub-blocks, block.update to modify, block.append/insert to add content, block.delete to remove.
- Notebook: a top-level container holding documents. Use notebook.list to see all notebooks. Specify notebook ID when creating documents.
- hPath (human-readable path): the title-based path shown in the document tree, e.g. "/Diary/2024/June". The "path" parameter in document tools (document.create, document.move, document.list) refers to hPath, not the internal ID-based filesystem path. When a document is renamed, its hPath changes but its ID stays the same.
- Document vs block move: document.move performs full document relocation — it moves a document (and its children) to a new parent hPath in a notebook. Requires: id, notebook, path. The notebook ID can be found via document.get (field: Box). block.move repositions a single block under a new parent block — use this for moving content blocks, not entire documents.

## Tool Usage Patterns
- Finding information: search.fulltext (keyword) → block.get (by ID) to read full content. For semantic search use search.semantic.
- Exploring structure: document.list (see child documents under an hPath) → document.get (read document metadata and content) → block.get_children (list blocks inside a document) → block.get (read a specific block). Use breadcrumb to trace a block's location path.
- Creating content: document.create specifies the target notebook and hPath to create a document → block.append/prepend/insert to add blocks into the document. Use dataType "markdown" for text content.
- Modifying content: block.update with a block's ID and new markdown content.
- Organizing: document.move (full document relocation to a new hPath, needs notebook ID from document.get). document.rename changes a document's title (hPath follows). block.move repositions a single block under a new parent — for content blocks, not entire documents. document.delete removes a document by ID.
- Attributes/properties: use attr.get/set to read/write custom attributes on any block. Use database tools for spreadsheets/attribute views.

## Response Guidelines
- Reply in the language indicated by the user.
- Provide context: when mentioning documents or blocks, include their titles and IDs so the user can reference them.
- Be concise: summarize key findings rather than repeating large amounts of content.
- Use markdown formatting for readability: bullet points, headings, code blocks for technical content.

## Todo Tracking
- For multi-step tasks (3+ distinct steps), use the todo_write tool to create a structured task list before starting work. This helps the user see your progress.
- Each call replaces the entire list. Include all tasks, marking each with the correct status.
- Status values: pending (not started), in_progress (currently working on), completed (done), cancelled (no longer needed).
- Mark a task as in_progress before starting work on it, and completed immediately after finishing.
- Update the todo list whenever status changes — call todo_write with the updated list.
- Skip todo_write for simple single-step requests. Only use it when there is meaningful multi-step work to track.

## Safety
- Confirm before deleting documents, blocks, or data.
- Confirm before moving or renaming important items.
- Read operations (get, list, search, query) are always safe and do not need confirmation.
- Do not expose or log API keys, passwords, or sensitive configuration.`

const maxToolCallRounds = 64

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
	RetryAttempt     int
	RetryMax         int
}

type UserMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type AgentMessage struct {
	Role      string          `json:"role"`
	Content   string          `json:"content"`
	ToolCalls []AgentToolCall `json:"toolCalls,omitempty"`
}

type AgentToolCall struct {
	Name      string                 `json:"name"`
	Arguments map[string]interface{} `json:"arguments"`
	Result    string                 `json:"result,omitempty"`
}

type Reference struct {
	ID    string `json:"id"`
	Title string `json:"title"`
}

type agentCheckpoint struct {
	ID               string         `json:"id"`
	Title            string         `json:"title"`
	Messages         []AgentMessage `json:"messages"`
	PromptTokens     int            `json:"promptTokens"`
	CompletionTokens int            `json:"completionTokens"`
	TotalDuration    int64          `json:"totalDuration"`
	CreatedAt        int64          `json:"createdAt"`
	UpdatedAt        int64          `json:"updatedAt"`
}

func AgentChat(ctx context.Context, client *openai.Client, model string, sessionID string, history []UserMessage, language string, references []Reference, confirmTimeout time.Duration, maxRetries int) <-chan AgentEvent {
	ch := make(chan AgentEvent, 100)

	go func() {
		defer close(ch)

		tools := convertMCPToolsToOpenAI()
		messages := buildMessages(history, language, references)
		var totalPrompt, totalCompletion int
		startTime := time.Now().UnixMilli()

		checkpointMsgs := make([]AgentMessage, 0, len(history))
		for _, h := range history {
			checkpointMsgs = append(checkpointMsgs, AgentMessage{Role: h.Role, Content: h.Content})
		}

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

			stream, streamErr := createStreamWithRetry(ctx, client, req, maxRetries, ch)
			if streamErr != nil {
				ch <- AgentEvent{Type: "error", Error: "API request failed: " + streamErr.Error()}
				saveCheckpoint(sessionID, checkpointMsgs, totalPrompt, totalCompletion, startTime)
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

				checkpointMsg := AgentMessage{
					Role:    "assistant",
					Content: contentBuilder.String(),
				}
				for _, tc := range aggregatedToolCalls {
					checkpointMsg.ToolCalls = append(checkpointMsg.ToolCalls, AgentToolCall{
						Name:      tc.Function.Name,
						Arguments: parseToolArgs(tc.Function.Arguments),
					})
				}
				checkpointMsgs = append(checkpointMsgs, checkpointMsg)
				assistantIdx := len(checkpointMsgs) - 1

				for i, tc := range aggregatedToolCalls {
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
						var confirmResult string
						var approved bool
						timedOut := false

						select {
						case approved = <-ch2:
							delete(confirmChannels, confirmID)
						case <-ctx.Done():
							delete(confirmChannels, confirmID)
							return
						case <-time.After(confirmTimeout):
							delete(confirmChannels, confirmID)
							timedOut = true
							confirmResult = "Confirmation timed out, operation skipped automatically"
							ch <- AgentEvent{Type: "tool_result", Name: tc.Function.Name, Result: confirmResult}
						}

						if timedOut || !approved {
							if confirmResult == "" {
								confirmResult = "User rejected this operation"
								ch <- AgentEvent{Type: "tool_result", Name: tc.Function.Name, Result: confirmResult}
							}
							messages = append(messages, openai.ChatCompletionMessage{
								Role:       openai.ChatMessageRoleTool,
								Content:    confirmResult,
								ToolCallID: tc.ID,
							})
							checkpointMsgs[assistantIdx].ToolCalls[i].Result = confirmResult
							saveCheckpoint(sessionID, checkpointMsgs, totalPrompt, totalCompletion, startTime)
							continue
						}
					}

					setCurrentTodoSession(sessionID)
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
					checkpointMsgs[assistantIdx].ToolCalls[i].Result = result
				}
				saveCheckpoint(sessionID, checkpointMsgs, totalPrompt, totalCompletion, startTime)
				continue
			}

			content := contentBuilder.String()
			checkpointMsgs = append(checkpointMsgs, AgentMessage{Role: "assistant", Content: content})
			saveCheckpoint(sessionID, checkpointMsgs, totalPrompt, totalCompletion, startTime)
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
		saveCheckpoint(sessionID, checkpointMsgs, totalPrompt, totalCompletion, startTime)
		ch <- AgentEvent{Type: "done"}
	}()

	return ch
}

func GenerateTitle(client *openai.Client, model string, msg string) string {
	runes := []rune(msg)
	if len(runes) > 500 {
		msg = string(runes[:500])
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
		runes = []rune(msg)
		if len(runes) > 30 {
			return string(runes[:30]) + "..."
		}
		return msg
	}
	title := strings.TrimSpace(resp.Choices[0].Message.Content)
	if title == "" {
		runes = []rune(msg)
		if len(runes) > 30 {
			return string(runes[:30]) + "..."
		}
		return msg
	}
	return title
}

var safeActions = map[string]bool{
	"get": true, "get_kramdown": true, "get_children": true, "breadcrumb": true,
	"tree_stat": true,
	"list":      true, "search_docs": true, "fulltext": true, "backlinks": true,
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
	var prompt = systemPrompt + "\n\n<env>\nWorkspace: " + util.WorkspaceDir + "\nVersion: " + util.Ver + "\nToday's date: " + time.Now().Format("2006-01-02 Mon") + "\nContainer: " + util.Container + "\n</env>\n\nReply in " + langName(language) + "."
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
		content := msg.Content
		if content == "" {
			content = " "
		}
		messages = append(messages, openai.ChatCompletionMessage{
			Role:    msg.Role,
			Content: content,
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

func saveCheckpoint(sessionID string, messages []AgentMessage, promptTokens int, completionTokens int, startTime int64) {
	if sessionID == "" {
		return
	}

	cp := agentCheckpoint{
		ID:               sessionID,
		Title:            "AI Agent",
		Messages:         messages,
		PromptTokens:     promptTokens,
		CompletionTokens: completionTokens,
		TotalDuration:    time.Now().UnixMilli() - startTime,
		CreatedAt:        startTime,
		UpdatedAt:        time.Now().UnixMilli(),
	}

	dir := filepath.Join(util.DataDir, "storage", "ai", "agent", "sessions")
	_ = os.MkdirAll(dir, 0755)

	path := filepath.Join(dir, sessionID+".json")
	existing, err := os.ReadFile(path)
	if err == nil {
		var old agentCheckpoint
		if json.Unmarshal(existing, &old) == nil && old.Title != "" && old.Title != "AI Agent" {
			cp.Title = old.Title
		}
		if old.CreatedAt > 0 {
			cp.CreatedAt = old.CreatedAt
		}
	}

	data, err := json.MarshalIndent(cp, "", "  ")
	if err != nil {
		return
	}
	_ = filelock.WriteFile(path, data)
}

func createStreamWithRetry(ctx context.Context, client *openai.Client, req openai.ChatCompletionRequest, maxRetries int, ch chan<- AgentEvent) (*openai.ChatCompletionStream, error) {
	if maxRetries <= 0 {
		maxRetries = 1
	}

	var lastErr error
	for attempt := 0; attempt < maxRetries; attempt++ {
		if attempt > 0 {
			backoff := time.Duration(1<<uint(attempt-1)) * time.Second
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-time.After(backoff):
			}
			ch <- AgentEvent{Type: "retry", RetryAttempt: attempt + 1, RetryMax: maxRetries}
		}

		stream, err := client.CreateChatCompletionStream(ctx, req)
		if err == nil {
			return stream, nil
		}

		lastErr = err
		if !isRetryableError(err) {
			return nil, err
		}
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
	}
	return nil, lastErr
}

func isRetryableError(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	if strings.Contains(msg, "401") || strings.Contains(msg, "Unauthorized") {
		return false
	}
	if strings.Contains(msg, "402") || strings.Contains(msg, "Payment Required") {
		return false
	}
	if strings.Contains(msg, "403") || strings.Contains(msg, "Forbidden") {
		return false
	}
	if strings.Contains(msg, "400") || strings.Contains(msg, "Bad Request") {
		return false
	}
	if strings.Contains(msg, "context canceled") || strings.Contains(msg, "context deadline exceeded") {
		return false
	}
	return true
}
