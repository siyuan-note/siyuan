package model

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/memo"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func setupAIMemoryTest(t *testing.T) *conf.AI {
	t.Helper()
	previousConf, previousDir, previousReadOnly, previousComplete := Conf, util.DataDir, util.ReadOnly, memoryComplete
	util.DataDir, util.ReadOnly = t.TempDir(), false
	Conf = NewAppConf()
	Conf.Sync.Store(conf.NewSync())
	cfg := conf.NewAI()
	cfg.Memory.Enabled = true
	cfg.Memory.ModelID = "memory-model"
	cfg.Providers = []*conf.Provider{{Enabled: true, Protocol: util.OpenAIProtocolResponses, Models: []*conf.Model{{ID: "memory-model", Name: "gpt-5", Enabled: true}}}}
	Conf.AI.Store(cfg)
	t.Cleanup(func() {
		memoryStoreMu.Lock()
		delete(memoryStores, util.DataDir)
		memoryStoreMu.Unlock()
		Conf, util.DataDir, util.ReadOnly, memoryComplete = previousConf, previousDir, previousReadOnly, previousComplete
	})
	return cfg
}

func TestAIMemoryModelReadRequiresActiveValidity(t *testing.T) {
	cfg := setupAIMemoryTest(t)
	ctx := context.Background()
	for _, state := range []string{"candidate", "review", "disabled", "superseded", "expired", "future", "active"} {
		r := memo.Record{Schema: 1, Kind: "fact", Subject: "user", Scope: "workspace", State: state, Content: "private fact", Sources: []memo.Source{{Kind: "user", ID: state, Revision: "one"}}}
		if state == "expired" || state == "future" {
			r.State = "active"
			if state == "expired" {
				r.ValidUntil = time.Now().Add(-time.Hour).UTC().Format(time.RFC3339)
			} else {
				r.ValidFrom = time.Now().Add(time.Hour).UTC().Format(time.RFC3339)
			}
		}
		e, err := aiMemoryStore().Save(ctx, r, "missing", state)
		if err != nil {
			t.Fatal(err)
		}
		_, err = GetAIMemoryForModel(ctx, e.Record.ID)
		if (err == nil) != (state == "active") {
			t.Fatalf("state %s model read: %v", state, err)
		}
		if _, err = GetAIMemory(ctx, e.Record.ID); err != nil {
			t.Fatal("owner must retain management access", err)
		}
	}
	list, err := ListAIMemoryForModel(ctx, apicontract.AIMemoryListRequest{})
	if err != nil || len(list.Records) != 1 {
		t.Fatalf("invalid records reached model: %+v %v", list, err)
	}
	cfg.Memory.Enabled = false
	Conf.AI.Store(cfg)
	if _, err = GetAIMemoryForModel(ctx, list.Records[0].ID); err == nil {
		t.Fatal("disabled memory remained readable by model")
	}
}

func TestAIMemoryRepeatedConfirmationDoesNotDuplicateEvidence(t *testing.T) {
	setupAIMemoryTest(t)
	q := apicontract.AIMemorySaveRequest{Revision: "missing", Content: strings.Repeat("x", 32000), Kind: "fact", Subject: "user", Scope: "workspace", State: "active"}
	for i := 0; i < 12; i++ {
		q.OperationID = fmt.Sprintf("confirmation-%d", i)
		if i%2 == 0 {
			q.State = "disabled"
		} else {
			q.State = "active"
		}
		saved, err := SaveAIMemory(context.Background(), q)
		if err != nil {
			t.Fatalf("save %d failed: %v", i, err)
		}
		q.ID, q.Revision = saved.ID, saved.Revision
	}
	e, err := aiMemoryStore().Get(context.Background(), q.ID)
	if err != nil || len(e.Record.Sources) != 1 || e.Record.Confirmed == "" {
		t.Fatalf("confirmation provenance: %+v %v", e.Record.Sources, err)
	}
}

