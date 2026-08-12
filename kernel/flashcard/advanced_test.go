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
	"strings"
	"testing"
)

func TestCreateAdvancedSourceSupportsClozeAndOrderedMultiBlankModes(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	applyGenerationEntities(t, ctx, store, "advanced-preset", 1,
		testSchedulerPreset(legacyPresetID, false, false))
	reviewSet := ReviewSet{ID: "advanced-set", Name: "Advanced", NewLimit: 20, ReviewLimit: 200,
		DefaultReviewMode: "normal"}
	reviewSetRevision, err := NewOperationEntityRevision("advanced-set", EntityReviewSet, reviewSet.ID, nil, 2,
		false, reviewSet)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = store.Apply(ctx, "advanced-set",
		[]Change{{Kind: RecordEntityRevision, Revision: &reviewSetRevision}}); err != nil {
		t.Fatal(err)
	}

	tests := []struct {
		mode      string
		sourceID  string
		wantCards int
	}{
		{AdvancedModeCloze, "advanced-cloze", 3},
		{AdvancedModeOrderedSingle, "advanced-ordered-single", 1},
		{AdvancedModeOrderedCards, "advanced-ordered-cards", 3},
	}
	for index, test := range tests {
		request := AdvancedSourceRequest{OperationID: "create-" + test.sourceID, SourceID: test.sourceID,
			Mode: test.mode, BlockIDs: []string{"block-a", "block-b", "block-c"},
			ReviewSetIDs: []string{reviewSet.ID}, CreatedAt: int64(10 + index)}
		result, createErr := store.CreateAdvancedSource(ctx, request)
		if createErr != nil {
			t.Fatalf("create %s: %v", test.mode, createErr)
		}
		if result.SourceRevision.EntityID != test.sourceID || len(result.Cards.Created) != test.wantCards ||
			len(result.Memberships) != test.wantCards || result.Cards.Batch == nil ||
			result.Cards.Batch.OperationID != request.OperationID {
			t.Fatalf("unexpected %s source result: %+v", test.mode, result)
		}
		references, referenceErr := store.Projection().CardSourceReferences(ctx, test.sourceID)
		if referenceErr != nil || len(references) != 3 {
			t.Fatalf("unexpected %s references: references=%+v err=%v", test.mode, references, referenceErr)
		}
		for referenceIndex, reference := range references {
			wantOcclusionID := DeterministicID("advanced-occlusion", test.sourceID,
				request.BlockIDs[referenceIndex])
			if reference.Sort != referenceIndex || reference.Role != "occlusion:"+wantOcclusionID {
				t.Fatalf("%s reference lost stable order or identity: %+v", test.mode, reference)
			}
		}
		retry, retryErr := store.CreateAdvancedSource(ctx, request)
		if retryErr != nil || retry.SourceRevision.RevisionID != result.SourceRevision.RevisionID ||
			retry.Cards.Batch.BatchID != result.Cards.Batch.BatchID {
			t.Fatalf("%s retry was not idempotent: result=%+v err=%v", test.mode, retry, retryErr)
		}
	}
}

func TestCreateAdvancedSourcePersistsOrderedStepIdentityAndOrder(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	applyGenerationEntities(t, ctx, store, "advanced-step-preset", 1,
		testSchedulerPreset(legacyPresetID, false, false))
	request := AdvancedSourceRequest{OperationID: "advanced-step-source", SourceID: "source-steps",
		Mode: AdvancedModeOrderedSingle, BlockIDs: []string{"block-second", "block-first"}, CreatedAt: 10}
	result, err := store.CreateAdvancedSource(ctx, request)
	if err != nil {
		t.Fatal(err)
	}
	cardRevision, found, err := store.Projection().CurrentEntity(ctx, EntityCard, result.Cards.Created[0])
	if err != nil || !found {
		t.Fatalf("ordered card was not found: found=%v err=%v", found, err)
	}
	var card Card
	if err = decodeStrictJSON(cardRevision.Payload, &card); err != nil {
		t.Fatal(err)
	}
	var variant struct {
		Mode    string   `json:"mode"`
		StepIDs []string `json:"stepIDs"`
	}
	if err = decodeStrictJSON(card.VariantData, &variant); err != nil {
		t.Fatal(err)
	}
	want := []string{
		DeterministicID("advanced-ordered-step", request.SourceID, "block-second"),
		DeterministicID("advanced-ordered-step", request.SourceID, "block-first"),
	}
	if variant.Mode != "single" || !equalStrings(variant.StepIDs, want) {
		t.Fatalf("ordered card did not preserve the requested step order: %+v", variant)
	}
}

