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
	"path/filepath"
	"sort"
	"testing"
)

func TestBidirectionalCardsKeepIndependentStateAcrossTemplateDisable(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	schemaID := "schema-qa"
	sourceID := "source-qa"
	forwardID := "template-forward"
	reverseID := "template-reverse"
	applyGenerationEntities(t, ctx, store, "setup-qa", 100,
		testGenerationSchema(schemaID, []string{forwardID, reverseID}),
		testGenerationTemplate(forwardID, schemaID, GenerationStatic, "forward", true),
		testGenerationTemplate(reverseID, schemaID, GenerationStatic, "reverse", true),
		testGenerationSource(sourceID, schemaID, "qa", json.RawMessage(`{}`)))
	result, err := store.ReconcileSourceCards(ctx, "reconcile-qa", sourceID, 110)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Created) != 2 || result.Batch == nil {
		t.Fatalf("unexpected bidirectional reconcile result: %+v", result)
	}
	retried, err := store.ReconcileSourceCards(ctx, "reconcile-qa", sourceID, 110)
	if err != nil || retried.Batch == nil || retried.Batch.BatchID != result.Batch.BatchID || len(retried.Created) != 2 {
		t.Fatalf("idempotent reconcile retry changed its result: result=%+v err=%v", retried, err)
	}
	if _, err = store.ReconcileSourceCards(ctx, "reconcile-qa", sourceID, 111); err == nil {
		t.Fatal("conflicting reconcile retry was not rejected")
	}
	forwardCardID := GeneratedCardID(sourceID, forwardID, "forward")
	reverseCardID := GeneratedCardID(sourceID, reverseID, "reverse")
	setReviewStateForTest(t, ctx, store, "review-reverse", reverseCardID, 120, 500, 7)
	assertReviewStateForTest(t, ctx, store, forwardCardID, 110, 0)
	assertReviewStateForTest(t, ctx, store, reverseCardID, 500, 7)

	disabledRevision := updateTemplateEnabledForTest(t, ctx, store, "disable-reverse", reverseID, false, 130)
	result, err = store.ReconcileSourceCards(ctx, "reconcile-disabled", sourceID, 131)
	if err != nil {
		t.Fatal(err)
	}
	if cardStatusForTest(t, ctx, store, reverseCardID) != GenerationDisabledByTemplate {
		t.Fatal("reverse card was not disabled with its template")
	}
	assertReviewStateForTest(t, ctx, store, reverseCardID, 500, 7)

	updateTemplateFromRevisionForTest(t, ctx, store, "enable-reverse", disabledRevision, true, 140)
	result, err = store.ReconcileSourceCards(ctx, "reconcile-enabled", sourceID, 141)
	if err != nil {
		t.Fatal(err)
	}
	if cardStatusForTest(t, ctx, store, reverseCardID) != GenerationActive {
		t.Fatal("reverse card was not restored with its original identity")
	}
	assertReviewStateForTest(t, ctx, store, reverseCardID, 500, 7)
	if result.Batch == nil || containsString(result.Created, reverseCardID) {
		t.Fatalf("re-enabled card was recreated instead of restored: %+v", result)
	}
}

func TestOrphanedSourceCardsRestoreIdentityAndReviewState(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	const (
		schemaID   = "schema-orphan"
		templateID = "template-orphan"
		sourceID   = "source-orphan"
	)
	applyGenerationEntities(t, ctx, store, "setup-orphan", 100,
		testGenerationSchema(schemaID, []string{templateID}),
		testGenerationTemplate(templateID, schemaID, GenerationStatic, "forward", true),
		testGenerationSource(sourceID, schemaID, "qa", json.RawMessage(`{}`)))
	if _, err := store.ReconcileSourceCards(ctx, "reconcile-orphan-active", sourceID, 110); err != nil {
		t.Fatal(err)
	}
	cardID := GeneratedCardID(sourceID, templateID, "forward")
	setReviewStateForTest(t, ctx, store, "review-before-orphan", cardID, 120, 500, 7)

	setSourceStatusForTest(t, ctx, store, "mark-source-orphaned", sourceID, "orphaned", 130)
	result, err := store.ReconcileSourceCards(ctx, "reconcile-orphaned", sourceID, 131)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Updated) != 1 || result.Updated[0] != cardID ||
		cardStatusForTest(t, ctx, store, cardID) != GenerationOrphaned {
		t.Fatalf("source loss did not orphan its existing card: %+v", result)
	}
	assertReviewStateForTest(t, ctx, store, cardID, 500, 7)

	setSourceStatusForTest(t, ctx, store, "restore-source-active", sourceID, "active", 140)
	result, err = store.ReconcileSourceCards(ctx, "reconcile-orphan-restored", sourceID, 141)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Created) != 0 || len(result.Updated) != 1 || result.Updated[0] != cardID ||
		cardStatusForTest(t, ctx, store, cardID) != GenerationActive {
		t.Fatalf("restored source did not reactivate the same card: %+v", result)
	}
	assertReviewStateForTest(t, ctx, store, cardID, 500, 7)
}

