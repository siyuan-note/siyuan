// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package flashcard

import (
	"context"
	"testing"
)

func TestSourceLifecyclePreservesCardStateAndSupportsRetry(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	now := int64(1786431600000)
	setupLegacyCompatibilityBuiltins(t, ctx, store, now)
	created, err := store.CreateQuickSources(ctx, QuickSourceRequest{OperationID: "source-lifecycle-create",
		BlockIDs: []string{"source-lifecycle-block"}, CreatedAt: now + 1})
	if err != nil {
		t.Fatal(err)
	}
	cardID := created.CardIDs[0]
	sourceID := created.SourceIDs[0]
	due := now + 86400000
	if _, err = store.ManageCards(ctx, CardManagementRequest{OperationID: "source-lifecycle-due",
		CardIDs: []string{cardID}, Action: CardActionSetDue, ChangedAt: now + 2, Due: due}); err != nil {
		t.Fatal(err)
	}
	deleteRequest := SourceLifecycleRequest{OperationID: "source-lifecycle-delete", SourceID: sourceID,
		Action: SourceActionDelete, ChangedAt: now + 3}
	deleted, err := store.ManageSourceLifecycle(ctx, deleteRequest)
	if err != nil || deleted.SourceRevision.RevisionID == "" {
		t.Fatalf("delete source failed: result=%+v err=%v", deleted, err)
	}
	if retried, retryErr := store.ManageSourceLifecycle(ctx, deleteRequest); retryErr != nil ||
		retried.SourceRevision.RevisionID != deleted.SourceRevision.RevisionID {
		t.Fatalf("delete retry was not idempotent: result=%+v err=%v", retried, retryErr)
	}
	if results, searchErr := store.Projection().SearchCards(ctx, nil, CardSearchOptions{Now: now + 4}); searchErr != nil || len(results) != 0 {
		t.Fatalf("deleted source remained reviewable: results=%+v err=%v", results, searchErr)
	}
	results, err := store.Projection().SearchCards(ctx, nil, CardSearchOptions{Now: now + 4,
		IncludeInactive: true, IncludeSuspended: true, IncludeBuried: true, IncludePaused: true})
	if err != nil || len(results) != 1 || results[0].SourceStatus != "deleted" ||
		results[0].Card.GenerationStatus != GenerationDeleted {
		t.Fatalf("deleted source was not visible in management: results=%+v err=%v", results, err)
	}
	if _, err = store.ManageSourceLifecycle(ctx, SourceLifecycleRequest{OperationID: "source-lifecycle-restore",
		SourceID: sourceID, Action: SourceActionRestore, ChangedAt: now + 5}); err != nil {
		t.Fatal(err)
	}
	assertReviewStateForTest(t, ctx, store, cardID, due, 0)
	results, err = store.Projection().SearchCards(ctx, nil, CardSearchOptions{Now: now + 6})
	if err != nil || len(results) != 1 || results[0].Card.ID != cardID || results[0].SourceStatus != "active" {
		t.Fatalf("restored source did not resume the same card: results=%+v err=%v", results, err)
	}
}