func TestAIMemorySourceRevisionReconcilesExistingID(t *testing.T) {
	cfg := setupAIMemoryTest(t)
	cfg.Memory.Conversations = true
	oldReader := AIMemoryConversationReader
	t.Cleanup(func() { AIMemoryConversationReader = oldReader })
	content := "User prefers concise answers"
	AIMemoryConversationReader = func(context.Context, string, string) (string, error) { return content, nil }
	source, err := memorySource(context.Background(), "conversation:session:entry", nil)
	if err != nil {
		t.Fatal(err)
	}
	e, err := aiMemoryStore().Save(context.Background(), memo.Record{Schema: 1, Kind: "preference", Subject: "user", Scope: "workspace", State: "review", Content: content, Sources: []memo.Source{source}}, "missing", "prior")
	if err != nil {
		t.Fatal(err)
	}
	content = "User prefers detailed answers"
	source, err = memorySource(context.Background(), source.ID, nil)
	if err != nil {
		t.Fatal(err)
	}
	memoryComplete = func(_ context.Context, _ *conf.AI, prompt string) (string, error) {
		if strings.Contains(prompt, "\"terms\"") {
			return `{"terms":["answers"]}`, nil
		}
		if strings.HasPrefix(prompt, "Generate a concise") {
			return "", nil
		}
		if !strings.Contains(prompt, e.Record.ID) {
			t.Error("stale authorized record missing from reconciliation")
		}
		return fmt.Sprintf(`{"actions":[{"id":%q,"kind":"preference","subject":"user","scope":"workspace","content":%q,"state":"active","sourceIndexes":[0]}]}`, e.Record.ID, content), nil
	}
	ctx, cancel := context.WithCancel(context.Background())
	task := &memoryTask{cancel: cancel}
	runAIMemory(ctx, cfg, apicontract.AIMemoryMaintainRequest{SourceIDs: []string{source.ID}, OperationID: strings.Repeat("o", 200)}, []memo.Source{source}, false, task)
	if len(task.status.Results) != 1 || !task.status.Results[0].Saved || task.status.Results[0].ID != e.Record.ID {
		t.Fatalf("reconciliation failed: %+v", task.status)
	}
	updated, err := aiMemoryStore().Get(context.Background(), e.Record.ID)
	if err != nil || updated.Record.Content != content || updated.Record.State != "candidate" || len(updated.Record.Sources) != 1 || updated.Record.Sources[0].Revision != source.Revision {
		t.Fatalf("incorrect reconciliation: %+v %v", updated, err)
	}
}

func TestAIMemoryCandidateSourceChangesDuringModelCall(t *testing.T) {
	cfg := setupAIMemoryTest(t)
	cfg.Memory.Conversations = true
	oldReader := AIMemoryConversationReader
	t.Cleanup(func() { AIMemoryConversationReader = oldReader })
	content := "User prefers concise answers"
	AIMemoryConversationReader = func(context.Context, string, string) (string, error) { return content, nil }
	source, err := memorySource(context.Background(), "conversation:session:entry", nil)
	if err != nil {
		t.Fatal(err)
	}
	e, err := aiMemoryStore().Save(context.Background(), memo.Record{Schema: 1, Kind: "preference", Subject: "user", Scope: "workspace", State: "active", Content: content, Sources: []memo.Source{source}}, "missing", "prior")
	if err != nil {
		t.Fatal(err)
	}
	memoryComplete = func(_ context.Context, _ *conf.AI, prompt string) (string, error) {
		if strings.Contains(prompt, "\"terms\"") {
			return `{"terms":["answers"]}`, nil
		}
		content = "Changed source"
		return fmt.Sprintf(`{"actions":[{"id":%q,"kind":"preference","subject":"user","scope":"workspace","content":"User prefers concise answers","state":"active","sourceIndexes":[0]}]}`, e.Record.ID), nil
	}
	ctx, cancel := context.WithCancel(context.Background())
	task := &memoryTask{cancel: cancel}
	runAIMemory(ctx, cfg, apicontract.AIMemoryMaintainRequest{Text: "answers", OperationID: "source-race"}, []memo.Source{{Kind: "user", ID: "source-race", Revision: "one", Evidence: "User prefers concise answers"}}, false, task)
	if len(task.status.Results) != 1 || task.status.Results[0].Saved {
		t.Fatalf("obsolete candidate saved: %+v", task.status)
	}
	after, err := aiMemoryStore().Get(context.Background(), e.Record.ID)
	if err != nil || after.Revision != e.Revision {
		t.Fatal("obsolete candidate changed", err)
	}
}