func TestImportedVariantsAreFilteredByTemplateAndKeepExternalIdentity(t *testing.T) {
	config := ImportedGenerationConfig{Variants: []ImportedVariant{
		{TemplateID: "template-front", Key: "anki-card:20", Data: json.RawMessage(`{"ord":0}`)},
		{TemplateID: "template-reverse", Key: "anki-card:21", Data: json.RawMessage(`{"ord":1}`)},
		{TemplateID: "template-front", Key: "anki-card:22", Data: json.RawMessage(`{"ord":0}`)},
	}}
	source := CardSource{ID: "source-imported", SchemaID: "schema-imported", SourceType: "anki",
		PrimaryRefID: "ref-imported", GenerationConfig: mustRawJSON(t, config), Status: "active"}
	template := testGenerationTemplate("template-front", "schema-imported", GenerationImported, "", true)
	variants, err := EnumerateCardVariants(source, template)
	if err != nil {
		t.Fatal(err)
	}
	if len(variants) != 2 || variants[0].Key != "anki-card:20" || variants[1].Key != "anki-card:22" {
		t.Fatalf("imported variants were not filtered and sorted by stable identity: %+v", variants)
	}
}

func TestClozeGroupReorderingKeepsCardIdentityAndSupportsMultiGroupMembership(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	schemaID := "schema-cloze"
	templateID := "template-cloze"
	sourceID := "source-cloze"
	config := ClozeGenerationConfig{
		Occlusions: []ClozeOcclusion{
			{ID: "occlusion-1", GroupIDs: []string{"group-a", "group-b"}, DisplayOrder: 0},
			{ID: "occlusion-2", GroupIDs: []string{"group-a"}, DisplayOrder: 1},
			{ID: "occlusion-3", GroupIDs: []string{"group-b"}, DisplayOrder: 2},
		},
		Groups: []ClozeGroup{{ID: "group-a", DisplayOrder: 0}, {ID: "group-b", DisplayOrder: 1}},
	}
	applyGenerationEntities(t, ctx, store, "setup-cloze", 100,
		testGenerationSchema(schemaID, []string{templateID}),
		testGenerationTemplate(templateID, schemaID, GenerationClozeGroups, "", true),
		testGenerationSource(sourceID, schemaID, "cloze", mustRawJSON(t, config)))
	result, err := store.ReconcileSourceCards(ctx, "reconcile-cloze", sourceID, 110)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Created) != 2 {
		t.Fatalf("expected two cloze group cards, got %+v", result)
	}
	cardA := GeneratedCardID(sourceID, templateID, "group:group-a")
	cardB := GeneratedCardID(sourceID, templateID, "group:group-b")
	setReviewStateForTest(t, ctx, store, "review-cloze-a", cardA, 120, 600, 4)

	config.Groups[0].DisplayOrder = 1
	config.Groups[1].DisplayOrder = 0
	config.Occlusions[0].DisplayOrder = 2
	config.Occlusions[2].DisplayOrder = 0
	updateSourceConfigForTest(t, ctx, store, "reorder-cloze", sourceID, mustRawJSON(t, config), 130)
	result, err = store.ReconcileSourceCards(ctx, "reconcile-cloze-reordered", sourceID, 131)
	if err != nil {
		t.Fatal(err)
	}
	sort.Strings(result.Unchanged)
	if result.Batch != nil || len(result.Unchanged) != 2 || result.Unchanged[0] != minString(cardA, cardB) ||
		result.Unchanged[1] != maxString(cardA, cardB) {
		t.Fatalf("cloze reordering changed generated identities: %+v", result)
	}
	assertReviewStateForTest(t, ctx, store, cardA, 600, 4)
}

