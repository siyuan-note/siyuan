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
	"errors"
	"fmt"
	"io"
	"math/rand/v2"
	"os"

	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/88250/gulu"
	"github.com/siyuan-note/logging"

	"github.com/sashabaranov/go-openai"
	"github.com/siyuan-note/filelock"
	mcpclient "github.com/siyuan-note/siyuan/kernel/mcp/client"
	kernelModel "github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

const systemPrompt = `You are a SiYuan AI assistant. You help users manage their notes, documents, and knowledge base through the tools provided.

## Domain Concepts
- Block: the fundamental unit. Everything in SiYuan is a block with a unique ID, including documents themselves. A document block (type: NodeDocument) is the root block of a document. All content blocks (headings, paragraphs, lists, code, tables, etc.) live as children under a document block, forming a tree. Use block.get to read any block by its ID, block.get_children to browse sub-blocks, block.update to modify, block.append/insert to add content, block.delete to remove.
- Notebook: a top-level container holding documents. Use notebook.list to see all notebooks. Specify notebook ID when creating documents.
- hPath (human-readable path): the title-based path shown in the document tree, e.g. "/Diary/2024/June". The "path" parameter in document tools (document.create, document.move, document.list) refers to hPath, not the internal ID-based filesystem path. When a document is renamed, its hPath changes but its ID stays the same.
- Document vs block move: document.move performs full document relocation — it moves a document (and its children) to a new parent hPath in a notebook. Requires: id, notebook, path. The notebook ID can be found via document.get (field: Box). block.move repositions a single block under a new parent block — use this for moving content blocks, not entire documents.
- Dailynote (daily note/diary/journal): a special document created by the dailynote tool that follows the notebook's daily note save path. When the user asks to write or create a diary, daily note, or journal entry, always use dailynote.create (not document.create). dailynote.create creates or retrieves today's daily note for the given notebook; use dailynote.append/prepend to add content to it.

## Tool Usage Patterns
- Finding information: search.fulltext (keyword) → block.get (by ID) to read full content. For semantic search use search.semantic.
- Exploring structure: document.list (see child documents under an hPath) → document.get (read document metadata and content) → block.get_children (list blocks inside a document) → block.get (read a specific block). Use breadcrumb to trace a block's location path.
- Creating content: document.create specifies the target notebook and hPath to create a document → block.append/prepend/insert to add blocks into the document. Use dataType "markdown" for text content.
- Creating diary/dailynote: dailynote.create with notebook ID to create or open today's daily note → dailynote.append/prepend to add content. Do not use document.create for diary/dailynote requests.
- Modifying content: block.update ONLY replaces a SINGLE existing block's content with new markdown — it does NOT create or append new blocks. If you need to append new content after modifying an existing block, you MUST use TWO separate calls: first block.update to modify the existing block, then block.append/block.prepend (add to parent) or block.insert (add between siblings) to add new blocks. Never pass multiple blocks of content to block.update expecting them to be appended.
- Organizing: document.move (full document relocation to a new hPath, needs notebook ID from document.get). document.rename changes a document's title (hPath follows). block.move repositions a single block under a new parent — for content blocks, not entire documents. document.delete removes a document by ID.
- Attributes/properties: use attr.get/set to read/write custom attributes on any block.
- Database/attribute views: use database.item_add to add rows, database.key_add to add columns, database.render to view tables. To create a database block, use database tools — do NOT use the file tool to construct database JSON files.

## Response Guidelines
- Reply in the language indicated by the user.
- Provide context: when mentioning documents or blocks, include their titles and IDs so the user can reference them.
- Be concise: summarize key findings rather than repeating large amounts of content.
- When you need the user to choose from multiple options (e.g., which notebook, which document, which action), use the question tool to present structured choices. Never reply with a plain text list of options.
- Use markdown formatting for readability: bullet points, headings, code blocks for technical content.
- When writing code blocks, always specify the programming language after the opening fence (e.g. python, javascript, go) to enable syntax highlighting.
- Use $...$ for inline formulas and $$...$$ for block formulas.
- Refer to the product as "SiYuan", never "SiYuan Note".
- Do not fabricate information. If you don't know something or can't find it in the user's notes, say so honestly instead of making up an answer. Search and verify before claiming facts.

## SiYuan User Guide
- SiYuan has a built-in user guide notebook that documents all supported features.
  Notebook IDs by language:
  - 简体中文: "20210808180117-czj9bvb"
  - 繁體中文: "20211226090932-5lcq56f"
  - 日本語: "20240530133126-axarxgx"
  - English and other languages: "20210808180117-6v0mkxr"
- When a user asks whether SiYuan supports a feature or how to use a feature:
  1. Use notebook.list to check if the appropriate user guide notebook is already open (listed). If it is, skip step 2 and go directly to step 3.
  2. If not already open, use notebook.open to open the appropriate user guide notebook for the user's language.
  3. Use search.fulltext to search the user guide for relevant documentation.
  4. If found, cite the content. If not found, honestly tell the user the feature may not be supported.
- Do NOT invent features or UI workflows. The user guide is the authoritative source for SiYuan capabilities.

## Todo Tracking
- For multi-step tasks (3+ distinct steps), use the todo_write tool to create a structured task list before starting work. This helps the user see your progress.
- Each call replaces the entire list. Include all tasks, marking each with the correct status.
- Status values: pending (not started), in_progress (currently working on), completed (done), cancelled (no longer needed).
- Mark a task as in_progress before starting work on it, and completed immediately after finishing.
- Update the todo list whenever status changes — call todo_write with the updated list.
- Skip todo_write for simple single-step requests. Only use it when there is meaningful multi-step work to track.

## Debugging
- When the user reports an error, problem, or unexpected behavior, first use the file tool to read the SiYuan log at "temp/siyuan.log" (relative to the workspace) to find error messages and context.
- Use offset=-200 and limit=200 to read the last 200 lines of the log first. If more context is needed, adjust the offset to read earlier lines.
- The log file may contain stack traces, error codes, and timestamps that help pinpoint the issue.
- After reading the log, summarize the relevant errors before attempting any fixes.

## Tool Output Limits
- All file list/find/grep/read operations default to a limit of 200 entries/lines. Use the limit parameter to increase or decrease this. For file.read, always use offset and limit to read specific portions instead of the entire file.
- When a tool output indicates content was truncated with a file path, use file.read with offset/limit to retrieve more of that specific output file if needed.

## Safety
- WARNING: The file tool is for reading logs and debugging ONLY. NEVER use file.read/write/list/find to bypass the structured tools (block, document, notebook, database, etc.) for creating or modifying workspace data. Always prefer the dedicated domain tools. The file tool may only be used when the user explicitly requests file-level operations or when debugging via the log (see Debugging section).
- For write operations (create, update, move, rename, delete), the system automatically prompts the user for confirmation through the UI — you do NOT need to ask the user verbally. Simply state what you are about to do, then call the tool.
- Read operations (get, list, search, query) are always safe and do not need confirmation.
- Do not expose or log API keys, passwords, or sensitive configuration.`

