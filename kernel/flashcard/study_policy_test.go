// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package flashcard

import (
	"context"
	"errors"
	"testing"
)

func TestSaveStudyPolicyUsesStableScopeIdentityAndProtectsRevisions(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	targetDate := int64(1787000000000)
	request := SaveStudyPolicyRequest{OperationID: "create-study-policy", ScopeType: "document",
		ScopeID: "document-1", Priority: "exam", TargetDate: &targetDate, UpdatedAt: 10}
	created, err := store.SaveStudyPolicy(ctx, request)
	if err != nil {
		t.Fatal(err)
	}
	if created.EntityID != DeterministicID("study-policy", request.ScopeType, request.ScopeID) {
		t.Fatalf("study policy did not use its stable scope identity: %+v", created)
	}
	retry, err := store.SaveStudyPolicy(ctx, request)
	if err != nil || retry.RevisionID != created.RevisionID {
		t.Fatalf("study policy retry was not idempotent: revision=%+v err=%v", retry, err)
	}
	current, found, err := store.Projection().StudyPolicyRevision(ctx, request.ScopeType, request.ScopeID)
	if err != nil || !found || current.RevisionID != created.RevisionID {
		t.Fatalf("study policy could not be resolved by scope: revision=%+v found=%v err=%v", current, found, err)
	}
	request.OperationID = "overwrite-study-policy"
	request.Priority = "learning"
	request.UpdatedAt = 11
	if _, err = store.SaveStudyPolicy(ctx, request); !errors.Is(err, ErrRevisionConflict) {
		t.Fatalf("study policy update without an expected revision was accepted: %v", err)
	}
	request.OperationID = "update-study-policy"
	request.ExpectedRevisionID = created.RevisionID
	updated, err := store.SaveStudyPolicy(ctx, request)
	if err != nil || len(updated.ParentRevisionIDs) != 1 || updated.ParentRevisionIDs[0] != created.RevisionID {
		t.Fatalf("study policy update did not preserve revision ancestry: revision=%+v err=%v", updated, err)
	}
}

func TestStudyPolicyRetryDistinguishesOmittedPresetFromExplicitChange(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	applyGenerationEntities(t, ctx, store, "presets", 1, testSchedulerPreset("preset-a", false, false),
		testSchedulerPreset("preset-b", false, false))
	presetID := "preset-b"
	request := SaveStudyPolicyRequest{OperationID: "create-policy", ScopeType: "document", ScopeID: "doc",
		DefaultPresetID: &presetID, UpdatedAt: 2}
	created, err := store.SaveStudyPolicy(ctx, request)
	if err != nil {
		t.Fatal(err)
	}
	request.DefaultPresetID = nil
	if _, err = store.SaveStudyPolicy(ctx, request); !errors.Is(err, ErrOperationConflict) {
		t.Fatalf("omitting the initial preset changed retry semantics without a conflict: %v", err)
	}
	presetID = "preset-a"
	request.OperationID = "change-preset"
	request.DefaultPresetID = &presetID
	request.ExpectedRevisionID = created.RevisionID
	request.UpdatedAt = 3
	updated, err := store.SaveStudyPolicy(ctx, request)
	if err != nil {
		t.Fatal(err)
	}
	request.DefaultPresetID = nil
	if _, err = store.SaveStudyPolicy(ctx, request); !errors.Is(err, ErrOperationConflict) {
		t.Fatalf("omitting an explicit preset change was accepted as the same operation: %v", err)
	}
	request.OperationID = "preserve-preset"
	request.ExpectedRevisionID = updated.RevisionID
	request.UpdatedAt = 4
	preserved, err := store.SaveStudyPolicy(ctx, request)
	if err != nil {
		t.Fatal(err)
	}
	if retry, retryErr := store.SaveStudyPolicy(ctx, request); retryErr != nil || retry.RevisionID != preserved.RevisionID {
		t.Fatalf("omitted preset retry was not idempotent: %+v err=%v", retry, retryErr)
	}
}
