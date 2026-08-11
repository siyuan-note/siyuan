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
	"encoding/json"
	"errors"
	"testing"
)

func TestManageCardsPersistsAuditedStateAndMetadataChanges(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	createdAt := int64(1786431600000)
	schemaID := "schema-management"
	templateID := "template-management"
	source := testGenerationSource("source-management", schemaID, "qa", json.RawMessage(`{}`))
	preset := testSchedulerPreset("preset-management", false, false)
	source.DefaultPresetID = preset.ID
	applyGenerationEntities(t, ctx, store, "setup-management", createdAt,
		testGenerationSchema(schemaID, []string{templateID}),
		testGenerationTemplate(templateID, schemaID, GenerationStatic, "forward", true), source, preset)
	if _, err := store.ReconcileSourceCards(ctx, "reconcile-management", source.ID, createdAt); err != nil {
		t.Fatal(err)
	}
	cardID := GeneratedCardID(source.ID, templateID, "forward")
	stateRevision, found, err := store.Projection().CurrentEntity(ctx, EntityReviewState, cardID)
	if err != nil || !found {
		t.Fatalf("review state was not found: found=%v err=%v", found, err)
	}
	suspendRequest := CardManagementRequest{
		OperationID: "manage-suspend", CardIDs: []string{cardID}, Action: CardActionSuspend,
		ChangedAt: createdAt + 100, ExpectedStateRevisions: map[string]string{cardID: stateRevision.RevisionID},
	}
	suspended, err := store.ManageCards(ctx, suspendRequest)
	if err != nil {
		t.Fatal(err)
	}
	if !suspended.States[cardID].Suspended || len(suspended.Events) != 1 {
		t.Fatalf("unexpected suspend result: %#v", suspended)
	}
	retry, err := store.ManageCards(ctx, suspendRequest)
	if err != nil || retry.Batch.BatchID != suspended.Batch.BatchID {
		t.Fatalf("suspend retry was not idempotent: result=%#v err=%v", retry, err)
	}
	conflicting := suspendRequest
	conflicting.Action = CardActionResume
	if _, err = store.ManageCards(ctx, conflicting); !errors.Is(err, ErrOperationConflict) {
		t.Fatalf("expected conflicting management retry, got %v", err)
	}

	buriedUntil := createdAt + 86400000
	buried, err := store.ManageCards(ctx, CardManagementRequest{
		OperationID: "manage-bury", CardIDs: []string{cardID}, Action: CardActionBury,
		ChangedAt: createdAt + 200, BuriedUntil: buriedUntil, Reason: "manual",
	})
	if err != nil {
		t.Fatal(err)
	}
	if buried.States[cardID].BuriedUntil != buriedUntil || buried.States[cardID].BuriedReason != "manual" {
		t.Fatalf("unexpected buried state: %#v", buried.States[cardID])
	}
	setReviewStateForTest(t, ctx, store, "prepare-management-reset", cardID, createdAt+300, createdAt+5000, 7)
	reset, err := store.ManageCards(ctx, CardManagementRequest{
		OperationID: "manage-reset", CardIDs: []string{cardID}, Action: CardActionReset, ChangedAt: createdAt + 400,
	})
	if err != nil {
		t.Fatal(err)
	}
	resetState := reset.States[cardID]
	if resetState.State != "new" || resetState.Reps != 0 || !resetState.Suspended ||
		resetState.BuriedUntil != buriedUntil {
		t.Fatalf("reset did not preserve independent availability state: %#v", resetState)
	}
	flagged, err := store.ManageCards(ctx, CardManagementRequest{
		OperationID: "manage-flag", CardIDs: []string{cardID}, Action: CardActionSetFlag,
		ChangedAt: createdAt + 500, Flag: 7,
	})
	if err != nil || flagged.Cards[cardID].Flag != 7 {
		t.Fatalf("card flag was not updated: result=%#v err=%v", flagged, err)
	}
	history, err := store.Projection().CardHistory(ctx, cardID, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(history) != 4 {
		t.Fatalf("management history is incomplete: %#v", history)
	}
	for _, event := range history {
		if event.EventType != EventCardStateChanged {
			t.Fatalf("unexpected event in management-only history: %#v", event)
		}
	}
}

func TestManageCardsRejectsWholeBatchWhenOneCardIsMissing(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	createdAt := int64(1786431600000)
	schemaID := "schema-management-atomic"
	templateID := "template-management-atomic"
	source := testGenerationSource("source-management-atomic", schemaID, "qa", json.RawMessage(`{}`))
	preset := testSchedulerPreset("preset-management-atomic", false, false)
	source.DefaultPresetID = preset.ID
	applyGenerationEntities(t, ctx, store, "setup-management-atomic", createdAt,
		testGenerationSchema(schemaID, []string{templateID}),
		testGenerationTemplate(templateID, schemaID, GenerationStatic, "forward", true), source, preset)
	if _, err := store.ReconcileSourceCards(ctx, "reconcile-management-atomic", source.ID, createdAt); err != nil {
		t.Fatal(err)
	}
	cardID := GeneratedCardID(source.ID, templateID, "forward")
	before, found, err := store.Projection().CurrentEntity(ctx, EntityReviewState, cardID)
	if err != nil || !found {
		t.Fatalf("review state was not found: found=%v err=%v", found, err)
	}
	if _, err = store.ManageCards(ctx, CardManagementRequest{
		OperationID: "manage-atomic", CardIDs: []string{cardID, "missing-card"},
		Action: CardActionSuspend, ChangedAt: createdAt + 100,
	}); !errors.Is(err, ErrEntityNotFound) {
		t.Fatalf("expected missing card error, got %v", err)
	}
	after, found, err := store.Projection().CurrentEntity(ctx, EntityReviewState, cardID)
	if err != nil || !found || after.RevisionID != before.RevisionID {
		t.Fatalf("rejected batch changed its valid card: before=%s after=%s err=%v", before.RevisionID,
			after.RevisionID, err)
	}
}

func TestDeleteReviewSetPreservesCardsAndCompletedSessionHistory(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	now := int64(1786431600000)
	setupLegacyCompatibilityBuiltins(t, ctx, store, now)
	if _, err := store.CreateLegacyReviewSet(ctx, "delete-review-set-setup", "delete-deck", "Delete Set",
		now, 20, 200); err != nil {
		t.Fatal(err)
	}
	if _, err := store.AddLegacyQuickCards(ctx, "delete-review-set-card", "delete-deck", []string{"delete-block"},
		now+1); err != nil {
		t.Fatal(err)
	}
	reviewSetID := LegacyReviewSetID("delete-deck")
	endedAt := now + 1
	session := StudySession{ID: "completed-review-set-session", ReviewSetID: reviewSetID,
		ReviewMode: "normal", Status: "completed", Seed: "seed", SelectionDigest: "digest", StartedAt: now,
		EndedAt: &endedAt}
	if _, err := store.MutateEntities(ctx, "completed-review-set-session", []EntityMutation{{
		EntityType: EntityStudySession, EntityID: session.ID, UpdatedAt: endedAt, Payload: mustRawJSON(t, session),
	}}); err != nil {
		t.Fatal(err)
	}
	revision, found, err := store.Projection().CurrentEntity(ctx, EntityReviewSet, reviewSetID)
	if err != nil || !found {
		t.Fatalf("review set was not found: found=%v err=%v", found, err)
	}
	if _, err = store.DeleteReviewSet(ctx, "delete-review-set", reviewSetID, revision.RevisionID,
		now+2); err != nil {
		t.Fatal(err)
	}
	deletedRevision, found, err := store.Projection().CurrentEntity(ctx, EntityReviewSet, reviewSetID)
	if err != nil || !found || !deletedRevision.Deleted {
		t.Fatalf("review set was not deleted: found=%v revision=%+v err=%v", found, deletedRevision, err)
	}
	if _, found, err = store.Projection().CurrentEntity(ctx, EntityCard,
		LegacyQuickCardID("delete-block")); err != nil || !found {
		t.Fatalf("review set deletion removed a shared card: found=%v err=%v", found, err)
	}
	if _, found, err = store.Projection().CurrentEntity(ctx, EntityStudySession, session.ID); err != nil || !found {
		t.Fatalf("review set deletion removed completed session history: found=%v err=%v", found, err)
	}
}
