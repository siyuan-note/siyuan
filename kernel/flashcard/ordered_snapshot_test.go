// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package flashcard

import (
	"context"
	"reflect"
	"testing"
)

func TestOrderedSourceSnapshotAndReplayAreReadOnly(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	applyGenerationEntities(t, ctx, store, "preset", 1, testSchedulerPreset(legacyPresetID, false, false))
	created, err := store.CreateAdvancedSource(ctx, AdvancedSourceRequest{OperationID: "create", SourceID: "source", Mode: AdvancedModeOrderedCards, BlockIDs: []string{"a", "b"}, CreatedAt: 100})
	if err != nil {
		t.Fatal(err)
	}
	before := len(store.journal.Batches())
	snapshot, err := store.OrderedSourceSnapshot(ctx, "source")
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(snapshot.SourceRevision, created.SourceRevision) || len(snapshot.References) != 2 {
		t.Fatal("snapshot differs from source")
	}
	var source CardSource
	if err = decodeStrictJSON(snapshot.SourceRevision.Payload, &source); err != nil {
		t.Fatal(err)
	}
	var config OrderedGenerationConfig
	if err = decodeStrictJSON(source.GenerationConfig, &config); err != nil {
		t.Fatal(err)
	}
	request := ReorderAdvancedSourceRequest{OperationID: "reorder", SourceID: source.ID, ExpectedRevisionID: snapshot.SourceRevision.RevisionID, OrderedStepIDs: []string{config.Steps[1].ID, config.Steps[0].ID}, UpdatedAt: 200}
	if _, found, err := store.ReplayReorderAdvancedSource(ctx, request); err != nil || found {
		t.Fatal("unknown operation replay", err)
	}
	if len(store.journal.Batches()) != before {
		t.Fatal("read wrote journal")
	}
	result, err := store.ReorderAdvancedSource(ctx, request)
	if err != nil {
		t.Fatal(err)
	}
	before = len(store.journal.Batches())
	replayed, found, err := store.ReplayReorderAdvancedSource(ctx, request)
	if err != nil || !found || !reflect.DeepEqual(result, replayed) {
		t.Fatal("replay changed result", err)
	}
	if len(store.journal.Batches()) != before {
		t.Fatal("replay wrote journal")
	}
}
