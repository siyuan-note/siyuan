// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/memo"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func memoryForgetFixture(t *testing.T, text, scope string) (*conf.AI, memo.Entry, apicontract.AIMemoryMaintainRequest, []memo.Source, memoryAction) {
	t.Helper()
	cfg := setupAIMemoryTest(t)
	entry, err := aiMemoryStore().Save(context.Background(), memo.Record{Schema: 1, Kind: "preference", Subject: "user", Scope: scope, State: "active", Content: "Prefers coffee", Sources: []memo.Source{{Kind: "user", ID: "original", Revision: "one", Evidence: "Prefers coffee"}}}, "missing", "original")
	if err != nil {
		t.Fatal(err)
	}
	q := apicontract.AIMemoryMaintainRequest{Text: text, OperationID: "manual-forget"}
	sources := []memo.Source{{Kind: "user", ID: q.OperationID, Revision: memoryHash([]byte(text)), Evidence: text}}
	a := memoryAction{Operation: "forget", Instruction: strings.TrimSpace(text), ID: entry.Record.ID, Kind: entry.Record.Kind, Subject: entry.Record.Subject, Scope: entry.Record.Scope, Content: entry.Record.Content}
	return cfg, entry, q, sources, a
}

func TestAIMemoryForgetMultilingualAndRetry(t *testing.T) {
	for _, text := range []string{"Forget my coffee preference", "忘记我喜欢咖啡这件事", "私のコーヒーの好みを忘れて", "Olvida mi preferencia por el café", "disabled", "superseded"} {
		t.Run(text, func(t *testing.T) {
			cfg, entry, q, sources, action := memoryForgetFixture(t, text, "other-scope")
			if text == "disabled" || text == "superseded" {
				r := entry.Record
				r.State = text
				updated, err := aiMemoryStore().Save(context.Background(), r, entry.Revision, "state-change")
				if err != nil {
					t.Fatal(err)
				}
				entry = updated
				q.Text = "Forget my coffee preference"
				sources[0].Evidence = q.Text
				sources[0].Revision = memoryHash([]byte(q.Text))
				action.Instruction = q.Text
			}
			proposal, _ := json.Marshal(memoryProposal{Actions: []memoryAction{action}})
			calls := 0
			memoryComplete = func(_ context.Context, _ *conf.AI, prompt string) (string, error) {
				calls++
				if strings.Contains(prompt, `"terms"`) {
					return `{"terms":["coffee"]}`, nil
				}
				if strings.HasPrefix(prompt, "Verify a memory forget request") {
					if !strings.Contains(prompt, q.Text) || !strings.Contains(prompt, "Candidates") {
						t.Fatal("verifier missing full context")
					}
					return `{"authorizedIDs":["` + entry.Record.ID + `"]}`, nil
				}
				if strings.HasPrefix(prompt, "Generate a concise") {
					return "", nil
				}
				return string(proposal), nil
			}
			task := &memoryTask{}
			run := func() {
				ctx, cancel := context.WithCancel(context.Background())
				task.cancel = cancel
				task.status = apicontract.AIMemoryTaskData{}
				runAIMemory(ctx, cfg, q, sources, false, task)
			}
			run()
			if len(task.status.Results) != 1 || !task.status.Results[0].Saved {
				t.Fatalf("forget failed: %+v", task.status)
			}
			if result, err := aiMemoryStore().Search(context.Background(), memo.SearchOptions{}); err != nil || len(result.Entries) != 0 {
				t.Fatalf("forgotten remains: %+v %v", result, err)
			}
			previous := calls
			run()
			if len(task.status.Results) != 1 || !task.status.Results[0].Saved || calls != previous {
				t.Fatalf("retry reran model/deletion: %+v calls %d/%d", task.status, calls, previous)
			}
		})
	}
}

