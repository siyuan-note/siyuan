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
	"testing"
)

func TestSessionRepeatDueReviewUndoAndRecovery(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	now := int64(1786431600000)
	preset := testSchedulerPreset("repeat", false, false)
	preset.NewLimit, preset.ReviewLimit = 2, 1
	setupDailyLimitCards(t, ctx, store, now-1000, preset, 3)
	session, err := store.StartStudySession(ctx, StudyQueueRequest{OperationID: "start", SessionID: "repeat",
		Now: now, NewLimit: 2, ReviewLimit: 1, ReviewMode: "normal"})
	if err != nil || len(session.SessionCards) != 2 {
		t.Fatalf("start: %+v %v", session, err)
	}
	cardID := session.SessionCards[0].CardID
	first, err := store.ReviewCard(ctx, ReviewRequest{OperationID: "first", CardID: cardID, Rating: ReviewAgain,
		ReviewedAt: now + 1000, DurationMS: 1000, SessionID: "repeat", ReviewMode: "normal"})
	if err != nil {
		t.Fatal(err)
	}
	if first.AfterState.State != "learning" || first.AfterState.Due <= now+1000 {
		t.Fatalf("expected short learning interval: %+v", first.AfterState)
	}
	due := first.AfterState.Due
	checkQueue := func(at int64, repeatDue int64) {
		t.Helper()
		queue, queueErr := store.Projection().SessionQueueAt(ctx, "repeat", StudyDayOptions{Now: at})
		if queueErr != nil || len(queue) != 2 || queue[0].RepeatDue != repeatDue || queue[1].SessionCard.Status != "queued" {
			t.Fatalf("queue: %+v %v", queue, queueErr)
		}
		for index, item := range queue {
			if item.Card.ID != session.SessionCards[index].CardID {
				t.Fatal("queue admitted an unselected card")
			}
		}
	}
	checkQueue(due-1, due)
	if err = store.RebuildProjection(ctx); err != nil {
		t.Fatal(err)
	}
	checkQueue(due, due)
	request := ReviewRequest{OperationID: "second", CardID: cardID, Rating: ReviewAgain, ReviewedAt: due,
		DurationMS: 2000, SessionID: "repeat", ReviewMode: "normal", StateRevisionID: first.AfterState.StateRevisionID}
	early := request
	early.ReviewedAt--
	if _, err = store.ReviewCard(ctx, early); err == nil {
		t.Fatal("learning card was reviewed before due")
	}
	missingVersion := request
	missingVersion.StateRevisionID = ""
	if _, err = store.ReviewCard(ctx, missingVersion); err == nil {
		t.Fatal("repeat accepted without the displayed schedule version")
	}
	second, err := store.ReviewCard(ctx, request)
	if err != nil {
		t.Fatal(err)
	}
	if second.AfterState.Reps != first.AfterState.Reps+1 {
		t.Fatal("repeat did not count a review")
	}
	retry, err := store.ReviewCard(ctx, request)
	if err != nil || retry.Event.EventID != second.Event.EventID {
		t.Fatalf("retry was not idempotent: %v", err)
	}
	duplicate := request
	duplicate.OperationID = "duplicate"
	duplicate.ReviewedAt = second.AfterState.Due
	if _, err = store.ReviewCard(ctx, duplicate); err == nil {
		t.Fatal("stale duplicate rating changed the next learning step")
	}
	undone, err := store.UndoReview(ctx, ReviewUndoRequest{OperationID: "undo-second", CardID: cardID,
		ReviewEventID: second.Event.EventID, UndoneAt: due + 1})
	if err != nil || undone.RestoredState.Reps != first.AfterState.Reps {
		t.Fatalf("undo repeat: %+v %v", undone, err)
	}
	checkQueue(due+1, due)
	request.OperationID, request.StateRevisionID, request.ReviewedAt = "after-undo", undone.RestoredState.StateRevisionID, due+2
	request.Rating = ReviewEasy
	if _, err = store.ReviewCard(ctx, request); err != nil {
		t.Fatal(err)
	}
	checkQueue(due+2, 0)
	start, end, _ := reviewDayBounds(due+2, 0, 0)
	budget, err := store.Projection().dailyPresetBudget(ctx, start, end)
	if err != nil || budget.usage[preset.ID].newCards != 1 || budget.usage[preset.ID].reviewCards != 0 {
		t.Fatalf("repeat consumed another daily slot: %+v %v", budget, err)
	}
}

