// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package flashcard

import (
	"context"
	"reflect"
	"testing"
)

func TestAdvancedOrderedUpdateIdentityScheduleHistoryAndPrimaryBoundary(t *testing.T) {
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
				var beforeSource CardSource
				if err = decodeStrictJSON(created.SourceRevision.Payload, &beforeSource); err != nil {
					t.Fatal(err)
				}
				var beforeConfig OrderedGenerationConfig
				if err = decodeStrictJSON(beforeSource.GenerationConfig, &beforeConfig); err != nil {
					t.Fatal(err)
				}
				states := map[string]EntityRevision{}
				history := map[string][]Event{}
				for _, id := range created.Cards.Created {
					if _, err = store.ReviewCard(ctx, ReviewRequest{OperationID: "review-" + id, CardID: id, Rating: ReviewGood, ReviewedAt: now + 1000, ReviewMode: "normal"}); err != nil {
						t.Fatal(err)
					}
					state, found, readErr := store.Projection().CurrentEntity(ctx, EntityReviewState, id)
					if readErr != nil || !found {
						t.Fatal("missing state", readErr)
					}
					states[id] = state
					history[id], err = store.Projection().CardHistory(ctx, id, 100, 0)
					if err != nil || len(history[id]) != 1 {
						t.Fatal("missing review history", err)
					}
				}
				request := AdvancedSourceUpdateRequest{OperationID: "reorder", SourceID: input.SourceID, ExpectedRevision: created.SourceRevision.RevisionID, Mode: mode, BlockIDs: []string{"b", "a"}, UpdatedAt: now + 2000}
				if inline {
					request.BlockIDs = []string{"a", "b"}
					request.InlineOcclusions = []AdvancedInlineOcclusion{{ID: "mark-a", BlockID: "a", DisplayOrder: 1}, {ID: "mark-b", BlockID: "b", DisplayOrder: 0}}
				}
				updated, err := store.UpdateAdvancedSource(ctx, request)
				if err != nil {
					t.Fatal(err)
				}
				if len(updated.Cards.Created) != 0 {
					t.Fatal("reorder created cards")
				}
				var afterSource CardSource
				if err = decodeStrictJSON(updated.SourceRevision.Payload, &afterSource); err != nil {
					t.Fatal(err)
				}
				var afterConfig OrderedGenerationConfig
				if err = decodeStrictJSON(afterSource.GenerationConfig, &afterConfig); err != nil {
					t.Fatal(err)
				}
				steps := map[string]OrderedStep{}
				for _, step := range beforeConfig.Steps {
					steps[step.ID] = step
				}
				for _, step := range afterConfig.Steps {
					previous, ok := steps[step.ID]
					if !ok || step.DisplayOrder != 1-previous.DisplayOrder {
						t.Fatal("step identity/order changed unexpectedly")
					}
					step.DisplayOrder = previous.DisplayOrder
					if !reflect.DeepEqual(step, previous) {
						t.Fatal("step semantics changed")
					}
				}
				for id, state := range states {
					next, found, readErr := store.Projection().CurrentEntity(ctx, EntityReviewState, id)
					if readErr != nil || !found || !reflect.DeepEqual(state, next) {
						t.Fatal("schedule changed", readErr)
					}
					events, readErr := store.Projection().CardHistory(ctx, id, 100, 0)
					if readErr != nil || !reflect.DeepEqual(events, history[id]) {
						t.Fatal("history changed", readErr)
					}
					model, readErr := store.Projection().CardRenderModel(ctx, id)
					if readErr != nil || model.Card.GenerationStatus != GenerationActive {
						t.Fatal("card identity lost", readErr)
					}
				}
				// 块重排会改变主引用；这记录现有边界，不代表允许界面悄然改变原文定位。
				if (beforeSource.PrimaryRefID == afterSource.PrimaryRefID) != inline {
					t.Fatal("unexpected primary reference behavior")
				}
				retried, err := store.UpdateAdvancedSource(ctx, request)
				if err != nil || retried.SourceRevision.RevisionID != updated.SourceRevision.RevisionID {
					t.Fatal("retry changed revision", err)
				}
			})
		}
	}
}