func TestAIMemoryForgetAuthorizationBoundaries(t *testing.T) {
	cases := []string{"automatic", "source-ids", "quoted", "single-quoted", "guillemets", "blockquote", "multiline", "unknown-id", "modified-content", "duplicate", "mixed", "negated", "reported", "all", "ambiguous", "bad-verdict", "config-race"}
	for _, name := range cases {
		t.Run(name, func(t *testing.T) {
			cfg, entry, q, sources, a := memoryForgetFixture(t, "Forget my coffee preference", "workspace")
			automatic := false
			actions := []memoryAction{a}
			deny := false
			switch name {
			case "automatic":
				automatic = true
			case "source-ids":
				q.SourceIDs = []string{"source"}
			case "quoted":
				q.Text = `"Forget my coffee preference"`
			case "single-quoted":
				q.Text = "'Forget my coffee preference'"
			case "guillemets":
				q.Text = "«Forget my coffee preference»"
			case "blockquote":
				q.Text = "> Forget my coffee preference"
			case "multiline":
				q.Text = "Note:\nForget my coffee preference"
			case "unknown-id":
				actions[0].ID = "20261030000000-abcdefg"
			case "modified-content":
				actions[0].Content = "unrelated"
			case "duplicate":
				actions = append(actions, a)
			case "mixed":
				actions = append(actions, memoryAction{Content: "New fact", Operation: "save"})
			case "negated":
				q.Text = "Do not forget my coffee preference"
				deny = true
			case "reported":
				q.Text = "My colleague said to forget my coffee preference"
				deny = true
			case "all":
				q.Text = "Forget all my memories"
				deny = true
			case "ambiguous":
				q.Text = "Forget that"
				deny = true
			}
			sources[0].Evidence = q.Text
			sources[0].Revision = memoryHash([]byte(q.Text))
			actions[0].Instruction = strings.TrimSpace(q.Text)
			calls := 0
			memoryComplete = func(context.Context, *conf.AI, string) (string, error) {
				calls++
				if name == "bad-verdict" {
					return `{"authorizedIDs":["` + entry.Record.ID + `"],"extra":true}`, nil
				}
				if deny {
					return `{"authorizedIDs":[]}`, nil
				}
				return `{"authorizedIDs":["` + entry.Record.ID + `"]}`, nil
			}
			check := func() error {
				if name == "config-race" && calls > 0 {
					return errors.New("configuration changed")
				}
				return nil
			}
			err := authorizeMemoryForgetting(context.Background(), cfg, q, sources, automatic, memoryProposal{Actions: actions}, map[string]memo.Entry{entry.Record.ID: entry}, check)
			if err == nil {
				t.Fatal("unsafe forget authorized")
			}
			if result, err := aiMemoryStore().Search(context.Background(), memo.SearchOptions{}); err != nil || len(result.Entries) != 1 {
				t.Fatal("authorization changed records")
			}
		})
	}
}

func TestAIMemoryForgetChangedRevisionAndCleanupPending(t *testing.T) {
	for _, mode := range []string{"revision", "cleanup"} {
		t.Run(mode, func(t *testing.T) {
			cfg, entry, q, sources, a := memoryForgetFixture(t, "Forget my coffee preference", "workspace")
			key := "fixed-action"
			task := &memoryTask{batch: &memoryBatch{proposal: memoryProposal{Actions: []memoryAction{a}}, scopes: []string{"workspace"}, revisions: map[string]memo.Entry{entry.Record.ID: entry}, keys: []string{key}, saved: map[string]apicontract.AIMemoryTaskResult{}}}
			if mode == "revision" {
				r := entry.Record
				r.Content = "Changed coffee fact"
				if _, err := aiMemoryStore().Save(context.Background(), r, entry.Revision, "changed"); err != nil {
					t.Fatal(err)
				}
			} else {
				if _, err := aiMemoryStore().Forget(context.Background(), entry.Record.ID, entry.Revision, "prior"); err != nil {
					t.Fatal(err)
				}
				path := filepath.Join(util.DataDir, "storage/ai/memos/records", entry.Record.ID+".md")
				if err := os.Mkdir(path, 0700); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(filepath.Join(path, "occupied"), []byte("preserve"), 0600); err != nil {
					t.Fatal(err)
				}
			}
			memoryComplete = func(context.Context, *conf.AI, string) (string, error) { return "", nil }
			ctx, cancel := context.WithCancel(context.Background())
			task.cancel = cancel
			runAIMemory(ctx, cfg, q, sources, false, task)
			if len(task.status.Results) != 1 {
				t.Fatalf("results %+v", task.status)
			}
			if task.status.Results[0].Saved != (mode == "cleanup") {
				t.Fatalf("wrong persisted result %+v", task.status)
			}
		})
	}
}