func TestSessionRepeatSiblingBurialCanBeUndone(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	now := int64(1786431600000)
	preset := testSchedulerPreset("siblings", false, false)
	source := testGenerationSource("source", "schema", "qa", mustRawJSON(t, map[string]any{}))
	source.DefaultPresetID = preset.ID
	applyGenerationEntities(t, ctx, store, "setup", now-1000,
		testGenerationSchema("schema", []string{"forward", "reverse"}),
		testGenerationTemplate("forward", "schema", GenerationStatic, "forward", true),
		testGenerationTemplate("reverse", "schema", GenerationStatic, "reverse", true), source, preset)
	if _, err := store.ReconcileSourceCards(ctx, "reconcile", source.ID, now-1000); err != nil {
		t.Fatal(err)
	}
	session, err := store.StartStudySession(ctx, StudyQueueRequest{OperationID: "start", SessionID: "siblings",
		Now: now, NewLimit: 10, ReviewLimit: 10, ReviewMode: "normal"})
	if err != nil || len(session.SessionCards) != 2 {
		t.Fatalf("start siblings: %+v %v", session, err)
	}
	firstID, secondID := session.SessionCards[0].CardID, session.SessionCards[1].CardID
	first, err := store.ReviewCard(ctx, ReviewRequest{OperationID: "first", CardID: firstID, Rating: ReviewAgain,
		ReviewedAt: now + 1, SessionID: "siblings", ReviewMode: "normal"})
	if err != nil {
		t.Fatal(err)
	}
	preset.BuryNewSiblings, preset.BuryReviewSiblings = true, true
	presetRevision, _, err := store.Projection().CurrentEntity(ctx, EntitySchedulerPreset, preset.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = store.MutateEntities(ctx, "enable-burial", []EntityMutation{{EntityType: EntitySchedulerPreset,
		EntityID: preset.ID, ExpectedRevisionID: presetRevision.RevisionID, UpdatedAt: now + 2,
		Payload: mustRawJSON(t, preset)}}); err != nil {
		t.Fatal(err)
	}
	_, dayEnd, _ := reviewDayBounds(now+2, 0, 0)
	second, err := store.ReviewCard(ctx, ReviewRequest{OperationID: "second", CardID: secondID, Rating: ReviewAgain,
		ReviewedAt: now + 2, SessionID: "siblings", ReviewMode: "normal", BuryUntil: dayEnd})
	if err != nil {
		t.Fatal(err)
	}
	queue, err := store.Projection().SessionQueueAt(ctx, "siblings", StudyDayOptions{Now: now + 3})
	if err != nil || queue[0].RepeatDue != 0 || queue[0].SessionCard.Status != "skipped" {
		t.Fatalf("buried learning sibling returned: %+v %v", queue, err)
	}
	if _, err = store.UndoReview(ctx, ReviewUndoRequest{OperationID: "undo", CardID: secondID,
		ReviewEventID: second.Event.EventID, UndoneAt: now + 4}); err != nil {
		t.Fatal(err)
	}
	queue, err = store.Projection().SessionQueueAt(ctx, "siblings", StudyDayOptions{Now: now + 5})
	if err != nil || queue[0].RepeatDue != first.AfterState.Due || queue[1].SessionCard.Status != "queued" {
		t.Fatalf("undo did not restore the learning sibling: %+v %v", queue, err)
	}
}

func TestSessionRepeatExcludesChangedSkippedAndFinishedCards(t *testing.T) {
	for _, action := range []string{"undo", "skip", "suspend", "other-session", "finished", "reinforcement"} {
		t.Run(action, func(t *testing.T) {
			ctx := context.Background()
			store := newGenerationTestStore(t, ctx)
			defer store.Close()
			now := int64(1786431600000)
			cards := setupDailyLimitCards(t, ctx, store, now-1000, testSchedulerPreset("repeat", false, false), 1)
			mode := "normal"
			if action == "reinforcement" {
				mode = "reinforcement"
			}
			_, err := store.StartStudySession(ctx, StudyQueueRequest{OperationID: "start", SessionID: "repeat", Now: now,
				NewLimit: 10, ReviewLimit: 10, ReviewMode: mode})
			if err != nil {
				t.Fatal(err)
			}
			review, err := store.ReviewCard(ctx, ReviewRequest{OperationID: "first", CardID: cards[0], Rating: ReviewAgain,
				ReviewedAt: now + 1, SessionID: "repeat", ReviewMode: mode})
			if err != nil {
				t.Fatal(err)
			}
			at := now + 600001
			switch action {
			case "undo":
				_, err = store.UndoReview(ctx, ReviewUndoRequest{OperationID: "undo", ReviewEventID: review.Event.EventID,
					CardID: cards[0], UndoneAt: now + 2})
			case "skip":
				_, err = store.UpdateSessionCard(ctx, SessionCardUpdateRequest{OperationID: "skip", SessionID: "repeat",
					CardID: cards[0], Status: "skipped", SkipReason: "user", UpdatedAt: now + 2})
			case "suspend":
				_, err = store.ManageCards(ctx, CardManagementRequest{OperationID: "suspend", CardIDs: cards,
					Action: CardActionSuspend, ChangedAt: now + 2})
			case "other-session":
				_, err = store.ReviewCard(ctx, ReviewRequest{OperationID: "external", CardID: cards[0], Rating: ReviewAgain,
					ReviewedAt: at, ReviewMode: "normal"})
			case "finished":
				_, err = store.FinishStudySession(ctx, FinishSessionRequest{OperationID: "finish", SessionID: "repeat",
					Status: "completed", EndedAt: now + 2})
			}
			if err != nil {
				t.Fatal(err)
			}
			queue, err := store.Projection().SessionQueueAt(ctx, "repeat", StudyDayOptions{Now: at})
			if err != nil || len(queue) != 1 || queue[0].RepeatDue != 0 {
				t.Fatalf("ineligible repeat: %+v %v", queue, err)
			}
		})
	}
}
