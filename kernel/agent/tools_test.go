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
	"strings"
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

func TestConvertSchemaPreservesRawJSONSchema(t *testing.T) {
	raw := map[string]any{
		"type":                  "object",
		"unevaluatedProperties": false,
	}
	out := convertSchema(tools.ToolSchema{Raw: raw}).(map[string]any)
	if out["unevaluatedProperties"] != false {
		t.Fatalf("raw schema was not preserved: %#v", out)
	}
}

func TestResultToStringUsesStructuredContent(t *testing.T) {
	result := resultToString(tools.CallToolResult{
		StructuredContent: map[string]any{"status": "ok"},
	})
	if result != `{"status":"ok"}` {
		t.Fatalf("unexpected structured result: %q", result)
	}
}

func TestResultToStringUsesExplicitNullStructuredContent(t *testing.T) {
	result := resultToString(tools.CallToolResult{StructuredContentSet: true})
	if result != "null" {
		t.Fatalf("unexpected explicit null result: %q", result)
	}
}

func TestResultToStringUsesStructuredContentForEmptyText(t *testing.T) {
	result := resultToString(tools.CallToolResult{
		Content:           []tools.ContentItem{{Type: "text"}},
		StructuredContent: map[string]any{"status": "ok"},
	})
	if result != `{"status":"ok"}` {
		t.Fatalf("unexpected structured result: %q", result)
	}
}

func TestResultToStringTranslatesNonTextContent(t *testing.T) {
	var image tools.ContentItem
	if err := json.Unmarshal([]byte(`{"type":"image","data":"aW1hZ2U=","mimeType":"image/png"}`), &image); err != nil {
		t.Fatal(err)
	}
	result := resultToString(tools.CallToolResult{Content: []tools.ContentItem{image}})
	if !strings.Contains(result, `"type":"image"`) || !strings.Contains(result, `"mimeType":"image/png"`) {
		t.Fatalf("unexpected image result: %q", result)
	}
}

func TestExecuteToolPreservesModelAttachments(t *testing.T) {
	const toolName = "test_model_attachment"
	tools.SetTool(toolName, &tools.Tool{
		Name:        toolName,
		InputSchema: tools.ToolSchema{Type: "object"},
		Handler: func(args map[string]any) (tools.CallToolResult, error) {
			return tools.CallToolResult{
				Content: []tools.ContentItem{{Type: "text", Text: "attached"}},
				ModelAttachments: []tools.ModelAttachment{{
					Type: "image", Data: []byte("image"), MIMEType: "image/png", Path: "assets/image.png",
				}},
			}, nil
		},
	})
	t.Cleanup(func() { tools.RemoveTool(toolName) })

	result := executeTool(context.Background(), openai.ToolCall{
		Function: openai.FunctionCall{Name: toolName, Arguments: `{}`},
	}, "")
	if result.Text != "attached" || result.IsError || len(result.ModelAttachments) != 1 ||
		string(result.ModelAttachments[0].Data) != "image" {
		t.Fatalf("model attachment was not preserved: %#v", result)
	}
}

func TestValidateToolCallInputRejectsMissingActionBeforeConfirmation(t *testing.T) {
	args := map[string]any{"id": "20260707184942-prjqwqo"}
	if _, _, err := validateToolCallInput(t.Context(), "outline", args); err == nil {
		t.Fatal("outline without its required action must fail validation before confirmation")
	}
	args["action"] = "get"
	if _, _, err := validateToolCallInput(t.Context(), "outline", args); err != nil {
		t.Fatalf("valid outline arguments were rejected: %s", err)
	}
}

