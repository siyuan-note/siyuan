// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/memo"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAIMemoryCandidateReconfirmationRequiresCurrentVerbatimEvidence(t *testing.T) {
	for _, tc := range []struct {
		name, state, evidence string
		replacement, omitID   bool
		want                  string
	}{
		{"confirmed", "candidate", "User prefers coffee", false, false, "active"},
		{"deduplicated", "candidate", "User prefers coffee", false, true, "active"},
		{"unconfirmed", "candidate", "The user might prefer coffee", false, false, "candidate"},
		{"review", "review", "User prefers coffee", false, false, "review"},
		{"replacement", "candidate", "User prefers coffee", true, false, "candidate"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			cfg := setupAIMemoryTest(t)
			ctx := context.Background()
			content := "User prefers coffee"
			r := memo.Record{Kind: "preference", Subject: "user", Scope: "workspace", State: tc.state, Content: content, Sources: []memo.Source{{Kind: "user", ID: "original", Revision: "one", Evidence: content}}}
			if tc.replacement {
				r.Supersedes = "20261031000000-abcdefg"
			}
			entry, err := aiMemoryStore().Save(ctx, r, "missing", "original")
			if err != nil {
				t.Fatal(err)
			}
			memoryComplete = func(_ context.Context, _ *conf.AI, prompt string) (string, error) {
				if strings.Contains(prompt, `"terms"`) {
					return `{"intent":"remember","terms":["coffee"]}`, nil
				}
				if strings.HasPrefix(prompt, "Generate a concise") {
					return content, nil
				}
				id := entry.Record.ID
				if tc.omitID {
					id = ""
				}
				return fmt.Sprintf(`{"actions":[{"id":%q,"kind":"preference","subject":"user","scope":"workspace","content":%q,"state":"active","sourceIndexes":[0]}]}`, id, content), nil
			}
			runCtx, cancel := context.WithCancel(ctx)
			task := &memoryTask{cancel: cancel}
			runAIMemory(runCtx, cfg, apicontract.AIMemoryMaintainRequest{Text: tc.evidence, OperationID: "confirmation"}, []memo.Source{{Kind: "user", ID: "confirmation", Revision: "two", Evidence: tc.evidence}}, false, task)
			current, err := aiMemoryStore().Get(ctx, entry.Record.ID)
			if err != nil || current.Record.State != tc.want || len(task.status.Results) != 1 || !task.status.Results[0].Saved || task.status.Results[0].ID != entry.Record.ID {
				t.Fatalf("candidate confirmation: %+v %+v %v", current, task.status, err)
			}
			all, err := aiMemoryStore().Search(ctx, memo.SearchOptions{States: []string{"candidate", "active", "review"}, Limit: 100})
			if err != nil || len(all.Entries) != 1 {
				t.Fatalf("equivalent candidate duplicated: %+v %v", all, err)
			}
		})
	}
}

func TestAIMemoryCandidateCleanupRespectsEnableAndWritePermissions(t *testing.T) {
	for _, mode := range []string{"enabled", "disabled", "readonly"} {
		t.Run(mode, func(t *testing.T) {
			cfg := setupAIMemoryTest(t)
			ctx := context.Background()
			store := aiMemoryStore()
			auto := memo.Record{Kind: "preference", Subject: "user", Scope: "workspace", State: "candidate", Content: "Coffee", Sources: []memo.Source{{Kind: "block", ID: "20261031000000-abcdefg", Revision: "one", Evidence: "Coffee"}}}
			entry, err := store.Save(ctx, auto, "missing", "auto")
			if err != nil {
				t.Fatal(err)
			}
			manual := auto
			manual.Sources = []memo.Source{{Kind: "user", ID: "manual", Revision: "one", Evidence: "Coffee"}}
			protected, err := store.Save(ctx, manual, "missing", "manual")
			if err != nil {
				t.Fatal(err)
			}
			cfg.Memory.Enabled = mode != "disabled"
			previous := util.ReadOnly
			util.ReadOnly = mode == "readonly"
			t.Cleanup(func() { util.ReadOnly = previous })
			calls := 0
			memoryComplete = func(context.Context, *conf.AI, string) (string, error) { calls++; return "", nil }
			if err = maintainAIMemoryCandidates(ctx, time.Now().Add(31*24*time.Hour)); err != nil {
				t.Fatal(err)
			}
			_, readErr := store.Get(ctx, entry.Record.ID)
			if (readErr != nil) != (mode == "enabled") || calls != 0 {
				t.Fatalf("cleanup permission mismatch: %v, model calls=%d", readErr, calls)
			}
			if _, err = store.Get(ctx, protected.Record.ID); err != nil {
				t.Fatalf("manual submission removed: %v", err)
			}
		})
	}
}
