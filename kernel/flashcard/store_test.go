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
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

const (
	testWriterA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
	testWriterB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
)

func TestManifestIsDeterministicAcrossWriters(t *testing.T) {
	root := filepath.Join(t.TempDir(), "v2")
	journalA, err := OpenJournal(root, "same-device", &JournalOptions{WriterID: testWriterA})
	if err != nil {
		t.Fatal(err)
	}
	journalB, err := OpenJournal(root, "same-device", &JournalOptions{WriterID: testWriterB})
	if err != nil {
		t.Fatal(err)
	}
	if journalA.WriterID() == journalB.WriterID() {
		t.Fatal("expected writer IDs to be isolated")
	}
	expected, err := ManifestBytes()
	if err != nil {
		t.Fatal(err)
	}
	actual, err := os.ReadFile(filepath.Join(root, manifestFilename))
	if err != nil {
		t.Fatal(err)
	}
	if string(actual) != string(expected) {
		t.Fatalf("unexpected manifest:\n%s", actual)
	}
	if err = journalA.Close(); err != nil {
		t.Fatal(err)
	}
	if err = journalB.Close(); err != nil {
		t.Fatal(err)
	}
}

func TestRefreshInvalidatesStoreWhenSyncedManifestIsIncompatible(t *testing.T) {
	ctx := context.Background()
	workspace := t.TempDir()
	root := filepath.Join(workspace, "v2")
	store, err := OpenStore(ctx, root, filepath.Join(workspace, "temp", "flashcards.db"), "device-a",
		&JournalOptions{WriterID: testWriterA})
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(root, manifestFilename), []byte(`{"formatVersion":999}`), 0600); err != nil {
		t.Fatal(err)
	}
	if err = store.Refresh(ctx); err == nil || !strings.Contains(err.Error(), "manifest") {
		t.Fatalf("incompatible synced manifest was accepted: %v", err)
	}
	if _, err = store.Apply(ctx, "after-incompatible-manifest", nil); err == nil ||
		!strings.Contains(err.Error(), "closed") {
		t.Fatalf("invalidated store remained writable: %v", err)
	}
	if err = store.Close(); err != nil {
		t.Fatalf("closing an invalidated store was not idempotent: %v", err)
	}
}

func TestRefreshInvalidatesStoreWhenSyncedSegmentIsCorrupt(t *testing.T) {
	ctx := context.Background()
	workspace := t.TempDir()
	root := filepath.Join(workspace, "v2")
	store, err := OpenStore(ctx, root, filepath.Join(workspace, "temp", "flashcards.db"), "device-a",
		&JournalOptions{WriterID: testWriterA})
	if err != nil {
		t.Fatal(err)
	}
	synced, err := OpenJournal(root, "device-b", &JournalOptions{WriterID: testWriterB})
	if err != nil {
		t.Fatal(err)
	}
	event := fixedEvent("test", "synced-event", "card-1", 1, `{"value":"original"}`)
	if _, _, err = synced.Append("synced-operation", []Change{{Kind: RecordEvent, Event: &event}}); err != nil {
		t.Fatal(err)
	}
	if err = synced.Close(); err != nil {
		t.Fatal(err)
	}
	path := firstSegmentPath(t, root)
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	data = []byte(strings.Replace(string(data), "original", "tampered", 1))
	if err = os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
	if err = store.Refresh(ctx); !errors.Is(err, ErrCorruptSegment) {
		t.Fatalf("corrupt synced segment was accepted: %v", err)
	}
	if _, err = store.Apply(ctx, "after-corrupt-segment", nil); err == nil ||
		!strings.Contains(err.Error(), "closed") {
		t.Fatalf("store remained writable after corrupt sync: %v", err)
	}
	if err = store.Close(); err != nil {
		t.Fatalf("closing an invalidated store was not idempotent: %v", err)
	}
}

func TestDeterministicIDUsesLengthDelimitedParts(t *testing.T) {
	first := DeterministicID("migration", "ab", "c")
	second := DeterministicID("migration", "a", "bc")
	if first == second {
		t.Fatal("length-delimited deterministic IDs must not collide at field boundaries")
	}
	if first != DeterministicID("migration", "ab", "c") {
		t.Fatal("deterministic ID changed for identical input")
	}
}

