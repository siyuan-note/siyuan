// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package flashcard

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"sync"
	"testing"
)

func TestReorderAdvancedSourceHundredProgressiveSteps(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	applyGenerationEntities(t, ctx, store, "preset", 1, testSchedulerPreset(legacyPresetID, false, false))
	blocks := make([]string, 100)
	for i := range blocks {
		blocks[i] = fmt.Sprintf("block-%03d", i)
	}
	created, err := store.CreateAdvancedSource(ctx, AdvancedSourceRequest{OperationID: "create", SourceID: "source", Mode: AdvancedModeOrderedCards, BlockIDs: blocks, CreatedAt: 100})
	if err != nil {
		t.Fatal(err)
	}
	var source CardSource
	if err = decodeStrictJSON(created.SourceRevision.Payload, &source); err != nil {
		t.Fatal(err)
	}
	var config OrderedGenerationConfig
	if err = decodeStrictJSON(source.GenerationConfig, &config); err != nil {
		t.Fatal(err)
	}
	ids := make([]string, len(config.Steps))
	for i, step := range config.Steps {
		ids[len(ids)-1-i] = step.ID
	}
	request := ReorderAdvancedSourceRequest{OperationID: "reorder", SourceID: source.ID, ExpectedRevisionID: created.SourceRevision.RevisionID, OrderedStepIDs: ids, UpdatedAt: 200}
	result, err := store.ReorderAdvancedSource(ctx, request)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.UpdatedCardIDs) != 100 {
		t.Fatal("expected all progressive cards updated")
	}
	retried, err := store.ReorderAdvancedSource(ctx, request)
	if err != nil || !reflect.DeepEqual(result, retried) {
		t.Fatal("large reorder retry changed result", err)
	}
}

func TestReorderAdvancedSourceConcurrentRevisionIsAtomic(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	applyGenerationEntities(t, ctx, store, "preset", 1, testSchedulerPreset(legacyPresetID, false, false))
	created, err := store.CreateAdvancedSource(ctx, AdvancedSourceRequest{OperationID: "create", SourceID: "source", Mode: AdvancedModeOrderedCards, BlockIDs: []string{"a", "b", "c"}, CreatedAt: 100})
	if err != nil {
		t.Fatal(err)
	}
	var source CardSource
	if err = decodeStrictJSON(created.SourceRevision.Payload, &source); err != nil {
		t.Fatal(err)
	}
	var config OrderedGenerationConfig
	if err = decodeStrictJSON(source.GenerationConfig, &config); err != nil {
		t.Fatal(err)
	}
	requests := []ReorderAdvancedSourceRequest{
		{OperationID: "race-a", SourceID: source.ID, ExpectedRevisionID: created.SourceRevision.RevisionID, OrderedStepIDs: []string{config.Steps[2].ID, config.Steps[1].ID, config.Steps[0].ID}, UpdatedAt: 200},
		{OperationID: "race-b", SourceID: source.ID, ExpectedRevisionID: created.SourceRevision.RevisionID, OrderedStepIDs: []string{config.Steps[1].ID, config.Steps[0].ID, config.Steps[2].ID}, UpdatedAt: 201},
	}
	start := make(chan struct{})
	errs := make([]error, 2)
	var wg sync.WaitGroup
	for i := range requests {
		wg.Add(1)
		go func(i int) { defer wg.Done(); <-start; _, errs[i] = store.ReorderAdvancedSource(ctx, requests[i]) }(i)
	}
	close(start)
	wg.Wait()
	successes := 0
	for i, err := range errs {
		if err == nil {
			successes++
			continue
		}
		if !errors.Is(err, ErrRevisionConflict) {
			t.Fatal(err)
		}
		if _, found, queryErr := store.findAppliedOperation(ctx, requests[i].OperationID); queryErr != nil || found {
			t.Fatal("losing operation wrote a batch", queryErr)
		}
	}
	if successes != 1 {
		t.Fatal("expected exactly one successful reorder", errs)
	}
}