func TestOrderedSingleAndProgressiveCardsKeepStepIdentityAfterReordering(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	schemaID := "schema-ordered"
	singleTemplateID := "template-ordered-single"
	cardTemplateID := "template-ordered-cards"
	sourceID := "source-ordered"
	config := OrderedGenerationConfig{Steps: []OrderedStep{
		{ID: "step-a", DisplayOrder: 0, OcclusionIDs: []string{"occlusion-a"}},
		{ID: "step-b", DisplayOrder: 1, OcclusionIDs: []string{"occlusion-b"}},
	}}
	applyGenerationEntities(t, ctx, store, "setup-ordered", 100,
		testGenerationSchema(schemaID, []string{singleTemplateID, cardTemplateID}),
		testGenerationTemplate(singleTemplateID, schemaID, GenerationOrderedSingle, "sequence", true),
		testGenerationTemplate(cardTemplateID, schemaID, GenerationOrderedCards, "", true),
		testGenerationSource(sourceID, schemaID, "ordered", mustRawJSON(t, config)))
	result, err := store.ReconcileSourceCards(ctx, "reconcile-ordered", sourceID, 110)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Created) != 3 {
		t.Fatalf("expected one sequence card and two progressive cards, got %+v", result)
	}
	singleCardID := GeneratedCardID(sourceID, singleTemplateID, "sequence")
	stepACardID := GeneratedCardID(sourceID, cardTemplateID, "step:step-a")
	stepBCardID := GeneratedCardID(sourceID, cardTemplateID, "step:step-b")
	setReviewStateForTest(t, ctx, store, "review-step-a", stepACardID, 120, 700, 6)

	config.Steps[0].DisplayOrder = 1
	config.Steps[1].DisplayOrder = 0
	updateSourceConfigForTest(t, ctx, store, "reorder-ordered", sourceID, mustRawJSON(t, config), 130)
	result, err = store.ReconcileSourceCards(ctx, "reconcile-ordered-reordered", sourceID, 131)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Created) != 0 || len(result.Updated) != 3 {
		t.Fatalf("ordered reordering did not preserve card identities: %+v", result)
	}
	for _, cardID := range []string{singleCardID, stepACardID, stepBCardID} {
		if cardStatusForTest(t, ctx, store, cardID) != GenerationActive {
			t.Fatalf("ordered card [%s] is not active", cardID)
		}
	}
	assertReviewStateForTest(t, ctx, store, stepACardID, 700, 6)

	config.Steps = append(config.Steps,
		OrderedStep{ID: "step-c", DisplayOrder: 2, OcclusionIDs: []string{"occlusion-c"}})
	updateSourceConfigForTest(t, ctx, store, "add-ordered-step", sourceID, mustRawJSON(t, config), 140)
	result, err = store.ReconcileSourceCards(ctx, "reconcile-ordered-added", sourceID, 141)
	if err != nil {
		t.Fatal(err)
	}
	stepCCardID := GeneratedCardID(sourceID, cardTemplateID, "step:step-c")
	if len(result.Created) != 1 || result.Created[0] != stepCCardID {
		t.Fatalf("new ordered step did not create exactly one card: %+v", result)
	}
	assertReviewStateForTest(t, ctx, store, stepCCardID, 141, 0)
}

func TestImageOcclusionValidationAndStableGroupVariants(t *testing.T) {
	config := ImageOcclusionConfig{
		AssetID: "assets/image.png",
		Shapes: []ImageOcclusionShape{
			{ID: "shape-a", Type: "rectangle", X: 0.1, Y: 0.2, Width: 0.2, Height: 0.1},
			{ID: "shape-b", Type: "polygon", Points: []ImageOcclusionPoint{{X: 0, Y: 0}, {X: 0.2, Y: 0},
				{X: 0.1, Y: 0.2}}},
		},
		Groups:    []ImageOcclusionGroup{{ID: "group-a", ShapeIDs: []string{"shape-a", "shape-b"}}},
		FrontMode: "hideAllAnswerOne",
	}
	source := testGenerationSource("source-image", "schema-image", "image-occlusion", mustRawJSON(t, config))
	template := testGenerationTemplate("template-image", "schema-image", GenerationImageGroups, "", true)
	variants, err := EnumerateCardVariants(source, template)
	if err != nil {
		t.Fatal(err)
	}
	if len(variants) != 1 || variants[0].Key != "group:group-a" {
		t.Fatalf("unexpected image occlusion variants: %+v", variants)
	}
	config.Shapes[0].Width = 2
	source.GenerationConfig = mustRawJSON(t, config)
	if _, err = EnumerateCardVariants(source, template); err == nil {
		t.Fatal("out-of-bounds image occlusion shape was accepted")
	}
}