func TestNeedsConfirmScopesReadOnlyActionsByToolSource(t *testing.T) {
	const externalWrite = "test_external_write"
	const externalRead = "test_external_read"
	const nativeWrite = "test_native_write"
	const nativeExternalWrite = "test_native_external_write"
	tools.SetTool(externalWrite, &tools.Tool{
		Name: externalWrite, Source: "mcp", InputSchema: tools.ToolSchema{Type: "object"},
	})
	tools.SetTool(externalRead, &tools.Tool{
		Name: externalRead, Source: "mcp", ReadOnlyHint: true, InputSchema: tools.ToolSchema{Type: "object"},
	})
	tools.SetTool(nativeWrite, &tools.Tool{
		Name: nativeWrite, Source: "native", InputSchema: tools.ToolSchema{Type: "object"},
	})
	tools.SetTool(nativeExternalWrite, &tools.Tool{
		Name: nativeExternalWrite, Source: "native", EffectScope: tools.EffectScopeExternal,
		InputSchema: tools.ToolSchema{Type: "object"},
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

func TestNativeReadOnlyToolActions(t *testing.T) {
	for _, action := range []string{"open_setting", "focus_block", "open_document", "open_search"} {
		if needsConfirm("frontend", action, nil) || needsLocalSnapshot("frontend", action) {
			t.Errorf("built-in frontend action %q must not require confirmation or create a snapshot", action)
		}
	}
	if !needsConfirm("frontend", "plugin__example__write", nil) {
		t.Fatal("plugin frontend actions with unknown effects must require confirmation")
	}
	for _, action := range []string{"html", "preview"} {
		if needsConfirm("export", action, nil) || needsLocalSnapshot("export", action) {
			t.Errorf("read-only export action %q must not require confirmation or create a snapshot", action)
		}
	}
	if !needsConfirm("export", "docx", nil) || !needsLocalSnapshot("export", "docx") {
		t.Fatal("file-producing export actions must retain confirmation and snapshot protection")
	}
}

func TestConfirmSessionAcceptsResponseOnce(t *testing.T) {
	const confirmID = "test-confirm"
	ch := make(chan confirmResult, 1)
	confirmChannelsMu.Lock()
	confirmChannels[confirmID] = &confirmWaiter{sessionID: testSessionID, ch: ch}
	confirmChannelsMu.Unlock()
	t.Cleanup(func() {
		confirmChannelsMu.Lock()
		delete(confirmChannels, confirmID)
		confirmChannelsMu.Unlock()
	})

	accepted, err := ConfirmSession(confirmID, true, false)
	if err != nil || !accepted {
		t.Fatal("registered confirmation was rejected")
	}
	if accepted, err = ConfirmSession(confirmID, false, false); err != nil || accepted {
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
		Name:        toolName,
		Source:      "mcp",
		InputSchema: tools.ToolSchema{Type: "object"},
		Handler: func(args map[string]any) (tools.CallToolResult, error) {
			return tools.CallToolResult{
				Content:          []tools.ContentItem{{Type: "text", Text: "result unknown"}},
				IsError:          true,
				ExecutionUnknown: true,
			}, nil
		},
	})
	t.Cleanup(func() { tools.RemoveTool(toolName) })

	result := executeTool(context.Background(), openai.ToolCall{
		Function: openai.FunctionCall{Name: toolName, Arguments: `{}`},
	}, "")
	if result.Text != "result unknown" || !result.IsError || !result.ExecutionUnknown {
		t.Fatalf("unexpected tool result: %#v", result)
	}
}

func TestExecuteToolRejectsInvalidStructuredOutput(t *testing.T) {
	const toolName = "test_invalid_structured_output"
	if err := tools.SetTool(toolName, &tools.Tool{
		Name:         toolName,
		Source:       "mcp",
		InputSchema:  tools.ToolSchema{Type: "object"},
		OutputSchema: &tools.ToolSchema{Raw: map[string]any{"type": "array"}},
		Handler: func(args map[string]any) (tools.CallToolResult, error) {
			return tools.CallToolResult{
				StructuredContent:    map[string]any{"wrong": true},
				StructuredContentSet: true,
			}, nil
		},
	}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { tools.RemoveTool(toolName) })

	result := executeTool(context.Background(), openai.ToolCall{
		Function: openai.FunctionCall{Name: toolName, Arguments: `{}`},
	}, "")
	if !result.IsError || !result.ExecutionUnknown || !strings.Contains(result.Text, "must not be retried automatically") {
		t.Fatalf("unexpected tool result: %#v", result)
	}
}

func TestExecuteToolCancellationMarksExecutionUnknown(t *testing.T) {
	const toolName = "test_cancelled_execution"
	started := make(chan struct{})
	release := make(chan struct{})
	tools.SetTool(toolName, &tools.Tool{
		Name:        toolName,
		InputSchema: tools.ToolSchema{Type: "object"},
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
	resultCh := make(chan executedToolResult, 1)
	go func() {
		resultCh <- executeTool(ctx, openai.ToolCall{
			Function: openai.FunctionCall{Name: toolName, Arguments: `{}`},
		}, "")
	}()
	<-started
	cancel()
	result := <-resultCh
	if !result.IsError || !result.ExecutionUnknown || result.Text == "" {
		t.Fatalf("cancelled tool result was not marked unknown: %#v", result)
	}
}

func TestExecuteToolDoesNotStartAfterCancellation(t *testing.T) {
	const toolName = "test_pre_cancelled_execution"
	invoked := false
	tools.SetTool(toolName, &tools.Tool{
		Name:        toolName,
		InputSchema: tools.ToolSchema{Type: "object"},
		Handler: func(args map[string]any) (tools.CallToolResult, error) {
			invoked = true
			return tools.CallToolResult{}, nil
		},
	})
	t.Cleanup(func() { tools.RemoveTool(toolName) })

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	result := executeTool(ctx, openai.ToolCall{
		Function: openai.FunctionCall{Name: toolName, Arguments: `{}`},
	}, "")
	if invoked || result.Text == "" || !result.IsError || result.ExecutionUnknown {
		t.Fatalf("pre-cancelled tool was handled incorrectly: invoked=%v, result=%#v", invoked, result)
	}
}
