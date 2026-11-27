// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package flashcard

import (
	"bytes"
	"context"
	"reflect"
	"testing"
)

func TestAdvancedDraftGenerationIsReadOnlyAndMatchesPersistedVariants(t *testing.T) {
	for _, mode := range []string{AdvancedModeCloze, AdvancedModeOrderedSingle, AdvancedModeOrderedCards,
		AdvancedModeChoiceSingle, AdvancedModeChoiceMultiple, AdvancedModeMultiLineAll,
		AdvancedModeMultiLineSteps, AdvancedModeTypedAnswer} {
		t.Run(mode, func(t *testing.T) {
			ctx := context.Background()
			store := newGenerationTestStore(t, ctx)
			defer store.Close()
			applyGenerationEntities(t, ctx, store, "draft-preset", 1,
				testSchedulerPreset(legacyPresetID, false, false))
			request := AdvancedSourceRequest{OperationID: "save-draft", SourceID: "draft-source",
				Mode: mode, BlockIDs: []string{"question", "answer-a", "answer-b"}, CreatedAt: 100}
			if mode == AdvancedModeChoiceSingle || mode == AdvancedModeChoiceMultiple {
				request.CorrectOptionIndexes = []int{0}
			}
			beforeInput, err := CanonicalJSON(request)
			if err != nil {
				t.Fatal(err)
			}
			beforeEvents, err := store.Projection().EventCount(ctx)
			if err != nil {
				t.Fatal(err)
			}
			if err = request.validate(); err != nil {
				t.Fatal(err)
			}
			source, references, template, err := buildAdvancedSource(request)
			if err != nil {
				t.Fatal(err)
			}
			variants, err := EnumerateCardVariants(source, template)
			if err != nil {
				t.Fatal(err)
			}
			afterInput, err := CanonicalJSON(request)
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(beforeInput, afterInput) {
				t.Fatal("draft construction changed its input")
			}
			afterEvents, err := store.Projection().EventCount(ctx)
			if err != nil || beforeEvents != afterEvents {
				t.Fatalf("draft changed events: %d %d %v", beforeEvents, afterEvents, err)
			}
			if _, found, err := store.Projection().CurrentEntity(ctx, EntityCardSource, request.SourceID); err != nil || found {
				t.Fatalf("draft persisted its source: found=%v err=%v", found, err)
			}
			repeated, repeatedRefs, repeatedTemplate, err := buildAdvancedSource(request)
			if err != nil || !reflect.DeepEqual(source, repeated) || !reflect.DeepEqual(references, repeatedRefs) ||
				!reflect.DeepEqual(template, repeatedTemplate) {
				t.Fatalf("draft construction is unstable: %v", err)
			}
			saved, err := store.CreateAdvancedSource(ctx, request)
			if err != nil {
				t.Fatal(err)
			}
			if len(saved.Cards.Created) != len(variants) {
				t.Fatalf("draft/save count mismatch: %d %d", len(variants), len(saved.Cards.Created))
			}
			for _, id := range saved.Cards.Created {
				model, err := store.Projection().CardRenderModel(ctx, id)
				if err != nil {
					t.Fatal(err)
				}
				matched := false
				for _, variant := range variants {
					if model.Card.VariantKey == variant.Key && bytes.Equal(model.Card.VariantData, variant.Data) {
						matched = true
					}
				}
				if !matched {
					t.Fatalf("persisted variant absent from draft: %s", model.Card.VariantKey)
				}
			}
		})
	}
}
