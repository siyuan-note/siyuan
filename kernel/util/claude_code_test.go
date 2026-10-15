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
	"errors"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/sashabaranov/go-openai"
)

// claudeCodeFixture 是 claude --print --output-format stream-json 的录制事件流，
// 包含两轮助手消息（思考块 + 工具调用、思考块 + 文本块）、进度事件与结果事件。
const claudeCodeFixture = `{"type":"system","subtype":"init","session_id":"s1","tools":["mcp__siyuan__search"]}
not-a-json-progress-line
{"type":"stream_event","event":{"type":"message_start","message":{"id":"m1","type":"message","role":"assistant","model":"claude-test","content":[],"usage":{"input_tokens":100,"output_tokens":0}}},"session_id":"s1"}
{"type":"stream_event","event":{"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":"","signature":""}},"session_id":"s1"}
{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"need to search"}},"session_id":"s1"}
{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"sig"}},"session_id":"s1"}
{"type":"stream_event","event":{"type":"content_block_stop","index":0},"session_id":"s1"}
{"type":"stream_event","event":{"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_1","name":"mcp__siyuan__search"}},"session_id":"s1"}
{"type":"stream_event","event":{"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\"action\":"}},"session_id":"s1"}
{"type":"stream_event","event":{"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"\"fulltext\"}"}},"session_id":"s1"}
{"type":"stream_event","event":{"type":"content_block_stop","index":1},"session_id":"s1"}
{"type":"stream_event","event":{"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":30}},"session_id":"s1"}
{"type":"stream_event","event":{"type":"message_stop"},"session_id":"s1"}
{"type":"assistant","message":{"id":"m1","type":"message","role":"assistant","content":[{"type":"text","text":"need to search"}]},"session_id":"s1"}
{"type":"user","message":{"role":"user","content":[{"type":"tool_result","content":[{"type":"text","text":"3 results"}]}]},"session_id":"s1"}
{"type":"stream_event","event":{"type":"message_start","message":{"id":"m2","type":"message","role":"assistant","model":"claude-test","content":[],"usage":{"input_tokens":200,"output_tokens":0}}},"session_id":"s1"}
{"type":"stream_event","event":{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}},"session_id":"s1"}
{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Found "}},"session_id":"s1"}
{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"three notes."}},"session_id":"s1"}
{"type":"stream_event","event":{"type":"content_block_stop","index":0},"session_id":"s1"}
{"type":"stream_event","event":{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":12}},"session_id":"s1"}
{"type":"stream_event","event":{"type":"message_stop"},"session_id":"s1"}
{"type":"result","subtype":"success","is_error":false,"stop_reason":"end_turn","num_turns":2,"total_cost_usd":0.01,"result":"Found three notes.","usage":{"input_tokens":200,"output_tokens":42,"cache_creation_input_tokens":10,"cache_read_input_tokens":90},"session_id":"s1"}`

// TestClaudeCodeEventsParseStream 覆盖事件流解析：多轮消息累积、工具调用透出、结果事件收尾。
func TestClaudeCodeEventsParseStream(t *testing.T) {
	events := newClaudeCodeEvents(strings.NewReader(claudeCodeFixture))

	var (
		content   strings.Builder
		reasoning strings.Builder
		toolCalls int
		toolArgs  strings.Builder
		usage     *openai.Usage
		finish    openai.FinishReason
		chunks    int
	)
	for {
		chunk, err := events.recv()
		if errors.Is(err, io.EOF) {
			break
		}
		if nil != err {
			t.Fatal(err)
		}
		chunks++
		if nil != chunk.Usage {
			usage = chunk.Usage
		}
		for _, choice := range chunk.Choices {
			content.WriteString(choice.Delta.Content)
			reasoning.WriteString(choice.Delta.ReasoningContent)
			if "" != choice.FinishReason {
				finish = choice.FinishReason
			}
			for _, call := range choice.Delta.ToolCalls {
				if "" != call.Function.Name {
					toolCalls++
				}
				toolArgs.WriteString(call.Function.Arguments)
			}
		}
	}

	if "Found three notes." != content.String() {
		t.Fatalf("unexpected content: %q", content.String())
	}
	if "need to search" != reasoning.String() {
		t.Fatalf("unexpected reasoning: %q", reasoning.String())
	}
	if 1 != toolCalls {
		t.Fatalf("unexpected tool call count: %d", toolCalls)
	}
	if `{"action":"fulltext"}` != toolArgs.String() {
		t.Fatalf("unexpected tool arguments: %q", toolArgs.String())
	}
	if openai.FinishReasonStop != finish {
		t.Fatalf("unexpected finish reason: %q", finish)
	}
	if nil == usage || 300 != usage.PromptTokens || 42 != usage.CompletionTokens || 342 != usage.TotalTokens {
		t.Fatalf("unexpected usage: %#v", usage)
	}
	if 0 == chunks {
		t.Fatal("no chunk was returned")
	}
}