func TestAIMemoryOverviewRejectsSourceChangedDuringGeneration(t *testing.T) {
	cfg := setupAIMemoryTest(t)
	cfg.Memory.Conversations = true
	oldReader := AIMemoryConversationReader
	t.Cleanup(func() { AIMemoryConversationReader = oldReader })
	content := "Original source"
	AIMemoryConversationReader = func(context.Context, string, string) (string, error) { return content, nil }
	source, err := memorySource(context.Background(), "conversation:session:entry", nil)
	if err != nil {
		t.Fatal(err)
	}
	_, err = aiMemoryStore().Save(context.Background(), memo.Record{Schema: 1, Kind: "fact", Subject: "user", Scope: "workspace", State: "active", Content: content, Sources: []memo.Source{source}}, "missing", "prior")
	if err != nil {
		t.Fatal(err)
	}
	memoryComplete = func(context.Context, *conf.AI, string) (string, error) {
		content = "Changed source"
		return "Obsolete summary", nil
	}
	err = refreshAIMemoryProjections(context.Background(), cfg, func() error { return nil })
	if err == nil {
		t.Fatal("obsolete overview committed")
	}
	if _, err = aiMemoryStore().ReadProjection(context.Background(), "USER.md", []string{"workspace"}); err == nil {
		t.Fatal("obsolete overview was persisted")
	}
}

func TestAIMemoryForgetCleanupPendingIsSaved(t *testing.T) {
	setupAIMemoryTest(t)
	ctx := context.Background()
	saved, err := SaveAIMemory(ctx, apicontract.AIMemorySaveRequest{Revision: "missing", OperationID: "remember", Content: "Fact", Kind: "fact", Subject: "user", Scope: "workspace", State: "active"})
	if err != nil {
		t.Fatal(err)
	}
	q := apicontract.AIMemoryForgetRequest{ID: saved.ID, Revision: saved.Revision, OperationID: "forget"}
	if _, err = ForgetAIMemory(ctx, q); err != nil {
		t.Fatal(err)
	}
	// 模拟撤回后同步残留的不可删除目标，重试仍须报告已保存撤回标记。
	path := filepath.Join(util.DataDir, "storage", "ai", "memos", "records", saved.ID+".md")
	if err = os.Mkdir(path, 0700); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(path, "obstacle"), []byte("test"), 0600); err != nil {
		t.Fatal(err)
	}
	result, err := ForgetAIMemory(ctx, q)
	if err != nil || !result.Saved || !result.CleanupPending {
		t.Fatalf("durable withdrawal reported as failure: %+v %v", result, err)
	}
}

