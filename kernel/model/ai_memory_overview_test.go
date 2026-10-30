// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/memo"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAIMemoryUnifiedOverviewGenerationAndInjection(t *testing.T) {
	cfg := setupAIMemoryTest(t)
	Conf.Lang = "zh-CN"
	ctx := context.Background()
	r := memo.Record{Schema: 1, Kind: "preference", Subject: "user", Scope: "workspace", State: "active", Content: "Concise answers", Sources: []memo.Source{{Kind: "user", ID: "user-request", Revision: "one"}}}
	if _, err := aiMemoryStore().Save(ctx, r, "missing", "save"); err != nil {
		t.Fatal(err)
	}
	calls := 0
	memoryComplete = func(_ context.Context, _ *conf.AI, prompt string) (string, error) {
		calls++
		if !strings.Contains(prompt, "stable user background and preferences") || !strings.Contains(prompt, "common context") || strings.Contains(prompt, "USER.md") || !strings.Contains(prompt, "in language zh-CN") || !strings.Contains(prompt, "Do not include file-name headings, record IDs") {
			t.Fatalf("wrong unified instructions: %s", prompt)
		}
		return "Unified overview", nil
	}
	if err := refreshAIMemoryProjections(ctx, cfg, func() error { return nil }); err != nil {
		t.Fatal(err)
	}
	if err := refreshAIMemoryProjections(ctx, cfg, func() error { return nil }); err != nil {
		t.Fatal(err)
	}
	if calls != 1 {
		t.Fatalf("expected one model request, got %d", calls)
	}
	view, err := ReadAIMemoryOverview(ctx)
	if err != nil || view.Stale || view.User != "" || view.Memory != "Unified overview" || view.Count != 1 || !view.CountComplete {
		t.Fatalf("view %+v %v", view, err)
	}
	text, err := BuildAIMemoryContext(ctx, "answers", nil, 6000)
	if err != nil || strings.Count(text, "Unified overview") != 1 {
		t.Fatalf("context %q %v", text, err)
	}
	if _, err = os.Stat(filepath.Join(util.DataDir, "storage/ai/memos/USER.md")); !os.IsNotExist(err) {
		t.Fatal("new generation wrote USER.md")
	}
}

func TestAIMemoryOverviewCountTraversesAllScopesAndStates(t *testing.T) {
	setupAIMemoryTest(t)
	ctx := context.Background()
	store := aiMemoryStore()
	for i := 0; i < memo.MaxResults+3; i++ {
		r := memo.Record{Schema: 1, Kind: "fact", Subject: "user", Scope: fmt.Sprintf("scope-%d", i%3), State: "active", Content: fmt.Sprintf("Fact %d", i), Sources: []memo.Source{{Kind: "user", ID: fmt.Sprintf("source-%d", i), Revision: "one"}}}
		if _, err := store.Save(ctx, r, "missing", fmt.Sprintf("save-%d", i)); err != nil {
			t.Fatal(err)
		}
	}
	for _, state := range []string{"candidate", "disabled", "review", "superseded"} {
		r := memo.Record{Schema: 1, Kind: "fact", Subject: "user", Scope: "workspace", State: state, Content: state, Sources: []memo.Source{{Kind: "user", ID: state, Revision: "one"}}}
		if _, err := store.Save(ctx, r, "missing", state); err != nil {
			t.Fatal(err)
		}
	}
	r := memo.Record{Schema: 1, Kind: "fact", Subject: "user", Scope: "workspace", State: "active", Content: "Expired", ValidUntil: time.Now().Add(-time.Hour).UTC().Format(time.RFC3339Nano), Sources: []memo.Source{{Kind: "user", ID: "expired", Revision: "one"}}}
	if _, err := store.Save(ctx, r, "missing", "expired"); err != nil {
		t.Fatal(err)
	}
	count, complete := countAIMemory(ctx)
	if count != memo.MaxResults+3 || !complete {
		t.Fatalf("count %d complete %v", count, complete)
	}
	r.ValidUntil = ""
	r.Content = "Forgotten"
	entry, err := store.Save(ctx, r, "missing", "forgotten")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = store.Forget(ctx, entry.Record.ID, entry.Revision, "forget"); err != nil {
		t.Fatal(err)
	}
	count, complete = countAIMemory(ctx)
	if count != memo.MaxResults+3 || !complete {
		t.Fatalf("forgotten counted %d %v", count, complete)
	}
	if err = os.WriteFile(filepath.Join(util.DataDir, "storage/ai/memos/records/20261029000000-abcdefg.md"), []byte("corrupt"), 0600); err != nil {
		t.Fatal(err)
	}
	_, complete = countAIMemory(ctx)
	if complete {
		t.Fatal("corrupt record reported complete count")
	}
}

