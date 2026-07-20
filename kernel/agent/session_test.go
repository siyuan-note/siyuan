// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package agent

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/88250/gulu"
	"github.com/siyuan-note/siyuan/kernel/util"
)

const testSessionID = "20260715120000-abcdefg"

func useTestDataDir(t *testing.T) {
	t.Helper()
	original := util.DataDir
	util.DataDir = t.TempDir()
	t.Cleanup(func() {
		util.DataDir = original
		sessionLocks.Delete(testSessionID)
	})
}

func marshalSession(t *testing.T, value any) []byte {
	t.Helper()
	data, err := gulu.JSON.MarshalJSON(value)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func TestSaveSessionRevisionConflictAndUnknownFields(t *testing.T) {
	useTestDataDir(t)
	base := map[string]any{
		"id":        testSessionID,
		"title":     "base",
		"createdAt": int64(1),
		"updatedAt": int64(1),
		"entries":   []any{map[string]any{"id": "user-1", "type": "user", "content": "hello"}},
		"future":    map[string]any{"enabled": true},
	}
	revision, err := SaveSession(marshalSession(t, base))
	if err != nil || revision != 1 {
		t.Fatalf("save initial session failed: revision=%d, err=%v", revision, err)
	}
	path := filepath.Join(sessionsDir(), testSessionID, "session.json")
	legacyData, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var legacy map[string]any
	if err := gulu.JSON.UnmarshalJSON(legacyData, &legacy); err != nil {
		t.Fatal(err)
	}
	legacy["expectedRevision"] = int64(1)
	legacy["commitTurnID"] = "legacy-turn"
	legacy["recoveryTurnID"] = "legacy-turn"
	legacy["recoveryState"] = "interrupted"
	legacy["recoveryRevision"] = int64(99)
	legacy["agentRunning"] = true
	if err := os.WriteFile(path, marshalSession(t, legacy), 0644); err != nil {
		t.Fatal(err)
	}

	stale := map[string]any{
		"id":               testSessionID,
		"title":            "stale",
		"createdAt":        int64(1),
		"updatedAt":        int64(2),
		"entries":          base["entries"],
		"expectedRevision": int64(0),
	}
	revision, err = SaveSession(marshalSession(t, stale))
	if !errors.Is(err, ErrSessionConflict) || revision != 1 {
		t.Fatalf("expected revision conflict: revision=%d, err=%v", revision, err)
	}

	update := map[string]any{
		"id":                  testSessionID,
		"title":               "updated",
		"createdAt":           int64(1),
		"updatedAt":           int64(3),
		"entries":             base["entries"],
		"expectedRevision":    int64(1),
		"lastCommittedTurnID": "forged-turn",
	}
	revision, err = SaveSession(marshalSession(t, update))
	if err != nil || revision != 2 {
		t.Fatalf("save updated session failed: revision=%d, err=%v", revision, err)
	}
	session, err := GetSession(testSessionID)
	if err != nil {
		t.Fatal(err)
	}
	if session["title"] != "updated" || session["future"] == nil {
		t.Fatalf("session data was overwritten unexpectedly: %#v", session)
	}
	for _, key := range []string{"expectedRevision", "commitTurnID", "recoveryTurnID", "recoveryState", "recoveryRevision", "agentRunning"} {
		if _, ok := session[key]; ok {
			t.Fatalf("transient field %q was restored from legacy data: %#v", key, session)
		}
	}
	if _, ok := session["lastCommittedTurnID"]; ok {
		t.Fatalf("server-controlled commit marker was accepted from client data: %#v", session)
	}
}

func TestRuntimeRecoveryCommitDoesNotDuplicateHistory(t *testing.T) {
	useTestDataDir(t)
	base := map[string]any{
		"id":        testSessionID,
		"title":     "base",
		"createdAt": int64(1),
		"updatedAt": int64(1),
		"entries":   []any{map[string]any{"id": "user-1", "type": "user", "content": "hello"}},
	}
	if revision, err := SaveSession(marshalSession(t, base)); err != nil || revision != 1 {
		t.Fatalf("save initial session failed: revision=%d, err=%v", revision, err)
	}

	turn := &agentRuntimeTurn{
		TurnID:           "20260715120001-abcdefg",
		Mode:             "append",
		UserEntryID:      "user-1",
		BaseRevision:     1,
		State:            "running",
		PromptTokens:     21,
		CompletionTokens: 8,
		LastPromptTokens: 13,
		CachedTokens:     5,
		ContextLimit:     128,
		TokenBreakdown:   map[string]int{"user": 3, "system": 10},
		Delta: []AgentMessage{{
			Role:    "assistant",
			Content: "server authoritative content",
			ToolCalls: []AgentToolCall{{
				ID:        "call-1",
				Name:      "external_write",
				Arguments: map[string]any{"action": "write"},
				State:     "executing",
			}},
		}},
	}
	if err := beginRuntimeTurn(testSessionID, turn, false); err != nil {
		t.Fatal(err)
	}
	if err := saveRuntimeTurn(testSessionID, turn, false); err != nil {
		t.Fatal(err)
	}
	uncommitted, err := HasUncommittedTurn(testSessionID)
	if err != nil || !uncommitted {
		t.Fatalf("active runtime turn was not detected: uncommitted=%v, err=%v", uncommitted, err)
	}
	canonical, err := GetSessionState(testSessionID, false)
	if err != nil {
		t.Fatal(err)
	}
	if entries := canonical["entries"].([]any); len(entries) != 1 {
		t.Fatalf("live runtime leaked into canonical session view: %#v", canonical)
	}

	raw, err := os.ReadFile(filepath.Join(sessionsDir(), testSessionID, "session.json"))
	if err != nil {
		t.Fatal(err)
	}
	var persisted map[string]any
	if err := gulu.JSON.UnmarshalJSON(raw, &persisted); err != nil {
		t.Fatal(err)
	}
	if entries := persisted["entries"].([]any); len(entries) != 1 {
		t.Fatalf("runtime changed canonical history: %#v", entries)
	}

	recovered, err := GetSession(testSessionID)
	if err != nil {
		t.Fatal(err)
	}
	entries := recovered["entries"].([]any)
	if len(entries) != 2 || recovered["recoveryTurnID"] != turn.TurnID {
		t.Fatalf("runtime recovery was not overlaid correctly: %#v", recovered)
	}
	assistant := entries[1].(map[string]any)
	toolCalls := assistant["toolCalls"].([]map[string]any)
	toolCall := toolCalls[0]
	if toolCall["result"] != toolUnknownResult {
		t.Fatalf("executing external write must be restored with an explicit unknown result: %#v", toolCall)
	}
	if numberToInt64(recovered["promptTokens"]) != 21 || numberToInt64(recovered["completionTokens"]) != 8 ||
		numberToInt64(recovered["contextTokens"]) != 13 || numberToInt64(recovered["contextCachedTokens"]) != 5 ||
		numberToInt64(recovered["contextLimit"]) != 128 {
		t.Fatalf("runtime token metadata was not restored: %#v", recovered)
	}
	wrongCommit := map[string]any{}
	for key, value := range recovered {
		wrongCommit[key] = value
	}
	wrongCommit["expectedRevision"] = int64(1)
	wrongCommit["commitTurnID"] = "20260715120009-abcdefg"
	if revision, err := SaveSession(marshalSession(t, wrongCommit)); !errors.Is(err, ErrSessionConflict) || revision != 1 {
		t.Fatalf("mismatched runtime commit was accepted: revision=%d, err=%v", revision, err)
	}

	recovered["expectedRevision"] = int64(1)
	if revision, err := SaveSession(marshalSession(t, recovered)); !errors.Is(err, ErrRuntimeNotFinalized) || revision != 1 {
		t.Fatalf("running runtime turn was committed: revision=%d, err=%v", revision, err)
	}
	turn.State = "interrupted"
	if err := saveRuntimeTurn(testSessionID, turn, false); err != nil {
		t.Fatal(err)
	}
	recovered, err = GetSession(testSessionID)
	if err != nil {
		t.Fatal(err)
	}
	entries = recovered["entries"].([]any)
	entries[1].(map[string]any)["content"] = "client truncated content"
	recovered["expectedRevision"] = int64(1)
	revision, canonicalState, err := SaveSessionState(marshalSession(t, recovered))
	if err != nil || revision != 2 {
		t.Fatalf("commit recovered session failed: revision=%d, err=%v", revision, err)
	}
	if entries := canonicalState["entries"].([]any); entries[1].(map[string]any)["content"] != "server authoritative content" {
		t.Fatalf("save response did not return authoritative content: %#v", canonicalState)
	}
	committed, err := GetSession(testSessionID)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := committed["recoveryTurnID"]; ok {
		t.Fatalf("transient recovery metadata was persisted: %#v", committed)
	}
	if entries := committed["entries"].([]any); len(entries) != 2 {
		t.Fatalf("recovered history was duplicated: %#v", entries)
	} else if entries[1].(map[string]any)["content"] != "server authoritative content" {
		t.Fatalf("client snapshot overwrote authoritative runtime content: %#v", entries[1])
	}
	repeatedCommit := map[string]any{}
	for key, value := range committed {
		repeatedCommit[key] = value
	}
	repeatedCommit["entries"].([]any)[1].(map[string]any)["content"] = "tampered repeated commit"
	// 模拟提交已落盘但响应丢失：客户端会携带旧修订号原样重试。
	repeatedCommit["expectedRevision"] = int64(1)
	repeatedCommit["commitTurnID"] = turn.TurnID
	if revision, canonicalState, err := SaveSessionState(marshalSession(t, repeatedCommit)); err != nil || revision != 2 {
		t.Fatalf("repeated commit was not idempotent: revision=%d, err=%v", revision, err)
	} else if entries := canonicalState["entries"].([]any); entries[1].(map[string]any)["content"] != "server authoritative content" {
		t.Fatalf("repeated commit did not return authoritative content: %#v", canonicalState)
	}
	committed, err = GetSession(testSessionID)
	if err != nil {
		t.Fatal(err)
	}
	if entries := committed["entries"].([]any); entries[1].(map[string]any)["content"] != "server authoritative content" {
		t.Fatalf("repeated commit overwrote authoritative content: %#v", entries[1])
	}
	if uncommitted, err := HasUncommittedTurn(testSessionID); err != nil || uncommitted {
		t.Fatalf("committed runtime turn remained active: uncommitted=%v, err=%v", uncommitted, err)
	}
	if err := saveRuntimeTurn(testSessionID, turn, false); err != nil {
		t.Fatalf("late runtime save should be ignored after commit: %v", err)
	}
	committed, err = GetSession(testSessionID)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := committed["recoveryTurnID"]; ok {
		t.Fatalf("late runtime save recreated a committed turn: %#v", committed)
	}

	if err := DeleteSession(testSessionID); err != nil {
		t.Fatal(err)
	}
	if err := saveRuntimeTurn(testSessionID, turn, false); err == nil {
		t.Fatal("late runtime save recreated a deleted session")
	}
	if _, err := os.Stat(filepath.Join(sessionsDir(), testSessionID)); !os.IsNotExist(err) {
		t.Fatalf("deleted session directory was recreated: %v", err)
	}
}

func TestRegenerateRuntimeRecoveryKeepsEditedUserContent(t *testing.T) {
	useTestDataDir(t)
	base := map[string]any{
		"id":        testSessionID,
		"title":     "base",
		"createdAt": int64(1),
		"updatedAt": int64(1),
		"entries": []any{
			map[string]any{
				"id": "user-1", "type": "user", "content": "original prompt",
				"references":    []any{map[string]any{"id": "block-1", "title": "First block"}},
				"editorContext": map[string]any{"activeDocID": "old-doc"},
			},
			map[string]any{"id": "assistant-1", "type": "assistant", "content": "old answer"},
			map[string]any{"id": "user-2", "type": "user", "content": "later prompt"},
			map[string]any{"id": "assistant-2", "type": "assistant", "content": "later answer"},
		},
	}
	if revision, err := SaveSession(marshalSession(t, base)); err != nil || revision != 1 {
		t.Fatalf("save initial session failed: revision=%d, err=%v", revision, err)
	}

	turn := &agentRuntimeTurn{
		TurnID:       "20260715120008-abcdefg",
		Mode:         "regenerate",
		UserEntryID:  "user-1",
		UserContent:  "edited prompt",
		BaseRevision: 1,
		State:        "running",
		UpdatedAt:    2,
		Delta: []AgentMessage{{
			Role:    "assistant",
			Content: "new answer",
		}},
	}
	emptyReferences := []Reference{}
	turn.UserReferences = &emptyReferences
	turn.UserEditorContext = &EditorContext{ActiveDocID: "new-doc"}
	if err := beginRuntimeTurn(testSessionID, turn, false); err != nil {
		t.Fatal(err)
	}
	turn.State = "interrupted"
	if err := saveRuntimeTurn(testSessionID, turn, false); err != nil {
		t.Fatal(err)
	}

	recovered, err := GetSession(testSessionID)
	if err != nil {
		t.Fatal(err)
	}
	entries := recovered["entries"].([]any)
	if len(entries) != 2 || entries[0].(map[string]any)["content"] != "edited prompt" ||
		entries[1].(map[string]any)["content"] != "new answer" {
		t.Fatalf("regenerated runtime was not recovered consistently: %#v", entries)
	}
	if _, ok := entries[0].(map[string]any)["references"]; ok {
		t.Fatalf("references removed by the edit were restored: %#v", entries[0])
	}
	editorContext := entries[0].(map[string]any)["editorContext"].(*EditorContext)
	if editorContext.ActiveDocID != "new-doc" {
		t.Fatalf("regenerated editor context was not restored: %#v", entries[0])
	}
	recovered["expectedRevision"] = int64(1)
	revision, canonical, err := SaveSessionState(marshalSession(t, recovered))
	if err != nil || revision != 2 {
		t.Fatalf("commit recovered regenerate turn failed: revision=%d, err=%v", revision, err)
	}
	committedEntries := canonical["entries"].([]any)
	if len(committedEntries) != 2 || committedEntries[0].(map[string]any)["content"] != "edited prompt" {
		t.Fatalf("committed regenerate turn lost edited content: %#v", committedEntries)
	}
	committedEditorContext := committedEntries[0].(map[string]any)["editorContext"].(*EditorContext)
	if committedEditorContext.ActiveDocID != "new-doc" {
		t.Fatalf("committed regenerate turn lost editor context: %#v", committedEntries[0])
	}
	persisted, err := GetSession(testSessionID)
	if err != nil {
		t.Fatal(err)
	}
	persistedEntries := persisted["entries"].([]any)
	persistedEditorContext := persistedEntries[0].(map[string]any)["editorContext"].(map[string]any)
	if persistedEditorContext["activeDocID"] != "new-doc" {
		t.Fatalf("persisted regenerate turn lost editor context: %#v", persistedEntries[0])
	}
}

func TestRejectedNewSessionDoesNotCreateDirectory(t *testing.T) {
	useTestDataDir(t)
	const sessionID = "20260715120009-abcdefg"
	t.Cleanup(func() { sessionLocks.Delete(sessionID) })
	expectedRevision := int64(1)
	session := map[string]any{
		"id":               sessionID,
		"title":            "stale",
		"createdAt":        int64(1),
		"updatedAt":        int64(1),
		"entries":          []any{},
		"expectedRevision": expectedRevision,
	}
	if _, err := SaveSession(marshalSession(t, session)); !errors.Is(err, ErrSessionConflict) {
		t.Fatalf("expected revision conflict, got %v", err)
	}
	if _, err := os.Stat(filepath.Join(sessionsDir(), sessionID)); !os.IsNotExist(err) {
		t.Fatalf("rejected save created a session directory: %v", err)
	}
}

func TestSaveSessionRejectsCorruptExistingData(t *testing.T) {
	useTestDataDir(t)
	dir := filepath.Join(sessionsDir(), testSessionID)
	if err := os.MkdirAll(dir, 0755); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "session.json")
	if err := os.WriteFile(path, []byte("{"), 0644); err != nil {
		t.Fatal(err)
	}
	data := map[string]any{
		"id":        testSessionID,
		"title":     "replacement",
		"createdAt": int64(1),
		"updatedAt": int64(1),
		"entries":   []any{},
	}
	if _, err := SaveSession(marshalSession(t, data)); err == nil {
		t.Fatal("corrupt existing session was overwritten")
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != "{" {
		t.Fatalf("corrupt session changed unexpectedly: %q", raw)
	}
}

func TestBeginRuntimeTurnRejectsStaleRevision(t *testing.T) {
	useTestDataDir(t)
	base := map[string]any{
		"id":        testSessionID,
		"title":     "base",
		"createdAt": int64(1),
		"updatedAt": int64(1),
		"entries":   []any{map[string]any{"id": "user-1", "type": "user", "content": "hello"}},
	}
	if revision, err := SaveSession(marshalSession(t, base)); err != nil || revision != 1 {
		t.Fatalf("save initial session failed: revision=%d, err=%v", revision, err)
	}
	turn := &agentRuntimeTurn{
		TurnID:       "20260715120002-abcdefg",
		Mode:         "append",
		UserEntryID:  "user-1",
		BaseRevision: 0,
		State:        "running",
	}
	if err := beginRuntimeTurn(testSessionID, turn, false); !errors.Is(err, ErrSessionConflict) {
		t.Fatalf("expected stale runtime revision to be rejected: %v", err)
	}
	if _, err := os.Stat(runtimePath(testSessionID)); !os.IsNotExist(err) {
		t.Fatalf("stale runtime turn was persisted: %v", err)
	}
}

func TestFinalizeOrphanedTurnMakesRuntimeRecoverable(t *testing.T) {
	useTestDataDir(t)
	base := map[string]any{
		"id":        testSessionID,
		"title":     "base",
		"createdAt": int64(1),
		"updatedAt": int64(1),
		"entries":   []any{map[string]any{"id": "user-1", "type": "user", "content": "hello"}},
	}
	if revision, err := SaveSession(marshalSession(t, base)); err != nil || revision != 1 {
		t.Fatalf("save initial session failed: revision=%d, err=%v", revision, err)
	}
	turn := &agentRuntimeTurn{
		TurnID:       "20260715120003-abcdefg",
		Mode:         "append",
		UserEntryID:  "user-1",
		BaseRevision: 1,
		State:        "running",
		DraftContent: "partial response",
	}
	if err := beginRuntimeTurn(testSessionID, turn, false); err != nil {
		t.Fatal(err)
	}
	runtimeBefore, err := loadRuntimeState(testSessionID)
	if err != nil {
		t.Fatal(err)
	}
	if err := FinalizeOrphanedTurn(testSessionID); err != nil {
		t.Fatal(err)
	}
	runtimeAfter, err := loadRuntimeState(testSessionID)
	if err != nil {
		t.Fatal(err)
	}
	if runtimeAfter.ActiveTurn == nil || runtimeAfter.ActiveTurn.State != "interrupted" {
		t.Fatalf("orphaned runtime was not finalized: %#v", runtimeAfter.ActiveTurn)
	}
	if runtimeAfter.Revision <= runtimeBefore.Revision {
		t.Fatalf("runtime revision did not advance: before=%d, after=%d", runtimeBefore.Revision, runtimeAfter.Revision)
	}
	if turnID, err := RecoverableTurnID(testSessionID); err != nil || turnID != turn.TurnID {
		t.Fatalf("finalized runtime was not reported as recoverable: turnID=%q, err=%v", turnID, err)
	}
	recovered, err := GetSession(testSessionID)
	if err != nil {
		t.Fatal(err)
	}
	if recovered["recoveryState"] != "interrupted" || numberToInt64(recovered["recoveryRevision"]) != runtimeAfter.Revision {
		t.Fatalf("orphaned runtime recovery metadata is incomplete: %#v", recovered)
	}
	recovered["expectedRevision"] = int64(1)
	if revision, err := SaveSession(marshalSession(t, recovered)); err != nil || revision != 2 {
		t.Fatalf("commit finalized orphan failed: revision=%d, err=%v", revision, err)
	}
	if turnID, err := RecoverableTurnID(testSessionID); err != nil || turnID != "" {
		t.Fatalf("committed runtime remained recoverable: turnID=%q, err=%v", turnID, err)
	}
}

func TestRuntimeRejectsInvalidSessionID(t *testing.T) {
	useTestDataDir(t)
	turn := &agentRuntimeTurn{TurnID: "20260715120004-abcdefg", State: "running"}
	if err := beginRuntimeTurn("..", turn, false); err == nil {
		t.Fatal("invalid runtime session id was accepted")
	}
	if err := saveRuntimeTurn("..", turn, false); err == nil {
		t.Fatal("invalid runtime checkpoint session id was accepted")
	}
}

func TestGetSessionRejectsRuntimeWithoutUserAnchor(t *testing.T) {
	useTestDataDir(t)
	session := map[string]any{
		"id":        testSessionID,
		"title":     "base",
		"createdAt": int64(1),
		"updatedAt": int64(1),
		"entries":   []any{map[string]any{"id": "user-1", "type": "user", "content": "hello"}},
	}
	if _, err := SaveSession(marshalSession(t, session)); err != nil {
		t.Fatal(err)
	}
	turn := &agentRuntimeTurn{
		TurnID:       "20260715120007-abcdefg",
		UserEntryID:  "missing-user",
		BaseRevision: 1,
		State:        "running",
	}
	if err := beginRuntimeTurn(testSessionID, turn, false); err == nil {
		t.Fatal("runtime without a user anchor was started")
	}
	turn.State = "interrupted"
	runtime := &agentRuntime{
		SchemaVersion: 1,
		Revision:      1,
		SessionID:     testSessionID,
		ActiveTurn:    turn,
	}
	if err := os.WriteFile(runtimePath(testSessionID), marshalSession(t, runtime), 0644); err != nil {
		t.Fatal(err)
	}
	if _, err := GetSession(testSessionID); err == nil {
		t.Fatal("runtime without a user anchor was silently ignored")
	}
}

func TestGetSessionRejectsIncompatibleRuntimeMetadata(t *testing.T) {
	tests := []struct {
		name    string
		runtime map[string]any
	}{
		{
			name: "future schema",
			runtime: map[string]any{
				"schemaVersion": 2,
				"sessionID":     testSessionID,
			},
		},
		{
			name: "different session",
			runtime: map[string]any{
				"schemaVersion": 1,
				"sessionID":     "20260715120008-abcdefg",
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			useTestDataDir(t)
			session := map[string]any{
				"id":        testSessionID,
				"title":     "base",
				"createdAt": int64(1),
				"updatedAt": int64(1),
				"entries":   []any{map[string]any{"id": "user-1", "type": "user", "content": "hello"}},
			}
			if _, err := SaveSession(marshalSession(t, session)); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(runtimePath(testSessionID), marshalSession(t, test.runtime), 0644); err != nil {
				t.Fatal(err)
			}
			if _, err := GetSession(testSessionID); err == nil {
				t.Fatal("incompatible runtime metadata was accepted")
			}
		})
	}
}

func TestApplyRuntimePreservesUIOrderAndReplacesAssistant(t *testing.T) {
	session := map[string]any{
		"entries": []any{
			map[string]any{"id": "user-1", "type": "user", "content": "hello"},
			map[string]any{"id": "thinking-1", "type": "thinking"},
			map[string]any{"id": "client-assistant-1", "type": "assistant", "content": "client one"},
			map[string]any{"id": "confirm-1", "type": "confirm"},
			map[string]any{"id": "client-assistant-2", "type": "assistant", "content": "client two"},
			map[string]any{"id": "rollback-1", "type": "rollback"},
		},
	}
	turn := &agentRuntimeTurn{
		TurnID:      "20260715120005-abcdefg",
		UserEntryID: "user-1",
		UpdatedAt:   1,
		Delta: []AgentMessage{
			{Role: "assistant", Content: "server one"},
			{Role: "assistant", Content: "server two"},
		},
	}
	if err := applyRuntimeTurnToSessionLocked(session, turn); err != nil {
		t.Fatal(err)
	}
	entries := session["entries"].([]any)
	wantTypes := []string{"user", "thinking", "assistant", "confirm", "assistant", "rollback"}
	if len(entries) != len(wantTypes) {
		t.Fatalf("unexpected merged entry count: %#v", entries)
	}
	for i, wantType := range wantTypes {
		entry := entries[i].(map[string]any)
		if entry["type"] != wantType {
			t.Fatalf("entry %d type: got=%v, want=%s", i, entry["type"], wantType)
		}
	}
	if entries[2].(map[string]any)["content"] != "server one" ||
		entries[4].(map[string]any)["content"] != "server two" {
		t.Fatalf("client assistant content was not replaced: %#v", entries)
	}
}

func TestApplyRegenerateRuntimeReplacesUserContent(t *testing.T) {
	session := map[string]any{
		"entries": []any{
			map[string]any{"id": "user-1", "type": "user", "content": "original prompt"},
			map[string]any{"id": "assistant-1", "type": "assistant", "content": "old answer"},
			map[string]any{"id": "user-2", "type": "user", "content": "later prompt"},
			map[string]any{"id": "assistant-2", "type": "assistant", "content": "later answer"},
		},
	}
	turn := &agentRuntimeTurn{
		TurnID:      "20260715120007-abcdefg",
		Mode:        "regenerate",
		UserEntryID: "user-1",
		UserContent: "edited prompt",
		UpdatedAt:   1,
		Delta: []AgentMessage{{
			Role:    "assistant",
			Content: "new answer",
		}},
	}
	if err := applyRuntimeTurnToSessionLocked(session, turn); err != nil {
		t.Fatal(err)
	}
	entries := session["entries"].([]any)
	if len(entries) != 2 {
		t.Fatalf("regenerated history was not truncated: %#v", entries)
	}
	if content := entries[0].(map[string]any)["content"]; content != "edited prompt" {
		t.Fatalf("edited user content was not restored: %v", content)
	}
	if content := entries[1].(map[string]any)["content"]; content != "new answer" {
		t.Fatalf("regenerated assistant content was not restored: %v", content)
	}
}

func TestApplyRuntimeDistinguishesPendingAndExecutingTools(t *testing.T) {
	session := map[string]any{
		"entries": []any{map[string]any{"id": "user-1", "type": "user", "content": "hello"}},
	}
	turn := &agentRuntimeTurn{
		TurnID:      "20260715120006-abcdefg",
		UserEntryID: "user-1",
		Delta: []AgentMessage{{
			Role: "assistant",
			ToolCalls: []AgentToolCall{
				{Name: "not_started", State: "pending"},
				{Name: "possibly_started", State: "executing"},
			},
		}},
	}
	if err := applyRuntimeTurnToSessionLocked(session, turn); err != nil {
		t.Fatal(err)
	}
	entries := session["entries"].([]any)
	calls := entries[1].(map[string]any)["toolCalls"].([]map[string]any)
	if calls[0]["result"] != toolNotExecutedResult {
		t.Fatalf("pending tool result is ambiguous: %#v", calls[0])
	}
	if calls[1]["result"] != toolUnknownResult {
		t.Fatalf("executing tool result was not protected against automatic retry: %#v", calls[1])
	}
}
