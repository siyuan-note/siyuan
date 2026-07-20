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
	"testing"

	"github.com/sashabaranov/go-openai"
	"github.com/siyuan-note/siyuan/kernel/mcp/tools"
)

func TestConvertSchemaZodOptionalFields(t *testing.T) {
	schema := tools.ToolSchema{
		Type: "object",
		Properties: map[string]tools.Property{
			"title": {Type: "string", Description: "task title"},
			"content": {
				AnyOf: []tools.Property{
					{Type: "string"},
					{Type: "null"},
				},
				Description: "optional content",
			},
		},
		Required: []string{"title"},
	}

	out := convertSchema(schema).(map[string]any)
	if out["type"] != "object" {
		t.Fatalf("expected root type object, got %#v", out["type"])
	}

	props := out["properties"].(map[string]any)
	content := props["content"].(map[string]any)
	if content["type"] != "string" {
		t.Fatalf("expected simplified content type string, got %#v", content)
	}
	if _, ok := content["type"]; ok {
		if content["type"] == "" {
			t.Fatal("content type must not be empty string")
		}
	}
	if _, ok := content["anyOf"]; ok {
		t.Fatalf("expected anyOf to be simplified away, got %#v", content)
	}

	raw, err := json.Marshal(out)
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) == "" {
		t.Fatal("expected non-empty json")
	}
}

func TestConvertSchemaRootAnyOf(t *testing.T) {
	schema := tools.ToolSchema{
		AnyOf: []tools.ToolSchema{
			{
				Type: "object",
				Properties: map[string]tools.Property{
					"title": {Type: "string"},
				},
				Required: []string{"title"},
			},
		},
	}

	out := convertSchema(schema).(map[string]any)
	if out["type"] != "object" {
		t.Fatalf("expected root type object, got %#v", out["type"])
	}
	props := out["properties"].(map[string]any)
	if len(props) != 1 {
		t.Fatalf("expected 1 property, got %d", len(props))
	}
}

func TestNeedsConfirmScopesReadOnlyActionsByToolSource(t *testing.T) {
	const externalWrite = "test_external_write"
	const externalRead = "test_external_read"
	const nativeWrite = "test_native_write"
	const nativeExternalWrite = "test_native_external_write"
	tools.SetTool(externalWrite, &tools.Tool{Name: externalWrite, Source: "mcp"})
	tools.SetTool(externalRead, &tools.Tool{Name: externalRead, Source: "mcp", ReadOnlyHint: true})
	tools.SetTool(nativeWrite, &tools.Tool{Name: nativeWrite, Source: "native"})
	tools.SetTool(nativeExternalWrite, &tools.Tool{
		Name: nativeExternalWrite, Source: "native", EffectScope: tools.EffectScopeExternal,
	})
	t.Cleanup(func() {
		tools.RemoveTool(externalWrite)
		tools.RemoveTool(externalRead)
		tools.RemoveTool(nativeWrite)
		tools.RemoveTool(nativeExternalWrite)
	})

	if !needsConfirm(externalWrite, "", nil) {
		t.Fatal("external tool with unknown mutability must require confirmation")
	}
	if !needsConfirm(externalWrite, "close", nil) {
		t.Fatal("native safe action name must not bypass external tool confirmation")
	}
	if needsConfirm(externalRead, "query", nil) {
		t.Fatal("external tool explicitly declared read-only should not require confirmation")
	}
	if needsLocalSnapshot(externalWrite, "write") {
		t.Fatal("external write cannot be rolled back by a local repository snapshot")
	}
	if !needsLocalSnapshot(nativeWrite, "write") {
		t.Fatal("native write should create a local repository snapshot")
	}
	if needsLocalSnapshot(nativeExternalWrite, "write") {
		t.Fatal("native tool writing an external service cannot be rolled back by a local repository snapshot")
	}
	if !needsConfirm("import", "md", nil) || !needsLocalSnapshot("import", "md") {
		t.Fatal("markdown import must require confirmation and a snapshot despite export using the same safe action name")
	}
	if !needsConfirm("unzip", "", nil) || !needsLocalSnapshot("unzip", "") {
		t.Fatal("actionless write tool must require confirmation and create a local snapshot")
	}
	if needsConfirm("web_fetch", "", nil) || needsLocalSnapshot("web_fetch", "") {
		t.Fatal("actionless read-only tool must not require confirmation or create a snapshot")
	}
	if needsConfirm("todo_write", "", nil) || needsLocalSnapshot("todo_write", "") {
		t.Fatal("agent session todo updates must not require confirmation or create a repository snapshot")
	}
	if needsConfirm("http_request", "", nil) || needsLocalSnapshot("http_request", "") {
		t.Fatal("http_request without an action defaults to a read-only GET")
	}
}

