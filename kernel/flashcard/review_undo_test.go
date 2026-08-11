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
	"reflect"
	"testing"
)

func TestUndoReviewRestoresReviewEffectsAndStatistics(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	createdAt := int64(1786431600000)
	sourceID := "source-review-undo"
	forwardTemplateID := "template-review-undo-forward"
	reverseTemplateID := "template-review-undo-reverse"
	preset := testSchedulerPreset("preset-review-undo", true, true)
	source := testGenerationSource(sourceID, "schema-review-undo", "qa", json.RawMessage(`{}`))
	source.DefaultPresetID = preset.ID
	applyGenerationEntities(t, ctx, store, "setup-review-undo", createdAt,
		testGenerationSchema("schema-review-undo", []string{forwardTemplateID, reverseTemplateID}),
		testGenerationTemplate(forwardTemplateID, "schema-review-undo", GenerationStatic, "forward", true),
		testGenerationTemplate(reverseTemplateID, "schema-review-undo", GenerationStatic, "reverse", true),
		source, preset)
	if _, err := store.ReconcileSourceCards(ctx, "reconcile-review-undo", sourceID, createdAt); err != nil {
		t.Fatal(err)
	}
	reviewSet := ReviewSet{ID: "review-set-undo", Name: "Review Set", QueryAST: mustRawJSON(t, QueryAST{
		Version: QueryVersion, Root: QueryExpression{Operator: QueryMatchAll},
	}), NewLimit: 20, ReviewLimit: 200, DefaultReviewMode: "normal"}
	if _, err := store.MutateEntities(ctx, "setup-review-set-undo", []EntityMutation{{
		EntityType: EntityReviewSet, EntityID: reviewSet.ID, UpdatedAt: createdAt,
		Payload: mustRawJSON(t, reviewSet),
	}}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.StartStudySession(ctx, StudyQueueRequest{
		OperationID: "start-review-undo-session", SessionID: "session-review-undo", ReviewSetID: reviewSet.ID,
		ReviewMode: "normal", Now: createdAt,
	}); err != nil {
		t.Fatal(err)
	}
	cardID := GeneratedCardID(sourceID, forwardTemplateID, "forward")
	siblingID := GeneratedCardID(sourceID, reverseTemplateID, "reverse")
	before := currentReviewStateForUndoTest(t, ctx, store, cardID)
	siblingBefore := currentReviewStateForUndoTest(t, ctx, store, siblingID)
	reviewedAt := createdAt + 60000
	review, err := store.ReviewCard(ctx, ReviewRequest{
		OperationID: "review-before-undo", CardID: cardID, Rating: ReviewGood, ReviewedAt: reviewedAt,
		DurationMS: 1200, SessionID: "session-review-undo", ReviewSetID: reviewSet.ID, ReviewMode: "normal",
		BuryUntil: reviewedAt + 86400000,
	})
	if err != nil {
		t.Fatal(err)
	}
	if reviews, queryErr := store.Projection().statisticsReviews(ctx, createdAt, reviewedAt+1, nil); queryErr != nil || len(reviews) != 1 {
		t.Fatalf("review was not included before undo: reviews=%d err=%v", len(reviews), queryErr)
	}
	request := ReviewUndoRequest{OperationID: "undo-review", ReviewEventID: review.Event.EventID,
		CardID: cardID, UndoneAt: reviewedAt + 1000}
	result, err := store.UndoReview(ctx, request)
	if err != nil {
		t.Fatal(err)
	}
	if result.Event.EventType != EventReviewUndone || result.RestoredState == nil ||
		len(result.RestoredSiblingIDs) != 1 || result.RestoredSiblingIDs[0] != siblingID ||
		len(result.RestoredSessionCardIDs) != 1 || result.RestoredSessionCardIDs[0] != siblingID ||
		result.SessionCard == nil || result.SessionCard.Status != "queued" {
		t.Fatalf("unexpected review undo result: %+v", result)
	}
	after := currentReviewStateForUndoTest(t, ctx, store, cardID)
	expected := before
	expected.StateRevisionID = OperationRevisionID(request.OperationID, EntityReviewState, cardID)
	if !reflect.DeepEqual(after, expected) {
		t.Fatalf("review state was not restored:\nactual:   %+v\nexpected: %+v", after, expected)
	}
	siblingAfter := currentReviewStateForUndoTest(t, ctx, store, siblingID)
	siblingBefore.StateRevisionID = OperationRevisionID(request.OperationID, EntityReviewState, siblingID)
	if !reflect.DeepEqual(siblingAfter, siblingBefore) {
		t.Fatalf("sibling state was not restored:\nactual:   %+v\nexpected: %+v", siblingAfter, siblingBefore)
	}
	if reviews, queryErr := store.Projection().statisticsReviews(ctx, createdAt, request.UndoneAt+1, nil); queryErr != nil || len(reviews) != 0 {
		t.Fatalf("undone review remained in statistics: reviews=%d err=%v", len(reviews), queryErr)
	}
	history, err := store.Projection().CardHistory(ctx, cardID, 10, 0)
	if err != nil || len(history) != 2 || history[0].EventType != EventReviewUndone ||
		history[1].EventType != EventReview {
		t.Fatalf("review history did not preserve review and undo: history=%+v err=%v", history, err)
	}
	retried, err := store.UndoReview(ctx, request)
	if err != nil || retried.Batch.BatchID != result.Batch.BatchID || retried.Event.EventID != result.Event.EventID {
		t.Fatalf("review undo retry was not idempotent: result=%+v err=%v", retried, err)
	}
	conflicting := request
	conflicting.UndoneAt++
	if _, err = store.UndoReview(ctx, conflicting); !errors.Is(err, ErrOperationConflict) {
		t.Fatalf("conflicting review undo retry was not rejected: %v", err)
	}
	secondOperation := request
	secondOperation.OperationID = "undo-review-again"
	if _, err = store.UndoReview(ctx, secondOperation); err == nil {
		t.Fatal("already undone review was accepted")
	}
}

func TestUndoReviewRejectsChangedState(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	createdAt := int64(1786431600000)
	preset := testSchedulerPreset("preset-review-undo-change", false, false)
	source := testGenerationSource("source-review-undo-change", "schema-review-undo-change", "qa",
		json.RawMessage(`{}`))
	source.DefaultPresetID = preset.ID
	applyGenerationEntities(t, ctx, store, "setup-review-undo-change", createdAt,
		testGenerationSchema(source.SchemaID, []string{"template-review-undo-change"}),
		testGenerationTemplate("template-review-undo-change", source.SchemaID, GenerationStatic, "front", true),
		source, preset)
	if _, err := store.ReconcileSourceCards(ctx, "reconcile-review-undo-change", source.ID, createdAt); err != nil {
		t.Fatal(err)
	}
	cardID := GeneratedCardID(source.ID, "template-review-undo-change", "front")
	review, err := store.ReviewCard(ctx, ReviewRequest{OperationID: "review-before-change", CardID: cardID,
		Rating: ReviewGood, ReviewedAt: createdAt + 1000, DurationMS: 200, ReviewMode: "normal"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = store.ManageCards(ctx, CardManagementRequest{OperationID: "change-after-review", CardIDs: []string{cardID},
		Action: "suspend", ChangedAt: createdAt + 2000}); err != nil {
		t.Fatal(err)
	}
	_, err = store.UndoReview(ctx, ReviewUndoRequest{OperationID: "undo-after-change",
		ReviewEventID: review.Event.EventID, CardID: cardID, UndoneAt: createdAt + 3000})
	if err == nil {
		t.Fatal("review undo overwrote a newer card state")
	}
}

func TestUndoReviewRemovesNewLeechAssignment(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	createdAt := int64(1786431600000)
	preset := testSchedulerPreset("preset-review-undo-leech", false, false)
	source := testGenerationSource("source-review-undo-leech", "schema-review-undo-leech", "qa",
		json.RawMessage(`{}`))
	source.DefaultPresetID = preset.ID
	applyGenerationEntities(t, ctx, store, "setup-review-undo-leech", createdAt,
		testGenerationSchema(source.SchemaID, []string{"template-review-undo-leech"}),
		testGenerationTemplate("template-review-undo-leech", source.SchemaID, GenerationStatic, "front", true),
		source, preset)
	if _, err := store.ReconcileSourceCards(ctx, "reconcile-review-undo-leech", source.ID, createdAt); err != nil {
		t.Fatal(err)
	}
	cardID := GeneratedCardID(source.ID, "template-review-undo-leech", "front")
	current, found, err := store.Projection().CurrentEntity(ctx, EntityReviewState, cardID)
	if err != nil || !found {
		t.Fatalf("leech state was not found: found=%v err=%v", found, err)
	}
	state := ReviewState{CardID: cardID, ReviewStateSnapshot: ReviewStateSnapshot{
		State: "review", Due: createdAt, LastReview: createdAt - 86400000, Stability: 10, Difficulty: 5,
		ScheduledDays: 10, Reps: 10, Lapses: 7,
		StateRevisionID: OperationRevisionID("prepare-review-undo-leech", EntityReviewState, cardID),
	}}
	if _, err = store.MutateEntities(ctx, "prepare-review-undo-leech", []EntityMutation{{
		EntityType: EntityReviewState, EntityID: cardID, ExpectedRevisionID: current.RevisionID,
		UpdatedAt: createdAt + 1, Payload: mustRawJSON(t, state),
	}}); err != nil {
		t.Fatal(err)
	}
	review, err := store.ReviewCard(ctx, ReviewRequest{OperationID: "review-undo-leech", CardID: cardID,
		Rating: ReviewAgain, ReviewedAt: createdAt + 1000, DurationMS: 200, ReviewMode: "normal"})
	if err != nil || !review.LeechTagged {
		t.Fatalf("review did not add the leech tag: result=%+v err=%v", review, err)
	}
	undo, err := store.UndoReview(ctx, ReviewUndoRequest{OperationID: "undo-review-leech",
		ReviewEventID: review.Event.EventID, CardID: cardID, UndoneAt: createdAt + 2000})
	if err != nil || !undo.LeechTagRemoved {
		t.Fatalf("review undo did not remove the leech assignment: result=%+v err=%v", undo, err)
	}
	assignmentID := DeterministicID("tag-assignment", builtinLeechTagID, "card", cardID)
	assignment, found, err := store.Projection().CurrentEntity(ctx, EntityTagAssignment, assignmentID)
	if err != nil || !found || !assignment.Deleted {
		t.Fatalf("leech assignment was not tombstoned: revision=%+v found=%v err=%v", assignment, found, err)
	}
	tag, found, err := store.Projection().CurrentEntity(ctx, EntityTag, builtinLeechTagID)
	if err != nil || !found || tag.Deleted {
		t.Fatalf("shared leech tag was removed: revision=%+v found=%v err=%v", tag, found, err)
	}
}

func currentReviewStateForUndoTest(t *testing.T, ctx context.Context, store *Store,
	cardID string) ReviewStateSnapshot {
	t.Helper()
	revision, found, err := store.Projection().CurrentEntity(ctx, EntityReviewState, cardID)
	if err != nil || !found || revision.Deleted {
		t.Fatalf("review state was not found: card=%s found=%v err=%v", cardID, found, err)
	}
	var state ReviewState
	if err = decodeStrictJSON(revision.Payload, &state); err != nil {
		t.Fatal(err)
	}
	return state.ReviewStateSnapshot
}
