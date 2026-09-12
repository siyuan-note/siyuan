package flashcard

import (
	"context"
	"errors"
	"testing"
)

func TestSourceHistoryRestorePreservesScheduleAndReferences(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	applyGenerationEntities(t, ctx, store, "history-preset", 1, testSchedulerPreset(legacyPresetID, false, false))
	created, err := store.CreateAdvancedSource(ctx, AdvancedSourceRequest{OperationID: "history-create",
		SourceID: "history-source", Mode: AdvancedModeOrderedCards, BlockIDs: []string{"first", "second"}, CreatedAt: 10})
	if err != nil {
		t.Fatal(err)
	}
	cardID := created.Cards.Created[1]
	setReviewStateForTest(t, ctx, store, "history-review", cardID, 15, 900, 7)
	updated, err := store.UpdateAdvancedSource(ctx, AdvancedSourceUpdateRequest{OperationID: "history-edit",
		SourceID: "history-source", ExpectedRevision: created.SourceRevision.RevisionID,
		Mode: AdvancedModeOrderedCards, BlockIDs: []string{"third", "first"}, UpdatedAt: 20})
	if err != nil {
		t.Fatal(err)
	}
	version, err := store.Projection().SourceHistoryVersion(ctx, "history-source", created.SourceRevision.RevisionID)
	if err != nil || len(version.References) != 2 || version.References[0].EntityID != "first" || version.References[1].EntityID != "second" {
		t.Fatalf("historical references: %+v, %v", version, err)
	}
	versions, err := store.Projection().SourceHistory(ctx, "history-source", 1, 1)
	if err != nil || len(versions) != 1 || versions[0].RevisionID != created.SourceRevision.RevisionID {
		t.Fatalf("history pagination: %+v, %v", versions, err)
	}
	request := RestoreSourceHistoryRequest{OperationID: "history-restore", SourceID: "history-source",
		RevisionID: created.SourceRevision.RevisionID, ExpectedRevisionID: updated.SourceRevision.RevisionID, UpdatedAt: 30}
	request.ValidateVersion = func(SourceHistoryVersion) error { return errors.New("missing block") }
	if _, err = store.RestoreSourceHistory(ctx, request); err == nil {
		t.Fatal("invalid source restored")
	}
	current, _, _ := store.Projection().CurrentEntity(ctx, EntityCardSource, request.SourceID)
	if current.RevisionID != updated.SourceRevision.RevisionID {
		t.Fatal("failed restore changed source")
	}
	request.ValidateVersion = nil
	restored, err := store.RestoreSourceHistory(ctx, request)
	if err != nil {
		t.Fatal(err)
	}
	assertReviewStateForTest(t, ctx, store, cardID, 900, 7)
	if cardStatusForTest(t, ctx, store, cardID) != GenerationActive {
		t.Fatal("removed card was not reactivated")
	}
	refs, err := store.Projection().CardSourceReferences(ctx, request.SourceID)
	if err != nil || len(refs) != 2 || refs[0].EntityID != "first" || refs[1].EntityID != "second" {
		t.Fatalf("restored references: %+v, %v", refs, err)
	}
	if retry, retryErr := store.RestoreSourceHistory(ctx, request); retryErr != nil || retry.RevisionID != restored.RevisionID {
		t.Fatalf("restore retry: %+v, %v", retry, retryErr)
	}
	request.OperationID = "history-stale"
	if _, err = store.RestoreSourceHistory(ctx, request); !errors.Is(err, ErrRevisionConflict) {
		t.Fatalf("stale restore: %v", err)
	}
	if _, err = store.Projection().SourceHistoryVersion(ctx, "other-source", restored.RevisionID); !errors.Is(err, ErrEntityNotFound) {
		t.Fatalf("cross-source history: %v", err)
	}
	if err = store.RebuildProjection(ctx); err != nil {
		t.Fatal(err)
	}
	assertReviewStateForTest(t, ctx, store, cardID, 900, 7)
	version, err = store.Projection().SourceHistoryVersion(ctx, request.SourceID, restored.RevisionID)
	if err != nil || len(version.References) != 2 || version.References[1].EntityID != "second" {
		t.Fatalf("rebuilt history: %+v, %v", version, err)
	}
	ref := version.References[0]
	ref.Role = "content"
	refPayload, err := CanonicalJSON(ref)
	if err != nil {
		t.Fatal(err)
	}
	refRevision, _, err := store.Projection().CurrentEntity(ctx, EntityCardSourceRef, ref.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = store.MutateEntities(ctx, "independent-reference", []EntityMutation{{EntityType: EntityCardSourceRef,
		EntityID: ref.ID, ExpectedRevisionID: refRevision.RevisionID, UpdatedAt: 35, Payload: refPayload}}); err != nil {
		t.Fatal(err)
	}
	if _, err = store.Projection().SourceHistoryVersion(ctx, request.SourceID, restored.RevisionID); err == nil {
		t.Fatal("independent reference edit was silently assigned to a source version")
	}
}

func TestSourceHistoryRestoresDirectionButPreservesSourceStatusAndRejectsConflict(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	applyGenerationEntities(t, ctx, store, "history-basic-preset", 1, testSchedulerPreset(legacyPresetID, false, false))
	created, err := store.CreateBasicSource(ctx, BasicSourceRequest{OperationID: "history-basic-create", SourceID: "basic-history",
		BlockIDs: []string{"question", "answer"}, Direction: BasicDirectionBidirectional, CreatedAt: 10})
	if err != nil {
		t.Fatal(err)
	}
	closed, err := store.UpdateBasicSourceDirection(ctx, BasicDirectionRequest{OperationID: "history-basic-close", SourceID: "basic-history",
		ExpectedRevision: created.SourceRevision.RevisionID, Direction: BasicDirectionClosed, UpdatedAt: 20})
	if err != nil {
		t.Fatal(err)
	}
	version, err := store.Projection().SourceHistoryVersion(ctx, "basic-history", created.SourceRevision.RevisionID)
	if err != nil || !equalStrings(version.Modes, []string{"forward", "reverse"}) {
		t.Fatalf("history modes: %+v %v", version, err)
	}
	deleted, err := store.ManageSourceLifecycle(ctx, SourceLifecycleRequest{OperationID: "history-basic-delete", SourceID: "basic-history",
		Action: SourceActionDelete, ChangedAt: 30, ExpectedRevision: closed.SourceRevision.RevisionID})
	if err != nil {
		t.Fatal(err)
	}
	request := RestoreSourceHistoryRequest{OperationID: "history-basic-restore", SourceID: "basic-history",
		RevisionID: created.SourceRevision.RevisionID, ExpectedRevisionID: deleted.SourceRevision.RevisionID, UpdatedAt: 40}
	restored, err := store.RestoreSourceHistory(ctx, request)
	if err != nil {
		t.Fatal(err)
	}
	var source CardSource
	if err = decodeStrictJSON(restored.Payload, &source); err != nil || source.Status != "deleted" || len(source.DisabledTemplateIDs) != 0 {
		t.Fatalf("restored settings or lifecycle: %+v %v", source, err)
	}
	request.RevisionID = closed.SourceRevision.RevisionID
	if _, err = store.RestoreSourceHistory(ctx, request); !errors.Is(err, ErrOperationConflict) {
		t.Fatalf("changed retry: %v", err)
	}
	source.Priority = "exam"
	branch, err := NewOperationEntityRevision("history-basic-branch", EntityCardSource, request.SourceID,
		[]string{deleted.SourceRevision.RevisionID}, 45, false, source)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = store.Apply(ctx, "history-basic-branch", []Change{{Kind: RecordEntityRevision, Revision: &branch}}); err != nil {
		t.Fatal(err)
	}
	current, _, err := store.Projection().CurrentEntity(ctx, EntityCardSource, request.SourceID)
	if err != nil {
		t.Fatal(err)
	}
	request.OperationID, request.ExpectedRevisionID, request.UpdatedAt = "history-basic-conflicted-restore", current.RevisionID, 50
	if _, err = store.RestoreSourceHistory(ctx, request); !errors.Is(err, ErrRevisionConflict) {
		t.Fatalf("unresolved conflict restored: %v", err)
	}
}
