// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package agent

import (
	"strings"
	"testing"
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
