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
	"testing"
)

func TestSetTagAssignmentsReplacesIndependentRelationsAtomically(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	applyGenerationEntities(t, ctx, store, "tag-assignment-dependencies", 1,
		testSchedulerPreset(legacyPresetID, false, false))
	applyTagEntitiesForTest(t, ctx, store, "tag-assignment-tags", 2,
		Tag{ID: "tag-parent", Name: "Parent", NormalizedName: "parent"},
		Tag{ID: "tag-child", ParentID: "tag-parent", Name: "Child", NormalizedName: "child"})
	request := BasicSourceRequest{OperationID: "tag-assignment-source", SourceID: "source-tags",
		BlockIDs: []string{"block-question", "block-answer"}, Direction: BasicDirectionForward, CreatedAt: 10}
	if _, err := store.CreateBasicSource(ctx, request); err != nil {
		t.Fatal(err)
	}
	cardID := GeneratedCardID(request.SourceID, basicForwardTemplateID, BasicDirectionForward)

	cardResult, err := store.SetTagAssignments(ctx, SetTagAssignmentsRequest{
		OperationID: "set-card-tags", TargetType: "card", TargetIDs: []string{cardID},
		TagIDs: []string{"tag-parent", "tag-child"}, ChangedAt: 20,
	})
	if err != nil || !equalStrings(cardResult.Assignments[cardID], []string{"tag-child", "tag-parent"}) {
		t.Fatalf("card tags were not assigned: result=%+v err=%v", cardResult, err)
	}
	if len(cardResult.Batch.Changes) != 3 {
		t.Fatalf("card tag assignment did not contain two relations and one audit event: %+v",
			cardResult.Batch.Changes)
	}
	if _, err = store.SetTagAssignments(ctx, SetTagAssignmentsRequest{
		OperationID: "set-source-tags", TargetType: "source", TargetIDs: []string{request.SourceID},
		TagIDs: []string{"tag-parent"}, ChangedAt: 21,
	}); err != nil {
		t.Fatal(err)
	}
	query := predicateQuery("cardID", QueryEqual, json.RawMessage(`"`+cardID+`"`))
	results, err := store.Projection().SearchCards(ctx, &query, CardSearchOptions{
		Now: 21, IncludeInactive: true, IncludeSuspended: true, IncludeBuried: true, IncludePaused: true,
	})
	if err != nil || len(results) != 1 || !equalStrings(results[0].CardTagIDs, []string{"tag-child", "tag-parent"}) ||
		!equalStrings(results[0].SourceTagIDs, []string{"tag-parent"}) ||
		!equalStrings(results[0].EffectiveTagIDs, []string{"tag-child", "tag-parent"}) {
		t.Fatalf("effective tags were not projected: results=%+v err=%v", results, err)
	}

	replaced, err := store.SetTagAssignments(ctx, SetTagAssignmentsRequest{
		OperationID: "replace-card-tags", TargetType: "card", TargetIDs: []string{cardID},
		TagIDs: []string{"tag-child"}, ChangedAt: 22,
	})
	if err != nil || len(replaced.Batch.Changes) != 2 {
		t.Fatalf("tag replacement did not tombstone only the removed relation: result=%+v err=%v", replaced, err)
	}
	retry, err := store.SetTagAssignments(ctx, SetTagAssignmentsRequest{
		OperationID: "replace-card-tags", TargetType: "card", TargetIDs: []string{cardID},
		TagIDs: []string{"tag-child"}, ChangedAt: 22,
	})
	if err != nil || retry.Batch.BatchID != replaced.Batch.BatchID {
		t.Fatalf("tag replacement retry was not idempotent: result=%+v err=%v", retry, err)
	}
	noChange, err := store.SetTagAssignments(ctx, SetTagAssignmentsRequest{
		OperationID: "same-card-tags", TargetType: "card", TargetIDs: []string{cardID},
		TagIDs: []string{"tag-child"}, ChangedAt: 23,
	})
	if err != nil || len(noChange.Batch.Changes) != 1 || noChange.Batch.Changes[0].Kind != RecordEvent {
		t.Fatalf("unchanged tag replacement did not preserve an idempotent audit operation: result=%+v err=%v",
			noChange, err)
	}
}

func applyTagEntitiesForTest(t *testing.T, ctx context.Context, store *Store, operationID string, updatedAt int64,
	tags ...Tag) {
	t.Helper()
	changes := make([]Change, 0, len(tags))
	for _, tag := range tags {
		revision, err := NewOperationEntityRevision(operationID, EntityTag, tag.ID, nil, updatedAt, false, tag)
		if err != nil {
			t.Fatal(err)
		}
		changes = append(changes, Change{Kind: RecordEntityRevision, Revision: &revision})
	}
	if _, err := store.Apply(ctx, operationID, changes); err != nil {
		t.Fatal(err)
	}
}

func TestSetTagAssignmentsRejectsMissingTagWithoutPartialWrite(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	applyGenerationEntities(t, ctx, store, "tag-assignment-invalid-dependencies", 1,
		testSchedulerPreset(legacyPresetID, false, false))
	request := BasicSourceRequest{OperationID: "tag-assignment-invalid-source", SourceID: "source-invalid-tags",
		BlockIDs: []string{"block-question", "block-answer"}, Direction: BasicDirectionForward, CreatedAt: 10}
	if _, err := store.CreateBasicSource(ctx, request); err != nil {
		t.Fatal(err)
	}
	cardID := GeneratedCardID(request.SourceID, basicForwardTemplateID, BasicDirectionForward)
	if _, err := store.SetTagAssignments(ctx, SetTagAssignmentsRequest{
		OperationID: "set-missing-tag", TargetType: "card", TargetIDs: []string{cardID},
		TagIDs: []string{"missing"}, ChangedAt: 20,
	}); err == nil {
		t.Fatal("missing tag was accepted")
	}
	if _, found := store.journal.FindOperation("set-missing-tag"); found {
		t.Fatal("rejected tag assignment wrote an operation")
	}
	assignments, err := store.projection.tagAssignmentsForTarget(ctx, "card", cardID)
	if err != nil || len(assignments) != 0 {
		t.Fatalf("rejected tag assignment left partial relations: assignments=%+v err=%v", assignments, err)
	}
}