func TestUpdateAdvancedSourcePreservesStableCardSchedule(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	applyGenerationEntities(t, ctx, store, "advanced-update-preset", 1,
		testSchedulerPreset(legacyPresetID, false, false))
	created, err := store.CreateAdvancedSource(ctx, AdvancedSourceRequest{OperationID: "advanced-update-create",
		SourceID: "source-update", Mode: AdvancedModeOrderedSingle,
		BlockIDs: []string{"block-first", "block-second"}, CreatedAt: 10})
	if err != nil {
		t.Fatal(err)
	}
	cardID := created.Cards.Created[0]
	stateRevision, found, err := store.Projection().CurrentEntity(ctx, EntityReviewState, cardID)
	if err != nil || !found {
		t.Fatalf("created review state was not found: found=%v err=%v", found, err)
	}
	var state ReviewState
	if err = decodeStrictJSON(stateRevision.Payload, &state); err != nil {
		t.Fatal(err)
	}
	state.Due = 999
	state.StateRevisionID = OperationRevisionID("advanced-update-schedule", EntityReviewState, cardID)
	statePayload, err := CanonicalJSON(state)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = store.MutateEntities(ctx, "advanced-update-schedule", []EntityMutation{{
		EntityType: EntityReviewState, EntityID: cardID, ExpectedRevisionID: stateRevision.RevisionID,
		UpdatedAt: 15, Payload: statePayload,
	}}); err != nil {
		t.Fatal(err)
	}
	request := AdvancedSourceUpdateRequest{OperationID: "advanced-update-config", SourceID: "source-update",
		ExpectedRevision: created.SourceRevision.RevisionID, Mode: AdvancedModeOrderedSingle,
		BlockIDs: []string{"block-second", "block-first"}, UpdatedAt: 20}
	updated, err := store.UpdateAdvancedSource(ctx, request)
	if err != nil {
		t.Fatal(err)
	}
	if len(updated.Cards.Created) != 0 || !equalStrings(updated.Cards.Updated, []string{cardID}) {
		t.Fatalf("advanced source update replaced its stable card: %+v", updated.Cards)
	}
	stateRevision, found, err = store.Projection().CurrentEntity(ctx, EntityReviewState, cardID)
	if err != nil || !found || decodeStrictJSON(stateRevision.Payload, &state) != nil || state.Due != 999 {
		t.Fatalf("advanced source update changed the review schedule: state=%+v found=%v err=%v", state, found, err)
	}
	references, err := store.Projection().CardSourceReferences(ctx, request.SourceID)
	if err != nil || len(references) != 2 || references[0].EntityID != "block-second" ||
		references[1].EntityID != "block-first" {
		t.Fatalf("advanced source references were not reordered: references=%+v err=%v", references, err)
	}
	retried, err := store.UpdateAdvancedSource(ctx, request)
	if err != nil || retried.SourceRevision.RevisionID != updated.SourceRevision.RevisionID ||
		retried.Cards.Batch.BatchID != updated.Cards.Batch.BatchID {
		t.Fatalf("advanced source update retry was not idempotent: result=%+v err=%v", retried, err)
	}
}