func TestImageToolActionEffects(t *testing.T) {
	if needsConfirm("image", "list", nil) || needsLocalSnapshot("image", "list") {
		t.Fatal("listing document images must be a confirmation-free local read")
	}
	if !needsConfirm("image", "analyze", nil) || needsLocalSnapshot("image", "analyze") {
		t.Fatal("image analysis must confirm data egress without creating a local snapshot")
	}
	if !needsConfirm("image", "generate", nil) || !needsLocalSnapshot("image", "generate") {
		t.Fatal("image generation must confirm external cost and snapshot the local write")
	}
	if needsConfirm("image", "analyze", map[string]bool{"image::analyze": true}) {
		t.Fatal("an explicitly allowed image action should not ask again")
	}
}

func TestSkillToolActionEffects(t *testing.T) {
	for _, action := range []string{"", "load", "list"} {
		if needsConfirm("skill", action, nil) || needsLocalSnapshot("skill", action) {
			t.Errorf("read-only skill action %q must not require confirmation or create a snapshot", action)
		}
	}
	for _, action := range []string{"save", "install", "remove", "rename"} {
		if !needsConfirm("skill", action, nil) || !needsLocalSnapshot("skill", action) {
			t.Errorf("write skill action %q must require confirmation and create a snapshot", action)
		}
	}
}

func TestQueryToolActionEffects(t *testing.T) {
	tests := []struct {
		toolName     string
		action       string
		needsConfirm bool
	}{
		{toolName: "sql", action: "query"},
		{toolName: "sql", action: ""},
		{toolName: "sql", action: "select"},
		{toolName: "search", action: "fulltext"},
		{toolName: "search", action: "semantic", needsConfirm: true},
		{toolName: "search", action: "asset"},
		{toolName: "search", action: "getasset"},
		{toolName: "search", action: "unknown"},
	}
	for _, test := range tests {
		if actual := needsConfirm(test.toolName, test.action, nil); actual != test.needsConfirm {
			t.Errorf("unexpected confirmation decision for %s::%s: got %t, want %t",
				test.toolName, test.action, actual, test.needsConfirm)
		}
		if needsLocalSnapshot(test.toolName, test.action) {
			t.Errorf("read-only action %s::%s must not create a local snapshot", test.toolName, test.action)
		}
	}
}

func TestConfirmSessionAcceptsResponseOnce(t *testing.T) {
	const confirmID = "test-confirm"
	ch := make(chan confirmResult, 1)
	confirmChannelsMu.Lock()
	confirmChannels[confirmID] = ch
	confirmChannelsMu.Unlock()
	t.Cleanup(func() {
		confirmChannelsMu.Lock()
		delete(confirmChannels, confirmID)
		confirmChannelsMu.Unlock()
	})

	if !ConfirmSession(confirmID, true, false) {
		t.Fatal("registered confirmation was rejected")
	}
	if ConfirmSession(confirmID, false, false) {
		t.Fatal("duplicate confirmation was accepted")
	}
	result, accepted := finishConfirmWait(confirmID, ch)
	if !accepted || !result.approved || result.always {
		t.Fatalf("unexpected confirmation result: %#v, accepted=%v", result, accepted)
	}
}

func TestQuestionAndFrontendResultsAreAcceptedOnce(t *testing.T) {
	const questionID = "test-question"
	questionCh := make(chan QuestionAnswer, 1)
	questionChannelsMu.Lock()
	questionChannels[questionID] = questionCh
	questionChannelsMu.Unlock()
	if !AnswerQuestion(questionID, []string{"answer"}) || AnswerQuestion(questionID, []string{"duplicate"}) {
		t.Fatal("question answer was not accepted exactly once")
	}
	if answer := <-questionCh; len(answer.Answers) != 1 || answer.Answers[0] != "answer" {
		t.Fatalf("unexpected question answer: %#v", answer)
	}

	const callID = "test-frontend-call"
	frontendCh := make(chan frontendCallResult, 1)
	frontendCallChannelsMu.Lock()
	frontendCallChannels[callID] = frontendCh
	frontendCallChannelsMu.Unlock()
	if !FrontendToolResult(callID, "result", false) || FrontendToolResult(callID, "duplicate", false) {
		t.Fatal("frontend result was not accepted exactly once")
	}
	if result := <-frontendCh; result.result != "result" || result.isError {
		t.Fatalf("unexpected frontend result: %#v", result)
	}
}