const maxToolCallRounds = 64

type confirmResult struct {
	approved bool
	always   bool
}

type doomLoopTracker struct {
	prevSig  string
	prevName string
	count    int
}

var confirmChannelsMu sync.Mutex
var confirmChannels = make(map[string]chan confirmResult)

func ConfirmSession(id string, approved bool, always bool) {
	confirmChannelsMu.Lock()
	ch, ok := confirmChannels[id]
	confirmChannelsMu.Unlock()
	if ok {
		ch <- confirmResult{approved: approved, always: always}
	}
}

type QuestionAnswer struct {
	Answers []string
}

var questionChannelsMu sync.Mutex
var questionChannels = make(map[string]chan QuestionAnswer)

func AnswerQuestion(id string, answers []string) {
	questionChannelsMu.Lock()
	ch, ok := questionChannels[id]
	questionChannelsMu.Unlock()
	if ok {
		ch <- QuestionAnswer{Answers: answers}
	}
}

func sendEvent(ch chan<- AgentEvent, ev AgentEvent) {
	select {
	case ch <- ev:
	default:
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
	QuestionID       string
	Error            string
	PromptTokens     int
	CompletionTokens int
	RetryAttempt     int
	RetryMax         int
	SnapshotID       string
}

type AgentMessage struct {
	Role      string          `json:"role"`
	Content   string          `json:"content"`
	ToolCalls []AgentToolCall `json:"toolCalls,omitempty"`
}

type AgentToolCall struct {
	ID        string                 `json:"id,omitempty"`
	Name      string                 `json:"name"`
	Arguments map[string]interface{} `json:"arguments"`
	Result    string                 `json:"result,omitempty"`
}

type Reference struct {
	ID    string `json:"id"`
	Title string `json:"title"`
}

type checkpointThinkingStep struct {
	Reasoning        string              `json:"reasoning"`
	Text             string              `json:"text"`
	ToolCalls        []checkpointBriefTC `json:"toolCalls"`
	ReasoningContent string              `json:"reasoningContent"`
}

type checkpointBriefTC struct {
	Name   string `json:"name"`
	Result string `json:"result,omitempty"`
}

type agentCheckpoint struct {
	ID               string                   `json:"id"`
	Title            string                   `json:"title"`
	Titled           bool                     `json:"titled"`
	Messages         []AgentMessage           `json:"messages"`
	Entries          []json.RawMessage        `json:"entries,omitempty"`
	PromptTokens     int                      `json:"promptTokens"`
	CompletionTokens int                      `json:"completionTokens"`
	TotalDuration    int64                    `json:"totalDuration"`
	CreatedAt        int64                    `json:"createdAt"`
	UpdatedAt        int64                    `json:"updatedAt"`
	MessageHistory   []string                 `json:"messageHistory,omitempty"`
	ThinkingSteps    []checkpointThinkingStep `json:"thinkingSteps,omitempty"`
	Snapshots        []string                 `json:"snapshots,omitempty"`
	AlwaysAllow      bool                     `json:"alwaysAllow,omitempty"`
}

func AgentChat(ctx context.Context, client *openai.Client, model string, sessionID string, userMessage string, language string, references []Reference, regenerate bool, confirmTimeout time.Duration, maxRetries int) <-chan AgentEvent {
	ch := make(chan AgentEvent, 100)

	go func() {
		defer close(ch)
		defer func() {
			if r := recover(); r != nil {
				logging.LogErrorf("agent chat panic: %v\n%s", r, logging.ShortStack())
				sendEvent(ch, AgentEvent{Type: "error", Error: kernelModel.Conf.Language(28)})
			}
		}()

		if kernelModel.Conf.AI.MCP != nil {
			mcpclient.EnsureMCPConnected(kernelModel.Conf.AI.MCP.Servers)
		}

		tools := convertMCPToolsToOpenAI()
		var messages []openai.ChatCompletionMessage
		var checkpointMsgs []AgentMessage
		var totalPrompt, totalCompletion int
		startTime := time.Now().UnixMilli()
		alwaysAllow := map[string]bool{}
		var doomLoop doomLoopTracker
		var compactCount int
		var snapshotIDs []string

		if sessionID != "" {
			if cp := loadCheckpoint(sessionID); cp != nil {
				if cp.AlwaysAllow {
					alwaysAllow["*"] = true
				}
				if len(cp.Messages) > 0 {
				truncated := cp.Messages
				if regenerate {
					lastUserIdx := -1
					for i := len(truncated) - 1; i >= 0; i-- {
						if truncated[i].Role == "user" {
							lastUserIdx = i
							break
						}
					}
					if lastUserIdx >= 0 && truncated[lastUserIdx].Content == userMessage {
						truncated = truncated[:lastUserIdx]
					}
				}
				checkpointMsgs = truncated
				checkpointMsgs = append(checkpointMsgs, AgentMessage{Role: "user", Content: userMessage})
				messages = checkpointMessagesToOpenAI(checkpointMsgs, language, references)
				}
			}
		}

		if messages == nil {
			checkpointMsgs = []AgentMessage{{Role: "user", Content: userMessage}}
			messages = buildInitialMessages(userMessage, language, references)
		}

		for round := 0; round < maxToolCallRounds; round++ {
			select {
			case <-ctx.Done():
				return
			default:
			}

			if round == 0 {
				sendEvent(ch, AgentEvent{Type: "thinking", Reasoning: "analyzing"})
			} else {
				sendEvent(ch, AgentEvent{Type: "thinking", Reasoning: "processing"})
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
				if compactCount < 3 && isContextOverflow(streamErr) {
					keepTurns := 3 - compactCount
					if keepTurns < 1 {
						keepTurns = 1
					}
					messages = compactMessages(messages, keepTurns)
					compactCount++
					sendEvent(ch, AgentEvent{Type: "thinking", Reasoning: fmt.Sprintf("context limit reached, compacting to last %d turns...", keepTurns)})
					continue
				}
		logging.LogErrorf("agent API request failed: %s", streamErr.Error())
		sendEvent(ch, AgentEvent{Type: "error", Error: getAgentErrorMessage(streamErr)})
		saveCheckpoint(sessionID, checkpointMsgs, totalPrompt, totalCompletion, startTime, snapshotIDs, alwaysAllow)
			return
			}

		var contentBuilder strings.Builder
		var reasoningBuilder strings.Builder
		var aggregatedToolCalls []openai.ToolCall

			for {
				resp, recvErr := stream.Recv()
				if recvErr != nil {
					if recvErr == io.EOF {
						break
					}
			logging.LogErrorf("agent stream error: %s", recvErr.Error())
			sendEvent(ch, AgentEvent{Type: "error", Error: getAgentErrorMessage(recvErr)})
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
						sendEvent(ch, AgentEvent{Type: "content", Token: choice.Delta.Content})
					}

					if choice.Delta.ReasoningContent != "" {
						reasoningBuilder.WriteString(choice.Delta.ReasoningContent)
						sendEvent(ch, AgentEvent{Type: "reasoning", Token: choice.Delta.ReasoningContent})
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
					Role:             openai.ChatMessageRoleAssistant,
					Content:          contentBuilder.String(),
					ReasoningContent: reasoningBuilder.String(),
					ToolCalls:        aggregatedToolCalls,
				})

				checkpointMsg := AgentMessage{
					Role:    "assistant",
					Content: contentBuilder.String(),
				}
				for _, tc := range aggregatedToolCalls {
					checkpointMsg.ToolCalls = append(checkpointMsg.ToolCalls, AgentToolCall{
						ID:        tc.ID,
						Name:      tc.Function.Name,
						Arguments: parseToolArgs(tc.Function.Arguments),
					})
				}
				checkpointMsgs = append(checkpointMsgs, checkpointMsg)
				assistantIdx := len(checkpointMsgs) - 1

				snapshotCreated := false
				for i, tc := range aggregatedToolCalls {
					args := parseToolArgs(tc.Function.Arguments)
					action := ""
					if a, ok := args["action"]; ok {
						action, _ = a.(string)
					}

					sendEvent(ch, AgentEvent{
						Type:      "tool_call",
						Name:      tc.Function.Name,
						Arguments: args,
					})

					if needsConfirm(tc.Function.Name, action, alwaysAllow) {
						confirmID := tc.ID
						sendEvent(ch, AgentEvent{Type: "confirm", Name: tc.Function.Name, Arguments: args, ConfirmID: confirmID})
						ch2 := make(chan confirmResult, 1)
						confirmChannelsMu.Lock()
						confirmChannels[confirmID] = ch2
						confirmChannelsMu.Unlock()
						var rejectionMsg string
						var result confirmResult
						timedOut := false

						select {
						case result = <-ch2:
							confirmChannelsMu.Lock()
							delete(confirmChannels, confirmID)
							confirmChannelsMu.Unlock()
						case <-ctx.Done():
							confirmChannelsMu.Lock()
							delete(confirmChannels, confirmID)
							confirmChannelsMu.Unlock()
							return
						case <-time.After(confirmTimeout):
							confirmChannelsMu.Lock()
							delete(confirmChannels, confirmID)
							confirmChannelsMu.Unlock()
							timedOut = true
							rejectionMsg = "Confirmation timed out, operation skipped automatically"
							sendEvent(ch, AgentEvent{Type: "tool_result", Name: tc.Function.Name, Result: rejectionMsg})
						}

						if timedOut || !result.approved {
							if rejectionMsg == "" {
								rejectionMsg = "User rejected this operation"
								sendEvent(ch, AgentEvent{Type: "tool_result", Name: tc.Function.Name, Result: rejectionMsg})
							}
							messages = append(messages, openai.ChatCompletionMessage{
								Role:       openai.ChatMessageRoleTool,
								Content:    rejectionMsg,
								ToolCallID: tc.ID,
							})
							checkpointMsgs[assistantIdx].ToolCalls[i].Result = rejectionMsg
							saveCheckpoint(sessionID, checkpointMsgs, totalPrompt, totalCompletion, startTime, snapshotIDs, alwaysAllow)
							continue
						}

						if result.always {
							alwaysAllow["*"] = true
							saveCheckpoint(sessionID, checkpointMsgs, totalPrompt, totalCompletion, startTime, snapshotIDs, alwaysAllow)
						}
					}

				if !snapshotCreated && action != "" && !safeActions[action] && !(tc.Function.Name == "repo" && action == "create") {
					id, err := kernelModel.IndexRepo("AI agent auto snapshot")
					if err != nil {
						logging.LogErrorf("agent auto snapshot failed: %s", err)
						sendEvent(ch, AgentEvent{
							Type:  "error",
							Error: "auto snapshot failed, operation aborted: " + err.Error(),
						})
						saveCheckpoint(sessionID, checkpointMsgs, totalPrompt, totalCompletion, startTime, snapshotIDs, alwaysAllow)
						return
					}
					snapshotIDs = append(snapshotIDs, id)
					snapshotCreated = true
					sendEvent(ch, AgentEvent{Type: "snapshot", SnapshotID: id})
				}

					var resultStr string
					if tc.Function.Name == "question" {
						resultStr = handleQuestion(tc.Function.Arguments, ch, 5*time.Minute)
						doomLoop = doomLoopTracker{}
					} else {
						resultStr = executeTool(tc, sessionID)
					}

					resultStr = util.TruncateToolOutput(resultStr, sessionID)

					sendEvent(ch, AgentEvent{
						Type:   "tool_result",
						Name:   tc.Function.Name,
						Result: resultStr,
					})

					messages = append(messages, openai.ChatCompletionMessage{
						Role:       openai.ChatMessageRoleTool,
						Content:    resultStr,
						ToolCallID: tc.ID,
					})
					checkpointMsgs[assistantIdx].ToolCalls[i].Result = resultStr

					if tc.Function.Name != "question" {
						sig := tc.Function.Name + "::" + tc.Function.Arguments
						if sig == doomLoop.prevSig && doomLoop.prevSig != "" {
							doomLoop.count++
						} else {
							doomLoop.prevSig = sig
							doomLoop.prevName = tc.Function.Name
							doomLoop.count = 1
						}
					}
				}

				if doomLoop.count >= 3 {
					messages = append(messages, openai.ChatCompletionMessage{
						Role:    openai.ChatMessageRoleSystem,
						Content: "You have called '" + doomLoop.prevName + "' " + fmt.Sprintf("%d", doomLoop.count) + " times with the same arguments. Please try a different approach.",
					})
					doomLoop = doomLoopTracker{}
				}

				saveCheckpoint(sessionID, checkpointMsgs, totalPrompt, totalCompletion, startTime, snapshotIDs, alwaysAllow)
				continue
			}

			content := contentBuilder.String()
			if content != "" {
				checkpointMsgs = append(checkpointMsgs, AgentMessage{Role: "assistant", Content: content})
			}
			saveCheckpoint(sessionID, checkpointMsgs, totalPrompt, totalCompletion, startTime, snapshotIDs, alwaysAllow)
			if content == "" {
				content = " "
			}
			messages = append(messages, openai.ChatCompletionMessage{
				Role:             openai.ChatMessageRoleAssistant,
				Content:          content,
				ReasoningContent: reasoningBuilder.String(),
			})

			sendEvent(ch, AgentEvent{Type: "usage", PromptTokens: totalPrompt, CompletionTokens: totalCompletion})
			sendEvent(ch, AgentEvent{Type: "done"})
			return
		}

		sendEvent(ch, AgentEvent{Type: "usage", PromptTokens: totalPrompt, CompletionTokens: totalCompletion})
		saveCheckpoint(sessionID, checkpointMsgs, totalPrompt, totalCompletion, startTime, snapshotIDs, alwaysAllow)
		sendEvent(ch, AgentEvent{Type: "done"})
	}()

	return ch
}

