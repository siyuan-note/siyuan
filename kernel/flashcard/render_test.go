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
