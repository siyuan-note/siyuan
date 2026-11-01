// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/memo"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAIMemoryConversationKeywordContract(t *testing.T) {
	for _, verdict := range []string{"self", "external", "uncertain"} {
		keywords, eligible, err := decodeMemoryConversationKeywords(`{"intent":"remember","terms":["answers"],"attribution":"` + verdict + `"}`)
		if err != nil || eligible != (verdict == "self") || len(keywords.Terms) != 1 {
			t.Fatalf("verdict %s: %+v %v %v", verdict, keywords, eligible, err)
		}
	}
	for _, raw := range []string{
		`{}`, `null`, `[]`,
		`{"intent":"remember","terms":[]}`,
		`{"intent":"remember","attribution":"self"}`,
		`{"intent":"remember","terms":null,"attribution":"self"}`,
		`{"intent":"forget","terms":[],"attribution":"self"}`,
		`{"intent":"remember","terms":[],"attribution":null}`,
		`{"intent":"remember","terms":[],"attribution":"unknown"}`,
		`{"intent":"remember","terms":[],"attribution":"external","attribution":"self"}`,
		`{"intent":"remember","terms":[],"terms":[],"attribution":"self"}`,
		`{"intent":"remember","terms":[],"attribution":"self","extra":true}`,
		`{"intent":"remember","terms":[],"attribution":"self"} {}`,
		`{"intent":"remember","terms":["` + strings.Repeat("x", 101) + `"],"attribution":"self"}`,
		`{"intent":"remember","terms":[` + strings.Repeat(`"x",`, 12) + `"x"],"attribution":"self"}`,
		strings.Repeat(" ", 8193),
	} {
		if _, eligible, err := decodeMemoryConversationKeywords(raw); err == nil || eligible {
			t.Fatalf("invalid verdict accepted: %q", raw)
		}
	}
}

func memoryConversationFixture(t *testing.T, content *string) memo.Source {
	t.Helper()
	previous := AIMemoryConversationReader
	t.Cleanup(func() { AIMemoryConversationReader = previous })
	AIMemoryConversationReader = func(context.Context, string, string) (string, error) {
		data, err := json.Marshal(map[string]string{"role": "user", "content": *content, "sessionID": "session", "entryID": "entry"})
		return string(data), err
	}
	source, err := memorySource(context.Background(), "conversation:session:entry")
	if err != nil {
		t.Fatal(err)
	}
	return source
}

func TestAIMemoryAutomaticAdmissionRejectsNonConversation(t *testing.T) {
	cfg := setupAIMemoryTest(t)
	fixture := setupFileOperationTest(t)
	Conf.AI.Store(cfg)
	content := "Use concise answers"
	conversation := memoryConversationFixture(t, &content)
	block, err := memorySource(context.Background(), fixture.sourceID)
	if err != nil {
		t.Fatal(err)
	}
	memoryComplete = func(context.Context, *conf.AI, string) (string, error) {
		t.Fatal("ineligible input reached model")
		return "", nil
	}
	for _, tc := range []struct {
		name    string
		q       apicontract.AIMemoryMaintainRequest
		sources []memo.Source
	}{
		{"notes", apicontract.AIMemoryMaintainRequest{SourceIDs: []string{block.ID}}, []memo.Source{block}},
		{"mixed", apicontract.AIMemoryMaintainRequest{SourceIDs: []string{block.ID, conversation.ID}}, []memo.Source{block, conversation}},
		{"manual-text", apicontract.AIMemoryMaintainRequest{Text: content}, nil},
		{"text-and-conversation", apicontract.AIMemoryMaintainRequest{Text: content, SourceIDs: []string{conversation.ID}}, []memo.Source{conversation}},
		{"empty", apicontract.AIMemoryMaintainRequest{}, nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			tc.q.OperationID = tc.name
			if _, err = StartAIMemory(context.Background(), tc.q, true); err == nil {
				t.Fatal("automatic request admitted")
			}
			ctx, cancel := context.WithCancel(context.Background())
			task := &memoryTask{cancel: cancel}
			runAIMemory(ctx, cfg, tc.q, tc.sources, true, task)
			if task.status.State != "failed" {
				t.Fatalf("internal automatic request admitted: %+v", task.status)
			}
		})
	}
	for _, evidence := range []string{`{"role":"assistant","content":"preference"}`, `{"role":"user","content":" "}`, `"preference"`} {
		conversation.Evidence = evidence
		if _, eligible := automaticMemoryConversation([]memo.Source{conversation}); eligible {
			t.Fatalf("non-user content admitted: %s", evidence)
		}
	}
}

