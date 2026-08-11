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
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/open-spaced-repetition/go-fsrs/v3"
	"github.com/siyuan-note/riff"
	"github.com/vmihailenco/msgpack/v5"
)

func TestQueryASTValidatesFieldsComparatorsAndComplexity(t *testing.T) {
	query := QueryAST{
		Version: QueryVersion,
		Root: QueryExpression{
			Operator: QueryAnd,
			Children: []QueryExpression{
				{Operator: QueryPredicate, Field: "due", Comparator: QueryLessOrEqual, Value: json.RawMessage(`1786431600000`)},
				{Operator: QueryPredicate, Field: "tagID", Comparator: QueryDescendantOf, Value: json.RawMessage(`"tag-1"`)},
			},
		},
	}
	data, err := CanonicalJSON(query)
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := ParseQueryAST(data)
	if err != nil {
		t.Fatal(err)
	}
	if parsed.Version != QueryVersion || parsed.Root.Operator != QueryAnd {
		t.Fatalf("unexpected parsed query: %+v", parsed)
	}

	query.Root.Children[0].Field = "unknown"
	if err = query.Validate(); err == nil || !strings.Contains(err.Error(), "unsupported flashcard query field") {
		t.Fatalf("expected unsupported field error, got %v", err)
	}
	query.Root.Children[0].Field = "due"
	query.Root.Children[0].Comparator = QueryContains
	if err = query.Validate(); err == nil || !strings.Contains(err.Error(), "unsupported comparator") {
		t.Fatalf("expected unsupported comparator error, got %v", err)
	}
}

func TestEntityAndReviewEventValidationRejectsIncompleteAuthorityRecords(t *testing.T) {
	revision := EntityRevision{
		EntityType: EntityCardSource,
		EntityID:   "source-1",
		RevisionID: "revision-1",
		UpdatedAt:  1,
		Payload:    json.RawMessage(`{"id":"source-1"}`),
	}
	if err := revision.Validate(); err == nil || !strings.Contains(err.Error(), "identity is incomplete") {
		t.Fatalf("expected incomplete card source to be rejected, got %v", err)
	}

	payload := ReviewEventPayload{
		CardID:     "card-1",
		SourceID:   "source-1",
		Kind:       "review",
		Rating:     ReviewGood,
		ReviewedAt: 1,
		ReviewMode: "normal",
	}
	if _, err := NewReviewEvent("operation-1", payload); err == nil ||
		!strings.Contains(err.Error(), "lacks scheduler state") {
		t.Fatalf("expected incomplete review event to be rejected, got %v", err)
	}
}

func TestOperationDerivedIdentitiesAreStable(t *testing.T) {
	card := testCard("card-1", "source-1", "template-1", "forward", 100)
	first, err := NewOperationEntityRevision("operation-1", EntityCard, card.ID, nil, 100, false, card)
	if err != nil {
		t.Fatal(err)
	}
	second, err := NewOperationEntityRevision("operation-1", EntityCard, card.ID, nil, 100, false, card)
	if err != nil {
		t.Fatal(err)
	}
	if first.RevisionID != second.RevisionID || first.RevisionID != OperationRevisionID("operation-1", EntityCard, card.ID) {
		t.Fatal("operation-derived revision identity is not stable")
	}

	state := testReviewState("card-1", "state-before", 100)
	eventPayload := testReviewEventPayload(state.ReviewStateSnapshot, state.ReviewStateSnapshot, 100)
	eventA, err := NewReviewEvent("operation-2", eventPayload)
	if err != nil {
		t.Fatal(err)
	}
	eventB, err := NewReviewEvent("operation-2", eventPayload)
	if err != nil {
		t.Fatal(err)
	}
	if eventA.EventID != eventB.EventID || eventA.EventID != ReviewEventID("operation-2", "card-1") {
		t.Fatal("operation-derived review event identity is not stable")
	}
}

