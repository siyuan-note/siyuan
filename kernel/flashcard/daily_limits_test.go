// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package flashcard

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"
	"time"
)

func TestPresetDailyLimitsAreSharedAcrossSetsAndFrozenSessions(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	now := int64(1786431600000)
	preset := testSchedulerPreset("daily-shared", false, false)
	preset.NewLimit, preset.ReviewLimit = 1, 1
	cards := setupDailyLimitCards(t, ctx, store, now-1000, preset, 4)
	setReviewStateForTest(t, ctx, store, "daily-review-state-a", cards[2], now-100, now-100, 3)
	setReviewStateForTest(t, ctx, store, "daily-review-state-b", cards[3], now-100, now-100, 3)
	query := mustRawJSON(t, QueryAST{Version: QueryVersion, Root: QueryExpression{Operator: QueryMatchAll}})
	for _, id := range []string{"daily-set-a", "daily-set-b"} {
		set := ReviewSet{ID: id, Name: id, QueryAST: query, NewLimit: 10, ReviewLimit: 10, DefaultReviewMode: "normal"}
		if _, err := store.MutateEntities(ctx, "setup-"+id, []EntityMutation{{EntityType: EntityReviewSet, EntityID: id,
			UpdatedAt: now, Payload: mustRawJSON(t, set)}}); err != nil {
			t.Fatal(err)
		}
	}
	first, err := store.StartStudySession(ctx, StudyQueueRequest{OperationID: "daily-start-a", SessionID: "daily-a",
		ReviewSetID: "daily-set-a", Now: now})
	if err != nil || len(first.SessionCards) != 2 {
		t.Fatalf("preset limits did not cap the set queue: cards=%+v err=%v", first.SessionCards, err)
	}
	if _, err = store.StartStudySession(ctx, StudyQueueRequest{OperationID: "daily-start-b", SessionID: "daily-b",
		ReviewSetID: "daily-set-b", Now: now}); err != nil {
		t.Fatal(err)
	}
	var reviewed []ReviewResult
	for index, item := range first.SessionCards {
		review, reviewErr := store.ReviewCard(ctx, ReviewRequest{OperationID: fmt.Sprintf("daily-review-%d", index),
			CardID: item.CardID, Rating: ReviewGood, ReviewedAt: now + int64(index+1), DurationMS: 100,
			SessionID: first.Session.ID, ReviewSetID: first.Session.ReviewSetID, ReviewMode: "normal"})
		if reviewErr != nil {
			t.Fatal(reviewErr)
		}
		reviewed = append(reviewed, review)
	}
	third, err := store.StartStudySession(ctx, StudyQueueRequest{OperationID: "daily-start-c", SessionID: "daily-c",
		ReviewSetID: "daily-set-b", Now: now + 10})
	if err != nil || len(third.SessionCards) != 0 {
		t.Fatalf("another set received a fresh daily allowance: cards=%+v err=%v", third.SessionCards, err)
	}
	remaining := map[string]bool{}
	for _, id := range cards {
		remaining[id] = true
	}
	for _, item := range first.SessionCards {
		delete(remaining, item.CardID)
	}
	for cardID := range remaining {
		if _, err = store.ReviewCard(ctx, ReviewRequest{OperationID: "daily-over-budget-" + cardID, CardID: cardID,
			Rating: ReviewGood, ReviewedAt: now + 20, DurationMS: 100, ReviewMode: "normal"}); err == nil {
			t.Fatal("direct review bypassed the preset daily allowance")
		}
	}
	for index, review := range reviewed {
		if _, err = store.UndoReview(ctx, ReviewUndoRequest{OperationID: fmt.Sprintf("daily-undo-%d", index),
			ReviewEventID: review.Event.EventID, CardID: first.SessionCards[index].CardID, UndoneAt: now + 30}); err != nil {
			t.Fatal(err)
		}
	}
	reopened, err := store.StartStudySession(ctx, StudyQueueRequest{OperationID: "daily-start-d", SessionID: "daily-d",
		ReviewSetID: "daily-set-b", Now: now + 40})
	if err != nil || len(reopened.SessionCards) != 2 {
		t.Fatalf("undo did not restore daily allowance: cards=%+v err=%v", reopened.SessionCards, err)
	}
}

