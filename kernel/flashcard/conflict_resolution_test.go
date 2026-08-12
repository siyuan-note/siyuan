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
	"testing"
)

func TestEntityConflictCanBeListedAndResolvedBySelectedBranch(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	sourceID := "conflict-resolution-source"
	applyGenerationEntities(t, ctx, store, "conflict-resolution-setup", 100,
		testGenerationSchema("conflict-resolution-schema", []string{"conflict-resolution-template"}),
		testGenerationTemplate("conflict-resolution-template", "conflict-resolution-schema", GenerationStatic,
			"forward", true),
		testGenerationSource(sourceID, "conflict-resolution-schema", "qa", json.RawMessage(`{}`)))
	root, found, err := store.Projection().CurrentEntity(ctx, EntityCardSource, sourceID)
	if err != nil || !found {
		t.Fatalf("source root was not found: found=%v err=%v", found, err)
	}
	var source CardSource
	if err = decodeStrictJSON(root.Payload, &source); err != nil {
		t.Fatal(err)
	}
	source.Priority = "exam"
	first, err := NewOperationEntityRevision("conflict-resolution-first", EntityCardSource, sourceID,
		[]string{root.RevisionID}, 200, false, source)
	if err != nil {
		t.Fatal(err)
	}
	source.Priority = "learning"
	second, err := NewOperationEntityRevision("conflict-resolution-second", EntityCardSource, sourceID,
		[]string{root.RevisionID}, 201, false, source)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = store.Apply(ctx, "conflict-resolution-first",
		[]Change{{Kind: RecordEntityRevision, Revision: &first}}); err != nil {
		t.Fatal(err)
	}
	if _, err = store.Apply(ctx, "conflict-resolution-second",
		[]Change{{Kind: RecordEntityRevision, Revision: &second}}); err != nil {
		t.Fatal(err)
	}
	groups, err := store.Projection().ListEntityConflicts(ctx, 10)
	if err != nil || len(groups) != 1 || len(groups[0].Revisions) != 2 {
		t.Fatalf("unexpected conflict groups: groups=%+v err=%v", groups, err)
	}
	request := ConflictResolutionRequest{OperationID: "conflict-resolution-merge", EntityType: EntityCardSource,
		EntityID: sourceID, SelectedRevision: first.RevisionID, ResolvedAt: 300}
	merged, err := store.ResolveEntityConflict(ctx, request)
	if err != nil {
		t.Fatal(err)
	}
	if retried, retryErr := store.ResolveEntityConflict(ctx, request); retryErr != nil ||
		retried.RevisionID != merged.RevisionID {
		t.Fatalf("conflict resolution retry failed: revision=%+v err=%v", retried, retryErr)
	}
	changedSelection := request
	changedSelection.SelectedRevision = second.RevisionID
	if _, retryErr := store.ResolveEntityConflict(ctx, changedSelection); !errors.Is(retryErr, ErrOperationConflict) {
		t.Fatalf("conflict resolution retry accepted another branch: %v", retryErr)
	}
	current, found, err := store.Projection().CurrentEntity(ctx, EntityCardSource, sourceID)
	if err != nil || !found || current.RevisionID != merged.RevisionID {
		t.Fatalf("merged source was not selected: current=%+v found=%v err=%v", current, found, err)
	}
	if err = decodeStrictJSON(current.Payload, &source); err != nil || source.Priority != "exam" {
		t.Fatalf("selected branch payload was not preserved: source=%+v err=%v", source, err)
	}
	if conflicts, countErr := store.Projection().ConflictCount(ctx); countErr != nil || conflicts != 0 {
		t.Fatalf("resolved conflict remained open: count=%d err=%v", conflicts, countErr)
	}
}