func TestBusinessProjectionAndReviewHistoryRebuildFromAuthority(t *testing.T) {
	ctx := context.Background()
	workspace := t.TempDir()
	journalRoot := filepath.Join(workspace, "data", "storage", "riff", "v2")
	projectionPath := filepath.Join(workspace, "temp", "flashcards.db")
	store, err := OpenStore(ctx, journalRoot, projectionPath, "device-a", &JournalOptions{WriterID: testWriterA})
	if err != nil {
		t.Fatal(err)
	}
	card := testCard("card-1", "source-1", "template-1", "forward", 100)
	cardRevision, err := NewOperationEntityRevision("operation-review", EntityCard, card.ID, nil, 100, false, card)
	if err != nil {
		t.Fatal(err)
	}
	stateRevisionID := OperationRevisionID("operation-review", EntityReviewState, card.ID)
	before := testReviewState(card.ID, "state-before", 90)
	after := testReviewState(card.ID, stateRevisionID, 200)
	stateRevision, err := NewOperationEntityRevision("operation-review", EntityReviewState, card.ID, nil, 100, false, after)
	if err != nil {
		t.Fatal(err)
	}
	eventPayload := testReviewEventPayload(before.ReviewStateSnapshot, after.ReviewStateSnapshot, 100)
	event, err := NewReviewEvent("operation-review", eventPayload)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = store.Apply(ctx, "operation-review", []Change{
		{Kind: RecordEntityRevision, Revision: &cardRevision},
		{Kind: RecordEntityRevision, Revision: &stateRevision},
		{Kind: RecordEvent, Event: &event},
	}); err != nil {
		t.Fatal(err)
	}
	assertBusinessProjection(t, ctx, store.Projection(), card.ID, stateRevisionID, event.EventID)
	if err = store.Close(); err != nil {
		t.Fatal(err)
	}

	if err = os.RemoveAll(filepath.Dir(projectionPath)); err != nil {
		t.Fatal(err)
	}
	rebuilt, err := OpenStore(ctx, journalRoot, projectionPath, "device-b", &JournalOptions{WriterID: testWriterB})
	if err != nil {
		t.Fatal(err)
	}
	defer rebuilt.Close()
	assertBusinessProjection(t, ctx, rebuilt.Projection(), card.ID, stateRevisionID, event.EventID)
}

func TestCardVariantUniquenessIsRejectedBeforeJournalWrite(t *testing.T) {
	ctx := context.Background()
	workspace := t.TempDir()
	store, err := OpenStore(ctx, filepath.Join(workspace, "v2"), filepath.Join(workspace, "temp", "flashcards.db"),
		"device-a", &JournalOptions{WriterID: testWriterA})
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	first := testCard("card-1", "source-1", "template-1", "forward", 100)
	firstRevision, err := NewOperationEntityRevision("operation-1", EntityCard, first.ID, nil, 100, false, first)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = store.Apply(ctx, "operation-1", []Change{{Kind: RecordEntityRevision, Revision: &firstRevision}}); err != nil {
		t.Fatal(err)
	}
	duplicate := testCard("card-2", "source-1", "template-1", "forward", 101)
	duplicateRevision, err := NewOperationEntityRevision("operation-2", EntityCard, duplicate.ID, nil, 101, false,
		duplicate)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = store.Apply(ctx, "operation-2", []Change{{Kind: RecordEntityRevision, Revision: &duplicateRevision}}); err == nil || !strings.Contains(err.Error(), "UNIQUE constraint failed") {
		t.Fatalf("expected duplicate card variant to be rejected, got %v", err)
	}
	if len(store.journal.Batches()) != 1 {
		t.Fatal("invalid card variant reached the authority journal")
	}
}

