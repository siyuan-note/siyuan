// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package agent

import (
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	kernelConf "github.com/siyuan-note/siyuan/kernel/conf"
	kernelModel "github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestTurnContextStaysInUserMessage(t *testing.T) {
	const userMessage = "summarize this"
	references := []Reference{{ID: "ref-block", Title: "Referenced block"}}
	editorCtx := EditorContext{
		ActiveDocID:      "active-doc",
		ActiveDocTitle:   "Active document",
		FocusedBlockID:   "focused-block",
		SelectedBlockIDs: []string{"selected-block"},
	}

	messages := buildInitialMessages(userMessage, "English", references, editorCtx, nil)
	if len(messages) != 2 {
		t.Fatalf("unexpected message count: %d", len(messages))
	}
	systemContent := messages[0].Content
	for _, marker := range []string{"ref-block", "active-doc", "focused-block", "selected-block"} {
		if strings.Contains(systemContent, marker) {
			t.Fatalf("turn context %q leaked into system prompt", marker)
		}
		if !strings.Contains(messages[1].Content, marker) {
			t.Fatalf("turn context %q is missing from user message", marker)
		}
	}
	if !strings.HasSuffix(messages[1].Content, userMessage) {
		t.Fatalf("raw user message is not preserved at the end: %q", messages[1].Content)
	}
}

func TestSystemPromptDocumentsBlockReferenceSyntax(t *testing.T) {
	if !strings.Contains(systemPrompt, `((<blockID> "<anchor text>"))`) {
		t.Fatal("system prompt is missing the SiYuan block-reference syntax")
	}
	if !strings.Contains(systemPrompt, `never use [[<blockID>]]`) {
		t.Fatal("system prompt does not reject bracketed block IDs")
	}
}

func TestSystemPromptSortsPluginActions(t *testing.T) {
	actions := []PluginAction{
		{Name: "plugin__z__run", Description: "Run Z"},
		{Name: "plugin__a__run", Description: "Run A"},
	}

	forward := buildSystemPrompt("English", actions)
	reversed := buildSystemPrompt("English", []PluginAction{actions[1], actions[0]})
	if forward != reversed {
		t.Fatal("plugin action order changed the system prompt")
	}
	if strings.Index(forward, actions[1].Name) > strings.Index(forward, actions[0].Name) {
		t.Fatalf("plugin actions are not sorted in system prompt: %q", forward)
	}
}

func TestSystemPromptUsesAppearanceLanguage(t *testing.T) {
	originalConf := kernelModel.Conf
	originalWorkingDir := util.WorkingDir
	kernelModel.Conf = kernelModel.NewAppConf()
	kernelModel.Conf.Appearance = kernelConf.NewAppearance()
	kernelModel.Conf.Appearance.Lang = "zh-CN"
	_, filename, _, _ := runtime.Caller(0)
	util.WorkingDir = filepath.Join(filepath.Dir(filename), "..", "..", "app")
	t.Cleanup(func() {
		kernelModel.Conf = originalConf
		util.WorkingDir = originalWorkingDir
	})

	prompt := buildSystemPrompt("en", nil)
	if !strings.Contains(prompt, "Reply in the language configured in SiYuan's appearance settings.") {
		t.Fatalf("appearance language instruction is missing from system prompt: %q", prompt)
	}
	if !strings.Contains(prompt, "Reply in 简体中文.") {
		t.Fatalf("appearance language is missing from system prompt: %q", prompt)
	}
	if strings.Contains(prompt, "Reply in English.") {
		t.Fatalf("request language leaked into system prompt: %q", prompt)
	}
}

func TestCheckpointMessagesKeepHistoricalTurnContexts(t *testing.T) {
	checkpoint := []AgentMessage{
		newAgentUserMessage("first question", "user-1", nil, EditorContext{ActiveDocID: "doc-a"}),
		{Role: "assistant", Content: "first answer", EntryID: "assistant-1"},
		newAgentUserMessage("second question", "user-2", nil, EditorContext{ActiveDocID: "doc-b"}),
	}

	messages := checkpointMessagesToOpenAI(checkpoint, "English", nil)
	if len(messages) != 4 {
		t.Fatalf("unexpected message count: %d", len(messages))
	}
	if strings.Contains(messages[0].Content, "doc-a") || strings.Contains(messages[0].Content, "doc-b") {
		t.Fatalf("historical editor context leaked into system prompt: %q", messages[0].Content)
	}
	if !strings.Contains(messages[1].Content, "doc-a") || strings.Contains(messages[1].Content, "doc-b") {
		t.Fatalf("first user message has the wrong editor context: %q", messages[1].Content)
	}
	if !strings.Contains(messages[3].Content, "doc-b") || strings.Contains(messages[3].Content, "doc-a") {
		t.Fatalf("second user message has the wrong editor context: %q", messages[3].Content)
	}
}

