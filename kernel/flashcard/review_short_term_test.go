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

// applyLegacyLongTermReview 写入短期学习关闭时的完整权威记录，验证升级后仍按记录参数恢复。
func applyLegacyLongTermReview(t *testing.T, ctx context.Context, store *Store, request ReviewRequest,
	preset SchedulerPreset) ReviewResult {
	t.Helper()
	beforeRevision, found, err := store.Projection().CurrentEntity(ctx, EntityReviewState, request.CardID)
	if err != nil || !found {
		t.Fatalf("legacy base state: %v", err)
	}
	var state ReviewState
	if err = decodeStrictJSON(beforeRevision.Payload, &state); err != nil {
		t.Fatal(err)
	}
	before := state.ReviewStateSnapshot
	after, err := scheduleReviewWithShortTerm(before, preset, request, false)
	if err != nil {
		t.Fatal(err)
	}
	after.StateRevisionID = OperationRevisionID(request.OperationID, EntityReviewState, request.CardID)
	revision, err := NewOperationEntityRevision(request.OperationID, EntityReviewState, request.CardID,
		[]string{beforeRevision.RevisionID}, request.ReviewedAt, false,
		ReviewState{CardID: request.CardID, ReviewStateSnapshot: after})
	if err != nil {
		t.Fatal(err)
	}
	presetRevision, _, err := store.Projection().CurrentEntity(ctx, EntitySchedulerPreset, preset.ID)
	if err != nil {
		t.Fatal(err)
	}
	cardRevision, _, err := store.Projection().CurrentEntity(ctx, EntityCard, request.CardID)
	if err != nil {
		t.Fatal(err)
	}
	var card Card
	if err = decodeStrictJSON(cardRevision.Payload, &card); err != nil {
		t.Fatal(err)
	}
	payload := ReviewEventPayload{CardID: request.CardID, SourceID: card.SourceID, Kind: "review",
		Rating: request.Rating, ReviewedAt: request.ReviewedAt, DurationMS: &request.DurationMS,
		BaseStateRevisionID: beforeRevision.RevisionID, BeforeState: &before, AfterState: &after,
		SchedulerVersion: preset.SchedulerVersion, PresetRevisionID: presetRevision.RevisionID,
		ReviewMode: "normal", SchedulerInput: mustRawJSON(t, schedulerInput{Rating: request.Rating,
			ReviewedAt: request.ReviewedAt, RequestRetention: preset.RequestRetention, MaximumInterval: preset.MaximumInterval,
			Weights: preset.Weights, EnableShortTerm: false, EnableFuzz: false,
			LeechThreshold: preset.LeechThreshold, LeechAction: preset.LeechAction})}
	event, err := NewReviewEvent(request.OperationID, payload)
	if err != nil {
		t.Fatal(err)
	}
	changes := []Change{{Kind: RecordEntityRevision, Revision: &revision}, {Kind: RecordEvent, Event: &event}}
	if err = store.Projection().ValidateBusinessChanges(ctx, changes); err != nil {
		t.Fatal(err)
	}
	batch, err := store.applyLocked(ctx, request.OperationID, changes)
	if err != nil {
		t.Fatal(err)
	}
	return ReviewResult{Batch: batch, Event: event, BeforeState: before, AfterState: &after}
}

func TestShortTermSchedulingKeepsLegacyLongTermResults(t *testing.T) {
	preset := testSchedulerPreset("compat", false, false)
	request := ReviewRequest{Rating: ReviewAgain, ReviewedAt: 1786431601000}
	before := ReviewStateSnapshot{State: "new"}
	legacy, err := scheduleReviewWithShortTerm(before, preset, request, false)
	if err != nil || legacy.State != "review" || legacy.Due != 1786518001000 || legacy.ScheduledDays != 1 {
		t.Fatalf("legacy long-term fixture changed: %+v %v", legacy, err)
	}
	for rating, minutes := range map[ReviewRating]int64{ReviewAgain: 1, ReviewHard: 5, ReviewGood: 10} {
		request.Rating = rating
		current, scheduleErr := scheduleReview(before, preset, request)
		if scheduleErr != nil || current.State != "learning" || current.Due != request.ReviewedAt+minutes*60000 {
			t.Fatalf("short-term interval for %s: %+v %v", rating, current, scheduleErr)
		}
	}
}
