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

	"github.com/open-spaced-repetition/go-fsrs/v3"
)

func TestReviewCardPersistsFullEventAndBuriesSiblingIdempotently(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	createdAt := int64(1786431600000)
	schemaID := "schema-review"
	sourceID := "source-review"
	forwardTemplateID := "template-review-forward"
	reverseTemplateID := "template-review-reverse"
	preset := testSchedulerPreset("preset-review", true, true)
	source := testGenerationSource(sourceID, schemaID, "qa", json.RawMessage(`{}`))
	source.DefaultPresetID = preset.ID
	applyGenerationEntities(t, ctx, store, "setup-review", createdAt,
		testGenerationSchema(schemaID, []string{forwardTemplateID, reverseTemplateID}),
		testGenerationTemplate(forwardTemplateID, schemaID, GenerationStatic, "forward", true),
		testGenerationTemplate(reverseTemplateID, schemaID, GenerationStatic, "reverse", true),
		source, preset)
	if _, err := store.ReconcileSourceCards(ctx, "reconcile-review", sourceID, createdAt); err != nil {
		t.Fatal(err)
	}
	reviewSet := ReviewSet{
		ID: "review-set-1", Name: "Review Set", QueryAST: mustRawJSON(t, QueryAST{
			Version: QueryVersion, Root: QueryExpression{Operator: QueryMatchAll},
		}), NewLimit: 20, ReviewLimit: 200, DefaultReviewMode: "normal",
	}
	if _, err := store.MutateEntities(ctx, "setup-review-set", []EntityMutation{{
		EntityType: EntityReviewSet, EntityID: reviewSet.ID, UpdatedAt: createdAt, Payload: mustRawJSON(t, reviewSet),
	}}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.StartStudySession(ctx, StudyQueueRequest{
		OperationID: "start-review-session", SessionID: "session-1", ReviewSetID: reviewSet.ID,
		ReviewMode: "normal", Now: createdAt,
	}); err != nil {
		t.Fatal(err)
	}
	forwardCardID := GeneratedCardID(sourceID, forwardTemplateID, "forward")
	reverseCardID := GeneratedCardID(sourceID, reverseTemplateID, "reverse")
	reviewedAt := createdAt + 60000
	buryUntil := reviewedAt + 86400000
	request := ReviewRequest{
		OperationID:  "review-forward",
		CardID:       forwardCardID,
		Rating:       ReviewGood,
		ReviewedAt:   reviewedAt,
		DurationMS:   1500,
		SessionID:    "session-1",
		ReviewSetID:  "review-set-1",
		ReviewMode:   "normal",
		BuryUntil:    buryUntil,
		AnswerResult: mustRawJSON(t, []map[string]any{{"correct": true, "distance": 0}}),
	}
	result, err := store.ReviewCard(ctx, request)
	if err != nil {
		t.Fatal(err)
	}
	if result.Event.EventID != ReviewEventID(request.OperationID, forwardCardID) || result.AfterState == nil ||
		result.AfterState.Reps != 1 || len(result.BuriedSiblingIDs) != 1 ||
		result.BuriedSiblingIDs[0] != reverseCardID || result.PresetRevisionID == "" ||
		result.SchedulerVersion != SchedulerVersionFSRS6 || result.SessionCard == nil ||
		result.SessionCard.Status != "reviewed" || len(result.SkippedSessionCardIDs) != 1 ||
		result.SkippedSessionCardIDs[0] != reverseCardID {
		t.Fatalf("unexpected review result: %+v", result)
	}
	var payload ReviewEventPayload
	if err = decodeStrictJSON(result.Event.Payload, &payload); err != nil {
		t.Fatal(err)
	}
	if payload.BeforeState == nil || payload.AfterState == nil || payload.DurationMS == nil ||
		*payload.DurationMS != 1500 || payload.SessionID != "session-1" || payload.ReviewSetID != "review-set-1" ||
		payload.SchedulerVersion != SchedulerVersionFSRS6 || len(payload.SchedulerInput) == 0 {
		t.Fatalf("review event is incomplete: %+v", payload)
	}
	if string(payload.AnswerResult) != `[{"correct":true,"distance":0}]` ||
		string(result.SessionCard.StepResults) != string(payload.AnswerResult) {
		t.Fatalf("typed answer result was not persisted: event=%s session=%s", payload.AnswerResult,
			result.SessionCard.StepResults)
	}
	assertBuriedStateForTest(t, ctx, store, reverseCardID, buryUntil, "sibling")

	retried, err := store.ReviewCard(ctx, request)
	if err != nil {
		t.Fatal(err)
	}
	if retried.Batch.BatchID != result.Batch.BatchID || retried.Event.EventID != result.Event.EventID ||
		len(retried.BuriedSiblingIDs) != 1 || retried.BuriedSiblingIDs[0] != reverseCardID {
		t.Fatalf("idempotent review retry changed its result: %+v", retried)
	}
	if count, countErr := store.Projection().EventCount(ctx); countErr != nil || count != 1 {
		t.Fatalf("idempotent review retry duplicated its event: count=%d err=%v", count, countErr)
	}
	conflicting := request
	conflicting.Rating = ReviewEasy
	if _, err = store.ReviewCard(ctx, conflicting); !errors.Is(err, ErrOperationConflict) {
		t.Fatalf("conflicting review retry was not rejected: %v", err)
	}
}

func TestReinforcementReviewRecordsPracticeWithoutChangingSchedule(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	createdAt := int64(1786431600000)
	schemaID := "schema-reinforcement"
	sourceID := "source-reinforcement"
	templateID := "template-reinforcement"
	preset := testSchedulerPreset("preset-reinforcement", false, false)
	source := testGenerationSource(sourceID, schemaID, "qa", json.RawMessage(`{}`))
	source.DefaultPresetID = preset.ID
	applyGenerationEntities(t, ctx, store, "setup-reinforcement", createdAt,
		testGenerationSchema(schemaID, []string{templateID}),
		testGenerationTemplate(templateID, schemaID, GenerationStatic, "forward", true), source, preset)
	if _, err := store.ReconcileSourceCards(ctx, "reconcile-reinforcement", sourceID, createdAt); err != nil {
		t.Fatal(err)
	}
	cardID := GeneratedCardID(sourceID, templateID, "forward")
	beforeRevision, found, err := store.Projection().CurrentEntity(ctx, EntityReviewState, cardID)
	if err != nil || !found {
		t.Fatalf("review state was not found: found=%v err=%v", found, err)
	}
	result, err := store.ReviewCard(ctx, ReviewRequest{
		OperationID: "reinforcement-review",
		CardID:      cardID,
		Rating:      ReviewHard,
		ReviewedAt:  createdAt + 60000,
		DurationMS:  900,
		ReviewMode:  "reinforcement",
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.AfterState != nil {
		t.Fatal("reinforcement review changed the normal schedule")
	}
	afterRevision, found, err := store.Projection().CurrentEntity(ctx, EntityReviewState, cardID)
	if err != nil || !found || afterRevision.RevisionID != beforeRevision.RevisionID {
		t.Fatalf("reinforcement review wrote a state revision: before=%s after=%s err=%v",
			beforeRevision.RevisionID, afterRevision.RevisionID, err)
	}
	var projected int
	if err = store.Projection().db.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM review_events WHERE card_id = ? AND review_mode = 'reinforcement'", cardID).
		Scan(&projected); err != nil || projected != 1 {
		t.Fatalf("reinforcement review event was not projected: count=%d err=%v", projected, err)
	}
}

func TestReviewCardAddsStableLeechTagAtThreshold(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	createdAt := int64(1786431600000)
	preset := testSchedulerPreset("preset-leech-tag", false, false)
	source := testGenerationSource("source-leech", "schema-leech", "qa", json.RawMessage(`{}`))
	source.DefaultPresetID = preset.ID
	applyGenerationEntities(t, ctx, store, "setup-leech", createdAt,
		testGenerationSchema("schema-leech", []string{"template-leech"}),
		testGenerationTemplate("template-leech", "schema-leech", GenerationStatic, "front", true), source, preset)
	if _, err := store.ReconcileSourceCards(ctx, "reconcile-leech", source.ID, createdAt); err != nil {
		t.Fatal(err)
	}
	cardID := GeneratedCardID(source.ID, "template-leech", "front")
	current, found, err := store.Projection().CurrentEntity(ctx, EntityReviewState, cardID)
	if err != nil || !found {
		t.Fatalf("leech state was not found: found=%v err=%v", found, err)
	}
	state := ReviewState{CardID: cardID, ReviewStateSnapshot: ReviewStateSnapshot{
		State: "review", Due: createdAt, LastReview: createdAt - 86400000, Stability: 10, Difficulty: 5,
		ScheduledDays: 10, Reps: 10, Lapses: 7,
		StateRevisionID: OperationRevisionID("prepare-leech", EntityReviewState, cardID),
	}}
	if _, err = store.MutateEntities(ctx, "prepare-leech", []EntityMutation{{
		EntityType: EntityReviewState, EntityID: cardID, ExpectedRevisionID: current.RevisionID,
		UpdatedAt: createdAt + 1, Payload: mustRawJSON(t, state),
	}}); err != nil {
		t.Fatal(err)
	}
	request := ReviewRequest{OperationID: "review-leech", CardID: cardID, Rating: ReviewAgain,
		ReviewedAt: createdAt + 60000, DurationMS: 900, ReviewMode: "normal"}
	result, err := store.ReviewCard(ctx, request)
	if err != nil {
		t.Fatal(err)
	}
	if !result.LeechTagged || result.AfterState == nil || result.AfterState.Lapses < 8 {
		t.Fatalf("leech threshold did not tag the card: %+v", result)
	}
	assignmentID := DeterministicID("tag-assignment", builtinLeechTagID, "card", cardID)
	assignment, found, err := store.Projection().CurrentEntity(ctx, EntityTagAssignment, assignmentID)
	if err != nil || !found || assignment.Deleted {
		t.Fatalf("leech tag assignment was not persisted: revision=%+v found=%v err=%v", assignment, found, err)
	}
	tag, found, err := store.Projection().CurrentEntity(ctx, EntityTag, builtinLeechTagID)
	if err != nil || !found || tag.Deleted {
		t.Fatalf("stable leech tag was not persisted: revision=%+v found=%v err=%v", tag, found, err)
	}
	retry, err := store.ReviewCard(ctx, request)
	if err != nil || !retry.LeechTagged || retry.Batch.BatchID != result.Batch.BatchID {
		t.Fatalf("leech review retry was not idempotent: result=%+v err=%v", retry, err)
	}
}

func TestNormalReviewRejectsMissingSiblingDayBoundary(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	createdAt := int64(1786431600000)
	schemaID := "schema-burial-boundary"
	sourceID := "source-burial-boundary"
	firstTemplateID := "template-burial-a"
	secondTemplateID := "template-burial-b"
	preset := testSchedulerPreset("preset-burial-boundary", true, false)
	source := testGenerationSource(sourceID, schemaID, "qa", json.RawMessage(`{}`))
	source.DefaultPresetID = preset.ID
	applyGenerationEntities(t, ctx, store, "setup-burial-boundary", createdAt,
		testGenerationSchema(schemaID, []string{firstTemplateID, secondTemplateID}),
		testGenerationTemplate(firstTemplateID, schemaID, GenerationStatic, "a", true),
		testGenerationTemplate(secondTemplateID, schemaID, GenerationStatic, "b", true), source, preset)
	if _, err := store.ReconcileSourceCards(ctx, "reconcile-burial-boundary", sourceID, createdAt); err != nil {
		t.Fatal(err)
	}
	_, err := store.ReviewCard(ctx, ReviewRequest{
		OperationID: "review-without-boundary",
		CardID:      GeneratedCardID(sourceID, firstTemplateID, "a"),
		Rating:      ReviewGood,
		ReviewedAt:  createdAt + 60000,
		DurationMS:  1000,
		ReviewMode:  "normal",
	})
	if err == nil {
		t.Fatal("review with sibling burial enabled accepted a missing day boundary")
	}
	if _, found, stateErr := store.Projection().CurrentEntity(ctx, EntityReviewState,
		GeneratedCardID(sourceID, firstTemplateID, "a")); stateErr != nil || !found {
		t.Fatalf("failed review damaged current state: found=%v err=%v", found, stateErr)
	}
	if count, countErr := store.Projection().EventCount(ctx); countErr != nil || count != 0 {
		t.Fatalf("failed review reached authority projection: count=%d err=%v", count, countErr)
	}
}

func testSchedulerPreset(id string, buryNew, buryReview bool) SchedulerPreset {
	weights := fsrs.DefaultWeights()
	return SchedulerPreset{
		ID:                 id,
		Name:               id,
		SchedulerVersion:   SchedulerVersionFSRS6,
		RequestRetention:   0.9,
		MaximumInterval:    36500,
		Weights:            append([]float64(nil), weights[:]...),
		NewLimit:           20,
		ReviewLimit:        200,
		BuryNewSiblings:    buryNew,
		BuryReviewSiblings: buryReview,
		LeechThreshold:     8,
		LeechAction:        "tag",
	}
}

func assertBuriedStateForTest(t *testing.T, ctx context.Context, store *Store, cardID string, buriedUntil int64,
	reason string) {
	t.Helper()
	current, found, err := store.Projection().CurrentEntity(ctx, EntityReviewState, cardID)
	if err != nil || !found {
		t.Fatalf("buried review state was not found: found=%v err=%v", found, err)
	}
	var state ReviewState
	if err = decodeStrictJSON(current.Payload, &state); err != nil {
		t.Fatal(err)
	}
	if state.BuriedUntil != buriedUntil || state.BuriedReason != reason {
		t.Fatalf("unexpected buried state: %+v", state)
	}
}
