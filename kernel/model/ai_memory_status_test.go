// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/memo"
)

func TestAIMemoryTaskSavedStatus(t *testing.T) {
	for _, scenario := range []struct {
		name, state string
		saved       int
		pending     bool
	}{
		{"keywords-fail", "failed", 0, false},
		{"proposal-fail", "failed", 0, false},
		{"all-rejected", "failed", 0, false},
		{"unknown-target", "failed", 0, false},
		{"no-changes", "completed", 0, false},
		{"saved", "completed", 1, false},
		{"candidate", "completed", 1, false},
		{"partial", "failed", 1, false},
		{"overview-fail", "failed", 1, true},
		{"update-overview-fail", "failed", 1, true},
		{"partial-overview-fail", "failed", 1, true},
		{"cancel-after-save", "cancelled", 1, true},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			cfg := setupAIMemoryTest(t)
			ctx, cancel := context.WithCancel(context.Background())
			task := &memoryTask{cancel: cancel}
			updatedID := ""
			if scenario.name == "update-overview-fail" {
				entry, err := aiMemoryStore().Save(ctx, memo.Record{Schema: 1, Kind: "fact", Subject: "user", Scope: "workspace", State: "active", Content: "User prefers concise answers", Sources: []memo.Source{{Kind: "user", ID: "prior", Revision: "one"}}}, "missing", "prior")
				if err != nil {
					t.Fatal(err)
				}
				updatedID = entry.Record.ID
			}
			memoryComplete = func(_ context.Context, _ *conf.AI, prompt string) (string, error) {
				if strings.Contains(prompt, `"terms"`) {
					if scenario.name == "keywords-fail" {
						return "", errors.New("keyword failure")
					}
					return `{"intent":"remember","terms":[]}`, nil
				}
				if strings.HasPrefix(prompt, "Generate a concise") {
					if scenario.name == "cancel-after-save" {
						cancel()
						return "", ctx.Err()
					}
					if strings.Contains(scenario.name, "overview-fail") {
						return "", errors.New("overview failure")
					}
					return "summary", nil
				}
				if scenario.name == "proposal-fail" {
					return "", errors.New("proposal failure")
				}
				if scenario.name == "no-changes" {
					return `{"actions":[]}`, nil
				}
				if scenario.name == "all-rejected" {
					return `{"actions":[{}]}`, nil
				}
				if scenario.name == "unknown-target" {
					return `{"actions":[{"id":"PRIVATE_MODEL_OUTPUT","kind":"fact","subject":"user","scope":"workspace","content":"User prefers concise answers","state":"active","sourceIndexes":[0]}]}`, nil
				}
				action := `{"kind":"fact","subject":"user","scope":"workspace","content":"User prefers concise answers","state":"active","sourceIndexes":[0]}`
				if updatedID != "" {
					action = strings.Replace(action, `{`, fmt.Sprintf(`{"id":%q,`, updatedID), 1)
				}
				if scenario.name == "candidate" {
					action = strings.Replace(action, `"active"`, `"candidate"`, 1)
				}
				if strings.HasPrefix(scenario.name, "partial") {
					action += `,{}`
				}
				return `{"actions":[` + action + `]}`, nil
			}
			runAIMemory(ctx, cfg, apicontract.AIMemoryMaintainRequest{Text: "User prefers concise answers", OperationID: "status"}, []memo.Source{{Kind: "user", ID: "status", Revision: "one", Evidence: "User prefers concise answers"}}, false, task)
			saved := 0
			for _, result := range task.status.Results {
				if result.Saved {
					saved++
					entry, err := aiMemoryStore().Get(context.Background(), result.ID)
					if err != nil {
						t.Fatal("saved result was not persisted", err)
					}
					if scenario.name == "candidate" && entry.Record.State != "candidate" {
						t.Fatal("saved candidate was activated")
					}
					if updatedID != "" && result.ID != updatedID {
						t.Fatal("update was not recorded against the existing record")
					}
				}
			}
			if task.status.State != scenario.state || saved != scenario.saved || task.status.OverviewPending != scenario.pending {
				t.Fatalf("unexpected outcome: %+v", task.status)
			}
			if scenario.name == "all-rejected" && task.status.Error != "proposal has no grounded evidence" {
				t.Fatalf("all-rejected task lost its failure reason: %+v", task.status)
			}
			data, err := json.Marshal(task.status)
			if err != nil || strings.Contains(string(data), "PRIVATE_MODEL_OUTPUT") {
				t.Fatal("unverified model output reached task metadata")
			}
			if scenario.name == "unknown-target" {
				records, searchErr := aiMemoryStore().Search(context.Background(), memo.SearchOptions{Limit: 10})
				if searchErr != nil || len(records.Entries) != 0 {
					t.Fatal("unverified target produced a stored record", searchErr)
				}
			}
		})
	}
}