func TestProjectionSchemaDamageTriggersAuthorityRebuild(t *testing.T) {
	ctx := context.Background()
	workspace := t.TempDir()
	root := filepath.Join(workspace, "v2")
	path := filepath.Join(workspace, "temp", "flashcards.db")
	store, err := OpenStore(ctx, root, path, "device-a", &JournalOptions{WriterID: testWriterA})
	if err != nil {
		t.Fatal(err)
	}
	card := testCard("card-1", "source-1", "template-1", "forward", 100)
	revision, err := NewOperationEntityRevision("operation-1", EntityCard, card.ID, nil, 100, false, card)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = store.Apply(ctx, "operation-1", []Change{{Kind: RecordEntityRevision, Revision: &revision}}); err != nil {
		t.Fatal(err)
	}
	if err = store.Close(); err != nil {
		t.Fatal(err)
	}
	db, err := sql.Open("sqlite3", path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec("DROP TABLE cards"); err != nil {
		_ = db.Close()
		t.Fatal(err)
	}
	if err = db.Close(); err != nil {
		t.Fatal(err)
	}
	if !ProjectionNeedsRebuild(path) {
		t.Fatal("projection with a missing business table was considered healthy")
	}
	rebuilt, err := OpenStore(ctx, root, path, "device-b", &JournalOptions{WriterID: testWriterB})
	if err != nil {
		t.Fatal(err)
	}
	defer rebuilt.Close()
	var count int
	if err = rebuilt.Projection().db.QueryRowContext(ctx, "SELECT COUNT(*) FROM cards WHERE id = ?", card.ID).Scan(&count); err != nil || count != 1 {
		t.Fatalf("card was not restored after schema rebuild: count=%d err=%v", count, err)
	}
}

func TestStoreRefreshImportsGrowingSyncedWriterSegment(t *testing.T) {
	ctx := context.Background()
	workspace := t.TempDir()
	root := filepath.Join(workspace, "v2")
	store, err := OpenStore(ctx, root, filepath.Join(workspace, "temp", "flashcards.db"), "device-a",
		&JournalOptions{WriterID: testWriterA})
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	remote, err := OpenJournal(root, "device-b", &JournalOptions{WriterID: testWriterB})
	if err != nil {
		t.Fatal(err)
	}
	for index, cardID := range []string{"card-1", "card-2"} {
		operationID := "remote-operation-" + cardID
		card := testCard(cardID, "source-1", "template-1", cardID, int64(index+1))
		revision, revisionErr := NewOperationEntityRevision(operationID, EntityCard, card.ID, nil,
			int64(index+1), false, card)
		if revisionErr != nil {
			t.Fatal(revisionErr)
		}
		if _, _, err = remote.Append(operationID, []Change{{Kind: RecordEntityRevision, Revision: &revision}}); err != nil {
			t.Fatal(err)
		}
		if err = store.Refresh(ctx); err != nil {
			t.Fatal(err)
		}
		var count int
		if err = store.Projection().db.QueryRowContext(ctx, "SELECT COUNT(*) FROM cards").Scan(&count); err != nil ||
			count != index+1 {
			t.Fatalf("unexpected refreshed card count: count=%d err=%v", count, err)
		}
	}
	if err = remote.Close(); err != nil {
		t.Fatal(err)
	}
	if err = store.Refresh(ctx); err != nil {
		t.Fatal(err)
	}
	if watermark, watermarkErr := store.Projection().HighWatermark(ctx, testWriterB); watermarkErr != nil || watermark != 2 {
		t.Fatalf("unexpected remote writer watermark: watermark=%d err=%v", watermark, watermarkErr)
	}
}

func TestSnapshotFallsBackAndReplaysAllAuthorityBatches(t *testing.T) {
	ctx := context.Background()
	workspace := t.TempDir()
	root := filepath.Join(workspace, "v2")
	projectionPath := filepath.Join(workspace, "temp", "flashcards.db")
	now := time.UnixMilli(1786431600000)
	store, err := OpenStore(ctx, root, projectionPath, "device-a", &JournalOptions{
		WriterID: testWriterA,
		Now:      func() time.Time { return now },
	})
	if err != nil {
		t.Fatal(err)
	}
	for index, cardID := range []string{"card-1", "card-2"} {
		operationID := "operation-" + cardID
		card := testCard(cardID, "source-1", "template-1", cardID, int64(index+1))
		revision, revisionErr := NewOperationEntityRevision(operationID, EntityCard, card.ID, nil,
			int64(index+1), false, card)
		if revisionErr != nil {
			t.Fatal(revisionErr)
		}
		if _, err = store.Apply(ctx, operationID, []Change{{Kind: RecordEntityRevision, Revision: &revision}}); err != nil {
			t.Fatal(err)
		}
		if index == 0 {
			if err = store.Projection().ReplaceBlockMetadataAndSourceAvailability(ctx, []BlockMetadata{{
				BlockID: "block-1", NotebookID: "notebook-1", RootID: "root-1", Path: "/root-1.sy",
			}}, map[string]bool{"source-1": false}); err != nil {
				t.Fatal(err)
			}
			var snapshot SnapshotInfo
			if snapshot, err = store.CreateSnapshot(ctx); err != nil {
				t.Fatal(err)
			}
			assertDisposableSnapshotTablesEmpty(t, snapshot.Path)
			var liveMetadata int
			if err = store.Projection().db.QueryRowContext(ctx, "SELECT COUNT(*) FROM block_metadata").
				Scan(&liveMetadata); err != nil || liveMetadata != 1 {
				t.Fatalf("snapshot cleanup changed live disposable metadata: count=%d err=%v", liveMetadata, err)
			}
		}
	}
	newest, err := store.CreateSnapshot(ctx)
	if err != nil {
		t.Fatal(err)
	}
	assertDisposableSnapshotTablesEmpty(t, newest.Path)
	best, found, err := BestSnapshot(SnapshotRoot(root))
	if err != nil || !found || best.BatchCount != 2 || best.Path != newest.Path {
		t.Fatalf("unexpected best snapshot: found=%v snapshot=%+v err=%v", found, best, err)
	}
	if err = os.WriteFile(newest.Path, []byte("corrupt snapshot"), 0600); err != nil {
		t.Fatal(err)
	}
	best, found, err = BestSnapshot(SnapshotRoot(root))
	if err != nil || !found || best.BatchCount != 1 {
		t.Fatalf("older snapshot was not selected after corruption: found=%v snapshot=%+v err=%v", found, best, err)
	}
	if err = store.Close(); err != nil {
		t.Fatal(err)
	}
	if err = os.RemoveAll(filepath.Dir(projectionPath)); err != nil {
		t.Fatal(err)
	}
	rebuilt, err := OpenStore(ctx, root, projectionPath, "device-b", &JournalOptions{WriterID: testWriterB})
	if err != nil {
		t.Fatal(err)
	}
	defer rebuilt.Close()
	var count int
	if err = rebuilt.Projection().db.QueryRowContext(ctx, "SELECT COUNT(*) FROM cards").Scan(&count); err != nil || count != 2 {
		t.Fatalf("authority batches were not replayed after snapshot restore: count=%d err=%v", count, err)
	}
}

func assertDisposableSnapshotTablesEmpty(t *testing.T, path string) {
	t.Helper()
	db, err := sql.Open("sqlite3", path+"?mode=ro&_busy_timeout=1000")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	for _, table := range []string{"block_metadata", "source_availability"} {
		var count int
		if err = db.QueryRow("SELECT COUNT(*) FROM " + table).Scan(&count); err != nil || count != 0 {
			t.Fatalf("disposable snapshot table [%s] is not empty: count=%d err=%v", table, count, err)
		}
	}
}

func TestLegacyMigrationIsDeterministicMergesDuplicatesAndExcludesEncryptedCards(t *testing.T) {
	ctx := context.Background()
	legacyRoot := t.TempDir()
	olderReview := int64(1786000000000)
	newerReview := int64(1786100000000)
	deckA := riff.Deck{ID: "deck-a", Name: "Deck A", Algo: riff.AlgoFSRS, Created: 1785000000000,
		Updated: 1786200000000}
	deckB := riff.Deck{ID: "deck-b", Name: "Deck B", Algo: riff.AlgoFSRS, Created: 1785100000000,
		Updated: 1786300000000}
	writeMsgpack(t, filepath.Join(legacyRoot, "deck-a.deck"), deckA)
	writeMsgpack(t, filepath.Join(legacyRoot, "deck-b.deck"), deckB)
	writeMsgpack(t, filepath.Join(legacyRoot, "deck-a.cards"), map[string]*riff.FSRSCard{
		"legacy-a": legacyFSRSCard("legacy-a", "block-shared", olderReview, 2),
		"legacy-e": legacyFSRSCard("legacy-e", "block-encrypted", olderReview, 1),
		"legacy-o": legacyFSRSCard("legacy-o", "block-orphaned", olderReview, 1),
	})
	writeMsgpack(t, filepath.Join(legacyRoot, "deck-b.cards"), map[string]*riff.FSRSCard{
		"legacy-b": legacyFSRSCard("legacy-b", "block-shared", newerReview, 5),
	})
	writeMsgpack(t, filepath.Join(legacyRoot, "logs", "202608.msgpack"), []*riff.Log{
		{ID: "log-a", CardID: "legacy-a", Rating: riff.Good, ScheduledDays: 3, ElapsedDays: 2,
			Reviewed: olderReview / 1000, State: riff.Review},
		{ID: "log-b", CardID: "legacy-b", Rating: riff.Easy, ScheduledDays: 5, ElapsedDays: 3,
			Reviewed: newerReview / 1000, State: riff.Review},
		{ID: "log-e", CardID: "legacy-e", Rating: riff.Hard, ScheduledDays: 1, ElapsedDays: 1,
			Reviewed: newerReview / 1000, State: riff.Learning},
	})
	weights := fsrs.DefaultWeights()
	options := LegacyMigrationOptions{
		RequestRetention: 0.9,
		MaximumInterval:  36500,
		Weights:          append([]float64(nil), weights[:]...),
		NewLimit:         20,
		ReviewLimit:      200,
		LeechThreshold:   8,
		LeechAction:      "tag",
		PresetName:       "Default",
		ResolveBlock: func(_ context.Context, blockID string) (LegacyBlockInfo, error) {
			switch blockID {
			case "block-encrypted":
				return LegacyBlockInfo{Exists: true, Encrypted: true}, nil
			case "block-orphaned":
				return LegacyBlockInfo{}, nil
			default:
				return LegacyBlockInfo{Exists: true}, nil
			}
		},
	}
	first, err := PrepareLegacyMigration(ctx, legacyRoot, options)
	if err != nil {
		t.Fatal(err)
	}
	if err = first.Validate(); err != nil {
		t.Fatal(err)
	}
	if !first.Report.Complete || first.Report.LegacyDecks != 2 || first.Report.LegacyCards != 4 ||
		first.Report.MigratedSources != 2 || first.Report.MigratedCards != 2 || first.Report.MergedCards != 1 ||
		first.Report.ReviewSets != 2 || first.Report.ReviewEvents != 2 || first.Report.OrphanedSources != 1 ||
		first.Report.SkippedEncryptedCards != 1 || first.Report.SkippedEncryptedLogs != 1 {
		t.Fatalf("unexpected migration report: %+v", first.Report)
	}
	canonicalChanges, err := CanonicalJSON(first.Changes)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(canonicalChanges), "block-encrypted") || strings.Contains(string(canonicalChanges), "legacy-e") {
		t.Fatal("encrypted flashcard metadata reached migration authority records")
	}
	sharedCardID := GeneratedCardID(DeterministicID("legacy-card-source", "block-shared"), legacyQuickTemplateID,
		"legacy-quick")
	selectedLegacyCard := ""
	for _, change := range first.Changes {
		if change.Kind != RecordEntityRevision || change.Revision == nil {
			continue
		}
		switch change.Revision.EntityType {
		case EntityReviewState:
			if change.Revision.EntityID != sharedCardID {
				continue
			}
			var state ReviewState
			if err = decodeStrictJSON(change.Revision.Payload, &state); err != nil {
				t.Fatal(err)
			}
			if state.LastReview != newerReview || state.Reps != 5 {
				t.Fatalf("newest duplicate state was not selected: %+v", state)
			}
		case EntityLegacyCardAlias:
			var alias LegacyCardAlias
			if err = decodeStrictJSON(change.Revision.Payload, &alias); err != nil {
				t.Fatal(err)
			}
			if alias.CardID == sharedCardID && alias.Selected {
				selectedLegacyCard = alias.LegacyCardID
			}
		}
	}
	if selectedLegacyCard != "legacy-b" {
		t.Fatalf("unexpected selected legacy card [%s]", selectedLegacyCard)
	}

	deckPath := filepath.Join(legacyRoot, "deck-a.deck")
	changedTime := time.Now().Add(5 * time.Second)
	if err = os.Chtimes(deckPath, changedTime, changedTime); err != nil {
		t.Fatal(err)
	}
	second, err := PrepareLegacyMigration(ctx, legacyRoot, options)
	if err != nil {
		t.Fatal(err)
	}
	if first.MigrationID != second.MigrationID || first.RecordDigest != second.RecordDigest ||
		string(canonicalChanges) != string(mustCanonicalJSON(t, second.Changes)) {
		t.Fatal("migration identities changed when only local file modification time changed")
	}

	workspace := t.TempDir()
	store, err := OpenStore(ctx, filepath.Join(workspace, "v2"), filepath.Join(workspace, "temp", "flashcards.db"),
		"device-a", &JournalOptions{WriterID: testWriterA})
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if _, err = store.Apply(ctx, first.OperationID, first.Changes); err != nil {
		t.Fatal(err)
	}
	for table, expected := range map[string]int{
		"cards":                  2,
		"review_states":          2,
		"review_events":          2,
		"review_sets":            2,
		"review_set_memberships": 3,
		"legacy_card_aliases":    3,
	} {
		var count int
		if err = store.Projection().db.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+table).Scan(&count); err != nil ||
			count != expected {
			t.Fatalf("unexpected migrated table [%s] count: count=%d err=%v", table, count, err)
		}
	}
}