func TestWaitCompletionKeepsConcurrentlyAcceptedResults(t *testing.T) {
	const questionID = "test-question-timeout-race"
	questionCh := make(chan QuestionAnswer, 1)
	questionChannelsMu.Lock()
	questionChannels[questionID] = questionCh
	questionChannelsMu.Unlock()
	if !AnswerQuestion(questionID, []string{"accepted"}) {
		t.Fatal("question answer was rejected")
	}
	answer, accepted := finishQuestionWait(questionID, questionCh)
	if !accepted || len(answer.Answers) != 1 || answer.Answers[0] != "accepted" {
		t.Fatalf("accepted question answer was lost: %#v, accepted=%v", answer, accepted)
	}

	const callID = "test-frontend-timeout-race"
	frontendCh := make(chan frontendCallResult, 1)
	frontendCallChannelsMu.Lock()
	frontendCallChannels[callID] = frontendCh
	frontendCallChannelsMu.Unlock()
	if !FrontendToolResult(callID, "accepted", false) {
		t.Fatal("frontend result was rejected")
	}
	result, accepted := finishFrontendWait(callID, frontendCh)
	if !accepted || result.result != "accepted" || result.isError {
		t.Fatalf("accepted frontend result was lost: %#v, accepted=%v", result, accepted)
	}
}

func TestExecuteToolPropagatesUnknownExecution(t *testing.T) {
	const toolName = "test_unknown_execution"
	tools.SetTool(toolName, &tools.Tool{
		Name:   toolName,
		Source: "mcp",
		Handler: func(args map[string]any) (tools.CallToolResult, error) {
			return tools.CallToolResult{
				Content:          []tools.ContentItem{{Type: "text", Text: "result unknown"}},
				IsError:          true,
				ExecutionUnknown: true,
			}, nil
		},
	})
	t.Cleanup(func() { tools.RemoveTool(toolName) })

	result, isErr, executionUnknown := executeTool(context.Background(), openai.ToolCall{
		Function: openai.FunctionCall{Name: toolName, Arguments: `{}`},
	}, "")
	if result != "result unknown" || !isErr || !executionUnknown {
		t.Fatalf("unexpected tool result: result=%q, isErr=%v, executionUnknown=%v", result, isErr, executionUnknown)
	}
}

func TestExecuteToolCancellationMarksExecutionUnknown(t *testing.T) {
	const toolName = "test_cancelled_execution"
	started := make(chan struct{})
	release := make(chan struct{})
	tools.SetTool(toolName, &tools.Tool{
		Name: toolName,
		Handler: func(args map[string]any) (tools.CallToolResult, error) {
			close(started)
			<-release
			return tools.CallToolResult{Content: []tools.ContentItem{{Type: "text", Text: "late result"}}}, nil
		},
	})
	t.Cleanup(func() {
		close(release)
		tools.RemoveTool(toolName)
	})

	ctx, cancel := context.WithCancel(context.Background())
	resultCh := make(chan struct {
		text    string
		isErr   bool
		unknown bool
	}, 1)
	go func() {
		text, isErr, unknown := executeTool(ctx, openai.ToolCall{
			Function: openai.FunctionCall{Name: toolName, Arguments: `{}`},
		}, "")
		resultCh <- struct {
			text    string
			isErr   bool
			unknown bool
		}{text: text, isErr: isErr, unknown: unknown}
	}()
	<-started
	cancel()
	result := <-resultCh
	if !result.isErr || !result.unknown || result.text == "" {
		t.Fatalf("cancelled tool result was not marked unknown: %#v", result)
	}
}

func TestExecuteToolDoesNotStartAfterCancellation(t *testing.T) {
	const toolName = "test_pre_cancelled_execution"
	invoked := false
	tools.SetTool(toolName, &tools.Tool{
		Name: toolName,
		Handler: func(args map[string]any) (tools.CallToolResult, error) {
			invoked = true
			return tools.CallToolResult{}, nil
		},
	})
	t.Cleanup(func() { tools.RemoveTool(toolName) })

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	result, isErr, executionUnknown := executeTool(ctx, openai.ToolCall{
		Function: openai.FunctionCall{Name: toolName, Arguments: `{}`},
	}, "")
	if invoked || result == "" || !isErr || executionUnknown {
		t.Fatalf("pre-cancelled tool was handled incorrectly: invoked=%v, result=%q, isErr=%v, executionUnknown=%v",
			invoked, result, isErr, executionUnknown)
	}
}
