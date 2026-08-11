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

func TestStudySessionFreezesPriorityQueueAndTracksReviewLifecycle(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	createdAt := int64(1786431600000)
	schemaID := "schema-session"
	templateID := "template-session"
	preset := testSchedulerPreset("preset-session", false, false)
	sources := []CardSource{
		testGenerationSource("source-session-exam", schemaID, "qa", json.RawMessage(`{}`)),
		testGenerationSource("source-session-learning", schemaID, "qa", json.RawMessage(`{}`)),
		testGenerationSource("source-session-retaining", schemaID, "qa", json.RawMessage(`{}`)),
		testGenerationSource("source-session-paused", schemaID, "qa", json.RawMessage(`{}`)),
	}
	priorities := []string{"exam", "learning", "retaining", "paused"}
	values := []any{
		testGenerationSchema(schemaID, []string{templateID}),
		testGenerationTemplate(templateID, schemaID, GenerationStatic, "forward", true), preset,
	}
	for index := range sources {
		sources[index].DefaultPresetID = preset.ID
		sources[index].Priority = priorities[index]
		values = append(values, sources[index])
	}
	applyGenerationEntities(t, ctx, store, "setup-session", createdAt, values...)
	cardIDs := make([]string, len(sources))
	for index, source := range sources {
		if _, err := store.ReconcileSourceCards(ctx, "reconcile-session-"+source.ID, source.ID, createdAt); err != nil {
			t.Fatal(err)
		}
		cardIDs[index] = GeneratedCardID(source.ID, templateID, "forward")
	}
	setReviewStateForTest(t, ctx, store, "set-session-review", cardIDs[1], createdAt+1, createdAt-100, 4)
	query := QueryAST{Version: QueryVersion, Root: QueryExpression{Operator: QueryMatchAll}}
	request := StudyQueueRequest{
		OperationID: "start-session", SessionID: "session-priority", Query: &query, ReviewMode: "normal",
		Seed: "stable-seed", Now: createdAt + 100, NewLimit: 1, ReviewLimit: 1,
	}
	validationErr := errors.New("blocked card source")
	blocked := request
	blocked.OperationID = "start-blocked-session"
	blocked.SessionID = "blocked-session"
	blocked.ValidateCardIDs = func(_ context.Context, cardIDs []string) error {
		if len(cardIDs) != 2 {
			t.Fatalf("unexpected queue passed to isolation validation: %v", cardIDs)
		}
		return validationErr
	}
	if _, err := store.StartStudySession(ctx, blocked); !errors.Is(err, validationErr) {
		t.Fatalf("study session ignored card isolation validation: %v", err)
	}
	if _, found, err := store.Projection().CurrentEntity(ctx, EntityStudySession, blocked.SessionID); err != nil || found {
		t.Fatalf("rejected study session left persisted state: found=%v err=%v", found, err)
	}
	result, err := store.StartStudySession(ctx, request)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.SessionCards) != 2 || result.SessionCards[0].CardID != cardIDs[0] ||
		result.SessionCards[1].CardID != cardIDs[1] {
		t.Fatalf("unexpected priority and limit queue: %#v", result.SessionCards)
	}
	retry, err := store.StartStudySession(ctx, request)
	if err != nil || retry.Batch.BatchID != result.Batch.BatchID {
		t.Fatalf("session retry was not idempotent: result=%#v err=%v", retry, err)
	}
	conflicting := request
	conflicting.Seed = "different-seed"
	if _, err = store.StartStudySession(ctx, conflicting); !errors.Is(err, ErrOperationConflict) {
		t.Fatalf("expected conflicting session retry, got %v", err)
	}
	queue, err := store.Projection().SessionQueue(ctx, request.SessionID)
	if err != nil || len(queue) != 2 || queue[0].Card.ID != cardIDs[0] {
		t.Fatalf("unexpected persisted session queue: queue=%#v err=%v", queue, err)
	}

	review, err := store.ReviewCard(ctx, ReviewRequest{
		OperationID: "review-session-card", CardID: cardIDs[0], Rating: ReviewGood,
		ReviewedAt: createdAt + 1000, DurationMS: 800, SessionID: request.SessionID, ReviewMode: "normal",
	})
	if err != nil {
		t.Fatal(err)
	}
	if review.SessionCard == nil || review.SessionCard.Status != "reviewed" {
		t.Fatalf("review did not advance its session card: %#v", review.SessionCard)
	}
	skipped, err := store.UpdateSessionCard(ctx, SessionCardUpdateRequest{
		OperationID: "skip-session-card", SessionID: request.SessionID, CardID: cardIDs[1],
		Status: "skipped", SkipReason: "later", UpdatedAt: createdAt + 1100,
	})
	if err != nil || skipped.Status != "skipped" {
		t.Fatalf("session card was not skipped: card=%#v err=%v", skipped, err)
	}
	if _, err = store.ReviewCard(ctx, ReviewRequest{
		OperationID: "review-skipped-session-card", CardID: cardIDs[1], Rating: ReviewGood,
		ReviewedAt: createdAt + 1200, DurationMS: 800, SessionID: request.SessionID, ReviewMode: "normal",
	}); err == nil {
		t.Fatal("skipped session card was reviewed without first being restored")
	}
	restored, err := store.UpdateSessionCard(ctx, SessionCardUpdateRequest{
		OperationID: "restore-session-card", SessionID: request.SessionID, CardID: cardIDs[1],
		Status: "queued", UpdatedAt: createdAt + 1250,
	})
	if err != nil || restored.Status != "queued" {
		t.Fatalf("session card was not restored before completion: card=%#v err=%v", restored, err)
	}
	finished, err := store.FinishStudySession(ctx, FinishSessionRequest{
		OperationID: "finish-session", SessionID: request.SessionID, Status: "completed", EndedAt: createdAt + 1300,
	})
	if err != nil || finished.Status != "completed" {
		t.Fatalf("study session was not completed: session=%#v err=%v", finished, err)
	}
	queue, err = store.Projection().SessionQueue(ctx, request.SessionID)
	if err != nil || queue[1].SessionCard.Status != "skipped" ||
		queue[1].SessionCard.SkipReason != "session-completed" {
		t.Fatalf("completion did not persistently skip pending cards: queue=%#v err=%v", queue, err)
	}
	if _, err = store.UpdateSessionCard(ctx, SessionCardUpdateRequest{
		OperationID: "update-finished-session", SessionID: request.SessionID, CardID: cardIDs[1],
		Status: "queued", UpdatedAt: createdAt + 1400,
	}); err == nil {
		t.Fatal("finished session accepted a card update")
	}
}