func TestAIMemorySourceReviewRejectsIncompleteScan(t *testing.T) {
	setupAIMemoryTest(t)
	path := filepath.Join(util.DataDir, "storage", "ai", "memos", "records")
	if err := os.MkdirAll(path, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(path, "20261029000000-abcdefg.md"), []byte("invalid record"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := RevalidateAIMemorySources(context.Background(), nil); !errors.Is(err, memo.ErrIncomplete) {
		t.Fatalf("incomplete scan accepted: %v", err)
	}
}

func TestAIMemoryActivationDoesNotHideRevokedSources(t *testing.T) {
	setupAIMemoryTest(t)
	ctx := context.Background()
	entry, err := aiMemoryStore().Save(ctx, memo.Record{Schema: 1, Kind: "fact", Subject: "user", Scope: "workspace", State: "review", Content: "A historical fact", Sources: []memo.Source{{Kind: "conversation", ID: "conversation:session:entry", Revision: "old"}}}, "missing", "prior")
	if err != nil {
		t.Fatal(err)
	}
	result, err := SaveAIMemory(ctx, apicontract.AIMemorySaveRequest{ID: entry.Record.ID, Revision: entry.Revision, OperationID: "confirm", Content: entry.Record.Content, Kind: "fact", Subject: "user", Scope: "workspace", State: "active"})
	if err == nil || result.Saved {
		t.Fatalf("invalid source activation reported success: %+v %v", result, err)
	}
	current, readErr := aiMemoryStore().Get(ctx, entry.Record.ID)
	if readErr != nil || current.Revision != entry.Revision || current.Record.State != "review" {
		t.Fatal("rejected activation changed record", readErr)
	}
}

func TestAIMemoryCommitGuardRechecksCandidateSource(t *testing.T) {
	cfg := setupAIMemoryTest(t)
	cfg.Memory.Conversations = true
	oldReader := AIMemoryConversationReader
	t.Cleanup(func() { AIMemoryConversationReader = oldReader })
	const original = "User prefers concise answers"
	reads := 0
	AIMemoryConversationReader = func(context.Context, string, string) (string, error) {
		reads++
		if reads > 3 {
			return "Changed before commit", nil
		}
		return original, nil
	}
	source, err := memorySource(context.Background(), "conversation:session:entry", nil)
	if err != nil {
		t.Fatal(err)
	}
	entry, err := aiMemoryStore().Save(context.Background(), memo.Record{Schema: 1, Kind: "preference", Subject: "user", Scope: "workspace", State: "active", Content: original, Sources: []memo.Source{source}}, "missing", "prior")
	if err != nil {
		t.Fatal(err)
	}
	reads = 0
	memoryComplete = func(_ context.Context, _ *conf.AI, prompt string) (string, error) {
		if strings.Contains(prompt, `"terms"`) {
			return `{"terms":["answers"]}`, nil
		}
		return fmt.Sprintf(`{"actions":[{"id":%q,"kind":"preference","subject":"user","scope":"workspace","content":%q,"state":"active","sourceIndexes":[0]}]}`, entry.Record.ID, original), nil
	}
	ctx, cancel := context.WithCancel(context.Background())
	task := &memoryTask{cancel: cancel}
	runAIMemory(ctx, cfg, apicontract.AIMemoryMaintainRequest{Text: original, OperationID: "guard"}, []memo.Source{{Kind: "user", ID: "guard", Revision: "one", Evidence: original}}, false, task)
	if len(task.status.Results) != 1 || task.status.Results[0].Saved || !strings.Contains(task.status.Results[0].Error, "before commit") {
		t.Fatalf("commit guard missed source change: %+v reads=%d", task.status, reads)
	}
	after, err := aiMemoryStore().Get(context.Background(), entry.Record.ID)
	if err != nil || after.Revision != entry.Revision {
		t.Fatal("guard allowed stale write", err)
	}
}

func TestAIMemoryDecodeProposal(t *testing.T) {
	for _, input := range []string{
		`{"actions":[]} trailing`, `{"actions":[],"unexpected":true}`, `{"actions":[{"shell":"rm"}]}`,
		strings.Repeat("x", 128*1024+1),
	} {
		if _, err := decodeMemoryProposal(input); err == nil {
			t.Fatalf("invalid proposal accepted: %.80s", input)
		}
	}
	if p, err := decodeMemoryProposal(`{"actions":[]}`); err != nil || len(p.Actions) != 0 {
		t.Fatal("valid no-op rejected", err)
	}
}

func TestAIMemoryManualLifecycle(t *testing.T) {
	setupAIMemoryTest(t)
	ctx := context.Background()
	q := apicontract.AIMemorySaveRequest{Revision: "missing", OperationID: "remember-1", Content: "Keep replies concise", Kind: "preference", Subject: "user", Scope: "workspace", State: "active"}
	first, err := SaveAIMemory(ctx, q)
	if err != nil || !first.Saved {
		t.Fatal("save failed", err)
	}
	again, err := SaveAIMemory(ctx, q)
	if err != nil || again.ID != first.ID {
		t.Fatal("retry duplicated memory", err)
	}
	text, err := BuildAIMemoryContext(ctx, "concise", nil, 2000)
	if err != nil || !strings.Contains(text, q.Content) {
		t.Fatal("memory was not available", err)
	}
	q.ID, q.Revision, q.OperationID, q.Content = first.ID, first.Revision, "correct-1", "Use detailed tutorials"
	second, err := SaveAIMemory(ctx, q)
	if err != nil || second.ID != first.ID {
		t.Fatal("correction did not retain ID", err)
	}
	q.OperationID = "stale-write"
	if _, err = SaveAIMemory(ctx, q); !errors.Is(err, memo.ErrConflict) {
		t.Fatal("stale edit accepted", err)
	}
	forgotten, err := ForgetAIMemory(ctx, apicontract.AIMemoryForgetRequest{ID: second.ID, Revision: second.Revision, OperationID: "forget-1"})
	if err != nil || !forgotten.Saved {
		t.Fatal("forget failed", err)
	}
	text, err = BuildAIMemoryContext(ctx, "tutorials", nil, 2000)
	if err != nil || text != "" {
		t.Fatal("forgotten memory injected", err)
	}
}

func TestAIMemoryReadOnlyWrites(t *testing.T) {
	setupAIMemoryTest(t)
	util.ReadOnly = true
	if _, err := SaveAIMemory(context.Background(), apicontract.AIMemorySaveRequest{}); err == nil {
		t.Fatal("read-only save accepted")
	}
	if _, err := ForgetAIMemory(context.Background(), apicontract.AIMemoryForgetRequest{}); err == nil {
		t.Fatal("read-only forget accepted")
	}
}

func TestAIMemoryConfigChangeDuringModelCall(t *testing.T) {
	cfg := setupAIMemoryTest(t)
	memoryComplete = func(ctx context.Context, selected *conf.AI, prompt string) (string, error) {
		next := conf.NewAI()
		Conf.AI.Store(next)
		return `{"actions":[{"id":"","kind":"preference","subject":"user","scope":"workspace","content":"Concise replies","state":"candidate","sourceIndexes":[0]}]}`, nil
	}
	ctx, cancel := context.WithCancel(context.Background())
	task := &memoryTask{cancel: cancel}
	runAIMemory(ctx, cfg, apicontract.AIMemoryMaintainRequest{Text: "Concise replies", OperationID: "generation-test"}, []memo.Source{{Kind: "user", ID: "generation-test", Revision: "one", Evidence: "Concise replies"}}, false, task)
	if task.status.State != "failed" || !strings.Contains(task.status.Error, "configuration changed") {
		t.Fatalf("obsolete task not rejected: %+v", task.status)
	}
	result, err := aiMemoryStore().Search(context.Background(), memo.SearchOptions{Limit: 10})
	if err != nil || len(result.Entries) != 0 {
		t.Fatal("obsolete task wrote memory", err)
	}
}

func TestAIMemoryModelFailurePreservesRecords(t *testing.T) {
	cfg := setupAIMemoryTest(t)
	first, err := SaveAIMemory(context.Background(), apicontract.AIMemorySaveRequest{Revision: "missing", OperationID: "existing", Content: "Concise replies", Kind: "preference", Subject: "user", Scope: "workspace", State: "active"})
	if err != nil {
		t.Fatal(err)
	}
	memoryComplete = func(context.Context, *conf.AI, string) (string, error) { return "", errors.New("provider unavailable") }
	ctx, cancel := context.WithCancel(context.Background())
	task := &memoryTask{cancel: cancel}
	runAIMemory(ctx, cfg, apicontract.AIMemoryMaintainRequest{Text: "remember", OperationID: "provider-failure"}, []memo.Source{{Kind: "user", ID: "provider-failure", Revision: "one", Evidence: "remember"}}, false, task)
	if task.status.State != "failed" {
		t.Fatalf("model failure hidden: %+v", task.status)
	}
	entry, err := aiMemoryStore().Get(context.Background(), first.ID)
	if err != nil || entry.Revision != first.Revision {
		t.Fatal("model failure changed record", err)
	}
}

func TestAIMemoryGroundedProposalAndStableRetry(t *testing.T) {
	cfg := setupAIMemoryTest(t)
	content := "Prefer concise replies"
	memoryComplete = func(ctx context.Context, selected *conf.AI, prompt string) (string, error) {
		if strings.Contains(prompt, "\"terms\"") {
			return `{"terms":["concise"]}`, nil
		}
		if strings.HasPrefix(prompt, "Generate a concise") {
			return content, nil
		}
		return `{"actions":[{"id":"","kind":"preference","subject":"user","scope":"workspace","content":"Prefer concise replies","state":"active","sourceIndexes":[0]}]}`, nil
	}
	run := func() *memoryTask {
		ctx, cancel := context.WithCancel(context.Background())
		task := &memoryTask{cancel: cancel}
		runAIMemory(ctx, cfg, apicontract.AIMemoryMaintainRequest{Text: content, OperationID: "grounded"}, []memo.Source{{Kind: "user", ID: "grounded", Revision: "source", Evidence: content}}, false, task)
		return task
	}
	first := run()
	if first.status.State != "completed" || len(first.status.Results) != 1 || !first.status.Results[0].Saved {
		t.Fatalf("first: %+v", first.status)
	}
	second := run()
	if second.status.State != "completed" || second.status.Results[0].ID != first.status.Results[0].ID {
		t.Fatalf("retry: %+v", second.status)
	}
	text, err := BuildAIMemoryContext(context.Background(), "write a response", nil, 6000)
	if err != nil || !strings.Contains(text, content) {
		t.Fatalf("later use failed: %q %v", text, err)
	}
	memoryComplete = func(context.Context, *conf.AI, string) (string, error) {
		return `{"actions":[{"id":"","kind":"preference","subject":"user","scope":"workspace","content":"A changed proposal","state":"active","sourceIndexes":[0]}]}`, nil
	}
	changed := run()
	if changed.status.State != "failed" {
		t.Fatal("changed retry proposal was accepted")
	}
}

func TestAIMemoryMixedSourceCannotBypassAccess(t *testing.T) {
	setupAIMemoryTest(t)
	r := memo.Record{Sources: []memo.Source{{Kind: "user", ID: "one", Revision: "one"}, {Kind: "unknown", ID: "two", Revision: "two"}}}
	if validateMemorySources(context.Background(), r, nil) {
		t.Fatal("user evidence bypassed restricted source")
	}
}

func TestAIMemoryConversationPermissionAndRevision(t *testing.T) {
	cfg := setupAIMemoryTest(t)
	old := AIMemoryConversationReader
	t.Cleanup(func() { AIMemoryConversationReader = old })
	content := "User prefers concise replies"
	AIMemoryConversationReader = func(context.Context, string, string) (string, error) { return content, nil }
	id := "conversation:session:entry"
	if _, err := memorySource(context.Background(), id, nil); err == nil {
		t.Fatal("conversation capture was opt-out")
	}
	cfg.Memory.Conversations = true
	Conf.AI.Store(cfg)
	source, err := memorySource(context.Background(), id, nil)
	if err != nil {
		t.Fatal(err)
	}
	r := memo.Record{Sources: []memo.Source{source}}
	if !validateMemorySources(context.Background(), r, nil) {
		t.Fatal("allowed conversation invalid")
	}
	content = "Changed user preference"
	if validateMemorySources(context.Background(), r, nil) {
		t.Fatal("edited utterance revision was ignored")
	}
	cfg.Memory.Conversations = false
	Conf.AI.Store(cfg)
	if validateMemorySources(context.Background(), r, nil) {
		t.Fatal("revoked conversation remained accessible")
	}
}

func TestAIMemoryModelReadRevocation(t *testing.T) {
	cfg := setupAIMemoryTest(t)
	old := AIMemoryConversationReader
	t.Cleanup(func() { AIMemoryConversationReader = old })
	AIMemoryConversationReader = func(context.Context, string, string) (string, error) { return "PRIVATE_SOURCE", nil }
	cfg.Memory.Conversations = true
	Conf.AI.Store(cfg)
	source, err := memorySource(context.Background(), "conversation:session:entry", nil)
	if err != nil {
		t.Fatal(err)
	}
	entry, err := aiMemoryStore().Save(context.Background(), memo.Record{Schema: 1, Kind: "fact", Subject: "user", Scope: "workspace", State: "active", Content: "PRIVATE_MEMORY", Sources: []memo.Source{source}}, "missing", "revoke-source")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = GetAIMemoryForModel(context.Background(), entry.Record.ID); err != nil {
		t.Fatal(err)
	}
	cfg.Memory.Conversations = false
	Conf.AI.Store(cfg)
	if _, err = GetAIMemoryForModel(context.Background(), entry.Record.ID); err == nil {
		t.Fatal("model read bypassed revoked source")
	}
	list, err := ListAIMemoryForModel(context.Background(), apicontract.AIMemoryListRequest{})
	if err != nil || len(list.Records) != 0 {
		t.Fatal("model list leaked revoked source", err)
	}
	local, err := GetAIMemory(context.Background(), entry.Record.ID)
	if err != nil || local.Record.Content != "PRIVATE_MEMORY" {
		t.Fatal("local owner management lost record", err)
	}
}

func TestAIMemoryOverviewValidatesPastSelection(t *testing.T) {
	cfg := setupAIMemoryTest(t)
	ctx := context.Background()
	for i := 0; i < 201; i++ {
		source := memo.Source{Kind: "user", ID: "confirmed", Revision: "one"}
		if i == 200 {
			source.Kind = "restricted"
		}
		_, err := aiMemoryStore().Save(ctx, memo.Record{Schema: 1, ID: fmt.Sprintf("20261029000000-%07d", i), Kind: "fact", Subject: "user", Scope: "workspace", State: "active", Content: "fact", Sources: []memo.Source{source}}, "missing", fmt.Sprintf("snapshot-%d", i))
		if err != nil {
			t.Fatal(err)
		}
	}
	snapshot, err := aiMemoryStore().Snapshot(ctx, []string{"workspace"})
	if err != nil || !snapshot.Partial {
		t.Fatal("test requires bounded snapshot", err)
	}
	if err = validateMemoryOverviewSources(ctx, cfg); err == nil {
		t.Fatal("unselected revoked source bypassed overview check")
	}
}