func TestUpdateAdvancedSourceAssignsNewCardsToOriginalReviewSets(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	applyGenerationEntities(t, ctx, store, "advanced-membership-preset", 1,
		testSchedulerPreset(legacyPresetID, false, false))
	reviewSets := []ReviewSet{
		{ID: "advanced-membership-set", Name: "Advanced", NewLimit: 20, ReviewLimit: 200,
			DefaultReviewMode: "normal"},
		{ID: "manual-membership-set", Name: "Manual", NewLimit: 20, ReviewLimit: 200,
			DefaultReviewMode: "normal"},
	}
	changes := make([]Change, 0, len(reviewSets))
	for _, reviewSet := range reviewSets {
		revision, err := NewOperationEntityRevision("advanced-membership-sets", EntityReviewSet, reviewSet.ID, nil,
			2, false, reviewSet)
		if err != nil {
			t.Fatal(err)
		}
		changes = append(changes, Change{Kind: RecordEntityRevision, Revision: &revision})
	}
	if _, err := store.Apply(ctx, "advanced-membership-sets", changes); err != nil {
		t.Fatal(err)
	}
	const sourceID = "source-membership-update"
	created, err := store.CreateAdvancedSource(ctx, AdvancedSourceRequest{
		OperationID: "advanced-membership-create", SourceID: sourceID, Mode: AdvancedModeOrderedCards,
		BlockIDs: []string{"block-first"}, ReviewSetIDs: []string{reviewSets[0].ID}, CreatedAt: 10,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = store.SetReviewSetMemberships(ctx, SetReviewSetMembershipsRequest{
		OperationID: "advanced-membership-manual", ReviewSetID: reviewSets[1].ID,
		CardIDs: created.Cards.Created, Mode: MembershipInclude, ChangedAt: 15,
	}); err != nil {
		t.Fatal(err)
	}
	updated, err := store.UpdateAdvancedSource(ctx, AdvancedSourceUpdateRequest{
		OperationID: "advanced-membership-update", SourceID: sourceID,
		ExpectedRevision: created.SourceRevision.RevisionID, Mode: AdvancedModeOrderedCards,
		BlockIDs: []string{"block-first", "block-second"}, UpdatedAt: 20,
	})
	if err != nil {
		t.Fatal(err)
	}
	stepID := DeterministicID("advanced-ordered-step", sourceID, "block-second")
	newCardID := GeneratedCardID(sourceID, advancedOrderedCardsTemplateID, "step:"+stepID)
	wantMembershipID := DeterministicID("advanced-review-set-membership", reviewSets[0].ID, newCardID)
	if !containsString(updated.Cards.Created, newCardID) || !equalStrings(updated.Memberships,
		[]string{wantMembershipID}) {
		t.Fatalf("new advanced card did not inherit its original review set: %+v", updated)
	}
	options := CardSearchOptions{Now: 100, IncludeSuspended: true, IncludeBuried: true, IncludePaused: true}
	automaticCardIDs, err := store.Projection().ReviewSetCardIDs(ctx, reviewSets[0].ID, options)
	if err != nil || !containsString(automaticCardIDs, newCardID) {
		t.Fatalf("new advanced card was not projected into its original review set: cards=%v err=%v",
			automaticCardIDs, err)
	}
	manualCardIDs, err := store.Projection().ReviewSetCardIDs(ctx, reviewSets[1].ID, options)
	if err != nil || containsString(manualCardIDs, newCardID) {
		t.Fatalf("new advanced card inherited a manual membership: cards=%v err=%v", manualCardIDs, err)
	}
	retried, err := store.UpdateAdvancedSource(ctx, AdvancedSourceUpdateRequest{
		OperationID: "advanced-membership-update", SourceID: sourceID,
		ExpectedRevision: created.SourceRevision.RevisionID, Mode: AdvancedModeOrderedCards,
		BlockIDs: []string{"block-first", "block-second"}, UpdatedAt: 20,
	})
	if err != nil || !equalStrings(retried.Memberships, []string{wantMembershipID}) ||
		retried.Cards.Batch.BatchID != updated.Cards.Batch.BatchID {
		t.Fatalf("advanced membership update retry was not idempotent: result=%+v err=%v", retried, err)
	}
}

func TestUpdateAdvancedSourceReactivatesRemovedVariantWithItsSchedule(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	applyGenerationEntities(t, ctx, store, "advanced-reactivate-preset", 1,
		testSchedulerPreset(legacyPresetID, false, false))
	const sourceID = "source-reactivate"
	created, err := store.CreateAdvancedSource(ctx, AdvancedSourceRequest{OperationID: "advanced-reactivate-create",
		SourceID: sourceID, Mode: AdvancedModeOrderedCards,
		BlockIDs: []string{"block-first", "block-second"}, CreatedAt: 10})
	if err != nil {
		t.Fatal(err)
	}
	stepID := DeterministicID("advanced-ordered-step", sourceID, "block-second")
	cardID := GeneratedCardID(sourceID, advancedOrderedCardsTemplateID, "step:"+stepID)
	if _, err = store.ManageCards(ctx, CardManagementRequest{OperationID: "advanced-reactivate-schedule",
		CardIDs: []string{cardID}, Action: CardActionSetDue, ChangedAt: 15, Due: 999}); err != nil {
		t.Fatal(err)
	}
	removed, err := store.UpdateAdvancedSource(ctx, AdvancedSourceUpdateRequest{
		OperationID: "advanced-reactivate-remove", SourceID: sourceID,
		ExpectedRevision: created.SourceRevision.RevisionID, Mode: AdvancedModeOrderedCards,
		BlockIDs: []string{"block-first"}, UpdatedAt: 20,
	})
	if err != nil {
		t.Fatal(err)
	}
	cardRevision, found, err := store.Projection().CurrentEntity(ctx, EntityCard, cardID)
	if err != nil || !found {
		t.Fatalf("removed variant was not retained: found=%v err=%v", found, err)
	}
	var card Card
	if err = decodeStrictJSON(cardRevision.Payload, &card); err != nil || card.GenerationStatus != GenerationDeleted {
		t.Fatalf("removed variant did not become inactive: card=%+v err=%v", card, err)
	}
	restored, err := store.UpdateAdvancedSource(ctx, AdvancedSourceUpdateRequest{
		OperationID: "advanced-reactivate-restore", SourceID: sourceID,
		ExpectedRevision: removed.SourceRevision.RevisionID, Mode: AdvancedModeOrderedCards,
		BlockIDs: []string{"block-first", "block-second"}, UpdatedAt: 30,
	})
	if err != nil {
		t.Fatal(err)
	}
	if !containsString(restored.Cards.Updated, cardID) {
		t.Fatalf("restored variant did not reuse its stable card: %+v", restored.Cards)
	}
	assertReviewStateForTest(t, ctx, store, cardID, 999, 0)
}

func TestCreateAdvancedSourceSupportsMultipleOcclusionsPerGroupAndMultipleGroupsPerOcclusion(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	applyGenerationEntities(t, ctx, store, "advanced-group-preset", 1,
		testSchedulerPreset(legacyPresetID, false, false))
	request := AdvancedSourceRequest{OperationID: "advanced-custom-groups", SourceID: "source-custom-groups",
		Mode: AdvancedModeCloze, BlockIDs: []string{"block-a", "block-b", "block-c"}, CreatedAt: 10,
		ClozeGroups: []AdvancedClozeGroup{
			{ID: "group-second", DisplayOrder: 1, BlockIDs: []string{"block-b", "block-c"}},
			{ID: "group-first", DisplayOrder: 0, BlockIDs: []string{"block-a", "block-b"}},
		}}
	result, err := store.CreateAdvancedSource(ctx, request)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Cards.Created) != 2 {
		t.Fatalf("custom cloze groups generated %d cards", len(result.Cards.Created))
	}
	var source CardSource
	if err = decodeStrictJSON(result.SourceRevision.Payload, &source); err != nil {
		t.Fatal(err)
	}
	var config ClozeGenerationConfig
	if err = decodeStrictJSON(source.GenerationConfig, &config); err != nil {
		t.Fatal(err)
	}
	if len(config.Groups) != 2 || config.Groups[0].ID != "group-second" || config.Groups[0].DisplayOrder != 1 ||
		len(config.Occlusions) != 3 || !equalStrings(config.Occlusions[1].GroupIDs,
		[]string{"group-second", "group-first"}) {
		t.Fatalf("custom cloze grouping was not preserved: %+v", config)
	}
}

func TestCreateAdvancedSourceSupportsMultipleInlineOcclusionsInOneBlock(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	applyGenerationEntities(t, ctx, store, "advanced-inline-preset", 1,
		testSchedulerPreset(legacyPresetID, false, false))
	request := AdvancedSourceRequest{OperationID: "advanced-inline", SourceID: "source-inline",
		Mode: AdvancedModeCloze, BlockIDs: []string{"block-a"}, CreatedAt: 10,
		InlineOcclusions: []AdvancedInlineOcclusion{
			{ID: "occlusion-first", BlockID: "block-a", DisplayOrder: 0},
			{ID: "occlusion-second", BlockID: "block-a", DisplayOrder: 1},
		},
		ClozeGroups: []AdvancedClozeGroup{
			{ID: "group-first", DisplayOrder: 0, OcclusionIDs: []string{"occlusion-first", "occlusion-second"}},
			{ID: "group-second", DisplayOrder: 1, OcclusionIDs: []string{"occlusion-second"}},
		}}
	result, err := store.CreateAdvancedSource(ctx, request)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Cards.Created) != 2 {
		t.Fatalf("inline cloze groups generated %d cards", len(result.Cards.Created))
	}
	references, err := store.Projection().CardSourceReferences(ctx, request.SourceID)
	if err != nil || len(references) != 1 || references[0].Role != "content" {
		t.Fatalf("inline cloze source did not keep one content reference: refs=%+v err=%v", references, err)
	}
	var source CardSource
	if err = decodeStrictJSON(result.SourceRevision.Payload, &source); err != nil {
		t.Fatal(err)
	}
	var config ClozeGenerationConfig
	if err = decodeStrictJSON(source.GenerationConfig, &config); err != nil {
		t.Fatal(err)
	}
	if len(config.Occlusions) != 2 || config.Occlusions[0].ID != "occlusion-first" ||
		!equalStrings(config.Occlusions[1].GroupIDs, []string{"group-first", "group-second"}) {
		t.Fatalf("inline cloze configuration was not preserved: %+v", config)
	}
}

