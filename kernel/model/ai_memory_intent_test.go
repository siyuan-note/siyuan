// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/conf"
)

func TestMemoryManualIntentStrictSchemaAndDirection(t *testing.T) {
	for _, raw := range []string{`{"terms":[]}`, `{"intent":"ambiguous","terms":[]}`, `{"intent":"forget","terms":null}`, `{"intent":"forget","terms":[]} {}`, `{"intent":"forget","terms":[],"override":true}`} {
		if _, err := decodeMemoryKeywords(raw, true); err == nil {
			t.Fatalf("unsafe intent accepted %s", raw)
		}
	}
	for _, operation := range []string{"", "save"} {
		if err := validateMemoryIntent("forget", memoryProposal{Actions: []memoryAction{{Operation: operation}}}); err == nil {
			t.Fatal("forget became save")
		}
	}
	if err := validateMemoryIntent("forget", memoryProposal{}); err == nil {
		t.Fatal("empty forgetting succeeded")
	}
	if err := validateMemoryIntent("remember", memoryProposal{Actions: []memoryAction{{Operation: "forget"}}}); err == nil {
		t.Fatal("remember became forget")
	}
}

func TestAIMemoryForgetIntentCannotBecomeOppositeFactOrEmptySuccess(t *testing.T) {
	for _, text := range []string{"删除中西文空格规则", "Forget the spacing rule", "Supprime la règle d’espacement", "空白のルールを削除して"} {
		for _, mode := range []string{"missing-operation", "save", "empty", "ambiguous"} {
			t.Run(text+mode, func(t *testing.T) {
				cfg, entry, q, sources, a := memoryForgetFixture(t, text, "workspace")
				a.Operation = ""
				a.Content = "Do not insert spaces"
				if mode == "save" {
					a.Operation = "save"
				}
				proposal := memoryProposal{Actions: []memoryAction{a}}
				if mode == "empty" {
					proposal.Actions = []memoryAction{}
				}
				data, _ := json.Marshal(proposal)
				memoryComplete = func(_ context.Context, _ *conf.AI, prompt string) (string, error) {
					if strings.Contains(prompt, `"terms"`) {
						if mode == "ambiguous" {
							return `{"intent":"ambiguous","terms":[]}`, nil
						}
						return `{"intent":"forget","terms":["unmatched-alias"]}`, nil
					}
					if strings.HasPrefix(prompt, "Verify") || strings.HasPrefix(prompt, "Generate") {
						t.Fatal("invalid proposal reached verification/write")
					}
					return string(data), nil
				}
				ctx, cancel := context.WithCancel(context.Background())
				task := &memoryTask{cancel: cancel}
				runAIMemory(ctx, cfg, q, sources, false, task)
				if task.status.State != "failed" || task.status.Error == "" {
					t.Fatalf("invalid deletion silently succeeded: %+v", task.status)
				}
				current, err := aiMemoryStore().Get(context.Background(), entry.Record.ID)
				if err != nil || current.Record.Content != entry.Record.Content || current.Revision != entry.Revision {
					t.Fatalf("deletion became altered fact: %+v %v", current, err)
				}
			})
		}
	}
}

func TestAIMemoryForgetRecallRemovesOverviewRatherThanNegating(t *testing.T) {
	cfg, entry, q, sources, _ := memoryForgetFixture(t, "删除中西文空格规则", "workspace")
	r := entry.Record
	r.Content = "中西文之间加空格"
	entry, err := aiMemoryStore().Save(context.Background(), r, entry.Revision, "spacing")
	if err != nil {
		t.Fatal(err)
	}
	snapshot, err := aiMemoryStore().Snapshot(context.Background(), []string{"workspace"})
	if err != nil {
		t.Fatal(err)
	}
	if err = aiMemoryStore().SaveProjection(context.Background(), "MEMORY.md", r.Content, snapshot.Fingerprint, []string{"workspace"}); err != nil {
		t.Fatal(err)
	}
	proposal := `{"targetIDs":["` + entry.Record.ID + `"]}`
	calls := 0
	memoryComplete = func(_ context.Context, _ *conf.AI, prompt string) (string, error) {
		calls++
		if strings.Contains(prompt, `"terms"`) {
			return `{"intent":"forget","terms":["删除中西文空格规则"]}`, nil
		}
		if strings.HasPrefix(prompt, "Verify a memory forget request") {
			return `{"authorizedIDs":["` + entry.Record.ID + `"]}`, nil
		}
		if strings.HasPrefix(prompt, "Generate a concise") {
			t.Fatal("empty overview must not invoke model")
		}
		if !strings.Contains(prompt, "中西文之间加空格") {
			t.Fatal("bounded recall did not find original rule")
		}
		return string(proposal), nil
	}
	ctx, cancel := context.WithCancel(context.Background())
	task := &memoryTask{cancel: cancel}
	runAIMemory(ctx, cfg, q, sources, false, task)
	if task.status.State != "completed" || len(task.status.Results) != 1 || !task.status.Results[0].Saved {
		t.Fatalf("forget failed %+v", task.status)
	}
	if calls != 3 {
		t.Fatalf("extra classification request: %d", calls)
	}
	if _, err = aiMemoryStore().Get(context.Background(), entry.Record.ID); err == nil {
		t.Fatal("record not withdrawn")
	}
	view, err := ReadAIMemoryOverview(context.Background())
	if err != nil || view.Stale || view.Memory != "" || view.Count != 0 {
		t.Fatalf("stale rule survived overview: %+v %v", view, err)
	}
}

func TestAIMemoryForgetMissingTargetFailsBeforeProposal(t *testing.T) {
	cfg, entry, q, sources, _ := memoryForgetFixture(t, "Forget my coffee preference", "workspace")
	if _, err := aiMemoryStore().Forget(context.Background(), entry.Record.ID, entry.Revision, "already-forgotten"); err != nil {
		t.Fatal(err)
	}
	calls := 0
	memoryComplete = func(_ context.Context, _ *conf.AI, prompt string) (string, error) {
		calls++
		if !strings.Contains(prompt, `"terms"`) {
			t.Fatal("missing target reached proposal")
		}
		return `{"intent":"forget","terms":["coffee"]}`, nil
	}
	ctx, cancel := context.WithCancel(context.Background())
	task := &memoryTask{cancel: cancel}
	runAIMemory(ctx, cfg, q, sources, false, task)
	if task.status.State != "failed" || task.status.Error != "memory forget request found no matching target" || calls != 1 {
		t.Fatalf("missing target silently succeeded: %+v calls=%d", task.status, calls)
	}
}