func GenerateTitle(client *openai.Client, model string, userMsg string, language string) string {
	resp, err := client.CreateChatCompletion(context.Background(), openai.ChatCompletionRequest{
		Model: model,
		Messages: []openai.ChatCompletionMessage{
			{Role: openai.ChatMessageRoleSystem, Content: "You are a title generator. Below is the first message of a conversation. Write a concise title (under 12 words) that summarizes the topic. Output ONLY the title, no other text. Reply in the same language as the user's message. If you cannot determine the language, reply in " + util.I18nTerm(language, "_label") + "."},
			{Role: openai.ChatMessageRoleUser, Content: "Conversation starts with: " + userMsg},
		},
		MaxCompletionTokens: 50,
	})
	if err != nil || len(resp.Choices) == 0 {
		runes := []rune(userMsg)
		if len(runes) > 30 {
			return string(runes[:30]) + "..."
		}
		return userMsg
	}
	title := strings.TrimSpace(resp.Choices[0].Message.Content)
	if title == "" {
		runes := []rune(userMsg)
		if len(runes) > 30 {
			return string(runes[:30]) + "..."
		}
		return userMsg
	}
	return title
}

var safeActions = map[string]bool{
	"get": true, "get_kramdown": true, "get_children": true, "breadcrumb": true,
	"tree_stat": true, "dom": true, "batch_get": true, "batch_kramdown": true,
	"list": true, "read": true, "search_docs": true, "fulltext": true, "semantic": true, "search": true,
	"backlinks": true, "mentions": true, "refresh": true,
	"labels": true, "status": true, "version": true,
	"current_time": true, "workspace": true, "info": true,
	"grep": true, "find": true, "stat": true, "unused": true,
	"keys": true, "render": true, "diff": true,
	"file_get": true, "file_open": true, "file_export": true,
	"open": true, "close": true, "batch-get": true, "question": true, "todo_write": true,
	"md": true, "query": true,
}