func TestCreateAdvancedSourceRejectsUngroupedClozeBlock(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	request := AdvancedSourceRequest{OperationID: "advanced-incomplete-groups", SourceID: "source-incomplete-groups",
		Mode: AdvancedModeCloze, BlockIDs: []string{"block-a", "block-b"}, CreatedAt: 10,
		ClozeGroups: []AdvancedClozeGroup{{ID: "group-a", BlockIDs: []string{"block-a"}}}}
	if _, err := store.CreateAdvancedSource(ctx, request); err == nil {
		t.Fatal("cloze source with an ungrouped block was accepted")
	}
}

func TestCreateAdvancedSourceRejectsInvalidReviewSetWithoutPartialSource(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	applyGenerationEntities(t, ctx, store, "advanced-invalid-preset", 1,
		testSchedulerPreset(legacyPresetID, false, false))
	request := AdvancedSourceRequest{OperationID: "advanced-invalid-source", SourceID: "source-invalid-advanced",
		Mode: AdvancedModeCloze, BlockIDs: []string{"block-a"}, ReviewSetIDs: []string{"missing"}, CreatedAt: 10}
	if _, err := store.CreateAdvancedSource(ctx, request); err == nil {
		t.Fatal("advanced source with a missing review set was accepted")
	}
	if revision, found, err := store.Projection().CurrentEntity(ctx, EntityCardSource, request.SourceID); err != nil ||
		found || len(revision.Payload) != 0 {
		t.Fatalf("rejected advanced source left partial data: revision=%+v found=%v err=%v", revision, found, err)
	}
	query := predicateQuery("sourceID", QueryEqual, json.RawMessage(`"`+request.SourceID+`"`))
	results, err := store.Projection().SearchCards(ctx, &query, CardSearchOptions{Now: 10, IncludeInactive: true,
		IncludeSuspended: true, IncludeBuried: true, IncludePaused: true})
	if err != nil || len(results) != 0 {
		t.Fatalf("rejected advanced source left cards: cards=%+v err=%v", results, err)
	}
}