func TestAIMemoryConversationAttributionGatesWrites(t *testing.T) {
	for _, tc := range []struct {
		name, content, answer, state string
	}{
		{"own-preference", "Use concise answers", "self", "completed"},
		{"own-blockquote", "These are my own words:\n> Use concise answers", "self", "completed"},
		{"supplied-article", "Here is an article by another author: I prefer concise answers", "external", "completed"},
		{"mixed-authorship", "I like tea. Summarize this article: I prefer coffee", "uncertain", "completed"},
		{"missing-verdict", "Use concise answers", "missing", "failed"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			cfg := setupAIMemoryTest(t)
			source := memoryConversationFixture(t, &tc.content)
			keywords, proposals, overviews := 0, 0, 0
			memoryComplete = func(_ context.Context, _ *conf.AI, prompt string) (string, error) {
				if strings.HasPrefix(prompt, memoryConversationKeywordPrompt) {
					keywords++
					if strings.Contains(prompt, `"role"`) || strings.Contains(prompt, `"sessionID"`) {
						t.Fatal("classification received metadata instead of user content")
					}
					if tc.answer == "missing" {
						return `{"intent":"remember","terms":[]}`, nil
					}
					return `{"intent":"remember","terms":[],"attribution":"` + tc.answer + `"}`, nil
				}
				if strings.HasPrefix(prompt, "Generate a concise") {
					overviews++
					return "Concise answers", nil
				}
				proposals++
				return `{"actions":[{"kind":"preference","subject":"user","scope":"workspace","content":"Use concise answers","state":"active","sourceIndexes":[0]}]}`, nil
			}
			ctx, cancel := context.WithCancel(context.Background())
			task := &memoryTask{cancel: cancel}
			runAIMemory(ctx, cfg, apicontract.AIMemoryMaintainRequest{SourceIDs: []string{source.ID}, OperationID: tc.name}, []memo.Source{source}, true, task)
			if task.status.State != tc.state || keywords != 1 {
				t.Fatalf("task: %+v keywords=%d", task.status, keywords)
			}
			if tc.answer == "self" {
				if proposals != 1 || overviews != 1 || len(task.status.Results) != 1 || !task.status.Results[0].Saved {
					t.Fatalf("self expression not saved: %+v calls=%d/%d", task.status, proposals, overviews)
				}
				entry, err := aiMemoryStore().Get(context.Background(), task.status.Results[0].ID)
				if err != nil || entry.Record.State != "active" {
					t.Fatalf("verbatim expression not activated: %+v %v", entry, err)
				}
			} else if proposals != 0 || overviews != 0 || len(task.status.Results) != 0 || task.status.OverviewPending {
				t.Fatalf("rejected attribution reached writing: %+v calls=%d/%d", task.status, proposals, overviews)
			}
		})
	}
}

func TestAIMemoryConversationClassificationRechecksGuards(t *testing.T) {
	for _, scenario := range []string{"source", "configuration", "readonly", "cancel"} {
		t.Run(scenario, func(t *testing.T) {
			cfg := setupAIMemoryTest(t)
			content := "Use concise answers"
			source := memoryConversationFixture(t, &content)
			ctx, cancel := context.WithCancel(context.Background())
			task := &memoryTask{cancel: cancel}
			calls := 0
			memoryComplete = func(context.Context, *conf.AI, string) (string, error) {
				calls++
				switch scenario {
				case "source":
					content = "Changed message"
				case "configuration":
					Conf.AI.Store(conf.NewAI())
				case "readonly":
					util.ReadOnly = true
				case "cancel":
					cancel()
				}
				return `{"intent":"remember","terms":[],"attribution":"self"}`, nil
			}
			runAIMemory(ctx, cfg, apicontract.AIMemoryMaintainRequest{SourceIDs: []string{source.ID}, OperationID: scenario}, []memo.Source{source}, true, task)
			if calls != 1 || (task.status.State != "failed" && task.status.State != "cancelled") || len(task.status.Results) != 0 {
				t.Fatalf("classification bypassed guard: %+v calls=%d", task.status, calls)
			}
		})
	}
}

func TestAIMemoryConversationMetadataCannotActivateFact(t *testing.T) {
	cfg := setupAIMemoryTest(t)
	content := "Use concise answers"
	source := memoryConversationFixture(t, &content)
	memoryComplete = func(_ context.Context, _ *conf.AI, prompt string) (string, error) {
		if strings.HasPrefix(prompt, memoryConversationKeywordPrompt) {
			return `{"intent":"remember","terms":[],"attribution":"self"}`, nil
		}
		if strings.HasPrefix(prompt, "Generate a concise") {
			return "No active facts", nil
		}
		return `{"actions":[{"kind":"fact","subject":"user","scope":"workspace","content":"session","state":"active","sourceIndexes":[0]}]}`, nil
	}
	ctx, cancel := context.WithCancel(context.Background())
	task := &memoryTask{cancel: cancel}
	runAIMemory(ctx, cfg, apicontract.AIMemoryMaintainRequest{SourceIDs: []string{source.ID}, OperationID: "metadata"}, []memo.Source{source}, true, task)
	if task.status.State != "completed" || len(task.status.Results) != 1 || !task.status.Results[0].Saved {
		t.Fatalf("task: %+v", task.status)
	}
	entry, err := aiMemoryStore().Get(context.Background(), task.status.Results[0].ID)
	if err != nil || entry.Record.State != "candidate" {
		t.Fatalf("metadata activated as user's words: %+v %v", entry, err)
	}
}