func TestReorderAdvancedSourceRejectsUnsupportedWithoutWriting(t *testing.T) {
	for _, mode := range []string{AdvancedModeOrderedSingle, AdvancedModeCloze} {
		t.Run(mode, func(t *testing.T) {
			ctx := context.Background()
			store := newGenerationTestStore(t, ctx)
			defer store.Close()
			applyGenerationEntities(t, ctx, store, "preset", 1, testSchedulerPreset(legacyPresetID, false, false))
			created, err := store.CreateAdvancedSource(ctx, AdvancedSourceRequest{OperationID: "create", SourceID: "source", Mode: mode, BlockIDs: []string{"a", "b"}, CreatedAt: 100})
			if err != nil {
				t.Fatal(err)
			}
			var source CardSource
			if err = decodeStrictJSON(created.SourceRevision.Payload, &source); err != nil {
				t.Fatal(err)
			}
			request := ReorderAdvancedSourceRequest{OperationID: "invalid", SourceID: source.ID, ExpectedRevisionID: created.SourceRevision.RevisionID, OrderedStepIDs: []string{"unknown"}, UpdatedAt: 200}
			if mode == AdvancedModeOrderedSingle {
				var config OrderedGenerationConfig
				if err = decodeStrictJSON(source.GenerationConfig, &config); err != nil {
					t.Fatal(err)
				}
				request.OrderedStepIDs = []string{config.Steps[1].ID, config.Steps[0].ID}
				revision, _, _ := store.projection.CurrentEntity(ctx, EntityCardTemplate, advancedOrderedSingleTemplateID)
				var template CardTemplate
				if err = decodeStrictJSON(revision.Payload, &template); err != nil {
					t.Fatal(err)
				}
				template.GenerationRule = []byte(`{"mode":"orderedSingle","variantKey":"changed"}`)
				payload, _ := CanonicalJSON(template)
				if _, err = store.MutateEntities(ctx, "template-change", []EntityMutation{{EntityType: EntityCardTemplate, EntityID: template.ID, ExpectedRevisionID: revision.RevisionID, UpdatedAt: 150, Payload: payload}}); err != nil {
					t.Fatal(err)
				}
			}
			before, _ := store.projection.cardRevisionsBySource(ctx, source.ID)
			if _, err = store.ReorderAdvancedSource(ctx, request); err == nil {
				t.Fatal("unsupported source or template accepted")
			}
			after, _ := store.projection.cardRevisionsBySource(ctx, source.ID)
			current, _, _ := store.projection.CurrentEntity(ctx, EntityCardSource, source.ID)
			if !reflect.DeepEqual(before, after) || !reflect.DeepEqual(current, created.SourceRevision) {
				t.Fatal("rejected reorder changed state")
			}
			if _, found, err := store.findAppliedOperation(ctx, request.OperationID); err != nil || found {
				t.Fatal("rejected reorder committed operation", err)
			}
		})
	}
}