// TestClaudeCodeEventsHeartbeat 长时间无输出时返回空分片，用于重置上层空闲计时器。
func TestClaudeCodeEventsHeartbeat(t *testing.T) {
	heartbeat := claudeCodeHeartbeat
	claudeCodeHeartbeat = 20 * time.Millisecond
	defer func() {
		claudeCodeHeartbeat = heartbeat
	}()

	reader, writer := io.Pipe()
	defer writer.Close()
	events := newClaudeCodeEvents(reader)

	chunk, err := events.recv()
	if nil != err {
		t.Fatalf("idle stream must report a heartbeat instead of an error: %v", err)
	}
	if 0 != len(chunk.Choices) || nil != chunk.Usage {
		t.Fatalf("heartbeat must not carry content: %#v", chunk)
	}

	// 心跳之后仍能继续读取事件
	if _, err = writer.Write([]byte(`{"type":"result","subtype":"success","stop_reason":"end_turn"}` + "\n")); nil != err {
		t.Fatal(err)
	}
	chunk, err = events.recv()
	if nil != err {
		t.Fatal(err)
	}
	if 0 == len(chunk.Choices) || openai.FinishReasonStop != chunk.Choices[0].FinishReason {
		t.Fatalf("unexpected terminal chunk: %#v", chunk)
	}
	if _, err = events.recv(); !errors.Is(err, io.EOF) {
		t.Fatalf("expected end of stream, got %v", err)
	}
}

// TestClaudeCodeEventsDetectMissingResult 命令行未返回结果事件时给出错误而不是空结果。
func TestClaudeCodeEventsDetectMissingResult(t *testing.T) {
	fixture := strings.TrimSuffix(claudeCodeFixture, strings.Split(claudeCodeFixture, "\n")[len(strings.Split(claudeCodeFixture, "\n"))-1])
	events := newClaudeCodeEvents(strings.NewReader(fixture))
	for {
		_, err := events.recv()
		if nil == err {
			continue
		}
		if errors.Is(err, io.EOF) {
			t.Fatal("missing result event was reported as a clean end of stream")
		}
		var resultErr claudeCodeResultError
		if !errors.As(err, &resultErr) {
			t.Fatalf("unexpected error: %v", err)
		}
		return
	}
}

// TestClaudeCodeProgressRewritesToolCalls 工具由命令行自行执行，工具调用只作为进度展示。
func TestClaudeCodeProgressRewritesToolCalls(t *testing.T) {
	name := openai.ToolCall{Function: openai.FunctionCall{Name: "mcp__siyuan__search"}}
	chunk := openai.ChatCompletionStreamResponse{Object: "chat.completion.chunk",
		Choices: []openai.ChatCompletionStreamChoice{{Index: 0, Delta: openai.ChatCompletionStreamChoiceDelta{ToolCalls: []openai.ToolCall{name}}}}}
	progress := claudeCodeProgress(chunk)
	if 0 == len(progress.Choices) || 0 < len(progress.Choices[0].Delta.ToolCalls) {
		t.Fatalf("tool call leaked to the caller: %#v", progress)
	}
	if "→ mcp__siyuan__search\n" != progress.Choices[0].Delta.ReasoningContent {
		t.Fatalf("unexpected progress text: %q", progress.Choices[0].Delta.ReasoningContent)
	}

	// 入参分片不再透出，也不产生进度文本
	partial := openai.ChatCompletionStreamResponse{Object: "chat.completion.chunk",
		Choices: []openai.ChatCompletionStreamChoice{{Index: 0, Delta: openai.ChatCompletionStreamChoiceDelta{
			ToolCalls: []openai.ToolCall{{Function: openai.FunctionCall{Arguments: `{"action":`}}}}}}}
	progress = claudeCodeProgress(partial)
	if 0 != len(progress.Choices) {
		t.Fatalf("tool arguments leaked to the caller: %#v", progress)
	}

	content := openai.ChatCompletionStreamResponse{Object: "chat.completion.chunk",
		Choices: []openai.ChatCompletionStreamChoice{{Index: 0, Delta: openai.ChatCompletionStreamChoiceDelta{Content: "text"}}}}
	if "text" != claudeCodeProgress(content).Choices[0].Delta.Content {
		t.Fatal("content chunk was modified")
	}
}

