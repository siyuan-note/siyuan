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
	"path/filepath"
	"testing"
)

const (
	testWriterC = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
	testWriterD = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
	testWriterE = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
)

func TestConcurrentOfflineReviewsResolveDeterministically(t *testing.T) {
	ctx := context.Background()
	workspace := t.TempDir()
	root := filepath.Join(workspace, "v2")
	baseProjection := filepath.Join(workspace, "temp-base", "flashcards.db")
	base, err := OpenStore(ctx, root, baseProjection, "device-base", &JournalOptions{WriterID: testWriterA})
	if err != nil {
		t.Fatal(err)
	}
	createdAt := int64(1786431600000)
	schemaID := "schema-conflict"
	sourceID := "source-conflict"
	templateID := "template-conflict"
	preset := testSchedulerPreset("preset-conflict", false, false)
	source := testGenerationSource(sourceID, schemaID, "qa", json.RawMessage(`{}`))
	source.DefaultPresetID = preset.ID
	applyGenerationEntities(t, ctx, base, "setup-conflict", createdAt,
		testGenerationSchema(schemaID, []string{templateID}),
		testGenerationTemplate(templateID, schemaID, GenerationStatic, "forward", true), source, preset)
	if _, err = base.ReconcileSourceCards(ctx, "reconcile-conflict", sourceID, createdAt); err != nil {
		t.Fatal(err)
	}
	if err = base.Close(); err != nil {
		t.Fatal(err)
	}

	deviceA, err := OpenStore(ctx, root, filepath.Join(workspace, "temp-a", "flashcards.db"), "device-a",
		&JournalOptions{WriterID: testWriterB})
	if err != nil {
		t.Fatal(err)
	}
	deviceB, err := OpenStore(ctx, root, filepath.Join(workspace, "temp-b", "flashcards.db"), "device-b",
		&JournalOptions{WriterID: testWriterC})
	if err != nil {
		_ = deviceA.Close()
		t.Fatal(err)
	}
	cardID := GeneratedCardID(sourceID, templateID, "forward")
	requestA := ReviewRequest{
		OperationID: "offline-review-a", CardID: cardID, Rating: ReviewGood,
		ReviewedAt: createdAt + 60000, DurationMS: 1000, ReviewMode: "normal",
	}
	requestB := ReviewRequest{
		OperationID: "offline-review-b", CardID: cardID, Rating: ReviewHard,
		ReviewedAt: createdAt + 120000, DurationMS: 1200, ReviewMode: "normal",
	}
	if _, err = deviceA.ReviewCard(ctx, requestA); err != nil {
		t.Fatal(err)
	}
	if _, err = deviceB.ReviewCard(ctx, requestB); err != nil {
		t.Fatal(err)
	}
	if err = deviceA.Close(); err != nil {
		t.Fatal(err)
	}
	if err = deviceB.Close(); err != nil {
		t.Fatal(err)
	}

	merged, err := OpenStore(ctx, root, filepath.Join(workspace, "temp-merged", "flashcards.db"), "device-merged",
		&JournalOptions{WriterID: testWriterD})
	if err != nil {
		t.Fatal(err)
	}
	current, found, err := merged.Projection().CurrentEntity(ctx, EntityReviewState, cardID)
	if err != nil || !found {
		_ = merged.Close()
		t.Fatalf("resolved state was not found: found=%v err=%v", found, err)
	}
	var state ReviewState
	if err = decodeStrictJSON(current.Payload, &state); err != nil {
		_ = merged.Close()
		t.Fatal(err)
	}
	if state.Reps != 2 || state.StateRevisionID != current.RevisionID {
		_ = merged.Close()
		t.Fatalf("concurrent reviews were not replayed into one state: %+v", state)
	}
	if conflicts, conflictErr := merged.Projection().ConflictCount(ctx); conflictErr != nil || conflicts != 0 {
		_ = merged.Close()
		t.Fatalf("review state conflict remains unresolved: count=%d err=%v", conflicts, conflictErr)
	}
	if events, eventErr := merged.Projection().EventCount(ctx); eventErr != nil || events != 3 {
		_ = merged.Close()
		t.Fatalf("unexpected event count after conflict resolution: count=%d err=%v", events, eventErr)
	}
	var resolutionPayload []byte
	if err = merged.Projection().db.QueryRowContext(ctx,
		"SELECT payload FROM events WHERE event_type = ?", EventReviewConflictResolved).Scan(&resolutionPayload); err != nil {
		_ = merged.Close()
		t.Fatal(err)
	}
	var resolution ReviewConflictResolvedPayload
	if err = decodeStrictJSON(resolutionPayload, &resolution); err != nil {
		_ = merged.Close()
		t.Fatal(err)
	}
	if resolution.CardID != cardID || resolution.Algorithm != reviewConflictAlgorithm ||
		len(resolution.ReviewEventIDs) != 2 || resolution.ResolvedState.Reps != 2 {
		_ = merged.Close()
		t.Fatalf("unexpected conflict resolution event: %+v", resolution)
	}
	if err = merged.Close(); err != nil {
		t.Fatal(err)
	}

	reopened, err := OpenStore(ctx, root, filepath.Join(workspace, "temp-reopened", "flashcards.db"), "device-reopened",
		&JournalOptions{WriterID: testWriterE})
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	if events, eventErr := reopened.Projection().EventCount(ctx); eventErr != nil || events != 3 {
		t.Fatalf("conflict resolution was duplicated after restart: count=%d err=%v", events, eventErr)
	}
}
