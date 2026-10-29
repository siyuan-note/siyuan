package model

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"

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
