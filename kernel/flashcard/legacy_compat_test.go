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

	"github.com/open-spaced-repetition/go-fsrs/v3"
)

func TestLegacyCompatibilityUsesReviewSetsAndPreservesSharedCards(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	now := int64(1786431600000)
	setupLegacyCompatibilityBuiltins(t, ctx, store, now)
	firstSet, err := store.CreateLegacyReviewSet(ctx, "legacy-set-a", "deck-a", "Deck A", now, 20, 200)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = store.CreateLegacyReviewSet(ctx, "legacy-set-b", "deck-b", "Deck B", now+1, 20, 200); err != nil {
		t.Fatal(err)
	}
	if _, err = store.AddLegacyQuickCards(ctx, "legacy-add-a", "deck-a", []string{"block-a", "block-b"},
		now+2); err != nil {
		t.Fatal(err)
	}
	if _, err = store.AddLegacyQuickCards(ctx, "legacy-add-b", "deck-b", []string{"block-a"}, now+3); err != nil {
		t.Fatal(err)
	}
	firstCards, err := store.Projection().LegacyQuickCards(ctx, "deck-a")
	if err != nil || len(firstCards) != 2 {
		t.Fatalf("unexpected first legacy review set: cards=%+v err=%v", firstCards, err)
	}
	resolved, found, err := store.Projection().ResolveLegacyCard(ctx, "deck-a", LegacyQuickCardID("block-a"))
	if err != nil || !found || resolved.BlockID != "block-a" {
		t.Fatalf("legacy-compatible card was not resolved: found=%v card=%+v err=%v", found, resolved, err)
	}
	dues, err := store.PreviewReviewDues(ctx, resolved.Card.ID, now+1000)
	if err != nil || len(dues) != 4 || dues[ReviewGood] <= now {
		t.Fatalf("legacy-compatible due preview failed: dues=%+v err=%v", dues, err)
	}
	if err = store.RemoveLegacyQuickCards(ctx, "legacy-remove-a", "deck-a", []string{"block-a"}, now+4); err != nil {
		t.Fatal(err)
	}
	firstCards, err = store.Projection().LegacyQuickCards(ctx, "deck-a")
	if err != nil || len(firstCards) != 1 || firstCards[0].BlockID != "block-b" {
		t.Fatalf("card was not removed from the first review set: cards=%+v err=%v", firstCards, err)
	}
	secondCards, err := store.Projection().LegacyQuickCards(ctx, "deck-b")
	if err != nil || len(secondCards) != 1 || secondCards[0].BlockID != "block-a" {
		t.Fatalf("shared card was removed from another review set: cards=%+v err=%v", secondCards, err)
	}
	if err = store.RenameLegacyReviewSet(ctx, "legacy-rename-a", "deck-a", "Renamed", now+5); err != nil {
		t.Fatal(err)
	}
	sets, err := store.Projection().LegacyReviewSets(ctx)
	if err != nil || len(sets) != 2 {
		t.Fatalf("unexpected legacy review sets: sets=%+v err=%v", sets, err)
	}
	var renamed bool
	for _, set := range sets {
		if set.ReviewSetID == firstSet.ReviewSetID && set.Name == "Renamed" && set.Size == 1 {
			renamed = true
		}
	}
	if !renamed {
		t.Fatalf("renamed legacy review set was not listed: %+v", sets)
	}
}

func TestLegacyCompatibilityReaddingDeletedGenerationResetsState(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	now := int64(1786431600000)
	setupLegacyCompatibilityBuiltins(t, ctx, store, now)
	if _, err := store.CreateLegacyReviewSet(ctx, "legacy-reset-set", "deck-reset", "Deck", now, 20, 200); err != nil {
		t.Fatal(err)
	}
	if _, err := store.AddLegacyQuickCards(ctx, "legacy-reset-add", "deck-reset", []string{"block-reset"},
		now+1); err != nil {
		t.Fatal(err)
	}
	cardID := LegacyQuickCardID("block-reset")
	if _, err := store.ManageCards(ctx, CardManagementRequest{OperationID: "legacy-reset-review-state",
		CardIDs: []string{cardID}, Action: CardActionSetDue, ChangedAt: now + 2, Due: now + 86400000}); err != nil {
		t.Fatal(err)
	}
	if err := store.RemoveLegacyQuickCards(ctx, "legacy-reset-remove", "deck-reset", nil, now+3); err != nil {
		t.Fatal(err)
	}
	if cards, err := store.Projection().LegacyQuickCards(ctx, "deck-reset"); err != nil || len(cards) != 0 {
		t.Fatalf("removed compatibility card stayed active: cards=%+v err=%v", cards, err)
	}
	if _, err := store.AddLegacyQuickCards(ctx, "legacy-reset-readd", "deck-reset", []string{"block-reset"},
		now+4); err != nil {
		t.Fatal(err)
	}
	cards, err := store.Projection().LegacyQuickCards(ctx, "deck-reset")
	if err != nil || len(cards) != 1 || cards[0].ReviewState.State != "new" || cards[0].ReviewState.Due != now+4 {
		t.Fatalf("readded compatibility card did not reset: cards=%+v err=%v", cards, err)
	}
}

func setupLegacyCompatibilityBuiltins(t *testing.T, ctx context.Context, store *Store, now int64) {
	t.Helper()
	weights := fsrs.DefaultWeights()
	options := LegacyMigrationOptions{RequestRetention: 0.9, MaximumInterval: 36500,
		Weights: append([]float64(nil), weights[:]...), NewLimit: 20, ReviewLimit: 200, LeechThreshold: 8,
		LeechAction: "tag", PresetName: "Default"}
	planned := builtinLegacyEntities(options, now)
	mutations := make([]EntityMutation, 0, len(planned))
	for _, entity := range planned {
		payload, err := CanonicalJSON(entity.payload)
		if err != nil {
			t.Fatal(err)
		}
		mutations = append(mutations, EntityMutation{EntityType: entity.entityType, EntityID: entity.entityID,
			UpdatedAt: now, Payload: payload})
	}
	if _, err := store.MutateEntities(ctx, "legacy-compatibility-builtins", mutations); err != nil {
		t.Fatal(err)
	}
}
