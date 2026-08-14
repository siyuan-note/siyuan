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
	"os"
	"path/filepath"
	"testing"

	"github.com/open-spaced-repetition/go-fsrs/v3"
	"github.com/siyuan-note/riff"
)

func TestLegacyMigrationActivationAndDivergenceAreImmutableAndIdempotent(t *testing.T) {
	ctx := context.Background()
	legacyRoot := t.TempDir()
	deck := riff.Deck{ID: "deck-lifecycle", Name: "Lifecycle", Algo: riff.AlgoFSRS,
		Created: 1785000000000, Updated: 1786000000000}
	writeMsgpack(t, filepath.Join(legacyRoot, "deck-lifecycle.deck"), deck)
	cardsPath := filepath.Join(legacyRoot, "deck-lifecycle.cards")
	writeMsgpack(t, cardsPath, map[string]*riff.FSRSCard{
		"legacy-lifecycle": legacyFSRSCard("legacy-lifecycle", "block-lifecycle", 1785900000000, 3),
	})
	weights := fsrs.DefaultWeights()
	plan, err := PrepareLegacyMigration(ctx, legacyRoot, LegacyMigrationOptions{
		RequestRetention: 0.9, MaximumInterval: 36500, Weights: append([]float64(nil), weights[:]...),
		NewLimit: 20, ReviewLimit: 200, LeechThreshold: 8, LeechAction: "tag", PresetName: "Default",
		ResolveBlock: func(context.Context, string) (LegacyBlockInfo, error) {
			return LegacyBlockInfo{Exists: true}, nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}

	workspace := t.TempDir()
	store, err := OpenStore(ctx, filepath.Join(workspace, "v2"), filepath.Join(workspace, "temp", "flashcards.db"),
		"device-a", &JournalOptions{WriterID: testWriterA})
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	first, err := store.ActivateLegacyMigration(ctx, legacyRoot, plan)
	if err != nil {
		t.Fatal(err)
	}
	if first.Status.State != MigrationStateActive || first.Status.MigrationID != plan.MigrationID ||
		first.Status.Activated == nil {
		t.Fatalf("unexpected activated migration status: %#v", first.Status)
	}
	retry, err := store.ActivateLegacyMigration(ctx, legacyRoot, plan)
	if err != nil {
		t.Fatal(err)
	}
	if retry.PreparedBatch.BatchID != first.PreparedBatch.BatchID ||
		retry.ActivationBatch.BatchID != first.ActivationBatch.BatchID {
		t.Fatal("migration activation retry created different authority batches")
	}

	data, err := os.ReadFile(cardsPath)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(cardsPath, append(data, 0), 0600); err != nil {
		t.Fatal(err)
	}
	status, err := store.CheckLegacyDivergence(ctx, legacyRoot)
	if err != nil {
		t.Fatal(err)
	}
	if status.State != MigrationStateLegacyDiverged || status.Diverged == nil ||
		status.Diverged.EntityID != plan.MigrationID {
		t.Fatalf("unexpected diverged migration status: %#v", status)
	}
	eventCount, err := store.Projection().EventCount(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = store.CheckLegacyDivergence(ctx, legacyRoot); err != nil {
		t.Fatal(err)
	}
	retryEventCount, err := store.Projection().EventCount(ctx)
	if err != nil || retryEventCount != eventCount {
		t.Fatalf("divergence retry duplicated an event: before=%d after=%d err=%v", eventCount, retryEventCount, err)
	}
}

func TestLegacyMigrationActivationRejectsChangedPreviewInput(t *testing.T) {
	ctx := context.Background()
	legacyRoot := t.TempDir()
	deck := riff.Deck{ID: "deck-preview", Name: "Preview", Algo: riff.AlgoFSRS,
		Created: 1785000000000, Updated: 1786000000000}
	deckPath := filepath.Join(legacyRoot, "deck-preview.deck")
	writeMsgpack(t, deckPath, deck)
	writeMsgpack(t, filepath.Join(legacyRoot, "deck-preview.cards"), map[string]*riff.FSRSCard{
		"legacy-preview": legacyFSRSCard("legacy-preview", "block-preview", 1785900000000, 3),
	})
	weights := fsrs.DefaultWeights()
	plan, err := PrepareLegacyMigration(ctx, legacyRoot, LegacyMigrationOptions{
		RequestRetention: 0.9, MaximumInterval: 36500, Weights: append([]float64(nil), weights[:]...),
		NewLimit: 20, ReviewLimit: 200, LeechThreshold: 8, LeechAction: "tag", PresetName: "Default",
		ResolveBlock: func(context.Context, string) (LegacyBlockInfo, error) {
			return LegacyBlockInfo{Exists: true}, nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(deckPath, []byte("changed"), 0600); err != nil {
		t.Fatal(err)
	}
	workspace := t.TempDir()
	store, err := OpenStore(ctx, filepath.Join(workspace, "v2"), filepath.Join(workspace, "temp", "flashcards.db"),
		"device-a", &JournalOptions{WriterID: testWriterA})
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if _, err = store.ActivateLegacyMigration(ctx, legacyRoot, plan); err == nil {
		t.Fatal("expected changed migration input to reject activation")
	}
	if count, countErr := store.Projection().OperationCount(ctx); countErr != nil || count != 0 {
		t.Fatalf("rejected activation wrote authority records: count=%d err=%v", count, countErr)
	}
}

func TestPreparingLegacyMigrationResumesTheSamePlan(t *testing.T) {
	ctx := context.Background()
	legacyRoot := filepath.Join(t.TempDir(), "missing-riff")
	plan, err := PrepareLegacyMigration(ctx, legacyRoot, preparingMigrationTestOptions())
	if err != nil {
		t.Fatal(err)
	}
	workspace := t.TempDir()
	store, err := OpenStore(ctx, filepath.Join(workspace, "v2"), filepath.Join(workspace, "temp", "flashcards.db"),
		"device-a", &JournalOptions{WriterID: testWriterA})
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	preparedBatch, err := store.Apply(ctx, plan.OperationID, plan.Changes)
	if err != nil {
		t.Fatal(err)
	}
	status, err := store.LegacyMigrationStatus(ctx)
	if err != nil || status.State != MigrationStatePreparing || status.MigrationID != plan.MigrationID {
		t.Fatalf("migration did not remain preparing after its candidate batch: status=%+v err=%v", status, err)
	}
	activation, err := store.ActivateLegacyMigration(ctx, legacyRoot, plan)
	if err != nil {
		t.Fatal(err)
	}
	if activation.PreparedBatch.BatchID != preparedBatch.BatchID || activation.Status.State != MigrationStateActive {
		t.Fatalf("same preparing plan did not resume idempotently: activation=%+v", activation)
	}
	if conflicts, countErr := store.Projection().ConflictCount(ctx); countErr != nil || conflicts != 0 {
		t.Fatalf("same preparing plan created entity conflicts: count=%d err=%v", conflicts, countErr)
	}
}

func TestPreparingLegacyMigrationRejectsDifferentPlan(t *testing.T) {
	ctx := context.Background()
	legacyRoot := filepath.Join(t.TempDir(), "riff")
	options := preparingMigrationTestOptions()
	firstPlan, err := PrepareLegacyMigration(ctx, legacyRoot, options)
	if err != nil {
		t.Fatal(err)
	}
	workspace := t.TempDir()
	store, err := OpenStore(ctx, filepath.Join(workspace, "v2"), filepath.Join(workspace, "temp", "flashcards.db"),
		"device-a", &JournalOptions{WriterID: testWriterA})
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if _, err = store.Apply(ctx, firstPlan.OperationID, firstPlan.Changes); err != nil {
		t.Fatal(err)
	}
	if err = os.MkdirAll(legacyRoot, 0755); err != nil {
		t.Fatal(err)
	}
	deck := riff.Deck{ID: "deck-preparing-changed", Name: "Changed", Algo: riff.AlgoFSRS,
		Created: 1785000000000, Updated: 1786000000000}
	writeMsgpack(t, filepath.Join(legacyRoot, "deck-preparing-changed.deck"), deck)
	writeMsgpack(t, filepath.Join(legacyRoot, "deck-preparing-changed.cards"), map[string]*riff.FSRSCard{
		"legacy-preparing-changed": legacyFSRSCard("legacy-preparing-changed", "block-preparing-changed",
			1785900000000, 3),
	})
	secondPlan, err := PrepareLegacyMigration(ctx, legacyRoot, options)
	if err != nil {
		t.Fatal(err)
	}
	if secondPlan.MigrationID == firstPlan.MigrationID {
		t.Fatal("changed legacy input did not produce another migration plan")
	}
	if _, err = store.ActivateLegacyMigration(ctx, legacyRoot, secondPlan); err == nil {
		t.Fatal("preparing migration accepted a different parentless plan")
	}
	if _, found := store.journal.FindOperation(secondPlan.OperationID); found {
		t.Fatal("rejected preparing migration wrote the different candidate plan")
	}
	status, err := store.LegacyMigrationStatus(ctx)
	if err != nil || status.State != MigrationStatePreparing || status.MigrationID != firstPlan.MigrationID {
		t.Fatalf("rejected plan changed preparing migration status: status=%+v err=%v", status, err)
	}
	if conflicts, countErr := store.Projection().ConflictCount(ctx); countErr != nil || conflicts != 0 {
		t.Fatalf("rejected preparing plan created parentless conflicts: count=%d err=%v", conflicts, countErr)
	}
}

func preparingMigrationTestOptions() LegacyMigrationOptions {
	weights := fsrs.DefaultWeights()
	return LegacyMigrationOptions{
		RequestRetention: 0.9, MaximumInterval: 36500, Weights: append([]float64(nil), weights[:]...),
		NewLimit: 20, ReviewLimit: 200, LeechThreshold: 8, LeechAction: "tag", PresetName: "Default",
		EmptyDeckID: "builtin-preparing", EmptyDeckName: "Built-in Deck",
		ResolveBlock: func(context.Context, string) (LegacyBlockInfo, error) {
			return LegacyBlockInfo{Exists: true}, nil
		},
	}
}

func TestDivergedLegacyMigrationRebasesExistingEntities(t *testing.T) {
	ctx := context.Background()
	legacyRoot := t.TempDir()
	deck := riff.Deck{ID: "deck-incremental", Name: "Incremental", Algo: riff.AlgoFSRS,
		Created: 1785000000000, Updated: 1786000000000}
	writeMsgpack(t, filepath.Join(legacyRoot, "deck-incremental.deck"), deck)
	cardsPath := filepath.Join(legacyRoot, "deck-incremental.cards")
	firstCard := legacyFSRSCard("legacy-first", "block-first", 1785900000000, 3)
	writeMsgpack(t, cardsPath, map[string]*riff.FSRSCard{"legacy-first": firstCard})
	logsPath := filepath.Join(legacyRoot, "logs", "202608.msgpack")
	firstDeletedLog := &riff.Log{ID: "log-deleted-first", CardID: "legacy-deleted", Rating: riff.Good,
		ScheduledDays: 3, ElapsedDays: 2, Reviewed: 1785950000, State: riff.Review}
	writeMsgpack(t, logsPath, []*riff.Log{firstDeletedLog})
	weights := fsrs.DefaultWeights()
	options := LegacyMigrationOptions{
		RequestRetention: 0.9, MaximumInterval: 36500, Weights: append([]float64(nil), weights[:]...),
		NewLimit: 20, ReviewLimit: 200, LeechThreshold: 8, LeechAction: "tag", PresetName: "Default",
		ResolveBlock: func(context.Context, string) (LegacyBlockInfo, error) {
			return LegacyBlockInfo{Exists: true}, nil
		},
	}
	firstPlan, err := PrepareLegacyMigration(ctx, legacyRoot, options)
	if err != nil {
		t.Fatal(err)
	}
	workspace := t.TempDir()
	store, err := OpenStore(ctx, filepath.Join(workspace, "v2"), filepath.Join(workspace, "temp", "flashcards.db"),
		"device-a", &JournalOptions{WriterID: testWriterA})
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if _, err = store.ActivateLegacyMigration(ctx, legacyRoot, firstPlan); err != nil {
		t.Fatal(err)
	}

	deck.Updated = 1787000000000
	writeMsgpack(t, filepath.Join(legacyRoot, "deck-incremental.deck"), deck)
	secondCard := legacyFSRSCard("legacy-deleted", "block-second", 1786900000000, 2)
	writeMsgpack(t, cardsPath, map[string]*riff.FSRSCard{"legacy-first": firstCard, "legacy-deleted": secondCard})
	writeMsgpack(t, logsPath, []*riff.Log{firstDeletedLog,
		{ID: "log-deleted-second", CardID: "legacy-deleted", Rating: riff.Easy, ScheduledDays: 5,
			ElapsedDays: 3, Reviewed: 1786950000, State: riff.Review}})
	status, err := store.CheckLegacyDivergence(ctx, legacyRoot)
	if err != nil || status.State != MigrationStateLegacyDiverged {
		t.Fatalf("legacy change did not enter divergence: status=%+v err=%v", status, err)
	}
	secondPlan, err := PrepareLegacyMigration(ctx, legacyRoot, options)
	if err != nil {
		t.Fatal(err)
	}
	activation, err := store.ActivateLegacyMigration(ctx, legacyRoot, secondPlan)
	if err != nil {
		t.Fatal(err)
	}
	if activation.Status.State != MigrationStateActive || activation.Status.MigrationID != secondPlan.MigrationID {
		t.Fatalf("incremental migration did not reactivate v2: %+v", activation.Status)
	}
	if conflicts, countErr := store.Projection().ConflictCount(ctx); countErr != nil || conflicts != 0 {
		t.Fatalf("incremental migration created entity conflicts: count=%d err=%v", conflicts, countErr)
	}
	cards, err := store.Projection().LegacyQuickCards(ctx, "deck-incremental")
	if err != nil || len(cards) != 2 {
		t.Fatalf("incremental migration did not retain both cards: cards=%+v err=%v", cards, err)
	}
	archivedCardID := DeterministicID("legacy-history-card", "legacy-deleted")
	activeCardID := GeneratedCardID(DeterministicID("legacy-card-source", "block-second"), legacyQuickTemplateID,
		"legacy-quick")
	for cardID, expected := range map[string]int{archivedCardID: 1, activeCardID: 1} {
		var count int
		if err = store.Projection().db.QueryRowContext(ctx,
			"SELECT COUNT(*) FROM review_events WHERE card_id = ?", cardID).Scan(&count); err != nil ||
			count != expected {
			t.Fatalf("incremental legacy history mapping is invalid: card=%s count=%d err=%v", cardID, count, err)
		}
	}
	historyAliasID := DeterministicID("legacy-history-alias", "legacy-deleted")
	historyAliasRevision, found, err := store.Projection().CurrentEntity(ctx, EntityLegacyCardAlias, historyAliasID)
	if err != nil || !found {
		t.Fatalf("incremental legacy history alias was not found: found=%t err=%v", found, err)
	}
	var historyAlias LegacyCardAlias
	if err = decodeStrictJSON(historyAliasRevision.Payload, &historyAlias); err != nil ||
		historyAlias.CardID != activeCardID {
		t.Fatalf("incremental legacy history alias did not follow the restored card: alias=%+v err=%v", historyAlias, err)
	}
}

func TestEmptyWorkspaceCanActivateV2WithBuiltinCompatibilityEntities(t *testing.T) {
	ctx := context.Background()
	legacyRoot := filepath.Join(t.TempDir(), "missing-riff")
	weights := fsrs.DefaultWeights()
	plan, err := PrepareLegacyMigration(ctx, legacyRoot, LegacyMigrationOptions{
		RequestRetention: 0.9, MaximumInterval: 36500, Weights: append([]float64(nil), weights[:]...),
		NewLimit: 20, ReviewLimit: 200, LeechThreshold: 8, LeechAction: "tag", PresetName: "Default",
		EmptyDeckID: "builtin-empty", EmptyDeckName: "Built-in Deck",
		ResolveBlock: func(context.Context, string) (LegacyBlockInfo, error) {
			return LegacyBlockInfo{}, nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if plan.Report.LegacyDecks != 0 || plan.Report.ReviewSets != 1 || len(plan.InputFiles) != 0 {
		t.Fatalf("unexpected empty-workspace migration report: %+v", plan.Report)
	}
	workspace := t.TempDir()
	store, err := OpenStore(ctx, filepath.Join(workspace, "v2"), filepath.Join(workspace, "temp", "flashcards.db"),
		"device-a", &JournalOptions{WriterID: testWriterA})
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	activation, err := store.ActivateLegacyMigration(ctx, legacyRoot, plan)
	if err != nil {
		t.Fatal(err)
	}
	if activation.Status.State != MigrationStateActive {
		t.Fatalf("empty workspace did not activate v2: %+v", activation.Status)
	}
	sets, err := store.Projection().LegacyReviewSets(ctx)
	if err != nil || len(sets) != 1 || sets[0].DeckID != "builtin-empty" || sets[0].Size != 0 {
		t.Fatalf("empty workspace lacks its built-in compatibility review set: sets=%+v err=%v", sets, err)
	}
	for _, entityType := range []EntityType{EntityCardSchema, EntityCardTemplate, EntitySchedulerPreset} {
		page, pageErr := store.Projection().ListEntities(ctx, entityType, EntityListOptions{Limit: 10})
		if pageErr != nil || page.Total != 1 {
			t.Fatalf("empty workspace lacks built-in entity [%s]: page=%+v err=%v", entityType, page, pageErr)
		}
	}
}