func TestFrozenSessionQueueRechecksCurrentPresetBudget(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	now := int64(1786431600000)
	preset := testSchedulerPreset("daily-frozen", false, false)
	preset.NewLimit = 1
	cards := setupDailyLimitCards(t, ctx, store, now-1000, preset, 2)
	for index, cardID := range cards {
		query := predicateQuery("cardID", QueryEqual, mustRawJSON(t, cardID))
		_, err := store.StartStudySession(ctx, StudyQueueRequest{OperationID: fmt.Sprintf("frozen-start-%d", index),
			SessionID: fmt.Sprintf("frozen-session-%d", index), Query: &query, Now: now, NewLimit: 10, ReviewLimit: 10})
		if err != nil {
			t.Fatal(err)
		}
	}
	review, err := store.ReviewCard(ctx, ReviewRequest{OperationID: "frozen-review-first", CardID: cards[0],
		Rating: ReviewGood, ReviewedAt: now + 1, DurationMS: 100, ReviewMode: "normal", SessionID: "frozen-session-0"})
	if err != nil {
		t.Fatal(err)
	}
	queue, err := store.Projection().SessionQueueAt(ctx, "frozen-session-1", StudyDayOptions{Now: now + 2})
	if err != nil || len(queue) != 1 || queue[0].SessionCard.Status != "skipped" ||
		queue[0].SessionCard.SkipReason != "preset-daily-limit" {
		t.Fatalf("frozen queue did not recheck daily allowance: queue=%+v err=%v", queue, err)
	}
	if _, err = store.ReviewCard(ctx, ReviewRequest{OperationID: "frozen-review-second", CardID: cards[1],
		Rating: ReviewGood, ReviewedAt: now + 3, DurationMS: 100, ReviewMode: "normal", SessionID: "frozen-session-1"}); err == nil {
		t.Fatal("frozen session bypassed the consumed daily allowance")
	}
	if _, err = store.UndoReview(ctx, ReviewUndoRequest{OperationID: "frozen-undo", ReviewEventID: review.Event.EventID,
		CardID: cards[0], UndoneAt: now + 4}); err != nil {
		t.Fatal(err)
	}
	queue, err = store.Projection().SessionQueueAt(ctx, "frozen-session-1", StudyDayOptions{Now: now + 5})
	if err != nil || len(queue) != 1 || queue[0].SessionCard.Status != "queued" {
		t.Fatalf("undo did not restore the frozen queue: queue=%+v err=%v", queue, err)
	}
}