func TestCreateAdvancedSourceSupportsImageOcclusionShapesAndGroups(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	applyGenerationEntities(t, ctx, store, "advanced-image-preset", 1,
		testSchedulerPreset(legacyPresetID, false, false))
	config := &ImageOcclusionConfig{AssetID: "assets/anatomy.png", FrontMode: "hideAllAnswerOne",
		Shapes: []ImageOcclusionShape{
			{ID: "rect", Type: "rectangle", X: 0.1, Y: 0.2, Width: 0.2, Height: 0.15},
			{ID: "ellipse", Type: "ellipse", X: 0.5, Y: 0.4, Width: 0.2, Height: 0.2},
			{ID: "polygon", Type: "polygon", Points: []ImageOcclusionPoint{
				{X: 0.2, Y: 0.7}, {X: 0.3, Y: 0.6}, {X: 0.4, Y: 0.8},
			}},
		},
		Groups: []ImageOcclusionGroup{
			{ID: "group-one", ShapeIDs: []string{"rect", "ellipse"}, DisplayOrder: 0},
			{ID: "group-two", ShapeIDs: []string{"polygon"}, DisplayOrder: 1},
		}}
	request := AdvancedSourceRequest{OperationID: "advanced-image-source", SourceID: "source-image-advanced",
		Mode: AdvancedModeImageOcclusion, BlockIDs: []string{"block-image"}, CreatedAt: 10,
		ImageConfig: config}
	result, err := store.CreateAdvancedSource(ctx, request)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Cards.Created) != 2 {
		t.Fatalf("image groups did not create stable cards: %+v", result.Cards)
	}
	sourceRevision, found, err := store.Projection().CurrentEntity(ctx, EntityCardSource, request.SourceID)
	if err != nil || !found {
		t.Fatalf("image source was not found: found=%v err=%v", found, err)
	}
	var source CardSource
	if err = decodeStrictJSON(sourceRevision.Payload, &source); err != nil {
		t.Fatal(err)
	}
	if source.SourceType != "image-occlusion" || source.SchemaID != advancedImageSchemaID {
		t.Fatalf("unexpected image source: %+v", source)
	}
	references, err := store.Projection().CardSourceReferences(ctx, source.ID)
	if err != nil || len(references) != 1 || references[0].EntityID != request.BlockIDs[0] ||
		references[0].Role != "image" {
		t.Fatalf("unexpected image reference: references=%+v err=%v", references, err)
	}
}