func needsConfirm(toolName string, action string, alwaysAllow map[string]bool) bool {
	if alwaysAllow["*"] {
		return false
	}
	if action == "" {
		return false
	}
	if alwaysAllow[toolName+"::"+action] {
		return false
	}
	if safeActions[action] {
		return false
	}
	if toolName == "sync" && action == "status" {
		return false
	}
	if toolName == "import" && action == "md" {
		return true
	}
	return true
}

func handleQuestion(argsJSON string, ch chan<- AgentEvent, timeout time.Duration) string {
	args := parseToolArgs(argsJSON)
	questionID := fmt.Sprintf("%d", time.Now().UnixNano())
	if len(questionID) > 10 {
		questionID = questionID[:10]
	}

	sendEvent(ch, AgentEvent{
		Type:       "question",
		QuestionID: questionID,
		Arguments:  args,
	})

	ch2 := make(chan QuestionAnswer, 1)
	questionChannelsMu.Lock()
	questionChannels[questionID] = ch2
	questionChannelsMu.Unlock()

	var answer QuestionAnswer
	select {
	case answer = <-ch2:
	case <-time.After(timeout):
		questionChannelsMu.Lock()
		delete(questionChannels, questionID)
		questionChannelsMu.Unlock()
		return "No answer received (timed out)."
	}

	questionChannelsMu.Lock()
	delete(questionChannels, questionID)
	questionChannelsMu.Unlock()

	if len(answer.Answers) == 0 {
		return "User provided no answer."
	}

	return strings.Join(answer.Answers, ", ")
}

