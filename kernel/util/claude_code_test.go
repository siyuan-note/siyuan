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
	"os"
	"path/filepath"
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
		var runErr claudeCodeRunError
		if !errors.As(err, &runErr) {
			t.Fatalf("unexpected error: %v", err)
		}
		return
	}
}

// TestClaudeCodeEventsSilentLimit 命令行长时间无任何事件输出时终止生成，避免一直停留在思考中。
func TestClaudeCodeEventsSilentLimit(t *testing.T) {
	heartbeat, silentLimit := claudeCodeHeartbeat, claudeCodeSilentLimit
	claudeCodeHeartbeat, claudeCodeSilentLimit = 10*time.Millisecond, 30*time.Millisecond
	defer func() {
		claudeCodeHeartbeat, claudeCodeSilentLimit = heartbeat, silentLimit
	}()

	reader, writer := io.Pipe()
	defer writer.Close()
	events := newClaudeCodeEvents(reader)

	for i := 0; i < 10; i++ {
		_, err := events.recv()
		if nil == err {
			continue
		}
		var runErr claudeCodeRunError
		if !errors.As(err, &runErr) {
			t.Fatalf("unexpected error: %v", err)
		}
		if !strings.Contains(runErr.Error(), "no output") {
			t.Fatalf("unexpected silent error: %q", runErr.Error())
		}
		return
	}
	t.Fatal("silent command line was not terminated")
}

// TestClaudeCodeEventsSessionAndFailure 覆盖 init 事件上报与 result 事件错误文本。
func TestClaudeCodeEventsSessionAndFailure(t *testing.T) {
	fixture := `{"type":"system","subtype":"init","model":"claude-sonnet-4-5","claude_code_version":"2.1.300","session_id":"s1"}
{"type":"result","subtype":"success","is_error":true,"result":"API Error: 400 The supported API model names are a, b, but you passed bogus.","session_id":"s1"}`
	events := newClaudeCodeEvents(strings.NewReader(fixture))

	_, err := events.recv()
	if nil != err {
		t.Fatalf("init event must not fail the stream: %v", err)
	}
	version, sessionModel := events.session()
	if "2.1.300" != version || "claude-sonnet-4-5" != sessionModel {
		t.Fatalf("unexpected session info: %q %q", version, sessionModel)
	}

	_, err = events.recv()
	var runErr claudeCodeRunError
	if !errors.As(err, &runErr) {
		t.Fatalf("expected a run error, got %v", err)
	}
	if !strings.Contains(runErr.Error(), "API Error: 400 The supported API model names") {
		t.Fatalf("unexpected error message: %q", runErr.Error())
	}
	if "Claude Code failed: success" != claudeCodeResultMessage("", "success") {
		t.Fatal("result message must fall back to the subtype")
	}
}

