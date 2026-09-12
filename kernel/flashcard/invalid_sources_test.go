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
	"errors"
	"reflect"
	"testing"
)

func TestInvalidSourcesRevalidateAndPreserveState(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	setupLegacyCompatibilityBuiltins(t, ctx, store, 100)
	created, err := store.CreateQuickSources(ctx, QuickSourceRequest{OperationID: "cleanup-create",
		BlockIDs: []string{"missing", "restored", "closed", "unknown", "active", "stale"}, CreatedAt: 101})
	if err != nil {
		t.Fatal(err)
	}
	states := map[string]BlockPresence{"missing": BlockMissing, "restored": BlockMissing,
		"closed": BlockClosed, "unknown": BlockUnknown, "active": BlockPresent, "stale": BlockMissing}
	resolve := func(context.Context, []string) (map[string]BlockPresence, error) { return states, nil }
	preview, err := store.InspectInvalidSources(ctx, resolve)
	if err != nil || len(preview.Sources) != 5 {
		t.Fatalf("preview: %+v %v", preview, err)
	}
	var missing InvalidSource
	for _, source := range preview.Sources {
		if source.BlockIDs[0] == "missing" {
			missing = source
		}
	}
	if missing.CardCount != 1 || missing.Reason != BlockMissing {
		t.Fatalf("missing: %+v", missing)
	}
	var cardID string
	for _, id := range created.CardIDs {
		revision, _, _ := store.projection.CurrentEntity(ctx, EntityCard, id)
		var card Card
		if err = decodeStrictJSON(revision.Payload, &card); err != nil {
			t.Fatal(err)
		}
		if card.SourceID == missing.SourceID {
			cardID = id
		}
	}
	setReviewStateForTest(t, ctx, store, "cleanup-schedule", cardID, 110, 500, 3)
	cardBefore, _, _ := store.projection.CurrentEntity(ctx, EntityCard, cardID)
	stateBefore, _, _ := store.projection.CurrentEntity(ctx, EntityReviewState, cardID)
	states["restored"] = BlockPresent
	for index := range preview.Sources {
		if preview.Sources[index].BlockIDs[0] == "stale" {
			preview.Sources[index].RevisionID = "outdated"
		}
	}
	request := DeleteInvalidSourcesRequest{OperationID: "cleanup-delete", Sources: preview.Sources, ChangedAt: 120}
	deleted, err := store.DeleteInvalidSources(ctx, request, resolve)
	if err != nil || !reflect.DeepEqual(deleted.Deleted, []string{missing.SourceID}) || len(deleted.Skipped) != 4 {
		t.Fatalf("cleanup deleted unsafe sources: %+v %v", deleted, err)
	}
	cardAfter, _, _ := store.projection.CurrentEntity(ctx, EntityCard, cardID)
	stateAfter, _, _ := store.projection.CurrentEntity(ctx, EntityReviewState, cardID)
	if !reflect.DeepEqual(cardBefore, cardAfter) || !reflect.DeepEqual(stateBefore, stateAfter) {
		t.Fatal("cleanup changed card or schedule")
	}
	if _, err = store.DeleteInvalidSources(ctx, request, func(context.Context, []string) (map[string]BlockPresence, error) {
		return nil, errors.New("retry should use journal")
	}); err != nil {
		t.Fatal(err)
	}
	if _, err = store.ManageSourceLifecycle(ctx, SourceLifecycleRequest{OperationID: "cleanup-restore",
		SourceID: missing.SourceID, Action: SourceActionRestore, ChangedAt: 130}); err != nil {
		t.Fatal(err)
	}
	assertReviewStateForTest(t, ctx, store, cardID, 500, 3)
}

