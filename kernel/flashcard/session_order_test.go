package flashcard

import (
	"context"
	"errors"
	"reflect"
	"testing"
)

func TestOrderedStudySessionPersistsSelectionAndLifecycle(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	now := int64(1786431600000)
	preset := testSchedulerPreset("ordered", false, false)
	ids := setupDailyLimitCards(t, ctx, store, now-1000, preset, 4)
	order := []string{ids[2], ids[0], ids[1]}
	request := StudyQueueRequest{OperationID: "ordered", SessionID: "ordered-session", Now: now,
		CardIDs: []string{ids[2], ids[0], ids[2], ids[1]}, ReviewMode: "normal", NewLimit: 10, ReviewLimit: 10}
	result, err := store.StartStudySession(ctx, request)
	if err != nil {
		t.Fatal(err)
	}
	assertOrderedSessionCards(t, result.SessionCards, order)
	if !reflect.DeepEqual(result.Session.CardIDs, order) {
		t.Fatalf("candidate order not persisted: %v", result.Session.CardIDs)
	}
	request.CardIDs = order
	if retry, retryErr := store.StartStudySession(ctx, request); retryErr != nil || retry.Batch.BatchID != result.Batch.BatchID {
		t.Fatalf("deduplicated retry failed: %v", retryErr)
	}
	for _, changed := range [][]string{nil, {ids[0], ids[2], ids[1]}, {ids[2], ids[0]}} {
		conflict := request
		conflict.CardIDs = changed
		if _, conflictErr := store.StartStudySession(ctx, conflict); !errors.Is(conflictErr, ErrOperationConflict) {
			t.Fatalf("changed candidate selection accepted: %v", conflictErr)
		}
	}
	review, err := store.ReviewCard(ctx, ReviewRequest{OperationID: "ordered-review", CardID: order[0],
		SessionID: request.SessionID, ReviewMode: "normal", Rating: ReviewEasy, ReviewedAt: now + 1})
	if err != nil || review.SessionCard == nil || review.SessionCard.Status != "reviewed" {
		t.Fatalf("ordered review failed: %+v %v", review, err)
	}
	queue, err := store.Projection().SessionQueue(ctx, request.SessionID)
	if err != nil || queue[0].ReviewState.Due <= now+1 {
		t.Fatalf("normal review did not update schedule: %+v %v", queue, err)
	}
	undo, err := store.UndoReview(ctx, ReviewUndoRequest{OperationID: "ordered-undo", CardID: order[0],
		ReviewEventID: review.Event.EventID, UndoneAt: now + 2})
	if err != nil || undo.SessionCard == nil || undo.SessionCard.Sort != 0 || undo.SessionCard.Status != "queued" {
		t.Fatalf("undo lost the original queue position: %+v %v", undo, err)
	}
	if err = store.RebuildProjection(ctx); err != nil {
		t.Fatal(err)
	}
	queue, err = store.Projection().SessionQueue(ctx, request.SessionID)
	if err != nil || len(queue) != len(order) {
		t.Fatalf("rebuild lost queue: %+v %v", queue, err)
	}
	for index, item := range queue {
		if item.Card.ID != order[index] || item.SessionCard.Sort != index {
			t.Fatalf("rebuild changed order: %+v", queue)
		}
	}
	if retry, retryErr := store.StartStudySession(ctx, request); retryErr != nil || retry.Batch.BatchID != result.Batch.BatchID {
		t.Fatalf("retry after rebuild failed: %v", retryErr)
	}
}