// TestBuildClaudeCodeInvocation 覆盖三种工具权限模式的命令行参数。
func TestBuildClaudeCodeInvocation(t *testing.T) {
	request := openai.ChatCompletionRequest{Messages: []openai.ChatCompletionMessage{
		{Role: openai.ChatMessageRoleSystem, Content: "You are a SiYuan AI assistant."},
		{Role: openai.ChatMessageRoleUser, Content: "hello"},
	}}

	readonly := buildClaudeCodeInvocation(ClaudeCodeRuntime{Model: "sonnet", PermissionMode: ClaudeCodePermissionReadOnly, MCPServers: "{}"}, request)
	if !containsArgPair(readonly.Args, "--output-format", "stream-json") {
		t.Fatalf("stream-json output is missing: %#v", readonly.Args)
	}
	if !containsArg(readonly.Args, "--include-partial-messages") || !containsArg(readonly.Args, "--verbose") ||
		!containsArg(readonly.Args, "--strict-mcp-config") || !containsArg(readonly.Args, "--no-session-persistence") {
		t.Fatalf("required flags are missing: %#v", readonly.Args)
	}
	if !containsArgPair(readonly.Args, "--tools", claudeCodeSafeBuiltinTools) {
		t.Fatalf("read-only mode must limit built-in tools: %#v", readonly.Args)
	}
	if !containsArgPair(readonly.Args, "--allowedTools", "mcp__siyuan") {
		t.Fatalf("SiYuan MCP tools must be allowed: %#v", readonly.Args)
	}
	if !containsArgPair(readonly.Args, "--permission-mode", claudeCodePermissionModeDeny) {
		t.Fatalf("read-only mode must not prompt for permissions: %#v", readonly.Args)
	}
	if !containsArgPair(readonly.Args, "--model", "sonnet") {
		t.Fatalf("model is missing: %#v", readonly.Args)
	}
	systemPrompt := argValue(readonly.Args, "--append-system-prompt")
	if !strings.HasPrefix(systemPrompt, "You are a SiYuan AI assistant.") || !strings.Contains(systemPrompt, "mcp__siyuan__") {
		t.Fatalf("unexpected system prompt: %q", systemPrompt)
	}
	if "hello" != readonly.Stdin {
		t.Fatalf("unexpected prompt: %q", readonly.Stdin)
	}

	notebook := buildClaudeCodeInvocation(ClaudeCodeRuntime{PermissionMode: ClaudeCodePermissionNotebook}, request)
	if !containsArgPair(notebook.Args, "--permission-mode", claudeCodePermissionModeDeny) || !containsArgPair(notebook.Args, "--allowedTools", "mcp__siyuan") {
		t.Fatalf("unexpected notebook mode arguments: %#v", notebook.Args)
	}
	if containsArg(notebook.Args, "--model") {
		t.Fatalf("empty model must be omitted: %#v", notebook.Args)
	}

	full := buildClaudeCodeInvocation(ClaudeCodeRuntime{PermissionMode: ClaudeCodePermissionFull}, request)
	if !containsArgPair(full.Args, "--permission-mode", claudeCodePermissionModeBypass) {
		t.Fatalf("unexpected full mode arguments: %#v", full.Args)
	}
	if containsArg(full.Args, "--tools") || containsArg(full.Args, "--allowedTools") {
		t.Fatalf("full mode must not restrict tools: %#v", full.Args)
	}

	withoutMCP := buildClaudeCodeInvocation(ClaudeCodeRuntime{}, request)
	if containsArg(withoutMCP.Args, "--mcp-config") {
		t.Fatalf("empty MCP configuration must be omitted: %#v", withoutMCP.Args)
	}
}