func TestReorderAdvancedSourceRejectsOtherOperationReplay(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	applyGenerationEntities(t, ctx, store, "preset", 1, testSchedulerPreset(legacyPresetID, false, false))
	created, err := store.CreateAdvancedSource(ctx, AdvancedSourceRequest{OperationID: "create", SourceID: "source", Mode: AdvancedModeOrderedCards, BlockIDs: []string{"a", "b"}, CreatedAt: 100})
	if err != nil {
		t.Fatal(err)
	}
	var source CardSource
	if err = decodeStrictJSON(created.SourceRevision.Payload, &source); err != nil {
		t.Fatal(err)
	}
	var config OrderedGenerationConfig
	if err = decodeStrictJSON(source.GenerationConfig, &config); err != nil {
		t.Fatal(err)
	}
	request := ReorderAdvancedSourceRequest{OperationID: "not-reorder", SourceID: source.ID, ExpectedRevisionID: created.SourceRevision.RevisionID, OrderedStepIDs: []string{config.Steps[1].ID, config.Steps[0].ID}, UpdatedAt: 200}
	config.Steps[0].DisplayOrder, config.Steps[1].DisplayOrder = 1, 0
	source.GenerationConfig, _ = CanonicalJSON(config)
	source.Priority = "exam"
	payload, _ := CanonicalJSON(source)
	if _, err = store.MutateEntities(ctx, request.OperationID, []EntityMutation{{EntityType: EntityCardSource, EntityID: source.ID, ExpectedRevisionID: request.ExpectedRevisionID, UpdatedAt: request.UpdatedAt, Payload: payload}}); err != nil {
		t.Fatal(err)
	}
	if _, err = store.ReorderAdvancedSource(ctx, request); !errors.Is(err, ErrOperationConflict) {
		t.Fatal("unrelated operation replay accepted", err)
	}
	// 即使其他字段不变，只更新源、遗漏卡片变体的操作也不是完整排序。
	current, _, _ := store.projection.CurrentEntity(ctx, EntityCardSource, source.ID)
	request.OperationID = "source-only"
	request.ExpectedRevisionID = current.RevisionID
	request.UpdatedAt++
	request.OrderedStepIDs = []string{config.Steps[0].ID, config.Steps[1].ID}
	config.Steps[0].DisplayOrder, config.Steps[1].DisplayOrder = 0, 1
	source.GenerationConfig, _ = CanonicalJSON(config)
	payload, _ = CanonicalJSON(source)
	if _, err = store.MutateEntities(ctx, request.OperationID, []EntityMutation{{EntityType: EntityCardSource, EntityID: source.ID, ExpectedRevisionID: request.ExpectedRevisionID, UpdatedAt: request.UpdatedAt, Payload: payload}}); err != nil {
		t.Fatal(err)
	}
	if _, err = store.ReorderAdvancedSource(ctx, request); !errors.Is(err, ErrOperationConflict) {
		t.Fatal("source-only operation replay accepted", err)
	}
}

func TestReorderAdvancedSourceRejectsInconsistentCardsBeforeWrite(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	applyGenerationEntities(t, ctx, store, "preset", 1, testSchedulerPreset(legacyPresetID, false, false))
	created, err := store.CreateAdvancedSource(ctx, AdvancedSourceRequest{OperationID: "create", SourceID: "source", Mode: AdvancedModeOrderedSingle, BlockIDs: []string{"a", "b"}, CreatedAt: 100})
	if err != nil {
		t.Fatal(err)
	}
	var source CardSource
	if err = decodeStrictJSON(created.SourceRevision.Payload, &source); err != nil {
		t.Fatal(err)
	}
	var config OrderedGenerationConfig
	if err = decodeStrictJSON(source.GenerationConfig, &config); err != nil {
		t.Fatal(err)
	}
	request := ReorderAdvancedSourceRequest{OperationID: "reorder", SourceID: source.ID, ExpectedRevisionID: created.SourceRevision.RevisionID, OrderedStepIDs: []string{config.Steps[1].ID, config.Steps[0].ID}, UpdatedAt: 200}
	config.Steps[0].DisplayOrder, config.Steps[1].DisplayOrder = 1, 0
	source.GenerationConfig, _ = CanonicalJSON(config)
	templates, _ := advancedTemplates()
	var variants []GeneratedVariant
	for _, template := range templates {
		if template.ID == advancedOrderedSingleTemplateID {
			variants, err = EnumerateCardVariants(source, template)
		}
	}
	if err != nil {
		t.Fatal(err)
	}
	revision, _, _ := store.projection.CurrentEntity(ctx, EntityCard, created.Cards.Created[0])
	var card Card
	if err = decodeStrictJSON(revision.Payload, &card); err != nil {
		t.Fatal(err)
	}
	card.VariantData = variants[0].Data
	payload, _ := CanonicalJSON(card)
	if _, err = store.MutateEntities(ctx, "inconsistent", []EntityMutation{{EntityType: EntityCard, EntityID: card.ID, ExpectedRevisionID: revision.RevisionID, UpdatedAt: 150, Payload: payload}}); err != nil {
		t.Fatal(err)
	}
	before, _, _ := store.projection.CurrentEntity(ctx, EntityCard, card.ID)
	if _, err = store.ReorderAdvancedSource(ctx, request); err == nil {
		t.Fatal("inconsistent card accepted")
	}
	after, _, _ := store.projection.CurrentEntity(ctx, EntityCard, card.ID)
	currentSource, _, _ := store.projection.CurrentEntity(ctx, EntityCardSource, source.ID)
	if !reflect.DeepEqual(before, after) || !reflect.DeepEqual(currentSource, created.SourceRevision) {
		t.Fatal("failed reorder changed state")
	}
	if _, found, err := store.findAppliedOperation(ctx, request.OperationID); err != nil || found {
		t.Fatal("failed reorder was committed", err)
	}
}