func TestStoreAppliesMixedBatchAndRebuildsAfterTempDeletion(t *testing.T) {
	ctx := context.Background()
	workspace := t.TempDir()
	journalRoot := V2Root(filepath.Join(workspace, "data"))
	tempDir := filepath.Join(workspace, "temp")
	projectionPath := ProjectionPath(tempDir)
	now := time.UnixMilli(1786431600000)
	store, err := OpenStore(ctx, journalRoot, projectionPath, "device-a", &JournalOptions{
		WriterID: testWriterA,
		Now:      func() time.Time { return now },
	})
	if err != nil {
		t.Fatal(err)
	}

	revision := fixedRevision("source-1", "revision-1", nil, now.UnixMilli(), false, `{"z":2,"a":1}`)
	event := fixedEvent("test", "event-1", "card-1", now.UnixMilli(), `{"rating":"good"}`)
	changes := []Change{
		{Kind: RecordEntityRevision, Revision: &revision},
		{Kind: RecordEvent, Event: &event},
	}
	batch, err := store.Apply(ctx, "operation-1", changes)
	if err != nil {
		t.Fatal(err)
	}
	if batch.Sequence != 1 || batch.WriterID != testWriterA {
		t.Fatalf("unexpected batch identity: %+v", batch)
	}
	if _, err = store.Apply(ctx, "operation-1", changes); err != nil {
		t.Fatalf("idempotent operation failed: %s", err)
	}
	assertProjectionCounts(t, ctx, store.Projection(), 1, 1, 1)
	current, found, err := store.Projection().CurrentEntity(ctx, EntityCardSource, "source-1")
	if err != nil {
		t.Fatal(err)
	}
	if !found {
		t.Fatal("current entity was not found")
	}
	var source CardSource
	if decodeErr := decodeStrictJSON(current.Payload, &source); decodeErr != nil {
		t.Fatal(decodeErr)
	}
	if current.RevisionID != "revision-1" || string(source.GenerationConfig) != `{"a":1,"z":2}` {
		t.Fatalf("unexpected current entity: found=%v entity=%+v", found, current)
	}
	if err = store.Close(); err != nil {
		t.Fatal(err)
	}

	if err = os.RemoveAll(tempDir); err != nil {
		t.Fatal(err)
	}
	reopened, err := OpenStore(ctx, journalRoot, projectionPath, "device-b", &JournalOptions{WriterID: testWriterB})
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	assertProjectionCounts(t, ctx, reopened.Projection(), 1, 1, 1)
	current, found, err = reopened.Projection().CurrentEntity(ctx, EntityCardSource, "source-1")
	if err != nil || !found || current.RevisionID != "revision-1" {
		t.Fatalf("entity was not rebuilt: found=%v entity=%+v err=%v", found, current, err)
	}
	highWatermark, err := reopened.Projection().HighWatermark(ctx, testWriterA)
	if err != nil {
		t.Fatal(err)
	}
	if highWatermark != 1 {
		t.Fatalf("unexpected rebuilt high watermark [%d]", highWatermark)
	}
}

func TestStoreRecoversJournaledOperationAfterProjectionCrash(t *testing.T) {
	ctx := context.Background()
	workspace := t.TempDir()
	journalRoot := filepath.Join(workspace, "data", "storage", "riff", "v2")
	projectionPath := filepath.Join(workspace, "temp", "flashcards.db")
	journal, err := OpenJournal(journalRoot, "device-a", &JournalOptions{WriterID: testWriterA})
	if err != nil {
		t.Fatal(err)
	}
	revision := fixedRevision("source-1", "revision-1", nil, 100, false, `{"name":"durable"}`)
	if _, _, err = journal.Append("operation-before-crash", []Change{{Kind: RecordEntityRevision, Revision: &revision}}); err != nil {
		t.Fatal(err)
	}

	store, err := OpenStore(ctx, journalRoot, projectionPath, "device-b", &JournalOptions{WriterID: testWriterB})
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	current, found, err := store.Projection().CurrentEntity(ctx, EntityCardSource, "source-1")
	if err != nil || !found || current.RevisionID != "revision-1" {
		t.Fatalf("journaled operation was not recovered: found=%v entity=%+v err=%v", found, current, err)
	}
}

