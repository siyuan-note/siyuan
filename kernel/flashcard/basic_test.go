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
	"errors"
	"testing"
)

func TestCreateBasicBidirectionalSourceKeepsIndependentCards(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	applyGenerationEntities(t, ctx, store, "basic-preset", 1,
		testSchedulerPreset(legacyPresetID, false, false))

	request := BasicSourceRequest{OperationID: "create-basic", SourceID: "source-basic",
		BlockIDs:  []string{"block-prompt", "block-answer-1", "block-answer-2"},
		Direction: BasicDirectionBidirectional, CreatedAt: 100}
	result, err := store.CreateBasicSource(ctx, request)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Cards.Created) != 2 {
		t.Fatalf("bidirectional source did not create two cards: %+v", result)
	}
	forwardID := GeneratedCardID(request.SourceID, basicForwardTemplateID, BasicDirectionForward)
	reverseID := GeneratedCardID(request.SourceID, basicReverseTemplateID, BasicDirectionReverse)
	setReviewStateForTest(t, ctx, store, "review-basic-forward", forwardID, 110, 500, 3)
	assertReviewStateForTest(t, ctx, store, reverseID, 100, 0)

	retry, err := store.CreateBasicSource(ctx, request)
	if err != nil || retry.SourceRevision.RevisionID != result.SourceRevision.RevisionID {
		t.Fatalf("basic source retry was not idempotent: result=%+v err=%v", retry, err)
	}
	closed, err := store.UpdateBasicSourceDirection(ctx, BasicDirectionRequest{OperationID: "close-basic",
		SourceID: request.SourceID, Direction: BasicDirectionClosed, UpdatedAt: 120})
	if err != nil || len(closed.Cards.Updated) != 2 {
		t.Fatalf("closing a basic source did not disable both cards: result=%+v err=%v", closed, err)
	}
	if closed.Cards.Batch == nil || closed.Cards.Batch.OperationID != "close-basic" ||
		len(closed.Cards.Batch.Changes) != 3 {
		t.Fatalf("basic direction update was not persisted atomically: %+v", closed.Cards.Batch)
	}
	if cardStatusForTest(t, ctx, store, forwardID) != GenerationDisabledByTemplate ||
		cardStatusForTest(t, ctx, store, reverseID) != GenerationDisabledByTemplate {
		t.Fatal("closed basic source left an active direction")
	}
	reopened, err := store.UpdateBasicSourceDirection(ctx, BasicDirectionRequest{OperationID: "reopen-basic",
		SourceID: request.SourceID, Direction: BasicDirectionForward, UpdatedAt: 130})
	if err != nil || len(reopened.Cards.Updated) != 1 {
		t.Fatalf("reopening a basic source did not restore its forward card: result=%+v err=%v", reopened, err)
	}
	if cardStatusForTest(t, ctx, store, forwardID) != GenerationActive ||
		cardStatusForTest(t, ctx, store, reverseID) != GenerationDisabledByTemplate {
		t.Fatal("reopened basic source has incorrect active directions")
	}
	assertReviewStateForTest(t, ctx, store, forwardID, 500, 3)
	reopenedRetry, err := store.UpdateBasicSourceDirection(ctx, BasicDirectionRequest{OperationID: "reopen-basic",
		SourceID: request.SourceID, Direction: BasicDirectionForward, UpdatedAt: 130})
	if err != nil || reopenedRetry.SourceRevision.RevisionID != reopened.SourceRevision.RevisionID {
		t.Fatalf("basic direction retry was not idempotent: result=%+v err=%v", reopenedRetry, err)
	}
}

func TestCreateBasicForwardSourceKeepsBothStableDirectionsAndMemberships(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	applyGenerationEntities(t, ctx, store, "basic-forward-dependencies", 1,
		testSchedulerPreset(legacyPresetID, false, false))
	reviewSet := ReviewSet{ID: "basic-forward-set", Name: "Forward", NewLimit: 20, ReviewLimit: 200,
		DefaultReviewMode: "normal"}
	revision, err := NewOperationEntityRevision("basic-forward-set", EntityReviewSet, reviewSet.ID, nil, 1, false,
		reviewSet)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = store.Apply(ctx, "basic-forward-set",
		[]Change{{Kind: RecordEntityRevision, Revision: &revision}}); err != nil {
		t.Fatal(err)
	}
	request := BasicSourceRequest{OperationID: "create-basic-forward", SourceID: "source-basic-forward",
		BlockIDs: []string{"block-prompt", "block-answer"}, Direction: BasicDirectionForward,
		ReviewSetIDs: []string{"basic-forward-set"}, CreatedAt: 100}
	result, err := store.CreateBasicSource(ctx, request)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Cards.Created) != 2 || len(result.Memberships) != 2 || result.Cards.Batch == nil ||
		result.Cards.Batch.OperationID != request.OperationID {
		t.Fatalf("basic source did not create stable directions atomically: %+v", result)
	}
	forwardID := GeneratedCardID(request.SourceID, basicForwardTemplateID, BasicDirectionForward)
	reverseID := GeneratedCardID(request.SourceID, basicReverseTemplateID, BasicDirectionReverse)
	if cardStatusForTest(t, ctx, store, forwardID) != GenerationActive ||
		cardStatusForTest(t, ctx, store, reverseID) != GenerationDisabledByTemplate {
		t.Fatal("forward basic source has incorrect direction states")
	}
}

