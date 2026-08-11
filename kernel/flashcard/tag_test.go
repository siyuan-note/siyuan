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
	"testing"
)

func TestSaveTagNormalizesNamesAndProtectsRevisions(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	created, err := store.SaveTag(ctx, SaveTagRequest{OperationID: "create-tag", TagID: "tag-save",
		Name: "  ＴＥＳＴ  ", UpdatedAt: 10})
	if err != nil {
		t.Fatal(err)
	}
	var tag Tag
	if err = decodeStrictJSON(created.Payload, &tag); err != nil {
		t.Fatal(err)
	}
	if tag.Name != "ＴＥＳＴ" || tag.NormalizedName != "test" {
		t.Fatalf("tag name was not normalized safely: %+v", tag)
	}
	retry, err := store.SaveTag(ctx, SaveTagRequest{OperationID: "create-tag", TagID: "tag-save",
		Name: "  ＴＥＳＴ  ", UpdatedAt: 10})
	if err != nil || retry.RevisionID != created.RevisionID {
		t.Fatalf("tag creation retry was not idempotent: revision=%+v err=%v", retry, err)
	}
	if _, err = store.SaveTag(ctx, SaveTagRequest{OperationID: "overwrite-tag", TagID: "tag-save",
		Name: "Overwrite", UpdatedAt: 11}); err == nil {
		t.Fatal("tag update without an expected revision was accepted")
	}
	updated, err := store.SaveTag(ctx, SaveTagRequest{OperationID: "update-tag", TagID: "tag-save",
		Name: "Renamed", ExpectedRevisionID: created.RevisionID, UpdatedAt: 12})
	if err != nil || len(updated.ParentRevisionIDs) != 1 || updated.ParentRevisionIDs[0] != created.RevisionID {
		t.Fatalf("tag update did not preserve revision ancestry: revision=%+v err=%v", updated, err)
	}
}

func TestSaveTagRejectsDuplicateSiblingName(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	if _, err := store.SaveTag(ctx, SaveTagRequest{OperationID: "create-first-tag", TagID: "tag-first",
		Name: "Example", UpdatedAt: 10}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.SaveTag(ctx, SaveTagRequest{OperationID: "create-duplicate-tag", TagID: "tag-duplicate",
		Name: "ＥＸＡＭＰＬＥ", UpdatedAt: 11}); err == nil {
		t.Fatal("canonically duplicate sibling tag name was accepted")
	}
	if _, found := store.journal.FindOperation("create-duplicate-tag"); found {
		t.Fatal("rejected duplicate tag wrote an operation")
	}
}

func TestSyncedDuplicateTagNamesDoNotBreakProjection(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	for index, tagID := range []string{"tag-device-a", "tag-device-b"} {
		operationID := "synced-tag-operation-" + tagID
		tag := Tag{ID: tagID, Name: []string{"Example", "ＥＸＡＭＰＬＥ"}[index], NormalizedName: "example"}
		revision, err := NewOperationEntityRevision(operationID, EntityTag, tagID, nil, int64(index+1), false, tag)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = store.Apply(ctx, operationID, []Change{{Kind: RecordEntityRevision, Revision: &revision}}); err != nil {
			t.Fatalf("synced semantic tag conflict made the projection unusable: %v", err)
		}
	}
	page, err := store.Projection().ListEntities(ctx, EntityTag, EntityListOptions{Limit: 10})
	if err != nil || page.Total != 2 {
		t.Fatalf("synced semantic tag conflict was not retained for resolution: page=%+v err=%v", page, err)
	}
}