func TestCreateAdvancedSourceFreezesChoiceOptionOrderInSession(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	applyGenerationEntities(t, ctx, store, "advanced-choice-preset", 1,
		testSchedulerPreset(legacyPresetID, false, false))
	request := AdvancedSourceRequest{OperationID: "advanced-choice-source", SourceID: "source-choice-advanced",
		Mode: AdvancedModeChoiceMultiple, BlockIDs: []string{"question", "option-a", "option-b", "option-c"},
		CorrectOptionIndexes: []int{0, 2}, RandomizeOptions: true,
		DistractorQuery:    &QueryAST{Version: QueryVersion, Root: QueryExpression{Operator: QueryMatchAll}},
		DynamicDistractors: 2, CreatedAt: 10}
	result, err := store.CreateAdvancedSource(ctx, request)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Cards.Created) != 1 {
		t.Fatalf("choice source did not create one schedulable card: %+v", result.Cards)
	}
	sourceRevision, found, err := store.Projection().CurrentEntity(ctx, EntityCardSource, request.SourceID)
	if err != nil || !found {
		t.Fatalf("choice source was not found: found=%v err=%v", found, err)
	}
	var source CardSource
	if err = decodeStrictJSON(sourceRevision.Payload, &source); err != nil {
		t.Fatal(err)
	}
	var config ChoiceGenerationConfig
	if err = decodeStrictJSON(source.GenerationConfig, &config); err != nil {
		t.Fatal(err)
	}
	if config.Mode != "multiple" || len(config.Options) != 3 || len(config.CorrectOptionIDs) != 2 {
		t.Fatalf("unexpected choice configuration: %+v", config)
	}
	cardID := result.Cards.Created[0]
	for index, blockID := range []string{"dynamic-a", "dynamic-b"} {
		_, err = store.CreateBasicSource(ctx, BasicSourceRequest{OperationID: "dynamic-choice-candidate-" + blockID,
			SourceID: "dynamic-source-" + blockID, BlockIDs: []string{blockID, "answer-" + blockID},
			Direction: BasicDirectionForward, CreatedAt: int64(20 + index)})
		if err != nil {
			t.Fatal(err)
		}
	}
	if err = store.Projection().ReplaceBlockMetadataAndSourceAvailability(ctx, nil,
		map[string]bool{"dynamic-source-dynamic-a": false}); err != nil {
		t.Fatal(err)
	}
	session, err := store.StartStudySession(ctx, StudyQueueRequest{OperationID: "choice-session",
		SessionID: "choice-session", ReviewMode: "normal", Seed: "choice-seed", Now: 10,
		NewLimit: 20, ReviewLimit: 200})
	if err != nil {
		t.Fatal(err)
	}
	if len(session.SessionCards) != 1 {
		t.Fatalf("unexpected choice session cards: %+v", session.SessionCards)
	}
	var choiceSessionCard SessionCard
	for _, sessionCard := range session.SessionCards {
		if sessionCard.CardID == cardID {
			choiceSessionCard = sessionCard
		}
	}
	if len(choiceSessionCard.OptionOrder) != 4 || len(choiceSessionCard.DynamicOptions) != 1 {
		t.Fatalf("choice options and dynamic distractors were not frozen in the session: %+v", choiceSessionCard)
	}
	for _, option := range choiceSessionCard.DynamicOptions {
		if option.EntityType != "block" || option.EntityID != "dynamic-b" {
			t.Fatalf("unexpected dynamic choice option: %+v", option)
		}
	}
	plain := config
	plain.Randomize = false
	plain.DistractorQuery = nil
	plain.DynamicDistractorCount = 0
	plainOrder, err := ChoiceOptionOrder(plain, "ignored", cardID)
	if err != nil || !equalStrings(plainOrder, []string{config.Options[0].ID, config.Options[1].ID,
		config.Options[2].ID}) {
		t.Fatalf("non-random choice order changed display order: order=%+v err=%v", plainOrder, err)
	}
}