func buildSystemPrompt(language string, references []Reference) string {
	var prompt = systemPrompt + "\n\n<env>\nWorkspace: " + util.WorkspaceDir + "\nVersion: " + util.Ver + "\nToday's date: " + time.Now().Format("2006-01-02 Mon") + "\nContainer: " + util.Container + "\n</env>"

	skills := util.DiscoverSkills()
	if len(skills) > 0 {
		prompt += "\n\n<available_skills>\n"
		for _, s := range skills {
			prompt += "  <skill>\n"
			prompt += "    <name>" + s.Name + "</name>\n"
			prompt += "    <description>" + s.Description + "</description>\n"
			prompt += "  </skill>\n"
		}
		prompt += "</available_skills>\n\n"
		prompt += "Use the skill tool to load a skill when a task matches its description."
	}

	prompt += "\n\nReply in " + util.I18nTerm(language, "_label") + "."
	prompt += "\n\nIn the user's language, a daily note is called: " + util.I18nTerm(language, "dailyNote") + ". When the user asks to write or create this, use dailynote.create, not document.create."
	if len(references) > 0 {
		prompt += "\n\nThe user has referenced the following content blocks:\n"
		for _, ref := range references {
			prompt += "- " + ref.Title + " (id: " + ref.ID + ")\n"
		}
		prompt += "Use the block tools to fetch their actual content before responding."
	}
	return prompt
}

