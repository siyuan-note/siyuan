// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package flashcard

import (
	"bytes"
	"context"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"slices"
	"testing"

	"github.com/open-spaced-repetition/go-fsrs/v3"
	"github.com/siyuan-note/riff"
)

const (
	replayBlock  = "migration-replay-block"
	replayReview = int64(1785900000000)
)

func legacyMigrationReplayFixture(t *testing.T) (string, LegacyMigrationOptions) {
	t.Helper()
	legacy := t.TempDir()
	writeMsgpack(t, filepath.Join(legacy, "replay.deck"), riff.Deck{
		ID: "replay", Name: "Replay", Algo: riff.AlgoFSRS, Created: replayReview, Updated: replayReview,
	})
	writeMsgpack(t, filepath.Join(legacy, "replay.cards"), map[string]*riff.FSRSCard{
		"old-card": legacyFSRSCard("old-card", replayBlock, replayReview, 3),
	})
	writeMsgpack(t, filepath.Join(legacy, "logs", "202608.msgpack"), []*riff.Log{
		{ID: "legacy-score", CardID: "old-card", Rating: riff.Good, Reviewed: replayReview / 1000, State: riff.Review},
	})
	weights := fsrs.DefaultWeights()
	return legacy, LegacyMigrationOptions{
		RequestRetention: 0.9, MaximumInterval: 36500, Weights: weights[:],
		NewLimit: 20, ReviewLimit: 200, LeechThreshold: 8, LeechAction: "tag", PresetName: "Default",
		ResolveBlock: func(context.Context, string) (LegacyBlockInfo, error) {
			return LegacyBlockInfo{Exists: true}, nil
		},
	}
}

func orphanedLegacyMigrationPlan(t *testing.T, plan LegacyMigrationPlan, flag int) LegacyMigrationPlan {
	t.Helper()
	plan.Changes = slices.Clone(plan.Changes)
	last := len(plan.Changes) - 1
	for index := range last {
		change := &plan.Changes[index]
		if change.Revision == nil {
			continue
		}
		revision := *change.Revision
		switch revision.EntityType {
		case EntityCardSource:
			var source CardSource
			if err := decodeStrictJSON(revision.Payload, &source); err != nil {
				t.Fatal(err)
			}
			source.Status = "orphaned"
			revision.Payload = mustCanonicalJSON(t, source)
		case EntityCard:
			var card Card
			if err := decodeStrictJSON(revision.Payload, &card); err != nil {
				t.Fatal(err)
			}
			card.GenerationStatus = GenerationOrphaned
			card.Flag = flag
			revision.Payload = mustCanonicalJSON(t, card)
		default:
			continue
		}
		change.Revision = &revision
	}
	digest, err := checksum(plan.Changes[:last])
	if err != nil {
		t.Fatal(err)
	}
	plan.RecordDigest = digest
	event := *plan.Changes[last].Event
	var prepared MigrationPreparedPayload
	if err = decodeStrictJSON(event.Payload, &prepared); err != nil {
		t.Fatal(err)
	}
	prepared.RecordDigest = digest
	event.Payload = mustCanonicalJSON(t, prepared)
	plan.Changes[last].Event = &event
	return plan
}

func copyMigrationWriter(t *testing.T, target, source, writer string) {
	t.Helper()
	dir := filepath.Join("writers", writer)
	tree, err := fs.Sub(os.DirFS(source), filepath.ToSlash(dir))
	if err != nil {
		t.Fatal(err)
	}
	if err = os.CopyFS(filepath.Join(target, dir), tree); err != nil {
		t.Fatal(err)
	}
}