func newGenerationTestStore(t *testing.T, ctx context.Context) *Store {
	t.Helper()
	workspace := t.TempDir()
	store, err := OpenStore(ctx, filepath.Join(workspace, "v2"), filepath.Join(workspace, "temp", "flashcards.db"),
		"device-a", &JournalOptions{WriterID: testWriterA})
	if err != nil {
		t.Fatal(err)
	}
	return store
}

func applyGenerationEntities(t *testing.T, ctx context.Context, store *Store, operationID string, updatedAt int64,
	values ...any) {
	t.Helper()
	var changes []Change
	for _, value := range values {
		var entityType EntityType
		var entityID string
		switch typed := value.(type) {
		case CardSchema:
			entityType, entityID = EntityCardSchema, typed.ID
		case CardTemplate:
			entityType, entityID = EntityCardTemplate, typed.ID
		case CardSource:
			entityType, entityID = EntityCardSource, typed.ID
			ref := CardSourceRef{
				ID: typed.PrimaryRefID, SourceID: typed.ID, EntityType: "block", EntityID: "block-" + typed.ID,
				Role: "content", Required: true,
			}
			refRevision, err := NewOperationEntityRevision(operationID, EntityCardSourceRef, ref.ID, nil, updatedAt,
				false, ref)
			if err != nil {
				t.Fatal(err)
			}
			changes = append(changes, Change{Kind: RecordEntityRevision, Revision: &refRevision})
		case SchedulerPreset:
			entityType, entityID = EntitySchedulerPreset, typed.ID
		default:
			t.Fatalf("unsupported generation test entity %T", value)
		}
		revision, err := NewOperationEntityRevision(operationID, entityType, entityID, nil, updatedAt, false, value)
		if err != nil {
			t.Fatal(err)
		}
		changes = append(changes, Change{Kind: RecordEntityRevision, Revision: &revision})
	}
	if _, err := store.Apply(ctx, operationID, changes); err != nil {
		t.Fatal(err)
	}
}

func setSourceStatusForTest(t *testing.T, ctx context.Context, store *Store, operationID, sourceID, status string,
	updatedAt int64) {
	t.Helper()
	revision, found, err := store.Projection().CurrentEntity(ctx, EntityCardSource, sourceID)
	if err != nil || !found {
		t.Fatalf("source was not found: found=%v err=%v", found, err)
	}
	var source CardSource
	if err = decodeStrictJSON(revision.Payload, &source); err != nil {
		t.Fatal(err)
	}
	source.Status = status
	payload := mustRawJSON(t, source)
	if _, err = store.MutateEntities(ctx, operationID, []EntityMutation{{EntityType: EntityCardSource,
		EntityID: sourceID, ExpectedRevisionID: revision.RevisionID, UpdatedAt: updatedAt, Payload: payload}}); err != nil {
		t.Fatal(err)
	}
}

func testGenerationSchema(id string, templateIDs []string) CardSchema {
	return CardSchema{
		ID: id, Name: id,
		Fields:      []CardSchemaField{{ID: "field-content", Name: "Content", Type: "block", Required: true}},
		TemplateIDs: append([]string(nil), templateIDs...),
		CreatedAt:   100,
		UpdatedAt:   100,
	}
}

func testGenerationTemplate(id, schemaID, mode, variantKey string, enabled bool) CardTemplate {
	rule := GenerationRule{Mode: mode, VariantKey: variantKey}
	return CardTemplate{
		ID: id, SchemaID: schemaID, Name: id, GenerationRule: mustRawJSONNoTest(rule),
		FrontSpec: json.RawMessage(`{"type":"field"}`), BackSpec: json.RawMessage(`{"type":"field"}`),
		AnswerMode: "reveal", Enabled: enabled,
	}
}

func testGenerationSource(id, schemaID, sourceType string, config json.RawMessage) CardSource {
	return CardSource{
		ID: id, SchemaID: schemaID, SourceType: sourceType, PrimaryRefID: "ref-" + id,
		GenerationConfig: config, Status: "active",
	}
}

func updateTemplateEnabledForTest(t *testing.T, ctx context.Context, store *Store, operationID, templateID string,
	enabled bool, updatedAt int64) EntityRevision {
	t.Helper()
	current, found, err := store.Projection().CurrentEntity(ctx, EntityCardTemplate, templateID)
	if err != nil || !found {
		t.Fatalf("template was not found: found=%v err=%v", found, err)
	}
	return updateTemplateFromRevisionForTest(t, ctx, store, operationID, current, enabled, updatedAt)
}

