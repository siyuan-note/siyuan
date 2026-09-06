package flashcard

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

func TestSourcePresetUsesNearestScopeAndPreservesExistingSources(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	setupLegacyCompatibilityBuiltins(t, ctx, store, 1)
	applyGenerationEntities(t, ctx, store, "presets", 2,
		testSchedulerPreset("notebook-preset", false, false),
		testSchedulerPreset("parent-preset", false, false),
		testSchedulerPreset("child-preset", false, false))
	savePolicy := func(scopeType, scopeID, presetID string) EntityRevision {
		t.Helper()
		revision, found, err := store.projection.StudyPolicyRevision(ctx, scopeType, scopeID)
		if err != nil {
			t.Fatal(err)
		}
		request := SaveStudyPolicyRequest{OperationID: NewID(), ScopeType: scopeType, ScopeID: scopeID,
			Priority: "exam", DefaultPresetID: &presetID, UpdatedAt: 10}
		if found {
			request.ExpectedRevisionID = revision.RevisionID
			request.UpdatedAt = revision.UpdatedAt + 1
		}
		revision, err = store.SaveStudyPolicy(ctx, request)
		if err != nil {
			t.Fatal(err)
		}
		return revision
	}
	savePolicy("notebook", "book", "notebook-preset")
	savePolicy("document", "parent", "parent-preset")
	savePolicy("document", "child", "child-preset")
	locations := []BlockMetadata{
		{BlockID: "a", NotebookID: "book", RootID: "child", Path: "/parent/child.sy"},
		{BlockID: "b", NotebookID: "book", RootID: "sibling", Path: "/parent/sibling.sy"},
		{BlockID: "c", NotebookID: "book", RootID: "root", Path: "/root.sy"},
		{BlockID: "d", NotebookID: "other", RootID: "root2", Path: "/root2.sy"},
	}
	request := QuickSourceRequest{OperationID: "scope-quick", BlockIDs: []string{"a", "b", "c", "d"},
		CreatedAt: 20, BlockMetadata: locations}
	if _, err := store.CreateQuickSources(ctx, request); err != nil {
		t.Fatal(err)
	}
	assertPreset := func(sourceID, expected string) {
		t.Helper()
		revision, found, err := store.projection.CurrentEntity(ctx, EntityCardSource, sourceID)
		var source CardSource
		if err != nil || !found || json.Unmarshal(revision.Payload, &source) != nil || source.DefaultPresetID != expected {
			t.Fatalf("source %s preset: %+v; wanted %s, err=%v", sourceID, source, expected, err)
		}
	}
	for index, expected := range []string{"child-preset", "parent-preset", "notebook-preset", legacyPresetID} {
		assertPreset(LegacyQuickSourceID(request.BlockIDs[index]), expected)
	}
	if _, err := store.ManageCards(ctx, CardManagementRequest{OperationID: "scope-due", CardIDs: []string{LegacyQuickCardID("a")},
		Action: CardActionSetDue, ChangedAt: 21, Due: 987654321}); err != nil {
		t.Fatal(err)
	}
	savePolicy("document", "child", "")
	request.OperationID = "scope-repeated-quick"
	request.CreatedAt = 30
	request.BlockMetadata[0] = locations[3]
	request.BlockMetadata[0].BlockID = "a"
	if _, err := store.CreateQuickSources(ctx, request); err != nil {
		t.Fatal(err)
	}
	assertPreset(LegacyQuickSourceID("a"), "child-preset")
	assertReviewStateForTest(t, ctx, store, LegacyQuickCardID("a"), 987654321, 0)
	newLocation := []BlockMetadata{{BlockID: "new", NotebookID: "book", RootID: "child", Path: "/parent/child.sy"}}
	if _, err := store.CreateBasicSource(ctx, BasicSourceRequest{OperationID: "scope-basic", SourceID: "basic",
		BlockIDs: []string{"new", "answer"}, Direction: BasicDirectionBidirectional, CreatedAt: 40,
		BlockMetadata: newLocation}); err != nil {
		t.Fatal(err)
	}
	assertPreset("basic", "parent-preset")
	if _, err := store.CreateAdvancedSource(ctx, AdvancedSourceRequest{OperationID: "scope-advanced", SourceID: "advanced",
		BlockIDs: []string{"new", "answer"}, Mode: AdvancedModeTypedAnswer, CreatedAt: 41,
		BlockMetadata: newLocation}); err != nil {
		t.Fatal(err)
	}
	assertPreset("advanced", "parent-preset")
	if _, err := store.CreateBasicSource(ctx, BasicSourceRequest{OperationID: "scope-explicit", SourceID: "explicit",
		BlockIDs: []string{"new", "answer"}, Direction: BasicDirectionForward, CreatedAt: 42,
		BlockMetadata: newLocation, DefaultPresetID: "child-preset"}); err != nil {
		t.Fatal(err)
	}
	assertPreset("explicit", "child-preset")
}