func buildInitialMessages(userMessage string, language string, references []Reference) []openai.ChatCompletionMessage {
	return []openai.ChatCompletionMessage{
		{Role: openai.ChatMessageRoleSystem, Content: buildSystemPrompt(language, references)},
		{Role: openai.ChatMessageRoleUser, Content: userMessage},
	}
}

func loadCheckpoint(sessionID string) *agentCheckpoint {
	if sessionID == "" {
		return nil
	}
	dir := filepath.Join(util.DataDir, "storage", "ai", "agent", "sessions", sessionID)
	path := filepath.Join(dir, "session.json")
	data, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	var cp agentCheckpoint
	if gulu.JSON.UnmarshalJSON(data, &cp) != nil {
		return nil
	}
	return &cp
}

func checkpointMessagesToOpenAI(checkpointMsgs []AgentMessage, language string, references []Reference) []openai.ChatCompletionMessage {
	msgs := []openai.ChatCompletionMessage{
		{Role: openai.ChatMessageRoleSystem, Content: buildSystemPrompt(language, references)},
	}

	for cmi := range checkpointMsgs {
		cm := &checkpointMsgs[cmi]
		switch cm.Role {
		case "user":
			content := cm.Content
			if content == "" {
				content = " "
			}
			msgs = append(msgs, openai.ChatCompletionMessage{
				Role:    openai.ChatMessageRoleUser,
				Content: content,
			})
		case "assistant":
			if len(cm.ToolCalls) == 0 {
				content := cm.Content
				if content == "" {
					content = " "
				}
				msgs = append(msgs, openai.ChatCompletionMessage{
					Role:    openai.ChatMessageRoleAssistant,
					Content: content,
				})
			} else {
				for j := range cm.ToolCalls {
					if cm.ToolCalls[j].ID == "" {
						cm.ToolCalls[j].ID = fmt.Sprintf("call_cp_%d_%d", cmi, j)
					}
				}

				toolCalls := make([]openai.ToolCall, 0, len(cm.ToolCalls))
				for _, tc := range cm.ToolCalls {
					argsJSON, _ := gulu.JSON.MarshalJSON(tc.Arguments)
					toolCalls = append(toolCalls, openai.ToolCall{
						ID:   tc.ID,
						Type: openai.ToolTypeFunction,
						Function: openai.FunctionCall{
							Name:      tc.Name,
							Arguments: string(argsJSON),
						},
					})
				}
				msgs = append(msgs, openai.ChatCompletionMessage{
					Role:      openai.ChatMessageRoleAssistant,
					Content:   cm.Content,
					ToolCalls: toolCalls,
				})
				for _, tc := range cm.ToolCalls {
					if tc.Result != "" {
						msgs = append(msgs, openai.ChatCompletionMessage{
							Role:       openai.ChatMessageRoleTool,
							Content:    tc.Result,
							ToolCallID: tc.ID,
						})
					}
				}
			}
		}
	}
	return msgs
}

