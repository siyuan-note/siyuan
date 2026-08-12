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

func TestCreateQuickSourcesDoesNotDependOnReviewSets(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	now := int64(1786431600000)
	setupLegacyCompatibilityBuiltins(t, ctx, store, now)
	request := QuickSourceRequest{OperationID: "quick-create", BlockIDs: []string{"block-b", "block-a", "block-a"},
		CreatedAt: now + 1}
	result, err := store.CreateQuickSources(ctx, request)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.SourceIDs) != 2 || len(result.CardIDs) != 2 || result.CardIDs[0] != LegacyQuickCardID("block-a") {
		t.Fatalf("unexpected quick source result: %+v", result)
	}
	var memberships int
	if err = store.projection.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM review_set_memberships`).Scan(&memberships); err != nil {
		t.Fatal(err)
	}
	if memberships != 0 {
		t.Fatalf("quick sources unexpectedly depend on review sets: %d", memberships)
	}
	cardID := result.CardIDs[0]
	if _, err = store.ManageCards(ctx, CardManagementRequest{OperationID: "quick-due", CardIDs: []string{cardID},
		Action: CardActionSetDue, ChangedAt: now + 2, Due: now + 86400000}); err != nil {
		t.Fatal(err)
	}
	request.OperationID = "quick-repeat"
	request.CreatedAt = now + 3
	if _, err = store.CreateQuickSources(ctx, request); err != nil {
		t.Fatal(err)
	}
	assertReviewStateForTest(t, ctx, store, cardID, now+86400000, 0)
	if reconciled, reconcileErr := store.ReconcileSourceCards(ctx, "quick-reconcile", result.SourceIDs[0], now+4); reconcileErr != nil || len(reconciled.Created) != 0 {
		t.Fatalf("quick source did not use the built-in stable variant: result=%+v err=%v", reconciled, reconcileErr)
	}
	deleted, err := store.ManageSourceLifecycle(ctx, SourceLifecycleRequest{OperationID: "quick-delete-source",
		SourceID: result.SourceIDs[0], Action: SourceActionDelete, ChangedAt: now + 5})
	if err != nil {
		t.Fatal(err)
	}
	request.OperationID = "quick-restore-source"
	request.BlockIDs = []string{"block-a"}
	request.CreatedAt = now + 6
	if _, err = store.CreateQuickSources(ctx, request); err != nil {
		t.Fatal(err)
	}
	restored, found, err := store.Projection().CurrentEntity(ctx, EntityCardSource, result.SourceIDs[0])
	if err != nil || !found || restored.RevisionID == deleted.SourceRevision.RevisionID {
		t.Fatalf("quick creation did not restore the deleted source: revision=%+v found=%v err=%v", restored, found, err)
	}
	var source CardSource
	if err = decodeStrictJSON(restored.Payload, &source); err != nil || source.Status != "active" {
		t.Fatalf("quick source was not restored to active: source=%+v err=%v", source, err)
	}
	assertReviewStateForTest(t, ctx, store, cardID, now+86400000, 0)
}

func TestToggleQuickSourcesRemovesAllActiveAndOtherwiseCreatesMissing(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	now := int64(1786431600000)
	setupLegacyCompatibilityBuiltins(t, ctx, store, now)
	created, err := store.ToggleQuickSources(ctx, QuickSourceRequest{OperationID: "quick-toggle-create",
		BlockIDs: []string{"block-a"}, CreatedAt: now + 1, Toggle: true})
	if err != nil || created.Action != QuickSourceActionCreated {
		t.Fatalf("quick toggle did not create a missing source: result=%+v err=%v", created, err)
	}
	if _, err = store.ManageCards(ctx, CardManagementRequest{OperationID: "quick-toggle-due",
		CardIDs: created.CardIDs, Action: CardActionSetDue, ChangedAt: now + 2, Due: now + 86400000}); err != nil {
		t.Fatal(err)
	}
	removed, err := store.ToggleQuickSources(ctx, QuickSourceRequest{OperationID: "quick-toggle-remove",
		BlockIDs: []string{"block-a"}, CreatedAt: now + 3, Toggle: true})
	if err != nil || removed.Action != QuickSourceActionRemoved {
		t.Fatalf("quick toggle did not remove an active source: result=%+v err=%v", removed, err)
	}
	sourceRevision, found, err := store.Projection().CurrentEntity(ctx, EntityCardSource, created.SourceIDs[0])
	if err != nil || !found {
		t.Fatalf("removed quick source was not retained: found=%v err=%v", found, err)
	}
	var source CardSource
	if err = decodeStrictJSON(sourceRevision.Payload, &source); err != nil || source.Status != "deleted" {
		t.Fatalf("quick source was not disabled: source=%+v err=%v", source, err)
	}
	restored, err := store.ToggleQuickSources(ctx, QuickSourceRequest{OperationID: "quick-toggle-restore",
		BlockIDs: []string{"block-a", "block-b"}, CreatedAt: now + 4, Toggle: true})
	if err != nil || restored.Action != QuickSourceActionCreated || len(restored.CardIDs) != 2 {
		t.Fatalf("mixed quick toggle did not restore and create sources: result=%+v err=%v", restored, err)
	}
	assertReviewStateForTest(t, ctx, store, created.CardIDs[0], now+86400000, 0)
}

func TestUpgradeBlockFlashcardModePreservesCardIdentityAndReviewState(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	now := int64(1786431600000)
	setupLegacyCompatibilityBuiltins(t, ctx, store, now)
	created, err := store.CreateQuickSources(ctx, QuickSourceRequest{OperationID: "block-upgrade-create",
		BlockIDs: []string{"block-upgrade"}, CreatedAt: now + 1})
	if err != nil {
		t.Fatal(err)
	}
	cardID := created.CardIDs[0]
	if _, err = store.ManageCards(ctx, CardManagementRequest{OperationID: "block-upgrade-due",
		CardIDs: []string{cardID}, Action: CardActionSetDue, ChangedAt: now + 2, Due: now + 86400000}); err != nil {
		t.Fatal(err)
	}
	schemaRevision, _, err := store.Projection().CurrentEntity(ctx, EntityCardSchema, legacyQuickSchemaID)
	if err != nil {
		t.Fatal(err)
	}
	var schema CardSchema
	if err = decodeStrictJSON(schemaRevision.Payload, &schema); err != nil {
		t.Fatal(err)
	}
	schema.Name = "Legacy Quick Card"
	schema.BuiltinType = "legacy-quick"
	templateRevision, _, err := store.Projection().CurrentEntity(ctx, EntityCardTemplate, legacyQuickTemplateID)
	if err != nil {
		t.Fatal(err)
	}
	var template CardTemplate
	if err = decodeStrictJSON(templateRevision.Payload, &template); err != nil {
		t.Fatal(err)
	}
	template.Name = "Legacy Quick Card"
	template.FrontSpec = []byte(`{"side":"front","type":"legacyQuick"}`)
	template.BackSpec = []byte(`{"side":"back","type":"legacyQuick"}`)
	template.AnswerMode = "reveal"
	template.ContextPolicy = []byte(`{"type":"legacy"}`)
	schemaPayload, _ := CanonicalJSON(schema)
	templatePayload, _ := CanonicalJSON(template)
	if _, err = store.MutateEntities(ctx, "block-upgrade-legacy-builtins", []EntityMutation{
		{EntityType: EntityCardSchema, EntityID: schema.ID, ExpectedRevisionID: schemaRevision.RevisionID,
			UpdatedAt: now + 3, Payload: schemaPayload},
		{EntityType: EntityCardTemplate, EntityID: template.ID, ExpectedRevisionID: templateRevision.RevisionID,
			UpdatedAt: now + 3, Payload: templatePayload},
	}); err != nil {
		t.Fatal(err)
	}
	upgraded, err := store.UpgradeBlockFlashcardMode(ctx)
	if err != nil || !upgraded {
		t.Fatalf("legacy quick mode was not upgraded: upgraded=%v err=%v", upgraded, err)
	}
	model, err := store.Projection().CardRenderModel(ctx, cardID)
	if err != nil {
		t.Fatal(err)
	}
	if model.Card.ID != cardID || model.Schema.BuiltinType != blockFlashcardType ||
		model.Template.AnswerMode != "auto" || model.Template.Name != blockFlashcardName {
		t.Fatalf("unexpected upgraded block flashcard model: %+v", model)
	}
	assertReviewStateForTest(t, ctx, store, cardID, now+86400000, 0)
	if upgraded, err = store.UpgradeBlockFlashcardMode(ctx); err != nil || upgraded {
		t.Fatalf("block flashcard upgrade was not idempotent: upgraded=%v err=%v", upgraded, err)
	}
}