// TestClaudeCodePromptFlattensHistory 会话历史拼入提示词，最新用户消息单独成段。
func TestClaudeCodePromptFlattensHistory(t *testing.T) {
	messages := []openai.ChatCompletionMessage{
		{Role: openai.ChatMessageRoleSystem, Content: "system"},
		{Role: openai.ChatMessageRoleUser, Content: "第一问"},
		{Role: openai.ChatMessageRoleAssistant, Content: "第一答"},
		{Role: openai.ChatMessageRoleUser, Content: "第二问"},
	}
	prompt := claudeCodePrompt(messages)
	if strings.Contains(prompt, "system") {
		t.Fatalf("system message must not be repeated in the prompt: %q", prompt)
	}
	if !strings.Contains(prompt, "<conversation_history>\nUser: 第一问\n\nAssistant: 第一答\n</conversation_history>") {
		t.Fatalf("unexpected history section: %q", prompt)
	}
	if !strings.Contains(prompt, "<user_message>\n第二问\n</user_message>") {
		t.Fatalf("unexpected user message section: %q", prompt)
	}

	single := claudeCodePrompt([]openai.ChatCompletionMessage{{Role: openai.ChatMessageRoleUser, Content: "only"}})
	if "only" != single {
		t.Fatalf("single message must be sent as-is: %q", single)
	}

	tool := claudeCodePrompt([]openai.ChatCompletionMessage{
		{Role: openai.ChatMessageRoleUser, Content: "q"},
		{Role: openai.ChatMessageRoleTool, Content: "[tool_output]result[/tool_output]"},
		{Role: openai.ChatMessageRoleUser, Content: "again"},
	})
	if !strings.Contains(tool, "Tool output:\n[tool_output]result[/tool_output]") {
		t.Fatalf("tool output was not preserved: %q", tool)
	}
}

// TestClaudeCodeUsageAndFinishReason 覆盖用量与结束原因映射。
func TestClaudeCodeUsageAndFinishReason(t *testing.T) {
	usage := claudeCodeUsage([]byte(`{"input_tokens":10,"output_tokens":5,"cache_creation_input_tokens":2,"cache_read_input_tokens":3}`))
	if nil == usage || 15 != usage.PromptTokens || 5 != usage.CompletionTokens || 20 != usage.TotalTokens {
		t.Fatalf("unexpected usage: %#v", usage)
	}
	if nil != claudeCodeUsage(nil) || nil != claudeCodeUsage([]byte("bad json")) {
		t.Fatal("invalid usage must be ignored")
	}
	if openai.FinishReasonLength != claudeCodeFinishReason("max_tokens") {
		t.Fatal("max_tokens must map to the length finish reason")
	}
	if openai.FinishReasonStop != claudeCodeFinishReason("end_turn") {
		t.Fatal("end_turn must map to the stop finish reason")
	}
}

// TestIsClaudeCodeProtocol 协议判定忽略大小写与空白。
func TestIsClaudeCodeProtocol(t *testing.T) {
	if !IsClaudeCodeProtocol(" claude-code ") || IsClaudeCodeProtocol("openai") || IsClaudeCodeProtocol("") {
		t.Fatal("unexpected protocol detection")
	}
}

func containsArg(args []string, value string) bool {
	for _, arg := range args {
		if arg == value {
			return true
		}
	}
	return false
}

func containsArgPair(args []string, name, value string) bool {
	for i := 0; i+1 < len(args); i++ {
		if args[i] == name && args[i+1] == value {
			return true
		}
	}
	return false
}

func argValue(args []string, name string) string {
	for i := 0; i+1 < len(args); i++ {
		if args[i] == name {
			return args[i+1]
		}
	}
	return ""
}
