// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package flashcard

import (
	"context"
	"reflect"
	"testing"
)

func TestReorderAdvancedSourceMissingCardRejectedWithoutRepair(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	applyGenerationEntities(t, ctx, store, "preset", 1, testSchedulerPreset(legacyPresetID, false, false))
	created, err := store.CreateAdvancedSource(ctx, AdvancedSourceRequest{OperationID: "create", SourceID: "source", Mode: AdvancedModeOrderedCards, BlockIDs: []string{"a", "b"}, CreatedAt: 100})
	if err != nil {
		t.Fatal(err)
	}
	id := created.Cards.Created[0]
	card, _, _ := store.projection.CurrentEntity(ctx, EntityCard, id)
	state, _, _ := store.projection.CurrentEntity(ctx, EntityReviewState, id)
	_, err = store.MutateEntities(ctx, "remove-card", []EntityMutation{{EntityType: EntityCard, EntityID: id, ExpectedRevisionID: card.RevisionID, UpdatedAt: 150, Deleted: true}, {EntityType: EntityReviewState, EntityID: id, ExpectedRevisionID: state.RevisionID, UpdatedAt: 150, Deleted: true}})
	if err != nil {
		t.Fatal(err)
	}
	var source CardSource
	if err = decodeStrictJSON(created.SourceRevision.Payload, &source); err != nil {
		t.Fatal(err)
	}
	var config OrderedGenerationConfig
	if err = decodeStrictJSON(source.GenerationConfig, &config); err != nil {
		t.Fatal(err)
	}
	before, _ := store.projection.cardRevisionsBySource(ctx, source.ID)
	request := ReorderAdvancedSourceRequest{OperationID: "reorder", SourceID: source.ID, ExpectedRevisionID: created.SourceRevision.RevisionID, OrderedStepIDs: []string{config.Steps[1].ID, config.Steps[0].ID}, UpdatedAt: 200}
	if _, err = store.ReorderAdvancedSource(ctx, request); err == nil {
		t.Fatal("missing card was repaired")
	}
	after, _ := store.projection.cardRevisionsBySource(ctx, source.ID)
	current, _, _ := store.projection.CurrentEntity(ctx, EntityCardSource, source.ID)
	if !reflect.DeepEqual(before, after) || !reflect.DeepEqual(current, created.SourceRevision) {
		t.Fatal("failed reorder changed source/cards")
	}
	if _, found, err := store.findAppliedOperation(ctx, request.OperationID); err != nil || found {
		t.Fatal("failed reorder wrote batch", err)
	}
}
