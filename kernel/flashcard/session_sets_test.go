package flashcard

import (
	"context"
	"errors"
	"testing"
)

func TestMixedReviewSetsPreservePresetsAndDeduplicate(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	now := int64(1786431600000)
	first := testSchedulerPreset("mixed-a", false, false)
	second := testSchedulerPreset("mixed-b", false, false)
	first.MaximumInterval, second.MaximumInterval = 1, 100
	first.NewLimit, second.NewLimit = 1, 1
	a := setupDailyLimitCards(t, ctx, store, now-1000, first, 2)
	b := setupDailyLimitCards(t, ctx, store, now-1000, second, 1)
	for _, id := range []string{"set-a", "set-b"} {
		set := ReviewSet{ID: id, Name: id, NewLimit: 10, ReviewLimit: 10, DefaultReviewMode: "normal"}
		if id == "set-a" {
			set.QueryAST = mustRawJSON(t, QueryAST{Version: QueryVersion, Root: QueryExpression{
				Operator: QueryPredicate, Field: "presetID", Comparator: QueryEqual, Value: mustRawJSON(t, first.ID)}})
		}
		if _, err := store.MutateEntities(ctx, "create-"+id, []EntityMutation{{EntityType: EntityReviewSet,
			EntityID: id, UpdatedAt: now, Payload: mustRawJSON(t, set)}}); err != nil {
			t.Fatal(err)
		}
	}
	for setID, ids := range map[string][]string{"set-a": {a[0]}, "set-b": {a[0], b[0]}} {
		if _, err := store.SetReviewSetMemberships(ctx, SetReviewSetMembershipsRequest{OperationID: "members-" + setID,
			ReviewSetID: setID, CardIDs: ids, Mode: MembershipInclude, ChangedAt: now}); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := store.SetReviewSetMemberships(ctx, SetReviewSetMembershipsRequest{OperationID: "exclude-a",
		ReviewSetID: "set-a", CardIDs: []string{a[1]}, Mode: MembershipExclude, ChangedAt: now}); err != nil {
		t.Fatal(err)
	}
	request := StudyQueueRequest{OperationID: "mixed", SessionID: "mixed-session", ReviewSetIDs: []string{"set-b", "set-a", "set-a"},
		Now: now + 1, NewLimit: 10, ReviewLimit: 10, ReviewMode: "normal"}
	result, err := store.StartStudySession(ctx, request)
	if err != nil || len(result.SessionCards) != 2 {
		t.Fatalf("mixed queue: %+v, %v", result.SessionCards, err)
	}
	request.ReviewSetIDs = []string{"set-a", "set-b"}
	if retry, retryErr := store.StartStudySession(ctx, request); retryErr != nil || retry.Batch.BatchID != result.Batch.BatchID {
		t.Fatalf("reordered retry: %v", retryErr)
	}
	request.ReviewSetIDs = []string{"set-a"}
	if _, err = store.StartStudySession(ctx, request); !errors.Is(err, ErrOperationConflict) {
		t.Fatalf("changed membership scope accepted: %v", err)
	}
	filteredRequest := request
	filteredRequest.OperationID, filteredRequest.SessionID = "filtered", "filtered-session"
	filteredRequest.ReviewSetIDs = []string{"set-a", "set-b"}
	filteredRequest.Query = &QueryAST{Version: QueryVersion, Root: QueryExpression{Operator: QueryPredicate,
		Field: "cardID", Comparator: QueryEqual, Value: mustRawJSON(t, b[0])}}
	filtered, filterErr := store.StartStudySession(ctx, filteredRequest)
	if filterErr != nil || len(filtered.SessionCards) != 1 || filtered.SessionCards[0].CardID != b[0] {
		t.Fatalf("query did not intersect set union: %+v %v", filtered, filterErr)
	}
	filteredRequest.Query = nil
	if _, err = store.StartStudySession(ctx, filteredRequest); !errors.Is(err, ErrOperationConflict) {
		t.Fatalf("retry dropped query: %v", err)
	}
	for _, item := range result.SessionCards {
		presetID := first.ID
		if item.CardID == b[0] {
			presetID = second.ID
		} else if item.CardID != a[0] {
			t.Fatalf("unselected card %s", item.CardID)
		}
		revision, _, _ := store.Projection().CurrentEntity(ctx, EntitySchedulerPreset, presetID)
		review, reviewErr := store.ReviewCard(ctx, ReviewRequest{OperationID: "rate-" + item.CardID, CardID: item.CardID,
			SessionID: result.Session.ID, ReviewMode: "normal", Rating: ReviewEasy, ReviewedAt: now + 2})
		if reviewErr != nil || review.PresetRevisionID != revision.RevisionID {
			t.Fatalf("card did not use its own preset: %+v %v", review, reviewErr)
		}
	}
	request.OperationID, request.SessionID = "exhausted", "exhausted-session"
	request.ReviewSetIDs = []string{"set-a", "set-b"}
	remaining, remainingErr := store.StartStudySession(ctx, request)
	if remainingErr != nil || len(remaining.SessionCards) != 0 {
		t.Fatalf("mixed review did not consume shared preset budgets: %+v %v", remaining, remainingErr)
	}
	request.OperationID, request.SessionID = "missing", "missing-session"
	request.ReviewSetIDs = []string{"missing"}
	if _, err = store.StartStudySession(ctx, request); err == nil {
		t.Fatal("missing review set accepted")
	}
	request.ReviewSetIDs = []string{}
	if _, err = store.StartStudySession(ctx, request); err == nil {
		t.Fatal("empty explicit selection became global review")
	}
}