func TestReinforcementSessionCanExplicitlyIncludePausedCards(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	createdAt := int64(1786431600000)
	schemaID := "schema-reinforcement-session"
	templateID := "template-reinforcement-session"
	source := testGenerationSource("source-reinforcement-paused", schemaID, "qa", json.RawMessage(`{}`))
	source.Priority = "paused"
	preset := testSchedulerPreset("preset-reinforcement-session", false, false)
	source.DefaultPresetID = preset.ID
	applyGenerationEntities(t, ctx, store, "setup-reinforcement-session", createdAt,
		testGenerationSchema(schemaID, []string{templateID}),
		testGenerationTemplate(templateID, schemaID, GenerationStatic, "forward", true), source, preset)
	if _, err := store.ReconcileSourceCards(ctx, "reconcile-reinforcement-session", source.ID, createdAt); err != nil {
		t.Fatal(err)
	}
	query := QueryAST{Version: QueryVersion, Root: QueryExpression{Operator: QueryMatchAll}}
	withoutPaused, err := store.StartStudySession(ctx, StudyQueueRequest{
		OperationID: "reinforcement-without-paused", SessionID: "reinforcement-without-paused", Query: &query,
		ReviewMode: "reinforcement", Now: createdAt, NewLimit: 10, ReviewLimit: 10,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(withoutPaused.SessionCards) != 0 {
		t.Fatalf("paused card entered reinforcement without explicit inclusion: %#v", withoutPaused.SessionCards)
	}
	withPaused, err := store.StartStudySession(ctx, StudyQueueRequest{
		OperationID: "reinforcement-with-paused", SessionID: "reinforcement-with-paused", Query: &query,
		ReviewMode: "reinforcement", Now: createdAt, NewLimit: 10, ReviewLimit: 10, IncludePaused: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(withPaused.SessionCards) != 1 {
		t.Fatalf("explicit paused reinforcement did not include the card: %#v", withPaused.SessionCards)
	}
}