func TestStudyPolicyPresetPreservesLegacyPayloadAndValidatesReferences(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	setupLegacyCompatibilityBuiltins(t, ctx, store, 1)
	applyGenerationEntities(t, ctx, store, "preset", 2, testSchedulerPreset("preset", false, false))
	// 旧版策略没有默认预设字段，重放后保持原有优先级和作用范围。
	legacy := json.RawMessage(`{"id":"legacy-policy","scopeType":"document","scopeID":"doc","priority":"paused","createdAt":3,"updatedAt":3}`)
	result, err := store.MutateEntities(ctx, "legacy-policy", []EntityMutation{{EntityType: EntityStudyPolicy,
		EntityID: "legacy-policy", UpdatedAt: 3, Payload: legacy}})
	if err != nil {
		t.Fatal(err)
	}
	presetID := "preset"
	request := SaveStudyPolicyRequest{OperationID: "assign", ScopeType: "document", ScopeID: "doc",
		Priority: "paused", DefaultPresetID: &presetID, ExpectedRevisionID: result.Revisions[0].RevisionID, UpdatedAt: 4}
	revision, err := store.SaveStudyPolicy(ctx, request)
	if err != nil {
		t.Fatal(err)
	}
	request.OperationID = "older-client-priority"
	request.ExpectedRevisionID = revision.RevisionID
	request.DefaultPresetID = nil
	request.Priority = "learning"
	request.UpdatedAt = 5
	revision, err = store.SaveStudyPolicy(ctx, request)
	var policy StudyPolicy
	if err != nil || json.Unmarshal(revision.Payload, &policy) != nil || policy.DefaultPresetID != presetID {
		t.Fatalf("priority-only update lost preset: %+v err=%v", policy, err)
	}
	unknown := "missing"
	request.OperationID = "missing-preset"
	request.ExpectedRevisionID = revision.RevisionID
	request.DefaultPresetID = &unknown
	request.UpdatedAt = 6
	if _, err = store.SaveStudyPolicy(ctx, request); err == nil {
		t.Fatal("missing scope preset was accepted")
	}
	if _, err = store.MutateEntities(ctx, "delete-used-preset", []EntityMutation{{EntityType: EntitySchedulerPreset,
		EntityID: presetID, UpdatedAt: 7, Deleted: true}}); err == nil {
		t.Fatal("deleting a scope-referenced preset was accepted")
	}
	empty := ""
	request.OperationID = "clear-preset"
	request.DefaultPresetID = &empty
	cleared, err := store.SaveStudyPolicy(ctx, request)
	policy = StudyPolicy{}
	if err != nil || json.Unmarshal(cleared.Payload, &policy) != nil || policy.DefaultPresetID != "" {
		t.Fatalf("clearing scope preset failed: %+v err=%v", policy, err)
	}
	request.DefaultPresetID = &presetID
	if _, err = store.SaveStudyPolicy(ctx, request); !errors.Is(err, ErrOperationConflict) {
		t.Fatalf("conflicting scope preset retry was accepted: %v", err)
	}
}