func TestReorderAdvancedSourcePreservesIdentityStateReferencesAndRetry(t *testing.T) {
	for _, mode := range []string{AdvancedModeOrderedSingle, AdvancedModeOrderedCards} {
		for _, inline := range []bool{false, true} {
			name := mode + "/blocks"
			if inline {
				name = mode + "/inline"
			}
			t.Run(name, func(t *testing.T) {
				ctx := context.Background()
				store := newGenerationTestStore(t, ctx)
				defer store.Close()
				now := int64(1786431600000)
				applyGenerationEntities(t, ctx, store, "preset", now, testSchedulerPreset(legacyPresetID, false, false))
				input := AdvancedSourceRequest{OperationID: "create", SourceID: "source", Mode: mode, BlockIDs: []string{"a", "b"}, CreatedAt: now + 1}
				if inline {
					input.InlineOcclusions = []AdvancedInlineOcclusion{{ID: "mark-a", BlockID: "a", DisplayOrder: 0}, {ID: "mark-b", BlockID: "b", DisplayOrder: 1}}
				}
				created, err := store.CreateAdvancedSource(ctx, input)
				if err != nil {
					t.Fatal(err)
				}
				var source CardSource
				if err = decodeStrictJSON(created.SourceRevision.Payload, &source); err != nil {
					t.Fatal(err)
				}
				var config OrderedGenerationConfig
				if err = decodeStrictJSON(source.GenerationConfig, &config); err != nil {
					t.Fatal(err)
				}
				refs, err := store.projection.CardSourceReferences(ctx, source.ID)
				if err != nil {
					t.Fatal(err)
				}
				states := map[string]EntityRevision{}
				history := map[string][]Event{}
				before := map[string]Card{}
				for _, id := range created.Cards.Created {
					if _, err = store.ReviewCard(ctx, ReviewRequest{OperationID: "review-" + id, CardID: id, Rating: ReviewGood, ReviewedAt: now + 1000, ReviewMode: "normal"}); err != nil {
						t.Fatal(err)
					}
					state, _, readErr := store.projection.CurrentEntity(ctx, EntityReviewState, id)
					if readErr != nil {
						t.Fatal(readErr)
					}
					states[id] = state
					history[id], err = store.projection.CardHistory(ctx, id, 100, 0)
					if err != nil {
						t.Fatal(err)
					}
					revision, _, _ := store.projection.CurrentEntity(ctx, EntityCard, id)
					var card Card
					if err = decodeStrictJSON(revision.Payload, &card); err != nil {
						t.Fatal(err)
					}
					card.GenerationStatus = GenerationDisabledByTemplate
					card.Flag = 3
					card.EditLater = &CardEditLater{Note: "keep", UpdatedAt: now + 1100}
					payload, _ := CanonicalJSON(card)
					if _, err = store.MutateEntities(ctx, "metadata-"+id, []EntityMutation{{EntityType: EntityCard, EntityID: id, ExpectedRevisionID: revision.RevisionID, UpdatedAt: now + 1100, Payload: payload}}); err != nil {
						t.Fatal(err)
					}
					before[id] = card
				}
				request := ReorderAdvancedSourceRequest{SourceID: source.ID, ExpectedRevisionID: created.SourceRevision.RevisionID, OrderedStepIDs: []string{config.Steps[1].ID, config.Steps[0].ID}, OperationID: "reorder", UpdatedAt: now + 2000}
				result, err := store.ReorderAdvancedSource(ctx, request)
				if err != nil {
					t.Fatal(err)
				}
				var after CardSource
				if err = decodeStrictJSON(result.SourceRevision.Payload, &after); err != nil {
					t.Fatal(err)
				}
				after.GenerationConfig = source.GenerationConfig
				if !reflect.DeepEqual(source, after) {
					t.Fatal("source metadata or primary reference changed")
				}
				afterRefs, _ := store.projection.CardSourceReferences(ctx, source.ID)
				if !reflect.DeepEqual(refs, afterRefs) {
					t.Fatal("references changed")
				}
				for id, card := range before {
					revision, _, _ := store.projection.CurrentEntity(ctx, EntityCard, id)
					var next Card
					if err = decodeStrictJSON(revision.Payload, &next); err != nil {
						t.Fatal(err)
					}
					next.VariantData = card.VariantData
					next.UpdatedAt = card.UpdatedAt
					if !reflect.DeepEqual(card, next) {
						t.Fatal("card metadata or identity changed")
					}
					state, _, _ := store.projection.CurrentEntity(ctx, EntityReviewState, id)
					if !reflect.DeepEqual(state, states[id]) {
						t.Fatal("review state changed")
					}
					events, _ := store.projection.CardHistory(ctx, id, 100, 0)
					if !reflect.DeepEqual(events, history[id]) {
						t.Fatal("history changed")
					}
				}
				retried, err := store.ReorderAdvancedSource(ctx, request)
				if err != nil || !reflect.DeepEqual(result, retried) {
					t.Fatal("retry changed result", err)
				}
				bad := request
				bad.OrderedStepIDs = []string{config.Steps[0].ID, config.Steps[1].ID}
				if _, err = store.ReorderAdvancedSource(ctx, bad); !errors.Is(err, ErrOperationConflict) {
					t.Fatal("changed retry accepted", err)
				}
				bad = request
				bad.UpdatedAt++
				if _, err = store.ReorderAdvancedSource(ctx, bad); !errors.Is(err, ErrOperationConflict) {
					t.Fatal("changed retry time accepted", err)
				}
				bad = request
				bad.ExpectedRevisionID = "other"
				if _, err = store.ReorderAdvancedSource(ctx, bad); !errors.Is(err, ErrOperationConflict) {
					t.Fatal("changed retry parent accepted", err)
				}
				bad = request
				bad.OperationID = "stale"
				if _, err = store.ReorderAdvancedSource(ctx, bad); !errors.Is(err, ErrRevisionConflict) {
					t.Fatal("stale source accepted", err)
				}
				for _, ids := range [][]string{{config.Steps[0].ID}, {config.Steps[0].ID, config.Steps[0].ID}, {config.Steps[0].ID, "unknown"}} {
					bad = request
					bad.OperationID = "invalid"
					bad.ExpectedRevisionID = result.SourceRevision.RevisionID
					bad.OrderedStepIDs = ids
					if _, err = store.ReorderAdvancedSource(ctx, bad); err == nil {
						t.Fatal("invalid permutation accepted")
					}
				}
				// 后续操作不会改变旧请求的重放结果。
				nextRequest := request
				nextRequest.OperationID = "second"
				nextRequest.ExpectedRevisionID = result.SourceRevision.RevisionID
				nextRequest.UpdatedAt++
				nextRequest.OrderedStepIDs = []string{config.Steps[0].ID, config.Steps[1].ID}
				if _, err = store.ReorderAdvancedSource(ctx, nextRequest); err != nil {
					t.Fatal(err)
				}
				retried, err = store.ReorderAdvancedSource(ctx, request)
				if err != nil || !reflect.DeepEqual(result, retried) {
					t.Fatal("late retry changed result", err)
				}
			})
		}
	}
}