func TestOrderedStudySessionFiltersBeforeLimits(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	now := int64(1786431600000)
	preset := testSchedulerPreset("ordered-filter", false, false)
	preset.NewLimit = 2
	ids := setupDailyLimitCards(t, ctx, store, now-1000, preset, 6)
	setReviewStateForTest(t, ctx, store, "future", ids[0], now-100, now+100000, 4)
	if _, err := store.ManageCards(ctx, CardManagementRequest{OperationID: "suspend", CardIDs: []string{ids[1]},
		Action: CardActionSuspend, ChangedAt: now - 10}); err != nil {
		t.Fatal(err)
	}
	request := StudyQueueRequest{OperationID: "filtered-order", SessionID: "filtered-order", Now: now,
		CardIDs: []string{ids[0], ids[1], ids[4], ids[3], ids[2]}, ReviewMode: "normal", NewLimit: 10, ReviewLimit: 10}
	result, err := store.StartStudySession(ctx, request)
	if err != nil {
		t.Fatal(err)
	}
	assertOrderedSessionCards(t, result.SessionCards, []string{ids[4], ids[3]})
	request.OperationID, request.SessionID = "limited-order", "limited-order"
	request.NewLimit = 1
	result, err = store.StartStudySession(ctx, request)
	if err != nil {
		t.Fatal(err)
	}
	assertOrderedSessionCards(t, result.SessionCards, []string{ids[4]})
	changed := request
	changed.CardIDs = []string{ids[4], ids[2]}
	if _, err = store.StartStudySession(ctx, changed); !errors.Is(err, ErrOperationConflict) {
		t.Fatalf("changed unselected candidates accepted: %v", err)
	}
	request.OperationID, request.SessionID = "query-order", "query-order"
	request.NewLimit = 10
	request.Query = &QueryAST{Version: QueryVersion, Root: QueryExpression{Operator: QueryPredicate, Field: "cardID",
		Comparator: QueryIn, Value: mustRawJSON(t, []string{ids[2], ids[3], ids[5]})}}
	result, err = store.StartStudySession(ctx, request)
	if err != nil {
		t.Fatal(err)
	}
	assertOrderedSessionCards(t, result.SessionCards, []string{ids[3], ids[2]})
	request.OperationID, request.SessionID = "reinforce-order", "reinforce-order"
	request.Query, request.ReviewMode = nil, "reinforcement"
	result, err = store.StartStudySession(ctx, request)
	if err != nil {
		t.Fatal(err)
	}
	assertOrderedSessionCards(t, result.SessionCards, []string{ids[0], ids[4], ids[3], ids[2]})
	before, _, _ := store.Projection().CurrentEntity(ctx, EntityReviewState, ids[0])
	if _, err = store.ReviewCard(ctx, ReviewRequest{OperationID: "reinforce-order-review", CardID: ids[0],
		SessionID: request.SessionID, ReviewMode: "reinforcement", Rating: ReviewEasy, ReviewedAt: now + 1}); err != nil {
		t.Fatal(err)
	}
	after, _, _ := store.Projection().CurrentEntity(ctx, EntityReviewState, ids[0])
	if before.RevisionID != after.RevisionID {
		t.Fatal("reinforcement changed the schedule")
	}
}

func TestOrderedStudySessionRejectsInvalidSelectionAtomically(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	now := int64(1786431600000)
	ids := setupDailyLimitCards(t, ctx, store, now-1000, testSchedulerPreset("ordered-invalid", false, false), 1)
	for _, selection := range [][]string{{}, {" "}, {ids[0], "missing"}} {
		request := StudyQueueRequest{OperationID: "invalid-order", SessionID: "invalid-order", Now: now,
			CardIDs: selection, NewLimit: 10, ReviewLimit: 10}
		if _, err := store.StartStudySession(ctx, request); err == nil {
			t.Fatalf("invalid selection accepted: %v", selection)
		}
		if _, found, err := store.Projection().CurrentEntity(ctx, EntityStudySession, request.SessionID); err != nil || found {
			t.Fatalf("failed selection persisted a session: %v", err)
		}
	}
	blocked := errors.New("blocked source")
	request := StudyQueueRequest{OperationID: "blocked-order", SessionID: "blocked-order", Now: now,
		CardIDs: ids, NewLimit: 10, ReviewLimit: 10,
		ValidateCardIDs: func(_ context.Context, selected []string) error { return blocked }}
	if _, err := store.StartStudySession(ctx, request); !errors.Is(err, blocked) {
		t.Fatalf("access validation bypassed: %v", err)
	}
	if _, found, err := store.Projection().CurrentEntity(ctx, EntityStudySession, request.SessionID); err != nil || found {
		t.Fatalf("blocked selection persisted a session: %v", err)
	}
}

func assertOrderedSessionCards(t *testing.T, cards []SessionCard, expected []string) {
	t.Helper()
	actual := make([]string, len(cards))
	for index, card := range cards {
		actual[index] = card.CardID
		if card.Sort != index {
			t.Fatalf("unexpected position: %+v", card)
		}
	}
	if !reflect.DeepEqual(actual, expected) {
		t.Fatalf("queue order: got %v, want %v", actual, expected)
	}
}