func TestDailyBudgetExcludesReinforcementAndCountsRepeatedCardsOnce(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	now := int64(1786431600000)
	preset := testSchedulerPreset("daily-repeat", false, false)
	preset.NewLimit, preset.ReviewLimit = 1, 0
	cards := setupDailyLimitCards(t, ctx, store, now-1000, preset, 2)
	if _, err := store.ReviewCard(ctx, ReviewRequest{OperationID: "daily-reinforcement", CardID: cards[1],
		Rating: ReviewGood, ReviewedAt: now, DurationMS: 100, ReviewMode: "reinforcement"}); err != nil {
		t.Fatal(err)
	}
	first, err := store.ReviewCard(ctx, ReviewRequest{OperationID: "daily-repeat-first", CardID: cards[0],
		Rating: ReviewGood, ReviewedAt: now + 1, DurationMS: 100, ReviewMode: "normal"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = store.ManageCards(ctx, CardManagementRequest{OperationID: "daily-repeat-due", CardIDs: cards[:1],
		Action: CardActionSetDue, Due: now + 2, ChangedAt: now + 2}); err != nil {
		t.Fatal(err)
	}
	if _, err = store.ReviewCard(ctx, ReviewRequest{OperationID: "daily-repeat-again", CardID: cards[0],
		Rating: ReviewGood, ReviewedAt: now + 3, DurationMS: 100, ReviewMode: "normal"}); err != nil {
		t.Fatalf("same-day learning consumed another review slot: %v", err)
	}
	start, end, err := reviewDayBounds(now, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	budget, err := store.Projection().dailyPresetBudget(ctx, start, end)
	if err != nil || budget.usage[preset.ID].newCards != 1 || budget.usage[preset.ID].reviewCards != 0 {
		t.Fatalf("unexpected daily usage after repeated review: budget=%+v err=%v", budget, err)
	}
	if first.AfterState == nil {
		t.Fatal("first review did not schedule the card")
	}
}

func TestDailyPresetBudgetsRemainIndependentAndHonorCardOverrides(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	now := int64(1786431600000)
	firstPreset := testSchedulerPreset("daily-preset-a", false, false)
	firstPreset.NewLimit = 0
	secondPreset := testSchedulerPreset("daily-preset-b", false, false)
	secondPreset.NewLimit = 1
	firstCards := setupDailyLimitCards(t, ctx, store, now-1000, firstPreset, 2)
	secondCards := setupDailyLimitCards(t, ctx, store, now-1000, secondPreset, 1)
	if _, err := store.ManageCards(ctx, CardManagementRequest{OperationID: "daily-override", CardIDs: firstCards[:1],
		Action: CardActionSetPreset, PresetID: secondPreset.ID, ChangedAt: now - 500}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.ReviewCard(ctx, ReviewRequest{OperationID: "daily-override-review", CardID: firstCards[0],
		Rating: ReviewGood, ReviewedAt: now, DurationMS: 100, ReviewMode: "normal"}); err != nil {
		t.Fatalf("card override did not use its own preset budget: %v", err)
	}
	if _, err := store.ReviewCard(ctx, ReviewRequest{OperationID: "daily-override-over-budget", CardID: secondCards[0],
		Rating: ReviewGood, ReviewedAt: now + 1, DurationMS: 100, ReviewMode: "normal"}); err == nil {
		t.Fatal("override review did not consume the shared target preset budget")
	}
	request := StudyQueueRequest{OperationID: "daily-preset-queue", SessionID: "daily-preset-queue", Now: now + 2,
		NewLimit: 10, ReviewLimit: 10}
	result, err := store.StartStudySession(ctx, request)
	if err != nil || len(result.SessionCards) != 0 {
		t.Fatalf("zero or exhausted preset admitted new cards: result=%+v err=%v", result, err)
	}
	request.OperationID, request.SessionID, request.ReviewMode = "daily-practice", "daily-practice", "reinforcement"
	result, err = store.StartStudySession(ctx, request)
	if err != nil || len(result.SessionCards) != 3 {
		t.Fatalf("normal daily limits blocked reinforcement: result=%+v err=%v", result, err)
	}
}

func TestDailyPresetBudgetUsesLocalDayAndHandlesDaylightSaving(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	location := time.FixedZone("UTC+8", 8*60*60)
	day := time.Date(2026, 8, 12, 0, 0, 0, 0, location)
	start, end := day.UnixMilli(), day.AddDate(0, 0, 1).UnixMilli()
	preset := testSchedulerPreset("daily-midnight", false, false)
	preset.NewLimit = 1
	cards := setupDailyLimitCards(t, ctx, store, start-2000, preset, 2)
	query := predicateQuery("cardID", QueryEqual, mustRawJSON(t, cards[1]))
	if _, err := store.StartStudySession(ctx, StudyQueueRequest{OperationID: "daily-cross-midnight", SessionID: "daily-cross-midnight",
		Query: &query, Now: start - 10, ReviewDayStart: day.AddDate(0, 0, -1).UnixMilli(), ReviewDayEnd: start,
		NewLimit: 10, ReviewLimit: 10}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.ReviewCard(ctx, ReviewRequest{OperationID: "daily-before-midnight", CardID: cards[0],
		Rating: ReviewGood, ReviewedAt: start - 1, ReviewDayStart: day.AddDate(0, 0, -1).UnixMilli(), ReviewDayEnd: start,
		DurationMS: 100, ReviewMode: "normal"}); err != nil {
		t.Fatal(err)
	}
	queue, err := store.Projection().SessionQueueAt(ctx, "daily-cross-midnight", StudyDayOptions{
		Now: start, ReviewDayStart: start, ReviewDayEnd: end})
	if err != nil || len(queue) != 1 || queue[0].SessionCard.Status != "queued" {
		t.Fatalf("frozen session did not use the next client-local day: queue=%+v err=%v", queue, err)
	}
	request := StudyQueueRequest{OperationID: "daily-after-midnight", SessionID: "daily-after-midnight", Now: start,
		ReviewDayStart: start, ReviewDayEnd: end, NewLimit: 10, ReviewLimit: 10}
	result, err := store.StartStudySession(ctx, request)
	if err != nil || len(result.SessionCards) != 1 || result.SessionCards[0].CardID != cards[1] {
		t.Fatalf("local midnight did not reset the budget: result=%+v err=%v", result, err)
	}
	changed := request
	changed.ReviewDayStart--
	if _, err = store.StartStudySession(ctx, changed); err == nil {
		t.Fatal("changed day boundary was accepted for an applied session")
	}
	for _, hours := range []int64{23, 25} {
		dayEnd := start + hours*int64(time.Hour/time.Millisecond)
		if actualStart, actualEnd, boundsErr := reviewDayBounds(start+1000, start, dayEnd); boundsErr != nil ||
			actualStart != start || actualEnd != dayEnd {
			t.Fatalf("%d-hour local day was rejected: start=%d end=%d err=%v", hours, actualStart, actualEnd, boundsErr)
		}
	}
}

func TestUnavailableSessionCardsDoNotReserveDailyBudget(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	now := int64(1786431600000)
	preset := testSchedulerPreset("daily-unavailable", false, false)
	preset.NewLimit = 2
	setupDailyLimitCards(t, ctx, store, now-1000, preset, 2)
	session, err := store.StartStudySession(ctx, StudyQueueRequest{OperationID: "unavailable-start", SessionID: "unavailable",
		Now: now, NewLimit: 10, ReviewLimit: 10})
	if err != nil || len(session.SessionCards) != 2 {
		t.Fatalf("unexpected initial queue: session=%+v err=%v", session, err)
	}
	if _, err = store.ManageCards(ctx, CardManagementRequest{OperationID: "unavailable-suspend",
		CardIDs: []string{session.SessionCards[0].CardID}, Action: CardActionSuspend, ChangedAt: now + 1}); err != nil {
		t.Fatal(err)
	}
	revision, found, err := store.Projection().CurrentEntity(ctx, EntitySchedulerPreset, preset.ID)
	if err != nil || !found {
		t.Fatalf("preset not found: found=%v err=%v", found, err)
	}
	preset.NewLimit = 1
	if _, err = store.MutateEntities(ctx, "unavailable-lower-limit", []EntityMutation{{EntityType: EntitySchedulerPreset,
		EntityID: preset.ID, ExpectedRevisionID: revision.RevisionID, UpdatedAt: now + 2,
		Payload: mustRawJSON(t, preset)}}); err != nil {
		t.Fatal(err)
	}
	queue, err := store.Projection().SessionQueueAt(ctx, session.Session.ID, StudyDayOptions{Now: now + 3})
	if err != nil || len(queue) != 2 || queue[0].SessionCard.Status != "skipped" || queue[1].SessionCard.Status != "queued" {
		t.Fatalf("suspended card reserved the remaining daily allowance: queue=%+v err=%v", queue, err)
	}
}

func setupDailyLimitCards(t *testing.T, ctx context.Context, store *Store, now int64,
	preset SchedulerPreset, count int) []string {
	t.Helper()
	schemaID, templateID := "schema-"+preset.ID, "template-"+preset.ID
	values := []any{testGenerationSchema(schemaID, []string{templateID}),
		testGenerationTemplate(templateID, schemaID, GenerationStatic, "forward", true), preset}
	sources := make([]CardSource, count)
	for index := range sources {
		sources[index] = testGenerationSource(fmt.Sprintf("source-%s-%d", preset.ID, index), schemaID, "qa", json.RawMessage(`{}`))
		sources[index].DefaultPresetID = preset.ID
		values = append(values, sources[index])
	}
	applyGenerationEntities(t, ctx, store, "setup-"+preset.ID, now, values...)
	cards := make([]string, count)
	for index, source := range sources {
		if _, err := store.ReconcileSourceCards(ctx, "reconcile-"+source.ID, source.ID, now); err != nil {
			t.Fatal(err)
		}
		cards[index] = GeneratedCardID(source.ID, templateID, "forward")
	}
	return cards
}