func testCard(id, sourceID, templateID, variantKey string, updatedAt int64) Card {
	return Card{
		ID:               id,
		SourceID:         sourceID,
		TemplateID:       templateID,
		VariantKey:       variantKey,
		GenerationStatus: GenerationActive,
		CreatedAt:        updatedAt,
		UpdatedAt:        updatedAt,
	}
}

func legacyFSRSCard(cardID, blockID string, lastReview int64, reps uint64) *riff.FSRSCard {
	return &riff.FSRSCard{
		BaseCard: &riff.BaseCard{CID: cardID, BID: blockID},
		C: &fsrs.Card{
			Due:           time.UnixMilli(lastReview + 86400000),
			Stability:     3,
			Difficulty:    5,
			ElapsedDays:   2,
			ScheduledDays: 3,
			Reps:          reps,
			Lapses:        1,
			State:         fsrs.Review,
			LastReview:    time.UnixMilli(lastReview),
		},
	}
}

func writeMsgpack(t *testing.T, path string, value any) {
	t.Helper()
	data, err := msgpack.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
}

func mustCanonicalJSON(t *testing.T, value any) []byte {
	t.Helper()
	data, err := CanonicalJSON(value)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func testReviewState(cardID, stateRevisionID string, due int64) ReviewState {
	return ReviewState{
		CardID: cardID,
		ReviewStateSnapshot: ReviewStateSnapshot{
			State:           "review",
			Due:             due,
			LastReview:      due - 10,
			Stability:       3,
			Difficulty:      5,
			ElapsedDays:     1,
			ScheduledDays:   3,
			Reps:            2,
			StateRevisionID: stateRevisionID,
		},
	}
}

func testReviewEventPayload(before, after ReviewStateSnapshot, reviewedAt int64) ReviewEventPayload {
	duration := int64(1500)
	return ReviewEventPayload{
		CardID:              "card-1",
		SourceID:            "source-1",
		Kind:                "review",
		Rating:              ReviewGood,
		ReviewedAt:          reviewedAt,
		DurationMS:          &duration,
		BaseStateRevisionID: before.StateRevisionID,
		BeforeState:         &before,
		AfterState:          &after,
		SchedulerVersion:    "fsrs-6",
		PresetRevisionID:    "preset-revision-1",
		SchedulerInput:      json.RawMessage(`{"requestRetention":0.9}`),
		SessionID:           "session-1",
		ReviewSetID:         "review-set-1",
		ReviewMode:          "normal",
	}
}

func assertBusinessProjection(t *testing.T, ctx context.Context, projection *Projection, cardID, stateRevisionID,
	eventID string) {
	t.Helper()
	var cardCount int
	if err := projection.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM cards WHERE id = ?", cardID).Scan(&cardCount); err != nil || cardCount != 1 {
		t.Fatalf("unexpected projected card count: count=%d err=%v", cardCount, err)
	}
	var projectedStateRevisionID string
	if err := projection.db.QueryRowContext(ctx, "SELECT state_revision_id FROM review_states WHERE card_id = ?", cardID).
		Scan(&projectedStateRevisionID); err != nil || projectedStateRevisionID != stateRevisionID {
		t.Fatalf("unexpected projected state revision: id=%s err=%v", projectedStateRevisionID, err)
	}
	var projectedEventID string
	if err := projection.db.QueryRowContext(ctx, "SELECT event_id FROM review_events WHERE event_id = ?", eventID).
		Scan(&projectedEventID); err != nil || projectedEventID != eventID {
		t.Fatalf("unexpected projected review event: id=%s err=%v", projectedEventID, err)
	}
}