func TestUserTurnContextSurvivesCheckpointRoundTrip(t *testing.T) {
	editorCtx := &EditorContext{
		ActiveDocID:     "round-trip-doc",
		VisibleBlockIDs: []string{"visible-block"},
	}
	entries := []SessionEntry{{
		ID:            "user-1",
		Type:          "user",
		Content:       "question",
		References:    []Reference{{ID: "round-trip-ref", Title: "Reference"}},
		EditorContext: editorCtx,
	}}

	checkpoint := entriesToAgentMessages(entries)
	if len(checkpoint) != 1 || checkpoint[0].EditorContext == nil {
		t.Fatalf("entry context was not restored into checkpoint: %#v", checkpoint)
	}
	roundTripped := agentMessagesToEntries(checkpoint)
	if len(roundTripped) != 1 || roundTripped[0].EditorContext == nil {
		t.Fatalf("checkpoint context was not persisted into entry: %#v", roundTripped)
	}
	if roundTripped[0].EditorContext.ActiveDocID != "round-trip-doc" ||
		len(roundTripped[0].References) != 1 || roundTripped[0].References[0].ID != "round-trip-ref" {
		t.Fatalf("turn context changed during checkpoint round trip: %#v", roundTripped[0])
	}

	checkpoint[0].EditorContext.VisibleBlockIDs[0] = "changed"
	if editorCtx.VisibleBlockIDs[0] != "visible-block" || roundTripped[0].EditorContext.VisibleBlockIDs[0] != "visible-block" {
		t.Fatal("editor context slices were not cloned")
	}
}

func TestAssistantContextSurvivesCheckpointRoundTrip(t *testing.T) {
	const argumentsJSON = "{\n  \"query\": \"SiYuan\",\n  \"limit\": 9007199254740993\n}"
	entries := []SessionEntry{{
		ID:            "assistant-1",
		Type:          "assistant",
		Content:       "Let me search for that.",
		ReasoningCont: "I need to use the search tool.",
		RoundID:       "round-1",
		ToolCalls: []AgentToolCall{{
			ID:            "call-original",
			Name:          "search",
			Arguments:     map[string]any{"query": "SiYuan", "limit": float64(9007199254740992)},
			ArgumentsJSON: argumentsJSON,
			Result:        "search result",
			State:         "finished",
		}},
	}}

	checkpoint := entriesToAgentMessages(entries)
	if len(checkpoint) != 1 || checkpoint[0].ReasoningContent != entries[0].ReasoningCont ||
		checkpoint[0].RoundID != entries[0].RoundID {
		t.Fatalf("assistant reasoning was not restored into checkpoint: %#v", checkpoint)
	}
	if len(checkpoint[0].ToolCalls) != 1 || checkpoint[0].ToolCalls[0].ID != "call-original" ||
		checkpoint[0].ToolCalls[0].ArgumentsJSON != argumentsJSON {
		t.Fatalf("assistant tool call was not restored exactly: %#v", checkpoint[0].ToolCalls)
	}

	messages := checkpointMessagesToOpenAI(checkpoint, "English", nil)
	if len(messages) != 3 {
		t.Fatalf("unexpected rebuilt message count: %d", len(messages))
	}
	assistant := messages[1]
	if assistant.ReasoningContent != entries[0].ReasoningCont || len(assistant.ToolCalls) != 1 ||
		assistant.ToolCalls[0].ID != "call-original" ||
		assistant.ToolCalls[0].Function.Arguments != argumentsJSON {
		t.Fatalf("assistant request context changed after rebuild: %#v", assistant)
	}
	if messages[2].ToolCallID != "call-original" {
		t.Fatalf("tool result no longer matches the original call: %#v", messages[2])
	}

	roundTripped := agentMessagesToEntries(checkpoint)
	if len(roundTripped) != 1 || roundTripped[0].ReasoningCont != entries[0].ReasoningCont ||
		roundTripped[0].RoundID != entries[0].RoundID ||
		len(roundTripped[0].ToolCalls) != 1 || roundTripped[0].ToolCalls[0].ID != "call-original" ||
		roundTripped[0].ToolCalls[0].ArgumentsJSON != argumentsJSON {
		t.Fatalf("assistant context changed during checkpoint round trip: %#v", roundTripped)
	}
}