func TestJournalSealsAndReloadsMultipleSegments(t *testing.T) {
	root := filepath.Join(t.TempDir(), "v2")
	journal, err := OpenJournal(root, "device-a", &JournalOptions{
		WriterID:             testWriterA,
		MaxBatchesPerSegment: 2,
	})
	if err != nil {
		t.Fatal(err)
	}
	for index := 1; index <= 3; index++ {
		event := fixedEvent("test", "event-"+string(rune('0'+index)), "card-1", int64(index), `{}`)
		if _, _, err = journal.Append("operation-"+string(rune('0'+index)),
			[]Change{{Kind: RecordEvent, Event: &event}}); err != nil {
			t.Fatal(err)
		}
	}
	if err = journal.Close(); err != nil {
		t.Fatal(err)
	}
	segmentPaths := allSegmentPaths(t, root)
	if len(segmentPaths) != 2 {
		t.Fatalf("expected two sealed segments, got %d", len(segmentPaths))
	}
	for _, path := range segmentPaths {
		if strings.Contains(filepath.Base(path), "-open-") {
			t.Fatalf("segment was not sealed: %s", path)
		}
	}
	reopened, err := OpenJournal(root, "device-b", &JournalOptions{WriterID: testWriterB})
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	if batches := reopened.Batches(); len(batches) != 3 {
		t.Fatalf("expected three reloaded batches, got %d", len(batches))
	}
}

func TestJournalRollsOverBeforeSegmentSizeLimit(t *testing.T) {
	root := filepath.Join(t.TempDir(), "v2")
	journal, err := OpenJournal(root, "device-a", &JournalOptions{
		WriterID:             testWriterA,
		MaxBatchesPerSegment: 100,
		MaxSegmentBytes:      4096,
	})
	if err != nil {
		t.Fatal(err)
	}
	payload := `{"value":"` + strings.Repeat("x", 2048) + `"}`
	for index := 1; index <= 2; index++ {
		event := fixedEvent("test", "large-event-"+string(rune('0'+index)), "card-1", int64(index), payload)
		if _, _, err = journal.Append("large-operation-"+string(rune('0'+index)),
			[]Change{{Kind: RecordEvent, Event: &event}}); err != nil {
			t.Fatal(err)
		}
	}
	if err = journal.Close(); err != nil {
		t.Fatal(err)
	}
	if paths := allSegmentPaths(t, root); len(paths) != 2 {
		t.Fatalf("expected size-based rollover to create two segments, got %d", len(paths))
	}
}

func TestOperationIDRejectsDifferentContent(t *testing.T) {
	ctx := context.Background()
	workspace := t.TempDir()
	store, err := OpenStore(ctx, filepath.Join(workspace, "v2"), filepath.Join(workspace, "temp", "flashcards.db"),
		"device-a", &JournalOptions{WriterID: testWriterA})
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	first := fixedRevision("source-1", "revision-1", nil, 100, false, `{"value":1}`)
	if _, err = store.Apply(ctx, "same-operation", []Change{{Kind: RecordEntityRevision, Revision: &first}}); err != nil {
		t.Fatal(err)
	}
	second := fixedRevision("source-1", "revision-1", nil, 100, false, `{"value":2}`)
	_, err = store.Apply(ctx, "same-operation", []Change{{Kind: RecordEntityRevision, Revision: &second}})
	if !errors.Is(err, ErrOperationConflict) {
		t.Fatalf("expected operation conflict, got %v", err)
	}
	assertProjectionCounts(t, ctx, store.Projection(), 1, 1, 0)
}