func TestPresetOnlyScopePolicyPreservesInheritedPause(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	setupLegacyCompatibilityBuiltins(t, ctx, store, 1)
	locations := []BlockMetadata{{BlockID: "block", NotebookID: "book", RootID: "child", Path: "/parent/child.sy"}}
	if _, err := store.SaveStudyPolicy(ctx, SaveStudyPolicyRequest{OperationID: "pause-parent",
		ScopeType: "document", ScopeID: "parent", Priority: "paused", UpdatedAt: 2}); err != nil {
		t.Fatal(err)
	}
	presetID := legacyPresetID
	if _, err := store.SaveStudyPolicy(ctx, SaveStudyPolicyRequest{OperationID: "preset-child",
		ScopeType: "document", ScopeID: "child", DefaultPresetID: &presetID, UpdatedAt: 3}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateQuickSources(ctx, QuickSourceRequest{OperationID: "paused-new-card",
		BlockIDs: []string{"block"}, CreatedAt: 4, BlockMetadata: locations}); err != nil {
		t.Fatal(err)
	}
	if err := store.projection.ReplaceBlockMetadata(ctx, locations); err != nil {
		t.Fatal(err)
	}
	cards, err := store.projection.SearchCards(ctx, nil, CardSearchOptions{Now: 5})
	if err != nil || len(cards) != 0 {
		t.Fatalf("preset-only child policy bypassed inherited pause: %+v err=%v", cards, err)
	}
	cards, err = store.projection.SearchCards(ctx, nil, CardSearchOptions{Now: 5, IncludePaused: true})
	if err != nil || len(cards) != 1 || cards[0].EffectivePriority != "paused" {
		t.Fatalf("preset-only child policy lost inherited priority: %+v err=%v", cards, err)
	}
}

func TestSourcePresetCreationRetryKeepsOriginalPresetAfterSourceEdit(t *testing.T) {
	for _, kind := range []string{"basic", "advanced"} {
		t.Run(kind, func(t *testing.T) {
			ctx := context.Background()
			store := newGenerationTestStore(t, ctx)
			defer store.Close()
			setupLegacyCompatibilityBuiltins(t, ctx, store, 1)
			applyGenerationEntities(t, ctx, store, "presets", 2,
				testSchedulerPreset("preset-a", false, false), testSchedulerPreset("preset-b", false, false))
			presetID := "preset-a"
			if _, err := store.SaveStudyPolicy(ctx, SaveStudyPolicyRequest{OperationID: "scope-preset",
				ScopeType: "document", ScopeID: "doc", DefaultPresetID: &presetID, UpdatedAt: 3}); err != nil {
				t.Fatal(err)
			}
			metadata := []BlockMetadata{{BlockID: "question", NotebookID: "book", RootID: "doc", Path: "/doc.sy"}}
			create := func(explicitPresetID string) (EntityRevision, []string, error) {
				if kind == "basic" {
					result, err := store.CreateBasicSource(ctx, BasicSourceRequest{OperationID: "create-source",
						SourceID: "source", BlockIDs: []string{"question", "answer"}, Direction: BasicDirectionForward,
						CreatedAt: 10, DefaultPresetID: explicitPresetID, BlockMetadata: metadata})
					return result.SourceRevision, result.Cards.Created, err
				}
				result, err := store.CreateAdvancedSource(ctx, AdvancedSourceRequest{OperationID: "create-source",
					SourceID: "source", BlockIDs: []string{"question", "answer"}, Mode: AdvancedModeTypedAnswer,
					CreatedAt: 10, DefaultPresetID: explicitPresetID, BlockMetadata: metadata})
				return result.SourceRevision, result.Cards.Created, err
			}
			created, cardIDs, err := create("")
			if err != nil || len(cardIDs) == 0 {
				t.Fatalf("create source: cards=%v err=%v", cardIDs, err)
			}
			var source CardSource
			if err = json.Unmarshal(created.Payload, &source); err != nil || source.DefaultPresetID != "preset-a" {
				t.Fatalf("creation did not capture the scope preset: %+v err=%v", source, err)
			}
			source.DefaultPresetID = "preset-b"
			edited, err := store.MutateEntities(ctx, "edit-source-preset", []EntityMutation{{
				EntityType: EntityCardSource, EntityID: source.ID, ExpectedRevisionID: created.RevisionID,
				UpdatedAt: 20, Payload: mustRawJSON(t, source),
			}})
			if err != nil {
				t.Fatal(err)
			}
			if _, err = store.ManageCards(ctx, CardManagementRequest{OperationID: "change-due",
				CardIDs: cardIDs, Action: CardActionSetDue, ChangedAt: 21, Due: 987654321}); err != nil {
				t.Fatal(err)
			}
			batchCount := len(store.journal.Batches())
			metadata[0] = BlockMetadata{BlockID: "question", NotebookID: "other", RootID: "moved", Path: "/moved.sy"}
			retried, retryCardIDs, err := create("")
			if err != nil || retried.RevisionID != created.RevisionID || string(retried.Payload) != string(created.Payload) ||
				string(mustRawJSON(t, retryCardIDs)) != string(mustRawJSON(t, cardIDs)) {
				t.Fatalf("creation retry did not return the original result: %+v cards=%v err=%v", retried, retryCardIDs, err)
			}
			current, found, err := store.projection.CurrentEntity(ctx, EntityCardSource, source.ID)
			if err != nil || !found || current.RevisionID != edited.Revisions[0].RevisionID {
				t.Fatalf("creation retry changed the edited source: %+v found=%v err=%v", current, found, err)
			}
			for _, cardID := range cardIDs {
				assertReviewStateForTest(t, ctx, store, cardID, 987654321, 0)
			}
			if _, _, err = create("preset-b"); !errors.Is(err, ErrOperationConflict) {
				t.Fatalf("creation retry accepted a different explicit preset: %v", err)
			}
			if len(store.journal.Batches()) != batchCount {
				t.Fatal("creation retries wrote additional authority batches")
			}
		})
	}
}

func TestSourcePresetSchemaFiveProjectionAndSnapshotReopen(t *testing.T) {
	ctx := context.Background()
	workspace := t.TempDir()
	root := filepath.Join(workspace, "v2")
	projectionPath := filepath.Join(workspace, "temp", "flashcards.db")
	store, err := OpenStore(ctx, root, projectionPath, "device-a", &JournalOptions{WriterID: testWriterA})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if store != nil {
			_ = store.Close()
		}
	})
	setupLegacyCompatibilityBuiltins(t, ctx, store, 1)
	applyGenerationEntities(t, ctx, store, "preset", 2, testSchedulerPreset("preset", false, false))
	legacyPayload := json.RawMessage(`{"id":"old-policy","scopeType":"document","scopeID":"doc","priority":"learning","createdAt":3,"updatedAt":3}`)
	policyResult, err := store.MutateEntities(ctx, "old-policy", []EntityMutation{{EntityType: EntityStudyPolicy,
		EntityID: "old-policy", UpdatedAt: 3, Payload: legacyPayload}})
	if err != nil {
		t.Fatal(err)
	}
	created, err := store.CreateBasicSource(ctx, BasicSourceRequest{OperationID: "create",
		SourceID: "source", BlockIDs: []string{"question", "answer"}, Direction: BasicDirectionForward,
		DefaultPresetID: "preset", CreatedAt: 10})
	if err != nil {
		t.Fatal(err)
	}
	cardID := basicActiveCardIDs("source", BasicDirectionForward)[0]
	reviewed, err := store.ReviewCard(ctx, ReviewRequest{OperationID: "review", CardID: cardID,
		Rating: ReviewGood, ReviewedAt: 1000, DurationMS: 1500, ReviewMode: "normal"})
	if err != nil {
		t.Fatal(err)
	}
	stateBefore, found, err := store.projection.CurrentEntity(ctx, EntityReviewState, cardID)
	if err != nil || !found {
		t.Fatalf("review state missing: found=%v err=%v", found, err)
	}
	snapshot, err := store.CreateSnapshot(ctx)
	if err != nil {
		t.Fatal(err)
	}
	batchCount := len(store.journal.Batches())
	if err = store.Close(); err != nil {
		t.Fatal(err)
	}
	// 还原第五版策略表及版本号，并为旧快照重新计算正确哈希，确保触发的是模式升级而非损坏回退。
	downgrade := func(path string) {
		t.Helper()
		db, openErr := sql.Open("sqlite3", path)
		if openErr != nil {
			t.Fatal(openErr)
		}
		defer db.Close()
		if _, openErr = db.Exec("ALTER TABLE study_policies DROP COLUMN default_preset_id"); openErr != nil {
			t.Fatal(openErr)
		}
		if _, openErr = db.Exec("PRAGMA user_version=5"); openErr != nil {
			t.Fatal(openErr)
		}
		if _, openErr = db.Exec("PRAGMA wal_checkpoint(TRUNCATE)"); openErr != nil {
			t.Fatal(openErr)
		}
	}
	downgrade(projectionPath)
	downgrade(snapshot.Path)
	legacyHash, err := fileSHA256(snapshot.Path)
	if err != nil {
		t.Fatal(err)
	}
	legacySnapshotPath := filepath.Join(filepath.Dir(snapshot.Path), fmt.Sprintf("%020d-%s.db", snapshot.CreatedAt, legacyHash))
	if err = os.Rename(snapshot.Path, legacySnapshotPath); err != nil {
		t.Fatal(err)
	}
	if !ProjectionNeedsRebuild(projectionPath) {
		t.Fatal("schema five projection was accepted without an upgrade")
	}
	if _, available, snapshotErr := BestSnapshot(SnapshotRoot(root)); snapshotErr != nil || available {
		t.Fatalf("schema five snapshot was accepted as a current projection: available=%v err=%v", available, snapshotErr)
	}
	store, err = OpenStore(ctx, root, projectionPath, "device-b", &JournalOptions{WriterID: testWriterB})
	if err != nil {
		t.Fatal(err)
	}
	assertRestored := func(expectedPolicy EntityRevision) {
		t.Helper()
		for _, expected := range []EntityRevision{created.SourceRevision, stateBefore, expectedPolicy} {
			actual, exists, queryErr := store.projection.CurrentEntity(ctx, expected.EntityType, expected.EntityID)
			if queryErr != nil || !exists || actual.RevisionID != expected.RevisionID || string(actual.Payload) != string(expected.Payload) {
				t.Fatalf("rebuilt entity changed: expected=%+v actual=%+v exists=%v err=%v", expected, actual, exists, queryErr)
			}
		}
		events, queryErr := store.projection.DomainEvents(ctx, EventReview)
		if queryErr != nil || len(events) != 1 || events[0].EventID != reviewed.Event.EventID ||
			string(events[0].Payload) != string(reviewed.Event.Payload) {
			t.Fatalf("rebuilt review history changed: %+v err=%v", events, queryErr)
		}
		if ProjectionNeedsRebuild(projectionPath) {
			t.Fatal("reopened projection still requires rebuilding")
		}
	}
	assertRestored(policyResult.Revisions[0])
	var projectedPresetID string
	if err = store.projection.db.QueryRowContext(ctx, "SELECT default_preset_id FROM study_policies WHERE id = ?",
		"old-policy").Scan(&projectedPresetID); err != nil || projectedPresetID != "" {
		t.Fatalf("legacy policy did not acquire an empty preset column: preset=%s err=%v", projectedPresetID, err)
	}
	if len(store.journal.Batches()) != batchCount {
		t.Fatal("schema upgrade changed the authority history")
	}
	presetID := "preset"
	updatedPolicy, err := store.SaveStudyPolicy(ctx, SaveStudyPolicyRequest{OperationID: "assign-scope-preset",
		ScopeType: "document", ScopeID: "doc", Priority: "learning", DefaultPresetID: &presetID,
		ExpectedRevisionID: policyResult.Revisions[0].RevisionID, UpdatedAt: 2000})
	if err != nil {
		t.Fatal(err)
	}
	if err = store.Close(); err != nil {
		t.Fatal(err)
	}
	if err = os.Remove(projectionPath); err != nil {
		t.Fatal(err)
	}
	store, err = OpenStore(ctx, root, projectionPath, "device-c", &JournalOptions{WriterID: NewID()})
	if err != nil {
		t.Fatal(err)
	}
	assertRestored(updatedPolicy)
	if err = store.projection.db.QueryRowContext(ctx, "SELECT default_preset_id FROM study_policies WHERE id = ?",
		"old-policy").Scan(&projectedPresetID); err != nil || projectedPresetID != presetID {
		t.Fatalf("new scope preset was not rebuilt from authority: preset=%s err=%v", projectedPresetID, err)
	}
	if preservedHash, hashErr := fileSHA256(legacySnapshotPath); hashErr != nil || preservedHash != legacyHash {
		t.Fatalf("legacy snapshot was modified during upgrade: hash=%s err=%v", preservedHash, hashErr)
	}
}