func TestLegacyMigrationAvailabilityDoesNotChangeSynchronizedRecords(t *testing.T) {
	ctx := context.Background()
	legacy, options := legacyMigrationReplayFixture(t)
	present, err := PrepareLegacyMigration(ctx, legacy, options)
	if err != nil {
		t.Fatal(err)
	}
	options.ResolveBlock = func(context.Context, string) (LegacyBlockInfo, error) {
		return LegacyBlockInfo{}, nil
	}
	missing, err := PrepareLegacyMigration(ctx, legacy, options)
	if err != nil {
		t.Fatal(err)
	}
	if missing.Report.OrphanedSources != 1 || present.Report.OrphanedSources != 0 ||
		present.OperationID != missing.OperationID || present.RecordDigest != missing.RecordDigest ||
		!bytes.Equal(mustCanonicalJSON(t, present.Changes), mustCanonicalJSON(t, missing.Changes)) {
		t.Fatal("local block availability changed the migration journal")
	}
}

func TestLegacyMigrationAvailabilityConflictReplaysWithoutLosingReviews(t *testing.T) {
	ctx := context.Background()
	legacy, options := legacyMigrationReplayFixture(t)
	plan, err := PrepareLegacyMigration(ctx, legacy, options)
	if err != nil {
		t.Fatal(err)
	}
	oldPlan := orphanedLegacyMigrationPlan(t, plan, 0)
	oldRoot, peerRoot := t.TempDir(), t.TempDir()
	database := filepath.Join(t.TempDir(), "projection.db")
	old, err := OpenStore(ctx, oldRoot, database, "old", &JournalOptions{WriterID: testWriterA})
	if err != nil {
		t.Fatal(err)
	}
	defer old.Close()
	previousActivation, err := old.ActivateLegacyMigration(ctx, legacy, oldPlan)
	if err != nil {
		t.Fatal(err)
	}
	snapshot, err := old.CreateSnapshot(ctx)
	if err != nil {
		t.Fatal(err)
	}
	peer, err := OpenStore(ctx, peerRoot, filepath.Join(t.TempDir(), "peer.db"), "peer", &JournalOptions{WriterID: testWriterB})
	if err != nil {
		t.Fatal(err)
	}
	defer peer.Close()
	if _, err = peer.ActivateLegacyMigration(ctx, legacy, plan); err != nil {
		t.Fatal(err)
	}
	sourceID := LegacyQuickSourceID(replayBlock)
	cardID := GeneratedCardID(sourceID, legacyQuickTemplateID, "legacy-quick")
	if _, err = peer.ReviewCard(ctx, ReviewRequest{
		OperationID: "review-after-migration", CardID: cardID, Rating: ReviewGood,
		ReviewedAt: replayReview + 2*86400000, ReviewMode: "normal",
	}); err != nil {
		t.Fatal(err)
	}
	if err = peer.Close(); err != nil {
		t.Fatal(err)
	}
	oldSegments := old.journal.segmentsDir()
	if err = old.Close(); err != nil {
		t.Fatal(err)
	}
	old, err = OpenStore(ctx, oldRoot, database, "reopen", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer old.Close()
	copyMigrationWriter(t, oldRoot, peerRoot, testWriterB)
	entries, err := os.ReadDir(oldSegments)
	if err != nil || len(entries) != 1 {
		t.Fatalf("read original segments: %v, %v", entries, err)
	}
	original := filepath.Join(oldSegments, entries[0].Name())
	originalBytes, err := os.ReadFile(original)
	if err != nil {
		t.Fatal(err)
	}
	if err = old.Refresh(ctx); err != nil {
		t.Fatal(err)
	}
	status, err := old.LegacyMigrationStatus(ctx)
	if err != nil || status.State != MigrationStateActive ||
		status.Activated.EventID == previousActivation.Status.Activated.EventID {
		t.Fatalf("canonical migration activation: %+v, %v", status, err)
	}
	if _, err = old.ActivateLegacyMigration(ctx, legacy, plan); err != nil {
		t.Fatalf("retry migration: %v", err)
	}
	if err = old.Projection().ReplaceSourceAvailability(ctx, map[string]bool{sourceID: false}); err != nil {
		t.Fatal(err)
	}
	result, err := old.Projection().SearchCards(ctx, nil, CardSearchOptions{IncludeInactive: true})
	if err != nil || len(result) != 1 || result[0].Card.ID != cardID ||
		result[0].Card.GenerationStatus != GenerationOrphaned || result[0].ReviewState.Reps != 4 {
		t.Fatalf("locally unavailable card lost its history: %+v, %v", result, err)
	}
	var events int
	if err = old.Projection().db.QueryRowContext(ctx, "SELECT count(*) FROM review_events").Scan(&events); err != nil || events != 2 {
		t.Fatalf("review history count %d: %v", events, err)
	}
	after, err := os.ReadFile(original)
	if err != nil || !bytes.Equal(originalBytes, after) {
		t.Fatalf("original migration segment changed: %v", err)
	}
	if err = old.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := OpenStore(ctx, oldRoot, filepath.Join(t.TempDir(), "rebuild.db"), "rebuild", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	result, err = reopened.Projection().SearchCards(ctx, nil, CardSearchOptions{})
	if err != nil || len(result) != 1 || result[0].Card.GenerationStatus != GenerationActive || result[0].ReviewState.Reps != 4 {
		t.Fatalf("rebuild with an older snapshot lost the card or reviews: %+v, %v", result, err)
	}
	if _, err = os.Stat(snapshot.Path); err != nil {
		t.Fatalf("original snapshot is missing: %v", err)
	}
}

func TestLegacyMigrationAvailabilityReplayRejectsDifferentCardContent(t *testing.T) {
	ctx := context.Background()
	legacy, options := legacyMigrationReplayFixture(t)
	plan, err := PrepareLegacyMigration(ctx, legacy, options)
	if err != nil {
		t.Fatal(err)
	}
	root, other := t.TempDir(), t.TempDir()
	for index, candidate := range []LegacyMigrationPlan{plan, orphanedLegacyMigrationPlan(t, plan, 2)} {
		dir, writer := root, testWriterA
		if index == 1 {
			dir, writer = other, testWriterB
		}
		journal, err := OpenJournal(dir, writer, &JournalOptions{WriterID: writer})
		if err != nil {
			t.Fatal(err)
		}
		if _, _, err = journal.Append(candidate.OperationID, candidate.Changes); err != nil {
			t.Fatal(err)
		}
		if err = journal.Close(); err != nil {
			t.Fatal(err)
		}
	}
	copyMigrationWriter(t, root, other, testWriterB)
	_, err = OpenJournal(root, "different-card", nil)
	if !errors.Is(err, ErrCorruptSegment) || !errors.Is(err, ErrOperationConflict) {
		t.Fatalf("different card content was accepted: %v", err)
	}
}

func TestLegacyMigrationAvailabilityReplayPreservesLegacyDivergence(t *testing.T) {
	ctx := context.Background()
	legacy, options := legacyMigrationReplayFixture(t)
	plan, err := PrepareLegacyMigration(ctx, legacy, options)
	if err != nil {
		t.Fatal(err)
	}
	root := t.TempDir()
	projection := filepath.Join(t.TempDir(), "legacy.db")
	store, err := OpenStore(ctx, root, projection, "old", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	old, err := store.ActivateLegacyMigration(ctx, legacy, orphanedLegacyMigrationPlan(t, plan, 0))
	if err != nil {
		t.Fatal(err)
	}
	writeMsgpack(t, filepath.Join(legacy, "replay.deck"), riff.Deck{
		ID: "replay", Name: "Renamed by an old client", Algo: riff.AlgoFSRS, Created: replayReview, Updated: replayReview + 1,
	})
	before, err := store.CheckLegacyDivergence(ctx, legacy)
	if err != nil || before.State != MigrationStateLegacyDiverged {
		t.Fatalf("record old client divergence: %+v, %v", before, err)
	}
	if err = store.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := OpenStore(ctx, root, projection, "reopen", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	after, err := reopened.LegacyMigrationStatus(ctx)
	if err != nil || after.State != MigrationStateLegacyDiverged || after.Diverged.EventID != before.Diverged.EventID ||
		after.Activated.EventID == old.Status.Activated.EventID {
		t.Fatalf("replay lost legacy write protection: %+v, %v", after, err)
	}
}
