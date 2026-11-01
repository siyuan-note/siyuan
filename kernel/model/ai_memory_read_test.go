// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/memory"
)

func TestAIMemoryReviewPreservesTransientErrorsAndFiltersChanges(t *testing.T) {
	setupAIMemoryTest(t)
	previous := AIMemoryConversationReader
	t.Cleanup(func() { AIMemoryConversationReader = previous })
	var failure error
	content, calls := "original", 0
	AIMemoryConversationReader = func(context.Context, string, string) (string, error) { calls++; return content, failure }
	source, err := memorySource(context.Background(), "conversation:session:entry")
	if err != nil {
		t.Fatal(err)
	}
	entry, err := aiMemoryStore().Save(context.Background(), memory.Record{Kind: "fact", Subject: "user", Scope: "workspace", State: "active", Content: "fact", Sources: []memory.Source{source}}, "missing", "create")
	if err != nil {
		t.Fatal(err)
	}
	failure = errors.New("temporary IO failure")
	calls = 0
	if err = RevalidateAIMemorySources(context.Background(), []string{"20261101000000-abcdefg"}); err != nil || calls != 0 {
		t.Fatalf("unrelated source read: %v calls=%d", err, calls)
	}
	if err = RevalidateAIMemorySources(context.Background(), nil); !errors.Is(err, failure) {
		t.Fatalf("transient failure hidden: %v", err)
	}
	current, err := aiMemoryStore().Get(context.Background(), entry.Record.ID)
	if err != nil || current.Revision != entry.Revision || current.Record.State != "active" {
		t.Fatalf("transient failure demoted memory: %+v %v", current, err)
	}
	failure = nil
	if err = RevalidateAIMemorySources(context.Background(), nil); err != nil {
		t.Fatal(err)
	}
	failure = ErrAIMemorySourceMissing
	if err = RevalidateAIMemorySources(context.Background(), []string{source.ID}); err != nil {
		t.Fatal(err)
	}
	current, err = aiMemoryStore().Get(context.Background(), entry.Record.ID)
	if err != nil || current.Record.State != "review" {
		t.Fatalf("confirmed deletion not demoted: %+v %v", current, err)
	}
}

func TestAIMemoryOverviewReusesSourcesWithinRequestOnly(t *testing.T) {
	setupAIMemoryTest(t)
	previous := AIMemoryConversationReader
	t.Cleanup(func() { AIMemoryConversationReader = previous })
	text, calls := "original", 0
	AIMemoryConversationReader = func(context.Context, string, string) (string, error) { calls++; return text, nil }
	ctx := context.Background()
	source, err := memorySource(ctx, "conversation:session:entry")
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 4; i++ {
		if _, err = aiMemoryStore().Save(ctx, memory.Record{Kind: "fact", Subject: "user", Scope: "workspace", State: "active", Content: fmt.Sprint("fact", i), Sources: []memory.Source{source}}, "missing", fmt.Sprint(i)); err != nil {
			t.Fatal(err)
		}
	}
	snapshot, err := aiMemoryStore().Snapshot(ctx, []string{"workspace"})
	if err != nil {
		t.Fatal(err)
	}
	if err = aiMemoryStore().SaveProjection(ctx, "MEMORY.md", "overview", snapshot.Fingerprint, []string{"workspace"}); err != nil {
		t.Fatal(err)
	}
	calls = 0
	view, err := ReadAIMemoryOverview(ctx)
	if err != nil || view.Stale || view.Count != 4 || calls != 1 {
		t.Fatalf("repeated validation: %+v err=%v calls=%d", view, err, calls)
	}
	text = "changed"
	view, err = ReadAIMemoryOverview(ctx)
	if err != nil || !view.Stale || view.Memory != "" || calls != 2 {
		t.Fatalf("request reused stale snapshot: %+v err=%v calls=%d", view, err, calls)
	}
	text, calls = "original", 0
	listed, err := ListAIMemoryForModel(ctx, apicontract.AIMemoryListRequest{})
	if err != nil || len(listed.Records) != 4 || calls != 1 {
		t.Fatalf("model list reread identical sources: %+v err=%v calls=%d", listed, err, calls)
	}
	if _, err = BuildAIMemoryContext(ctx, "", nil, 6000); err != nil || calls != 2 {
		t.Fatalf("context construction reread identical sources: err=%v calls=%d", err, calls)
	}
}