func TestAIMemoryForgetPartialRetryDoesNotRepeatAppliedAction(t *testing.T) {
	cfg, first, q, sources, a := memoryForgetFixture(t, "Forget coffee and tea preferences", "workspace")
	r := first.Record
	r.ID = ""
	r.Content = "Prefers tea"
	second, err := aiMemoryStore().Save(context.Background(), r, "missing", "second")
	if err != nil {
		t.Fatal(err)
	}
	b := a
	b.ID = second.Record.ID
	b.Content = second.Record.Content
	task := &memoryTask{batch: &memoryBatch{proposal: memoryProposal{Actions: []memoryAction{a, b}}, scopes: []string{"workspace"}, revisions: map[string]memo.Entry{first.Record.ID: first, second.Record.ID: second}, keys: []string{"first", "second"}, saved: map[string]apicontract.AIMemoryTaskResult{}}}
	changed := second.Record
	changed.Content = "Changed tea preference"
	if _, err = aiMemoryStore().Save(context.Background(), changed, second.Revision, "change-second"); err != nil {
		t.Fatal(err)
	}
	memoryComplete = func(_ context.Context, _ *conf.AI, prompt string) (string, error) {
		if !strings.HasPrefix(prompt, "Generate a concise") {
			t.Fatal("prepared retry must not repeat proposal or authorization")
		}
		return "Tea preference", nil
	}
	for i := 0; i < 2; i++ {
		ctx, cancel := context.WithCancel(context.Background())
		task.cancel = cancel
		task.status = apicontract.AIMemoryTaskData{}
		runAIMemory(ctx, cfg, q, sources, false, task)
		if len(task.status.Results) != 2 || !task.status.Results[0].Saved || task.status.Results[1].Saved {
			t.Fatalf("partial retry %+v", task.status)
		}
	}
}

func TestAIMemoryForgetVerifierCannotAuthorizeChangedSnapshot(t *testing.T) {
	cfg, entry, q, sources, a := memoryForgetFixture(t, "Forget my coffee preference", "workspace")
	memoryComplete = func(context.Context, *conf.AI, string) (string, error) {
		if _, err := aiMemoryStore().Forget(context.Background(), entry.Record.ID, entry.Revision, "concurrent"); err != nil {
			t.Fatal(err)
		}
		return `{"authorizedIDs":["` + entry.Record.ID + `"]}`, nil
	}
	if err := authorizeMemoryForgetting(context.Background(), cfg, q, sources, false, memoryProposal{Actions: []memoryAction{a}}, map[string]memo.Entry{entry.Record.ID: entry}, func() error { return nil }); err == nil {
		t.Fatal("changed snapshot authorized")
	}
}

func TestAIMemorySavingCannotChangeInactiveForgetTargets(t *testing.T) {
	for _, state := range []string{"disabled", "superseded"} {
		t.Run(state, func(t *testing.T) {
			cfg, entry, q, sources, a := memoryForgetFixture(t, "Update coffee preference", "workspace")
			entry.Record.State = state
			a.Operation = "save"
			if err := authorizeMemoryForgetting(context.Background(), cfg, q, sources, false, memoryProposal{Actions: []memoryAction{a}}, map[string]memo.Entry{entry.Record.ID: entry}, func() error { return nil }); err == nil {
				t.Fatal("save gained inactive target permission")
			}
		})
	}
}