func TestDeletedBasicSourceCannotChangeDirection(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	applyGenerationEntities(t, ctx, store, "basic-deleted-preset", 1,
		testSchedulerPreset(legacyPresetID, false, false))
	const sourceID = "source-basic-deleted"
	if _, err := store.CreateBasicSource(ctx, BasicSourceRequest{OperationID: "basic-deleted-create",
		SourceID: sourceID, BlockIDs: []string{"block-prompt", "block-answer"},
		Direction: BasicDirectionForward, CreatedAt: 100}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.ManageSourceLifecycle(ctx, SourceLifecycleRequest{OperationID: "basic-deleted-delete",
		SourceID: sourceID, Action: SourceActionDelete, ChangedAt: 110}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.UpdateBasicSourceDirection(ctx, BasicDirectionRequest{OperationID: "basic-deleted-direction",
		SourceID: sourceID, Direction: BasicDirectionReverse, UpdatedAt: 120}); err == nil {
		t.Fatal("deleted basic source changed direction")
	}
}

func TestSourceDisabledTemplateDoesNotCreateCard(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	applyGenerationEntities(t, ctx, store, "setup-source-disabled", 100,
		testGenerationSchema("schema-disabled", []string{"template-enabled", "template-source-disabled"}),
		testGenerationTemplate("template-enabled", "schema-disabled", GenerationStatic, "enabled", true),
		testGenerationTemplate("template-source-disabled", "schema-disabled", GenerationStatic, "disabled", true),
		CardSource{ID: "source-disabled", SchemaID: "schema-disabled", SourceType: "qa",
			PrimaryRefID: "ref-source-disabled", GenerationConfig: []byte(`{}`), Status: "active",
			DisabledTemplateIDs: []string{"template-source-disabled"}})
	result, err := store.ReconcileSourceCards(ctx, "reconcile-source-disabled", "source-disabled", 110)
	if err != nil || len(result.Created) != 1 {
		t.Fatalf("source template override was not applied: result=%+v err=%v", result, err)
	}
	disabledCardID := GeneratedCardID("source-disabled", "template-source-disabled", "disabled")
	if _, found, queryErr := store.Projection().CurrentEntity(ctx, EntityCard, disabledCardID); queryErr != nil || found {
		t.Fatalf("disabled source template unexpectedly created a card: found=%v err=%v", found, queryErr)
	}
}

func TestCreateBasicSourceIsAtomicAndCreateOnly(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	applyGenerationEntities(t, ctx, store, "basic-atomic-preset", 1,
		testSchedulerPreset(legacyPresetID, false, false))
	request := BasicSourceRequest{OperationID: "create-basic-invalid-set", SourceID: "source-basic-atomic",
		BlockIDs: []string{"block-prompt", "block-answer"}, Direction: BasicDirectionForward,
		ReviewSetIDs: []string{"missing-review-set"}, CreatedAt: 100}
	if _, err := store.CreateBasicSource(ctx, request); err == nil {
		t.Fatal("basic source with an invalid review set was accepted")
	}
	if _, found, err := store.Projection().CurrentEntity(ctx, EntityCardSource, request.SourceID); err != nil || found {
		t.Fatalf("failed basic source creation left partial state: found=%v err=%v", found, err)
	}
	request.OperationID = "create-basic-valid"
	request.ReviewSetIDs = nil
	if _, err := store.CreateBasicSource(ctx, request); err != nil {
		t.Fatal(err)
	}
	request.OperationID = "create-basic-overwrite"
	if _, err := store.CreateBasicSource(ctx, request); !errors.Is(err, ErrRevisionConflict) {
		t.Fatalf("basic source creation overwrote an existing source: %v", err)
	}
}