func saveCheckpoint(sessionID string, messages []AgentMessage, promptTokens int, completionTokens int, startTime int64, snapshotIDs []string, alwaysAllow map[string]bool) {
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
		Snapshots:         snapshotIDs,
		AlwaysAllow:       alwaysAllow["*"],
	}

	dir := filepath.Join(util.DataDir, "storage", "ai", "agent", "sessions", sessionID)
	_ = os.MkdirAll(dir, 0755)

	path := filepath.Join(dir, "session.json")
	existing, err := os.ReadFile(path)
	if err == nil {
		var old agentCheckpoint
		if gulu.JSON.UnmarshalJSON(existing, &old) == nil {
			if old.Titled {
				cp.Title = old.Title
				cp.Titled = true
			}
		}
		if old.CreatedAt > 0 {
			cp.CreatedAt = old.CreatedAt
		}
		if len(old.MessageHistory) > 0 {
			cp.MessageHistory = old.MessageHistory
		}
		if len(old.ThinkingSteps) > 0 {
			cp.ThinkingSteps = old.ThinkingSteps
		}
		if len(old.Entries) > 0 {
			cp.Entries = old.Entries
		}
		if len(old.Snapshots) > 0 {
			cp.Snapshots = old.Snapshots
		}
	}

	data, err := gulu.JSON.MarshalIndentJSON(cp, "", "\t")
	if err != nil {
		return
	}
	_ = filelock.WriteFile(path, data)
	UpdateSessionIndex(sessionID, cp.Title, cp.CreatedAt, cp.UpdatedAt)
}

