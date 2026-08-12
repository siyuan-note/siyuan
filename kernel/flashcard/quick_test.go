// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package flashcard

import (
	"context"
	"testing"
)

func TestCreateQuickSourcesDoesNotDependOnReviewSets(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	now := int64(1786431600000)
	setupLegacyCompatibilityBuiltins(t, ctx, store, now)
	request := QuickSourceRequest{OperationID: "quick-create", BlockIDs: []string{"block-b", "block-a", "block-a"},
		CreatedAt: now + 1}
	result, err := store.CreateQuickSources(ctx, request)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.SourceIDs) != 2 || len(result.CardIDs) != 2 || result.CardIDs[0] != LegacyQuickCardID("block-a") {
		t.Fatalf("unexpected quick source result: %+v", result)
	}
	var memberships int
	if err = store.projection.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM review_set_memberships`).Scan(&memberships); err != nil {
		t.Fatal(err)
	}
	if memberships != 0 {
		t.Fatalf("quick sources unexpectedly depend on review sets: %d", memberships)
	}
	cardID := result.CardIDs[0]
	if _, err = store.ManageCards(ctx, CardManagementRequest{OperationID: "quick-due", CardIDs: []string{cardID},
		Action: CardActionSetDue, ChangedAt: now + 2, Due: now + 86400000}); err != nil {
		t.Fatal(err)
	}
	request.OperationID = "quick-repeat"
	request.CreatedAt = now + 3
	if _, err = store.CreateQuickSources(ctx, request); err != nil {
		t.Fatal(err)
	}
	assertReviewStateForTest(t, ctx, store, cardID, now+86400000, 0)
	if reconciled, reconcileErr := store.ReconcileSourceCards(ctx, "quick-reconcile", result.SourceIDs[0], now+4); reconcileErr != nil || len(reconciled.Created) != 0 {
		t.Fatalf("quick source did not use the built-in stable variant: result=%+v err=%v", reconciled, reconcileErr)
	}
	deleted, err := store.ManageSourceLifecycle(ctx, SourceLifecycleRequest{OperationID: "quick-delete-source",
		SourceID: result.SourceIDs[0], Action: SourceActionDelete, ChangedAt: now + 5})
	if err != nil {
		t.Fatal(err)
	}
	request.OperationID = "quick-restore-source"
	request.BlockIDs = []string{"block-a"}
	request.CreatedAt = now + 6
	if _, err = store.CreateQuickSources(ctx, request); err != nil {
		t.Fatal(err)
	}
	restored, found, err := store.Projection().CurrentEntity(ctx, EntityCardSource, result.SourceIDs[0])
	if err != nil || !found || restored.RevisionID == deleted.SourceRevision.RevisionID {
		t.Fatalf("quick creation did not restore the deleted source: revision=%+v found=%v err=%v", restored, found, err)
	}
	var source CardSource
	if err = decodeStrictJSON(restored.Payload, &source); err != nil || source.Status != "active" {
		t.Fatalf("quick source was not restored to active: source=%+v err=%v", source, err)
	}
	assertReviewStateForTest(t, ctx, store, cardID, now+86400000, 0)
}
