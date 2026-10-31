// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/memo"
)

func TestAIMemoryProposalUsesExplicitWritableScopes(t *testing.T) {
	for _, scope := range []string{"workspace", "global", "user", "workspace or source block ID", "", "partial"} {
		t.Run(scope, func(t *testing.T) {
			cfg := setupAIMemoryTest(t)
			ctx := context.Background()
			content := "List items do not end with periods"
			foreign, err := aiMemoryStore().Save(ctx, memo.Record{Kind: "preference", Subject: "user", Scope: "20261031120000-abc1234", State: "active", Content: content, Sources: []memo.Source{{Kind: "user", ID: "foreign", Revision: "one", Evidence: content}}}, "missing", "foreign")
			if err != nil {
				t.Fatal(err)
			}
			overviews, proposals := 0, 0
			memoryComplete = func(_ context.Context, _ *conf.AI, prompt string) (string, error) {
				if strings.Contains(prompt, `"terms"`) {
					return `{"intent":"remember","terms":["List"]}`, nil
				}
				if strings.HasPrefix(prompt, "Generate a concise") {
					overviews++
					return content, nil
				}
				proposals++
				var input struct {
					AllowedScopes []string
					Candidates    []memo.Entry
				}
				if err := json.Unmarshal([]byte(prompt[strings.LastIndex(prompt, "\n")+1:]), &input); err != nil {
					t.Fatal(err)
				}
				if len(input.AllowedScopes) != 1 || input.AllowedScopes[0] != "workspace" || len(input.Candidates) != 0 {
					t.Fatalf("proposal received unauthorized save context: %+v", input)
				}
				var example memoryProposal
				start := strings.Index(prompt, `{"actions":`)
				if start < 0 || json.NewDecoder(strings.NewReader(prompt[start:])).Decode(&example) != nil || len(example.Actions) != 1 {
					t.Fatal("proposal example is not a valid JSON object")
				}
				if a := example.Actions[0]; a.Scope != "workspace" || a.Kind != "preference" || a.State != "candidate" || a.ID != "" {
					t.Fatalf("example contains enum placeholders: %+v", a)
				}
				action := memoryAction{Kind: "preference", Subject: "user", Scope: scope, Content: content, State: "active", SourceIndexes: []int{0}}
				actions := []memoryAction{action}
				if scope == "partial" {
					actions[0].Scope = "workspace"
					action.Scope = "global"
					actions = append(actions, action)
				}
				data, _ := json.Marshal(memoryProposal{Actions: actions})
				return string(data), nil
			}
			runCtx, cancel := context.WithCancel(ctx)
			task := &memoryTask{cancel: cancel}
			runAIMemory(runCtx, cfg, apicontract.AIMemoryMaintainRequest{Text: content, OperationID: "scope-test"}, []memo.Source{{Kind: "user", ID: "scope-test", Revision: "one", Evidence: content}}, false, task)
			wantSaved := scope == "workspace" || scope == "partial"
			wantState, wantError := "failed", "proposal scope is not permitted"
			if scope == "workspace" {
				wantState, wantError = "completed", ""
			} else if scope == "partial" {
				wantError = "some memory proposals were not saved; saved memories remain available"
			}
			if task.status.State != wantState || task.status.Error != wantError || proposals != 1 || (overviews != 0) != wantSaved {
				t.Fatalf("incorrect save result or unnecessary overview call: %+v proposals=%d overviews=%d", task.status, proposals, overviews)
			}
			workspace, err := aiMemoryStore().Search(ctx, memo.SearchOptions{Scopes: []string{"workspace"}})
			if err != nil || (len(workspace.Entries) == 1) != wantSaved {
				t.Fatalf("scope rejection changed workspace records: %+v %v", workspace, err)
			}
			current, err := aiMemoryStore().Get(ctx, foreign.Record.ID)
			if err != nil || current.Revision != foreign.Revision {
				t.Fatal("save modified a record outside the writable scope", err)
			}
		})
	}
}