func updateTemplateFromRevisionForTest(t *testing.T, ctx context.Context, store *Store, operationID string,
	current EntityRevision, enabled bool, updatedAt int64) EntityRevision {
	t.Helper()
	var template CardTemplate
	if err := decodeStrictJSON(current.Payload, &template); err != nil {
		t.Fatal(err)
	}
	template.Enabled = enabled
	revision, err := NewOperationEntityRevision(operationID, EntityCardTemplate, template.ID,
		[]string{current.RevisionID}, updatedAt, false, template)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = store.Apply(ctx, operationID, []Change{{Kind: RecordEntityRevision, Revision: &revision}}); err != nil {
		t.Fatal(err)
	}
	return revision
}

func updateSourceConfigForTest(t *testing.T, ctx context.Context, store *Store, operationID, sourceID string,
	config json.RawMessage, updatedAt int64) {
	t.Helper()
	current, found, err := store.Projection().CurrentEntity(ctx, EntityCardSource, sourceID)
	if err != nil || !found {
		t.Fatalf("source was not found: found=%v err=%v", found, err)
	}
	var source CardSource
	if err = decodeStrictJSON(current.Payload, &source); err != nil {
		t.Fatal(err)
	}
	source.GenerationConfig = config
	revision, err := NewOperationEntityRevision(operationID, EntityCardSource, source.ID,
		[]string{current.RevisionID}, updatedAt, false, source)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = store.Apply(ctx, operationID, []Change{{Kind: RecordEntityRevision, Revision: &revision}}); err != nil {
		t.Fatal(err)
	}
}

func setReviewStateForTest(t *testing.T, ctx context.Context, store *Store, operationID, cardID string, updatedAt,
	due int64, reps uint64) {
	t.Helper()
	current, found, err := store.Projection().CurrentEntity(ctx, EntityReviewState, cardID)
	if err != nil || !found {
		t.Fatalf("review state was not found: found=%v err=%v", found, err)
	}
	var state ReviewState
	if err = decodeStrictJSON(current.Payload, &state); err != nil {
		t.Fatal(err)
	}
	state.State = "review"
	state.Due = due
	state.LastReview = updatedAt
	state.Stability = 3
	state.Difficulty = 5
	state.Reps = reps
	state.StateRevisionID = OperationRevisionID(operationID, EntityReviewState, cardID)
	revision, err := NewOperationEntityRevision(operationID, EntityReviewState, cardID,
		[]string{current.RevisionID}, updatedAt, false, state)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = store.Apply(ctx, operationID, []Change{{Kind: RecordEntityRevision, Revision: &revision}}); err != nil {
		t.Fatal(err)
	}
}

func assertReviewStateForTest(t *testing.T, ctx context.Context, store *Store, cardID string, due int64, reps uint64) {
	t.Helper()
	current, found, err := store.Projection().CurrentEntity(ctx, EntityReviewState, cardID)
	if err != nil || !found {
		t.Fatalf("review state was not found: found=%v err=%v", found, err)
	}
	var state ReviewState
	if err = decodeStrictJSON(current.Payload, &state); err != nil {
		t.Fatal(err)
	}
	if state.Due != due || state.Reps != reps {
		t.Fatalf("unexpected review state for card [%s]: %+v", cardID, state)
	}
}

func cardStatusForTest(t *testing.T, ctx context.Context, store *Store, cardID string) GenerationStatus {
	t.Helper()
	current, found, err := store.Projection().CurrentEntity(ctx, EntityCard, cardID)
	if err != nil || !found {
		t.Fatalf("card was not found: found=%v err=%v", found, err)
	}
	var card Card
	if err = decodeStrictJSON(current.Payload, &card); err != nil {
		t.Fatal(err)
	}
	return card.GenerationStatus
}

func mustRawJSON(t *testing.T, value any) json.RawMessage {
	t.Helper()
	return mustCanonicalJSON(t, value)
}

func mustRawJSONNoTest(value any) json.RawMessage {
	data, err := CanonicalJSON(value)
	if err != nil {
		panic(err)
	}
	return data
}

func containsString(values []string, expected string) bool {
	for _, value := range values {
		if value == expected {
			return true
		}
	}
	return false
}

func minString(first, second string) string {
	if first < second {
		return first
	}
	return second
}

func maxString(first, second string) string {
	if first > second {
		return first
	}
	return second
}