func createStreamWithRetry(ctx context.Context, client *openai.Client, req openai.ChatCompletionRequest, maxRetries int, ch chan<- AgentEvent) (*openai.ChatCompletionStream, error) {
	if maxRetries <= 0 {
		maxRetries = 1
	}

	var lastErr error
	for attempt := 0; attempt < maxRetries; attempt++ {
		if attempt > 0 {
			category := classifyRetry(lastErr)
			delay := delayForCategory(category, attempt)
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-time.After(delay):
			}
			sendEvent(ch, AgentEvent{Type: "retry", RetryAttempt: attempt + 1, RetryMax: maxRetries})
		}

		stream, err := client.CreateChatCompletionStream(ctx, req)
		if err == nil {
			return stream, nil
		}

		lastErr = err
		category := classifyRetry(err)
		if category == "fatal" {
			return nil, err
		}
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
	}
	return nil, lastErr
}

func classifyRetry(err error) string {
	var apiErr *openai.APIError
	if errors.As(err, &apiErr) {
		switch apiErr.HTTPStatusCode {
		case 429:
			return "rate_limit"
		case 408:
			return "timeout"
		case 500, 502, 503, 504:
			return "server_error"
		default:
			if apiErr.HTTPStatusCode >= 400 {
				return "fatal" // 400, 401, 403, etc.
			}
		}
	}

	msg := err.Error()
	if strings.Contains(msg, "Unauthorized") {
		return "fatal"
	}
	if strings.Contains(msg, "Payment Required") {
		return "fatal"
	}
	if strings.Contains(msg, "Forbidden") {
		return "fatal"
	}
	if strings.Contains(msg, "Bad Request") {
		return "fatal"
	}
	if strings.Contains(msg, "context canceled") || strings.Contains(msg, "context deadline exceeded") {
		return "fatal"
	}
	return "network"
}

func getAgentErrorMessage(err error) string {
	msg := strings.ToLower(err.Error())
	if strings.Contains(msg, "context deadline exceeded") || strings.Contains(msg, "context canceled") || strings.Contains(msg, "timeout") || strings.Contains(msg, "exceeded while awaiting") {
		return kernelModel.Conf.Language(24)
	}
	return kernelModel.Conf.Language(28)
}

func delayForCategory(category string, attempt int) time.Duration {
	switch category {
	case "rate_limit", "server_error", "timeout":
		return backoffDuration(attempt)
	default:
		return 3 * time.Second
	}
}

func backoffDuration(attempt int) time.Duration {
	base := time.Duration(1<<uint(attempt)) * time.Second
	if base > 64*time.Second {
		base = 64 * time.Second
	}
	if base <= 1*time.Second {
		return base
	}
	jitter := time.Duration(rand.Int64N(int64(base)*40/100)) - time.Duration(base*20/100)
	return base + jitter
}