func TestConcurrentEntityDeletionWinsAndConflictIsRecorded(t *testing.T) {
	ctx := context.Background()
	workspace := t.TempDir()
	store, err := OpenStore(ctx, filepath.Join(workspace, "v2"), filepath.Join(workspace, "temp", "flashcards.db"),
		"device-a", &JournalOptions{WriterID: testWriterA})
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	root := fixedRevision("source-1", "revision-root", nil, 100, false, `{"value":"root"}`)
	live := fixedRevision("source-1", "revision-live", []string{"revision-root"}, 300, false, `{"value":"live"}`)
	deleted := fixedRevision("source-1", "revision-deleted", []string{"revision-root"}, 200, true, `{}`)
	for index, revision := range []*EntityRevision{&root, &live, &deleted} {
		if _, err = store.Apply(ctx, "operation-"+string(rune('a'+index)),
			[]Change{{Kind: RecordEntityRevision, Revision: revision}}); err != nil {
			t.Fatal(err)
		}
	}
	current, found, err := store.Projection().CurrentEntity(ctx, EntityCardSource, "source-1")
	if err != nil {
		t.Fatal(err)
	}
	if !found || !current.Deleted || current.RevisionID != "revision-deleted" {
		t.Fatalf("deletion did not win concurrent selection: %+v", current)
	}
	conflicts, err := store.Projection().ConflictCount(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if conflicts != 2 {
		t.Fatalf("expected two conflict branches, got %d", conflicts)
	}
	merged := fixedRevision("source-1", "revision-merged", []string{"revision-live", "revision-deleted"}, 400, false,
		`{"value":"restored"}`)
	if _, err = store.Apply(ctx, "operation-merged",
		[]Change{{Kind: RecordEntityRevision, Revision: &merged}}); err != nil {
		t.Fatal(err)
	}
	current, found, err = store.Projection().CurrentEntity(ctx, EntityCardSource, "source-1")
	if err != nil || !found || current.Deleted || current.RevisionID != "revision-merged" {
		t.Fatalf("merge revision did not resolve the entity: found=%v entity=%+v err=%v", found, current, err)
	}
	conflicts, err = store.Projection().ConflictCount(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if conflicts != 0 {
		t.Fatalf("expected merge revision to resolve conflicts, got %d", conflicts)
	}
}

func TestInvalidRevisionIsRejectedBeforeJournalWrite(t *testing.T) {
	ctx := context.Background()
	workspace := t.TempDir()
	root := filepath.Join(workspace, "v2")
	projectionPath := filepath.Join(workspace, "temp", "flashcards.db")
	store, err := OpenStore(ctx, root, projectionPath, "device-a", &JournalOptions{WriterID: testWriterA})
	if err != nil {
		t.Fatal(err)
	}
	first := fixedRevision("source-1", "revision-a", []string{"revision-b"}, 100, false, `{}`)
	if _, err = store.Apply(ctx, "operation-a", []Change{{Kind: RecordEntityRevision, Revision: &first}}); err != nil {
		t.Fatal(err)
	}
	cycle := fixedRevision("source-1", "revision-b", []string{"revision-a"}, 200, false, `{}`)
	if _, err = store.Apply(ctx, "operation-b", []Change{{Kind: RecordEntityRevision, Revision: &cycle}}); err == nil ||
		!strings.Contains(err.Error(), "cycle") {
		t.Fatalf("expected revision cycle to be rejected, got %v", err)
	}
	if err = store.Close(); err != nil {
		t.Fatal(err)
	}

	reopened, err := OpenStore(ctx, root, projectionPath, "device-b", &JournalOptions{WriterID: testWriterB})
	if err != nil {
		t.Fatalf("invalid revision poisoned journal recovery: %s", err)
	}
	defer reopened.Close()
	assertProjectionCounts(t, ctx, reopened.Projection(), 1, 1, 0)
}

func TestDuplicateLogicalOperationAcrossWritersAdvancesBothWatermarks(t *testing.T) {
	ctx := context.Background()
	workspace := t.TempDir()
	root := filepath.Join(workspace, "v2")
	revision := fixedRevision("source-1", "revision-1", nil, 100, false, `{}`)
	changes := []Change{{Kind: RecordEntityRevision, Revision: &revision}}
	journalA, err := OpenJournal(root, "device-a", &JournalOptions{WriterID: testWriterA})
	if err != nil {
		t.Fatal(err)
	}
	journalB, err := OpenJournal(root, "device-b", &JournalOptions{WriterID: testWriterB})
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err = journalA.Append("shared-operation", changes); err != nil {
		t.Fatal(err)
	}
	if err = journalA.Close(); err != nil {
		t.Fatal(err)
	}
	if _, _, err = journalB.Append("shared-operation", changes); err != nil {
		t.Fatal(err)
	}
	if err = journalB.Close(); err != nil {
		t.Fatal(err)
	}

	store, err := OpenStore(ctx, root, filepath.Join(workspace, "temp", "flashcards.db"), "device-c", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	assertProjectionCounts(t, ctx, store.Projection(), 1, 2, 0)
	for _, writerID := range []string{testWriterA, testWriterB} {
		highWatermark, watermarkErr := store.Projection().HighWatermark(ctx, writerID)
		if watermarkErr != nil {
			t.Fatal(watermarkErr)
		}
		if highWatermark != 1 {
			t.Fatalf("writer [%s] did not advance its watermark", writerID)
		}
	}
}

func TestCorruptProjectionIsRebuiltFromJournal(t *testing.T) {
	ctx := context.Background()
	workspace := t.TempDir()
	root := filepath.Join(workspace, "v2")
	projectionPath := filepath.Join(workspace, "temp", "flashcards.db")
	store, err := OpenStore(ctx, root, projectionPath, "device-a", &JournalOptions{WriterID: testWriterA})
	if err != nil {
		t.Fatal(err)
	}
	revision := fixedRevision("source-1", "revision-1", nil, 100, false, `{}`)
	if _, err = store.Apply(ctx, "operation-1", []Change{{Kind: RecordEntityRevision, Revision: &revision}}); err != nil {
		t.Fatal(err)
	}
	if err = store.Close(); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(projectionPath, []byte("not a sqlite database"), 0644); err != nil {
		t.Fatal(err)
	}
	rebuilt, err := OpenStore(ctx, root, projectionPath, "device-b", &JournalOptions{WriterID: testWriterB})
	if err != nil {
		t.Fatal(err)
	}
	defer rebuilt.Close()
	current, found, err := rebuilt.Projection().CurrentEntity(ctx, EntityCardSource, "source-1")
	if err != nil || !found || current.RevisionID != "revision-1" {
		t.Fatalf("corrupt projection was not rebuilt: found=%v entity=%+v err=%v", found, current, err)
	}
}

func TestTamperedSegmentIsRejected(t *testing.T) {
	root := filepath.Join(t.TempDir(), "v2")
	journal, err := OpenJournal(root, "device-a", &JournalOptions{WriterID: testWriterA})
	if err != nil {
		t.Fatal(err)
	}
	revision := fixedRevision("source-1", "revision-1", nil, 100, false, `{"value":"original"}`)
	if _, _, err = journal.Append("operation-1", []Change{{Kind: RecordEntityRevision, Revision: &revision}}); err != nil {
		t.Fatal(err)
	}
	if err = journal.Close(); err != nil {
		t.Fatal(err)
	}
	segmentPath := firstSegmentPath(t, root)
	data, err := os.ReadFile(segmentPath)
	if err != nil {
		t.Fatal(err)
	}
	tampered := strings.Replace(string(data), "original", "tampered", 1)
	if tampered == string(data) {
		t.Fatal("test segment did not contain payload")
	}
	if err = os.WriteFile(segmentPath, []byte(tampered), 0644); err != nil {
		t.Fatal(err)
	}
	_, err = OpenJournal(root, "device-b", &JournalOptions{WriterID: testWriterB})
	if !errors.Is(err, ErrCorruptSegment) {
		t.Fatalf("expected corrupt segment error, got %v", err)
	}
}

func fixedRevision(entityID, revisionID string, parents []string, updatedAt int64, deleted bool,
	payload string) EntityRevision {
	canonicalPayload := json.RawMessage(`{}`)
	if !deleted {
		source := CardSource{
			ID:               entityID,
			SchemaID:         "schema-1",
			SourceType:       "block",
			PrimaryRefID:     "ref-1",
			GenerationConfig: json.RawMessage(payload),
			Status:           "active",
		}
		encoded, err := CanonicalJSON(source)
		if err != nil {
			panic(err)
		}
		canonicalPayload = encoded
	}
	return EntityRevision{
		EntityType:        EntityCardSource,
		EntityID:          entityID,
		RevisionID:        revisionID,
		ParentRevisionIDs: parents,
		UpdatedAt:         updatedAt,
		Deleted:           deleted,
		Payload:           canonicalPayload,
	}
}

func fixedEvent(eventType, eventID, entityID string, occurredAt int64, payload string) Event {
	return Event{
		EventType:  eventType,
		EventID:    eventID,
		EntityID:   entityID,
		OccurredAt: occurredAt,
		Payload:    json.RawMessage(payload),
	}
}

func assertProjectionCounts(t *testing.T, ctx context.Context, projection *Projection, operations, batches, events int) {
	t.Helper()
	actualOperations, err := projection.OperationCount(ctx)
	if err != nil {
		t.Fatal(err)
	}
	actualBatches, err := projection.BatchCount(ctx)
	if err != nil {
		t.Fatal(err)
	}
	actualEvents, err := projection.EventCount(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if actualOperations != operations || actualBatches != batches || actualEvents != events {
		t.Fatalf("unexpected counts: operations=%d batches=%d events=%d", actualOperations, actualBatches, actualEvents)
	}
}

func firstSegmentPath(t *testing.T, root string) string {
	t.Helper()
	paths := allSegmentPaths(t, root)
	if len(paths) == 0 {
		t.Fatal("segment file was not found")
	}
	return paths[0]
}

func allSegmentPaths(t *testing.T, root string) []string {
	t.Helper()
	var paths []string
	err := filepath.WalkDir(filepath.Join(root, "writers"), func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".json") {
			paths = append(paths, path)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return paths
}