// TestResolveClaudeCodeEnv 环境变量注入：引用当前进程环境变量，引用不到时直接报错。
func TestResolveClaudeCodeEnv(t *testing.T) {
	t.Setenv("SIYUAN_TEST_CLAUDE_TOKEN", "token-value")

	env, err := resolveClaudeCodeEnv(map[string]string{
		"ANTHROPIC_BASE_URL":   "https://example.com/anthropic",
		"ANTHROPIC_AUTH_TOKEN": "${SIYUAN_TEST_CLAUDE_TOKEN}",
		"ANTHROPIC_MODEL":      "prefix-${SIYUAN_TEST_CLAUDE_TOKEN}",
	})
	if nil != err {
		t.Fatal(err)
	}
	expected := []string{
		"ANTHROPIC_AUTH_TOKEN=token-value",
		"ANTHROPIC_BASE_URL=https://example.com/anthropic",
		"ANTHROPIC_MODEL=prefix-token-value",
	}
	if 3 != len(env) {
		t.Fatalf("unexpected environment: %#v", env)
	}
	for i, item := range expected {
		if item != env[i] {
			t.Fatalf("unexpected environment item %d: %q", i, env[i])
		}
	}

	if empty, emptyErr := resolveClaudeCodeEnv(nil); nil != emptyErr || 0 != len(empty) {
		t.Fatalf("empty environment must not inject anything: %#v %v", empty, emptyErr)
	}
	_, err = resolveClaudeCodeEnv(map[string]string{"ANTHROPIC_AUTH_TOKEN": "${SIYUAN_TEST_CLAUDE_MISSING}"})
	if nil == err || !strings.Contains(err.Error(), "SIYUAN_TEST_CLAUDE_MISSING") {
		t.Fatalf("missing environment variable must fail: %v", err)
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

	// 放行技能本地命令：非法命令名被过滤，只保留合法命令的放行规则
	readonlyBins := buildClaudeCodeInvocation(ClaudeCodeRuntime{PermissionMode: ClaudeCodePermissionReadOnly,
		SkillBins: []string{"lark-cli", "../evil"}}, request)
	if !containsArgPair(readonlyBins.Args, "--tools", claudeCodeSafeBuiltinTools+",Bash") {
		t.Fatalf("skill bins must enable the Bash tool: %#v", readonlyBins.Args)
	}
	if !containsArgPair(readonlyBins.Args, "--allowedTools", "mcp__siyuan,Bash(lark-cli:*)") {
		t.Fatalf("skill bins must allow their own commands only: %#v", readonlyBins.Args)
	}
	systemPrompt = argValue(readonlyBins.Args, "--append-system-prompt")
	if !strings.Contains(systemPrompt, "lark-cli") || !strings.Contains(systemPrompt, "Only these executables are permitted") {
		t.Fatalf("system prompt must name the allowed executables: %q", systemPrompt)
	}

	notebookBins := buildClaudeCodeInvocation(ClaudeCodeRuntime{PermissionMode: ClaudeCodePermissionNotebook,
		SkillBins: []string{"lark-cli"}}, request)
	if !containsArgPair(notebookBins.Args, "--tools", claudeCodeSafeBuiltinTools+",Bash") ||
		!containsArgPair(notebookBins.Args, "--allowedTools", "mcp__siyuan,Bash(lark-cli:*)") {
		t.Fatalf("notebook mode must allow skill bins too: %#v", notebookBins.Args)
	}

	fullBins := buildClaudeCodeInvocation(ClaudeCodeRuntime{PermissionMode: ClaudeCodePermissionFull,
		SkillBins: []string{"lark-cli"}}, request)
	if containsArg(fullBins.Args, "--tools") || containsArg(fullBins.Args, "--allowedTools") {
		t.Fatalf("full mode must not restrict tools: %#v", fullBins.Args)
	}
	if !strings.Contains(argValue(fullBins.Args, "--append-system-prompt"), "lark-cli") {
		t.Fatalf("full mode system prompt must name the allowed executables: %#v", fullBins.Args)
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

// TestClaudeCodeEnvironmentSkillBinsPath 放行技能本地命令时补全 PATH：唯一 PATH 条目、发现目录在前、注入与继承 PATH 居后。
func TestClaudeCodeEnvironmentSkillBinsPath(t *testing.T) {
	root := t.TempDir()
	originalHome := HomeDir
	HomeDir = filepath.Join(root, "home")
	defer func() { HomeDir = originalHome }()

	binDir := filepath.Join(HomeDir, ".nvm", "versions", "node", "v24.21.0", "bin")
	if err := os.MkdirAll(binDir, 0755); nil != err {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(binDir, "lark-cli"), []byte("#!/bin/sh\n"), 0644); nil != err {
		t.Fatal(err)
	}
	cliPath := filepath.Join(root, "cli", "claude")

	t.Setenv("PATH", "/usr/bin")
	env, err := claudeCodeEnvironment(&ClaudeCodeRuntime{SkillBins: []string{"lark-cli"}}, cliPath)
	if nil != err {
		t.Fatal(err)
	}
	pathCount, pathValue := 0, ""
	for _, entry := range env {
		if key, value, ok := strings.Cut(entry, "="); ok && "PATH" == key {
			pathCount++
			pathValue = value
		}
	}
	if 1 != pathCount {
		t.Fatalf("expected a single PATH entry, got %d: %#v", pathCount, env)
	}
	dirs := filepath.SplitList(pathValue)
	if 2 != len(dirs) || binDir != dirs[0] || "/usr/bin" != dirs[1] {
		t.Fatalf("unexpected merged PATH: %q", pathValue)
	}

	// 用户注入的 PATH 位于发现目录与继承 PATH 之间，其余注入变量保留
	t.Setenv("PATH", "/usr/bin")
	env, err = claudeCodeEnvironment(&ClaudeCodeRuntime{
		SkillBins: []string{"lark-cli"},
		Env:       map[string]string{"PATH": "/opt/custom", "OTHER": "v"},
	}, cliPath)
	if nil != err {
		t.Fatal(err)
	}
	pathCount, pathValue = 0, ""
	hasOther := false
	for _, entry := range env {
		key, value, ok := strings.Cut(entry, "=")
		if !ok {
			continue
		}
		if "PATH" == key {
			pathCount++
			pathValue = value
		}
		if "OTHER" == key && "v" == value {
			hasOther = true
		}
	}
	if 1 != pathCount || !hasOther {
		t.Fatalf("unexpected environment: %#v", env)
	}
	if want := binDir + string(os.PathListSeparator) + "/opt/custom" + string(os.PathListSeparator) + "/usr/bin"; want != pathValue {
		t.Fatalf("unexpected merged PATH: %q, want %q", pathValue, want)
	}

	// 未放行技能本地命令时不改写 PATH，保持原有继承行为
	t.Setenv("PATH", "/usr/bin")
	plain, err := claudeCodeEnvironment(&ClaudeCodeRuntime{}, cliPath)
	if nil != err {
		t.Fatal(err)
	}
	if pathValue = claudeCodePickEnvValue(plain, "PATH"); "/usr/bin" != pathValue {
		t.Fatalf("plain PATH must stay inherited: %q", pathValue)
	}
}

// TestClaudeCodeEventsBashProgress Bash 工具调用结束时把实际命令展示为进度行，工具调用本身仍透出。
func TestClaudeCodeEventsBashProgress(t *testing.T) {
	fixture := `{"type":"stream_event","event":{"type":"message_start","message":{"id":"m1","type":"message","role":"assistant","model":"claude-test","content":[],"usage":{"input_tokens":10,"output_tokens":0}}}}
{"type":"stream_event","event":{"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"Bash"}}}
{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\"command\":\"lark-cli docs"}}}
{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":" list\",\"description\":\"x\"}"}}}
{"type":"stream_event","event":{"type":"content_block_stop","index":0}}
{"type":"stream_event","event":{"type":"message_delta","delta":{"stop_reason":"tool_use"}}}
{"type":"stream_event","event":{"type":"message_stop"}}
{"type":"result","subtype":"success","is_error":false,"stop_reason":"end_turn","result":"done"}`
	events := newClaudeCodeEvents(strings.NewReader(fixture))

	var progress strings.Builder
	toolCalls := 0
	for {
		chunk, err := events.recv()
		if errors.Is(err, io.EOF) {
			break
		}
		if nil != err {
			t.Fatal(err)
		}
		for _, choice := range chunk.Choices {
			progress.WriteString(choice.Delta.ReasoningContent)
			for _, call := range choice.Delta.ToolCalls {
				if "" != call.Function.Name {
					toolCalls++
				}
			}
		}
	}
	if 1 != toolCalls {
		t.Fatalf("unexpected tool call count: %d", toolCalls)
	}
	if "→ Bash: lark-cli docs list\n" != progress.String() {
		t.Fatalf("unexpected progress: %q", progress.String())
	}
}

// TestClaudeCodeBashCommand 覆盖命令提取：多行取首行、超长截断、异常入参返回空值。
func TestClaudeCodeBashCommand(t *testing.T) {
	if got := claudeCodeBashCommand(`{"command":"lark-cli x\nsecond line"}`); "lark-cli x" != got {
		t.Fatalf("multiline command must use the first line: %q", got)
	}
	long := strings.Repeat("a", 130)
	want := strings.Repeat("a", claudeCodeProgressCommandMax) + "..."
	if got := claudeCodeBashCommand(`{"command":"` + long + `"}`); want != got {
		t.Fatalf("long command must be truncated: %q", got)
	}
	if "" != claudeCodeBashCommand("not json") || "" != claudeCodeBashCommand(`{"command":""}`) || "" != claudeCodeBashCommand(`{"other":1}`) {
		t.Fatal("invalid or empty command must yield an empty string")
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