func TestCreateAdvancedMultiLineSource(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	applyGenerationEntities(t, ctx, store, "advanced-multi-line-preset", 1,
		testSchedulerPreset(legacyPresetID, false, false))
	request := AdvancedSourceRequest{OperationID: "advanced-multi-line-source",
		SourceID: "source-multi-line-advanced", Mode: AdvancedModeMultiLineSteps,
		BlockIDs: []string{"question", "answer-a", "answer-b"}, CreatedAt: 10}
	result, err := store.CreateAdvancedSource(ctx, request)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Cards.Created) != 1 {
		t.Fatalf("multi-line source did not create one schedulable card: %+v", result.Cards)
	}
	sourceRevision, found, err := store.Projection().CurrentEntity(ctx, EntityCardSource, request.SourceID)
	if err != nil || !found {
		t.Fatalf("multi-line source was not found: found=%v err=%v", found, err)
	}
	var source CardSource
	if err = decodeStrictJSON(sourceRevision.Payload, &source); err != nil {
		t.Fatal(err)
	}
	var config MultiLineGenerationConfig
	if err = decodeStrictJSON(source.GenerationConfig, &config); err != nil {
		t.Fatal(err)
	}
	if config.RevealMode != "steps" || len(config.Answers) != 2 {
		t.Fatalf("unexpected multi-line configuration: %+v", config)
	}
	references, err := store.Projection().CardSourceReferences(ctx, request.SourceID)
	if err != nil || len(references) != 3 || references[0].Role != "question" ||
		references[1].Role != "answer:"+config.Answers[0].ID ||
		references[2].Role != "answer:"+config.Answers[1].ID {
		t.Fatalf("unexpected multi-line references: references=%+v err=%v", references, err)
	}
}