func TestInvalidSourcesRequiredReferencesAndAtomicFailure(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	applyGenerationEntities(t, ctx, store, "cleanup-preset", 1, testSchedulerPreset(legacyPresetID, false, false))
	_, err := store.CreateBasicSource(ctx, BasicSourceRequest{OperationID: "cleanup-basic", SourceID: "source-basic",
		BlockIDs: []string{"question", "answer"}, Direction: BasicDirectionBidirectional, CreatedAt: 100})
	if err != nil {
		t.Fatal(err)
	}
	states := map[string]BlockPresence{"question": BlockPresent, "answer": BlockMissing}
	resolve := func(context.Context, []string) (map[string]BlockPresence, error) { return states, nil }
	report, err := store.InspectInvalidSources(ctx, resolve)
	if err != nil || len(report.Sources) != 1 || report.Sources[0].CardCount != 2 || report.Sources[0].Reason != BlockMissing {
		t.Fatalf("required answer was not detected: %+v %v", report, err)
	}
	request := DeleteInvalidSourcesRequest{OperationID: "cleanup-basic-delete", Sources: report.Sources, ChangedAt: 110}
	before, _, _ := store.projection.CurrentEntity(ctx, EntityCardSource, "source-basic")
	if _, err = store.DeleteInvalidSources(ctx, request, func(context.Context, []string) (map[string]BlockPresence, error) {
		return nil, errors.New("read failure")
	}); err == nil {
		t.Fatal("scan failure ignored")
	}
	after, _, _ := store.projection.CurrentEntity(ctx, EntityCardSource, "source-basic")
	if !reflect.DeepEqual(before, after) {
		t.Fatal("scan failure changed source")
	}
	states["question"] = BlockClosed
	report, err = store.InspectInvalidSources(ctx, resolve)
	if err != nil || report.Sources[0].Reason != BlockClosed {
		t.Fatalf("closed dependency was not protected: %+v %v", report, err)
	}
	delete(states, "question")
	report, err = store.InspectInvalidSources(ctx, resolve)
	if err != nil || report.Sources[0].Reason != BlockUnknown {
		t.Fatalf("unknown dependency was not protected: %+v %v", report, err)
	}
	states["question"] = BlockPresent
	stale := request
	stale.Sources = append([]InvalidSource(nil), request.Sources...)
	stale.Sources[0].CardCount++
	if result, err := store.DeleteInvalidSources(ctx, stale, resolve); err != nil || len(result.Deleted) != 0 {
		t.Fatalf("changed card count was not protected: %+v %v", result, err)
	}
	stale.Sources[0] = request.Sources[0]
	stale.Sources[0].BlockIDs = []string{"old-reference"}
	if result, err := store.DeleteInvalidSources(ctx, stale, resolve); err != nil || len(result.Deleted) != 0 {
		t.Fatalf("changed references were not protected: %+v %v", result, err)
	}
	var refID string
	if err = store.projection.db.QueryRowContext(ctx, `SELECT id FROM card_source_refs WHERE source_id = ? LIMIT 1`, "source-basic").Scan(&refID); err != nil {
		t.Fatal(err)
	}
	if _, err = store.projection.db.ExecContext(ctx, `INSERT INTO entity_conflicts
		(entity_type, entity_id, revision_id, selected_revision_id, detected_at) VALUES (?, ?, 'conflict', 'selected', 100)`,
		EntityCardSourceRef, refID); err != nil {
		t.Fatal(err)
	}
	if result, err := store.DeleteInvalidSources(ctx, request, resolve); err != nil || len(result.Deleted) != 0 {
		t.Fatalf("conflicted reference was not protected: %+v %v", result, err)
	}
	if _, err = store.projection.db.ExecContext(ctx, `DELETE FROM entity_conflicts`); err != nil {
		t.Fatal(err)
	}
	request.Sources = append(request.Sources, request.Sources[0])
	result, err := store.DeleteInvalidSources(ctx, request, resolve)
	if err != nil || len(result.Deleted) != 1 {
		t.Fatalf("duplicate source not deduplicated: %+v %v", result, err)
	}
}
