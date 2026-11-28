// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package flashcard

import (
	"context"
	"strings"
	"testing"
)

func TestCardRenderModelIncludesStableOrderedReferencesAndVariant(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	now := int64(1786431600000)
	setupLegacyCompatibilityBuiltins(t, ctx, store, now)
	if _, err := store.CreateLegacyReviewSet(ctx, "render-set", "render-deck", "Render", now, 20, 200); err != nil {
		t.Fatal(err)
	}
	if _, err := store.AddLegacyQuickCards(ctx, "render-card", "render-deck", []string{"render-block"},
		now+1); err != nil {
		t.Fatal(err)
	}
	model, err := store.Projection().CardRenderModel(ctx, LegacyQuickCardID("render-block"))
	if err != nil {
		t.Fatal(err)
	}
	if model.Card.VariantKey != "legacy-quick" || model.Source.SchemaID != LegacyQuickSchemaID() ||
		model.Template.ID != LegacyQuickTemplateID() || model.Schema.BuiltinType != blockFlashcardType ||
		model.Template.AnswerMode != "auto" ||
		len(model.References) != 1 || model.References[0].EntityID != "render-block" ||
		model.ReviewState.CardID != model.Card.ID {
		t.Fatalf("incomplete flashcard render model: %+v", model)
	}
}

func TestCardSourceReferencesUsesSourceLookupBeforeEntityLookup(t *testing.T) {
	ctx := context.Background()
	store := newGenerationTestStore(t, ctx)
	defer store.Close()
	rows, err := store.Projection().db.QueryContext(ctx, "EXPLAIN QUERY PLAN "+cardSourceReferencesSQL,
		EntityCardSourceRef, "source")
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var lookup []string
	for rows.Next() {
		var id, parent, unused int
		var detail string
		if err = rows.Scan(&id, &parent, &unused, &detail); err != nil {
			t.Fatal(err)
		}
		if strings.HasPrefix(detail, "SEARCH ") {
			lookup = append(lookup, detail)
		}
	}
	if err = rows.Err(); err != nil {
		t.Fatal(err)
	}
	if len(lookup) != 2 || !strings.Contains(lookup[0], "idx_card_source_refs_source") ||
		!strings.Contains(lookup[1], "entity_type=? AND entity_id=?") {
		t.Fatalf("unexpected reference lookup plan: %v", lookup)
	}
}