func TestAIMemoryInvalidScopeRetryRegeneratesProposal(t *testing.T) {
	setupAIMemoryTest(t)
	content := "List items do not end with periods"
	proposals, keywords := 0, 0
	memoryComplete = func(_ context.Context, _ *conf.AI, prompt string) (string, error) {
		if strings.Contains(prompt, `"terms"`) {
			keywords++
			return `{"intent":"remember","terms":[]}`, nil
		}
		if strings.HasPrefix(prompt, "Generate a concise") {
			return content, nil
		}
		proposals++
		scope := "global"
		if proposals == 2 {
			scope = "workspace"
		}
		return fmt.Sprintf(`{"actions":[{"kind":"preference","subject":"user","scope":%q,"content":%q,"state":"active","sourceIndexes":[0]}]}`, scope, content), nil
	}
	q := apicontract.AIMemoryMaintainRequest{Text: content, OperationID: "scope-regenerate"}
	first := waitMemoryOperation(t, startMemoryOperation(t, q, false))
	if first.State != "failed" || first.Error != "proposal scope is not permitted" || proposals != 1 || keywords != 1 {
		t.Fatalf("invalid scope was retried automatically or concealed: %+v proposals=%d keywords=%d", first, proposals, keywords)
	}
	second := waitMemoryOperation(t, startMemoryOperation(t, q, false))
	if second.State != "completed" || len(second.Results) != 1 || !second.Results[0].Saved || proposals != 2 || keywords != 2 {
		t.Fatalf("explicit retry reused a rejected proposal: %+v proposals=%d keywords=%d", second, proposals, keywords)
	}
	result, err := aiMemoryStore().Search(context.Background(), memo.SearchOptions{})
	if err != nil || len(result.Entries) != 1 {
		t.Fatalf("explicit scope retry duplicated memory: %+v %v", result, err)
	}
}

func TestAIMemoryProposalValidityRequiresExplicitEvidence(t *testing.T) {
	from, until := "2030-01-01T00:00:00Z", "2031-01-01T00:00:00Z"
	sources := []memo.Source{{Evidence: from + " through " + until}}
	for _, test := range []struct {
		from, until string
		valid       bool
	}{
		{from, until, true}, {"", "", true}, {until, from, false}, {from, from, false}, {"tomorrow", "", false}, {"2029-01-01T00:00:00Z", "", false},
	} {
		err := memoryActionValidity(memoryAction{ValidFrom: test.from, ValidUntil: test.until, SourceIndexes: []int{0}}, sources)
		if (err == nil) != test.valid {
			t.Fatalf("interval %+v: %v", test, err)
		}
	}
}

func TestAIMemoryReplacementProposalChecksTarget(t *testing.T) {
	for _, scenario := range []string{"candidate", "changed-target", "different-scope"} {
		t.Run(scenario, func(t *testing.T) {
			cfg := setupAIMemoryTest(t)
			ctx := context.Background()
			old, err := aiMemoryStore().Save(ctx, memo.Record{Schema: 1, Kind: "fact", Subject: "project", Scope: "workspace", State: "active", Content: "Project status pending", Sources: []memo.Source{{Kind: "user", ID: "prior", Revision: "one"}}}, "missing", "prior")
			if err != nil {
				t.Fatal(err)
			}
			memoryComplete = func(_ context.Context, _ *conf.AI, prompt string) (string, error) {
				if strings.Contains(prompt, `"terms"`) {
					return `{"intent":"remember","terms":["Project status"]}`, nil
				}
				if strings.HasPrefix(prompt, "Generate a concise") {
					return "Project status pending", nil
				}
				if scenario == "changed-target" {
					changed := old.Record
					changed.Content = "Project status revised by user"
					if _, e := aiMemoryStore().Save(ctx, changed, old.Revision, "concurrent"); e != nil {
						t.Fatal(e)
					}
				}
				scope := "workspace"
				if scenario == "different-scope" {
					scope = "other"
				}
				return fmt.Sprintf(`{"actions":[{"kind":"fact","subject":"project","scope":%q,"content":"Project status completed","state":"active","sourceIndexes":[0],"supersedes":%q}]}`, scope, old.Record.ID), nil
			}
			runCtx, cancel := context.WithCancel(ctx)
			task := &memoryTask{cancel: cancel}
			runAIMemory(runCtx, cfg, apicontract.AIMemoryMaintainRequest{Text: "Project status completed", OperationID: "replacement"}, []memo.Source{{Kind: "user", ID: "replacement", Revision: "two", Evidence: "Project status completed"}}, false, task)
			if len(task.status.Results) != 1 || task.status.Results[0].Saved != (scenario == "candidate") {
				t.Fatalf("replacement result: %+v", task.status)
			}
			if scenario == "candidate" {
				created, e := aiMemoryStore().Get(ctx, task.status.Results[0].ID)
				if e != nil || created.Record.State != "candidate" || created.Record.Supersedes != old.Record.ID {
					t.Fatalf("replacement not staged: %+v %v", created, e)
				}
				prior, e := aiMemoryStore().Get(ctx, old.Record.ID)
				if e != nil || prior.Revision != old.Revision {
					t.Fatal("proposal deactivated historical fact", e)
				}
				if _, e = GetAIMemoryForModel(ctx, created.Record.ID); e == nil {
					t.Fatal("replacement candidate became usable")
				}
			}
		})
	}
}