func TestAIMemoryOverviewCountExcludesChangedSourcesAndMarksFailures(t *testing.T) {
	setupAIMemoryTest(t)
	ctx := context.Background()
	previous := AIMemoryConversationReader
	t.Cleanup(func() { AIMemoryConversationReader = previous })
	text := "original"
	AIMemoryConversationReader = func(context.Context, string, string) (string, error) { return text, nil }
	source, err := memorySource(ctx, "conversation:session:entry")
	if err != nil {
		t.Fatal(err)
	}
	r := memo.Record{Schema: 1, Kind: "fact", Subject: "user", Scope: "workspace", State: "active", Content: "fact", Sources: []memo.Source{source}}
	if _, err = aiMemoryStore().Save(ctx, r, "missing", "save"); err != nil {
		t.Fatal(err)
	}
	text = "changed"
	if count, complete := countAIMemory(ctx); count != 0 || !complete {
		t.Fatalf("changed source %d %v", count, complete)
	}
	AIMemoryConversationReader = func(context.Context, string, string) (string, error) { return "", fmt.Errorf("unavailable") }
	if _, complete := countAIMemory(ctx); complete {
		t.Fatal("source failure reported exact count")
	}
}

func TestAIMemoryLegacyOverviewReadOnlyAndMigration(t *testing.T) {
	setupAIMemoryTest(t)
	ctx := context.Background()
	base := filepath.Join(util.DataDir, "storage/ai/memos")
	if err := os.MkdirAll(base, 0700); err != nil {
		t.Fatal(err)
	}
	snapshot, err := aiMemoryStore().Snapshot(ctx, []string{"workspace"})
	if err != nil {
		t.Fatal(err)
	}
	legacy := fmt.Sprintf("---\nschema: 1\nfingerprint: %s\n---\nOld user preference", snapshot.Fingerprint)
	if err = os.WriteFile(filepath.Join(base, "USER.md"), []byte(legacy), 0600); err != nil {
		t.Fatal(err)
	}
	util.ReadOnly = true
	view, err := ReadAIMemoryOverview(ctx)
	if err != nil || !view.Stale || view.Memory != "" || view.User != "" {
		t.Fatalf("read-only legacy: %+v %v", view, err)
	}
	if _, err = os.Stat(filepath.Join(base, "legacy-projections")); !os.IsNotExist(err) {
		t.Fatal("read-only lookup mutated storage")
	}
	util.ReadOnly = false
	view, err = ReadAIMemoryOverview(ctx)
	if err != nil || view.Stale || !strings.Contains(view.Memory, "Old user preference") || view.User != "" {
		t.Fatalf("migrated: %+v %v", view, err)
	}
}

func TestAIMemoryOverviewCountConcurrentWithdrawalIsIncomplete(t *testing.T) {
	setupAIMemoryTest(t)
	ctx := context.Background()
	previous := AIMemoryConversationReader
	t.Cleanup(func() { AIMemoryConversationReader = previous })
	AIMemoryConversationReader = func(context.Context, string, string) (string, error) { return "original", nil }
	source, err := memorySource(ctx, "conversation:session:entry")
	if err != nil {
		t.Fatal(err)
	}
	store := aiMemoryStore()
	for i := 0; i < memo.MaxResults+3; i++ {
		r := memo.Record{Schema: 1, Kind: "fact", Subject: "user", Scope: "workspace", State: "active", Content: fmt.Sprintf("Fact %d", i), Sources: []memo.Source{source}}
		if _, err = store.Save(ctx, r, "missing", fmt.Sprintf("save-%d", i)); err != nil {
			t.Fatal(err)
		}
	}
	page, err := store.Search(ctx, memo.SearchOptions{Limit: 1})
	if err != nil {
		t.Fatal(err)
	}
	first := page.Entries[0]
	changed := false
	AIMemoryConversationReader = func(context.Context, string, string) (string, error) {
		if !changed {
			changed = true
			if _, err := store.Forget(ctx, first.Record.ID, first.Revision, "concurrent-forget"); err != nil {
				t.Fatal(err)
			}
		}
		return "original", nil
	}
	if _, complete := countAIMemory(ctx); complete {
		t.Fatal("concurrent withdrawal reported an exact count")
	}
}

func TestAIMemoryProjectionReadSkipsUnrelatedScopeCount(t *testing.T) {
	setupAIMemoryTest(t)
	ctx := context.Background()
	previous := AIMemoryConversationReader
	t.Cleanup(func() { AIMemoryConversationReader = previous })
	AIMemoryConversationReader = func(context.Context, string, string) (string, error) { return "original", nil }
	source, err := memorySource(ctx, "conversation:session:entry")
	if err != nil {
		t.Fatal(err)
	}
	r := memo.Record{Schema: 1, Kind: "fact", Subject: "user", Scope: "other", State: "active", Content: "Fact", Sources: []memo.Source{source}}
	if _, err = aiMemoryStore().Save(ctx, r, "missing", "save"); err != nil {
		t.Fatal(err)
	}
	calls := 0
	AIMemoryConversationReader = func(context.Context, string, string) (string, error) { calls++; return "original", nil }
	if _, err = readAIMemoryOverview(ctx, false); err != nil {
		t.Fatal(err)
	}
	if calls != 0 {
		t.Fatalf("projection read performed %d unrelated source checks", calls)
	}
}