func TestCreateAdvancedTypedAnswerSource(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	applyGenerationEntities(t, ctx, store, "advanced-typed-preset", 1,
		testSchedulerPreset(legacyPresetID, false, false))
	request := AdvancedSourceRequest{OperationID: "advanced-typed-source", SourceID: "source-typed-advanced",
		Mode: AdvancedModeTypedAnswer, BlockIDs: []string{"question", "answer-a", "answer-b"}, CreatedAt: 10,
		TypedConfig: &TypedAnswerConfig{IgnoreDiacritics: true, FuzzyMaxDistance: 2, TrimWhitespace: true,
			CollapseWhitespace: true}}
	result, err := store.CreateAdvancedSource(ctx, request)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Cards.Created) != 1 {
		t.Fatalf("typed answer source did not create one schedulable card: %+v", result.Cards)
	}
	var source CardSource
	if err = decodeStrictJSON(result.SourceRevision.Payload, &source); err != nil {
		t.Fatal(err)
	}
	if source.SourceType != "typed-answer" || source.SchemaID != advancedTypedSchemaID {
		t.Fatalf("unexpected typed answer source: %+v", source)
	}
	var config TypedAnswerConfig
	if err = decodeStrictJSON(source.GenerationConfig, &config); err != nil {
		t.Fatal(err)
	}
	if !config.IgnoreDiacritics || config.FuzzyMaxDistance != 2 || !config.TrimWhitespace ||
		!config.CollapseWhitespace {
		t.Fatalf("unexpected typed answer configuration: %+v", config)
	}
	references, err := store.Projection().CardSourceReferences(ctx, source.ID)
	if err != nil || len(references) != 3 || references[0].Role != "question" ||
		!strings.HasPrefix(references[1].Role, "answer:") || !strings.HasPrefix(references[2].Role, "answer:") {
		t.Fatalf("unexpected typed answer references: references=%+v err=%v", references, err)
	}
	templateRevision, found, err := store.Projection().CurrentEntity(ctx, EntityCardTemplate,
		advancedTypedTemplateID)
	if err != nil || !found {
		t.Fatalf("typed answer template was not found: found=%v err=%v", found, err)
	}
	var template CardTemplate
	if err = decodeStrictJSON(templateRevision.Payload, &template); err != nil {
		t.Fatal(err)
	}
	if template.AnswerMode != "typed" {
		t.Fatalf("typed answer template did not enable answer checking: %+v", template)
	}
}
