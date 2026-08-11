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
	"testing"
)

func TestMutateEntitiesIsAtomicIdempotentAndRevisionChecked(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()

	tag := Tag{ID: "tag-mutation", Name: "First", NormalizedName: "first"}
	child := Tag{ID: "tag-mutation-child", ParentID: tag.ID, Name: "Child", NormalizedName: "child"}
	mutations := []EntityMutation{
		{EntityType: EntityTag, EntityID: tag.ID, UpdatedAt: 100, Payload: mustRawJSON(t, tag)},
		{EntityType: EntityTag, EntityID: child.ID, UpdatedAt: 100, Payload: mustRawJSON(t, child)},
	}
	first, err := store.MutateEntities(ctx, "mutation-create", mutations)
	if err != nil {
		t.Fatal(err)
	}
	retry, err := store.MutateEntities(ctx, "mutation-create", mutations)
	if err != nil {
		t.Fatal(err)
	}
	if retry.Batch.BatchID != first.Batch.BatchID || len(retry.Revisions) != 2 {
		t.Fatalf("unexpected mutation retry result: %#v", retry)
	}

	changedRetry := append([]EntityMutation(nil), mutations...)
	changedTag := tag
	changedTag.Name = "Changed"
	changedRetry[0].Payload = mustRawJSON(t, changedTag)
	if _, err = store.MutateEntities(ctx, "mutation-create", changedRetry); !errors.Is(err, ErrOperationConflict) {
		t.Fatalf("expected operation conflict, got %v", err)
	}

	current, found, err := store.Projection().CurrentEntity(ctx, EntityTag, tag.ID)
	if err != nil || !found {
		t.Fatalf("query created tag: found=%v err=%v", found, err)
	}
	updated := tag
	updated.Name = "Updated"
	updated.NormalizedName = "updated"
	update := EntityMutation{EntityType: EntityTag, EntityID: tag.ID, ExpectedRevisionID: current.RevisionID,
		UpdatedAt: 200, Payload: mustRawJSON(t, updated)}
	updatedResult, err := store.MutateEntities(ctx, "mutation-update", []EntityMutation{update})
	if err != nil {
		t.Fatal(err)
	}
	if len(updatedResult.Revisions) != 1 || updatedResult.Revisions[0].ParentRevisionIDs[0] != current.RevisionID {
		t.Fatalf("unexpected updated revision: %#v", updatedResult.Revisions)
	}

	stale := update
	stale.UpdatedAt = 300
	if _, err = store.MutateEntities(ctx, "mutation-stale", []EntityMutation{stale}); !errors.Is(err, ErrRevisionConflict) {
		t.Fatalf("expected revision conflict, got %v", err)
	}

	latest := updatedResult.Revisions[0]
	childRevision, found, err := store.Projection().CurrentEntity(ctx, EntityTag, child.ID)
	if err != nil || !found {
		t.Fatalf("query child tag: found=%v err=%v", found, err)
	}
	deleted, err := store.MutateEntities(ctx, "mutation-delete", []EntityMutation{
		{EntityType: EntityTag, EntityID: child.ID, ExpectedRevisionID: childRevision.RevisionID,
			UpdatedAt: 300, Deleted: true},
		{EntityType: EntityTag, EntityID: tag.ID, ExpectedRevisionID: latest.RevisionID,
			UpdatedAt: 300, Deleted: true},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(deleted.Revisions) != 2 || !deleted.Revisions[0].Deleted || !deleted.Revisions[1].Deleted ||
		string(deleted.Revisions[0].Payload) != `{}` || string(deleted.Revisions[1].Payload) != `{}` {
		t.Fatalf("deletion did not write canonical tombstones: %#v", deleted.Revisions)
	}
}

func TestMutateEntitiesRejectsWholeBatchBeforeJournalWrite(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()

	valid := Tag{ID: "tag-atomic", Name: "Atomic", NormalizedName: "atomic"}
	invalid := Tag{ID: "tag-invalid", Name: "", NormalizedName: ""}
	_, err := store.MutateEntities(ctx, "mutation-atomic", []EntityMutation{
		{EntityType: EntityTag, EntityID: valid.ID, UpdatedAt: 100, Payload: mustRawJSON(t, valid)},
		{EntityType: EntityTag, EntityID: invalid.ID, UpdatedAt: 100, Payload: mustRawJSON(t, invalid)},
	})
	if err == nil {
		t.Fatal("expected invalid mutation to fail")
	}
	if _, found, queryErr := store.Projection().CurrentEntity(ctx, EntityTag, valid.ID); queryErr != nil || found {
		t.Fatalf("valid prefix of a rejected batch was applied: found=%v err=%v", found, queryErr)
	}
	if count, countErr := store.Projection().OperationCount(ctx); countErr != nil || count != 0 {
		t.Fatalf("rejected mutation reached authority/projection: count=%d err=%v", count, countErr)
	}
}

func TestMutateEntitiesRetryRecoversJournaledOperationProjection(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()

	const operationID = "mutation-journaled-before-projection"
	tag := Tag{ID: "tag-journaled", Name: "Journaled", NormalizedName: "journaled"}
	mutation := EntityMutation{EntityType: EntityTag, EntityID: tag.ID, RequireAbsent: true,
		UpdatedAt: 100, Payload: mustRawJSON(t, tag)}
	revision, err := NewOperationEntityRevision(operationID, mutation.EntityType, mutation.EntityID, nil,
		mutation.UpdatedAt, false, mutation.Payload)
	if err != nil {
		t.Fatal(err)
	}
	batch, created, err := store.journal.Append(operationID,
		[]Change{{Kind: RecordEntityRevision, Revision: &revision}})
	if err != nil || !created {
		t.Fatalf("append journal-only operation: created=%v err=%v", created, err)
	}
	if _, found, queryErr := store.Projection().CurrentEntity(ctx, EntityTag, tag.ID); queryErr != nil || found {
		t.Fatalf("journal-only operation unexpectedly reached projection: found=%v err=%v", found, queryErr)
	}

	result, err := store.MutateEntities(ctx, operationID, []EntityMutation{mutation})
	if err != nil {
		t.Fatal(err)
	}
	if result.Batch.BatchID != batch.BatchID || len(result.Revisions) != 1 {
		t.Fatalf("unexpected recovered mutation result: %#v", result)
	}
	current, found, err := store.Projection().CurrentEntity(ctx, EntityTag, tag.ID)
	if err != nil || !found || current.RevisionID != revision.RevisionID {
		t.Fatalf("journaled mutation was not projected: found=%v revision=%#v err=%v", found, current, err)
	}
}

func TestFlagDefinitionsUseStableVersionedEntities(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()

	definitions := []FlagDefinition{
		{ID: FlagDefinitionID(1), Flag: 1, Name: "Important"},
		{ID: FlagDefinitionID(2), Flag: 2, Name: "Needs work"},
	}
	mutations := make([]EntityMutation, 0, len(definitions))
	for _, definition := range definitions {
		mutations = append(mutations, EntityMutation{EntityType: EntityFlagDefinition, EntityID: definition.ID,
			RequireAbsent: true, UpdatedAt: 100, Payload: mustRawJSON(t, definition)})
	}
	if _, err := store.MutateEntities(ctx, "create-flag-definitions", mutations); err != nil {
		t.Fatal(err)
	}
	page, err := store.Projection().ListEntities(ctx, EntityFlagDefinition, EntityListOptions{Limit: 10})
	if err != nil || page.Total != 2 || len(page.Entities) != 2 {
		t.Fatalf("list flag definitions: page=%+v err=%v", page, err)
	}
	invalid := FlagDefinition{ID: FlagDefinitionID(1), Flag: 2, Name: "Wrong identity"}
	if _, err = store.MutateEntities(ctx, "invalid-flag-definition", []EntityMutation{{
		EntityType: EntityFlagDefinition, EntityID: invalid.ID, UpdatedAt: 200, Payload: mustRawJSON(t, invalid),
	}}); err == nil {
		t.Fatal("expected a mismatched flag definition identity to fail")
	}
}
