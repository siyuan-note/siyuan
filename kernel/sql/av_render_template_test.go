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

package sql

import (
	"testing"

	"github.com/siyuan-note/siyuan/kernel/av"
)

func TestFillAttributeViewRenderTemplatePreservesStoredValue(t *testing.T) {
	const itemID = "20260828000000-item001"
	for _, layoutType := range []av.LayoutType{av.LayoutTypeTable, av.LayoutTypeGallery, av.LayoutTypeKanban} {
		t.Run(string(layoutType), func(t *testing.T) {
			blockKey := av.NewKey("block", "Block", "", av.KeyTypeBlock)
			numberKey := av.NewKey("progress", "Progress", "", av.KeyTypeNumber)
			numberKey.RenderTemplate = "<strong>.action{.Progress}%</strong>"
			blockValue := &av.Value{
				ID: itemID + "-block", KeyID: blockKey.ID, BlockID: itemID, Type: av.KeyTypeBlock, IsDetached: true,
				Block: &av.ValueBlock{Content: "Task"},
			}
			numberValue := &av.Value{
				ID: itemID + "-number", KeyID: numberKey.ID, BlockID: itemID, Type: av.KeyTypeNumber,
				Number: &av.ValueNumber{Content: 42, IsNotEmpty: true},
			}
			attrView := &av.AttributeView{
				ID: "attribute-view",
				KeyValues: []*av.KeyValues{
					{Key: blockKey, Values: []*av.Value{blockValue}},
					{Key: numberKey, Values: []*av.Value{numberValue}},
				},
			}
			collection := newRenderTemplateTestCollection(layoutType, itemID, blockValue, numberValue)

			fillAttributeViewTemplateValues(attrView, &av.View{ID: "view"}, collection, nil,
				NewAttributeViewRenderContext())

			actual := collection.GetValue(itemID, numberKey.ID)
			if actual != numberValue {
				t.Fatal("rendering replaced the stored value")
			}
			if av.KeyTypeNumber != actual.Type || nil == actual.Number || 42 != actual.Number.Content ||
				!actual.Number.IsNotEmpty {
				t.Fatalf("rendering changed the stored number: %+v", actual)
			}
			if "<strong>42%</strong>" != actual.RenderedContent {
				t.Fatalf("unexpected rendered content: %q", actual.RenderedContent)
			}
		})
	}
}

func TestFillAttributeViewRenderTemplateClearsStaleResult(t *testing.T) {
	const itemID = "20260828000000-item001"
	blockKey := av.NewKey("block", "Block", "", av.KeyTypeBlock)
	textKey := av.NewKey("text", "Text", "", av.KeyTypeText)
	blockValue := &av.Value{
		ID: itemID + "-block", KeyID: blockKey.ID, BlockID: itemID, Type: av.KeyTypeBlock, IsDetached: true,
		Block: &av.ValueBlock{Content: "Task"},
	}
	textValue := &av.Value{
		ID: itemID + "-text", KeyID: textKey.ID, BlockID: itemID, Type: av.KeyTypeText,
		Text: &av.ValueText{Content: "stored"}, RenderedContent: "stale",
	}
	attrView := &av.AttributeView{KeyValues: []*av.KeyValues{
		{Key: blockKey, Values: []*av.Value{blockValue}},
		{Key: textKey, Values: []*av.Value{textValue}},
	}}
	collection := newRenderTemplateTestCollection(av.LayoutTypeTable, itemID, blockValue, textValue)

	fillAttributeViewTemplateValues(attrView, &av.View{ID: "view"}, collection, nil,
		NewAttributeViewRenderContext())

	if "" != textValue.RenderedContent {
		t.Fatalf("stale rendered content was not cleared: %q", textValue.RenderedContent)
	}
}

func TestFillAttributeViewRenderTemplatesCannotReadOtherRenderedResults(t *testing.T) {
	const itemID = "20260828000000-item001"
	blockKey := av.NewKey("block", "Block", "", av.KeyTypeBlock)
	firstKey := av.NewKey("first", "First", "", av.KeyTypeText)
	firstKey.RenderTemplate = "first rendered"
	secondKey := av.NewKey("second", "Second", "", av.KeyTypeText)
	secondKey.RenderTemplate = ".action{.First_raw.RenderedContent}"
	blockValue := &av.Value{
		ID: itemID + "-block", KeyID: blockKey.ID, BlockID: itemID, Type: av.KeyTypeBlock, IsDetached: true,
		Block: &av.ValueBlock{Content: "Task"},
	}
	firstValue := &av.Value{
		ID: itemID + "-first", KeyID: firstKey.ID, BlockID: itemID, Type: av.KeyTypeText,
		Text: &av.ValueText{Content: "first stored"},
	}
	secondValue := &av.Value{
		ID: itemID + "-second", KeyID: secondKey.ID, BlockID: itemID, Type: av.KeyTypeText,
		Text: &av.ValueText{Content: "second stored"},
	}
	attrView := &av.AttributeView{KeyValues: []*av.KeyValues{
		{Key: blockKey, Values: []*av.Value{blockValue}},
		{Key: firstKey, Values: []*av.Value{firstValue}},
		{Key: secondKey, Values: []*av.Value{secondValue}},
	}}
	collection := newRenderTemplateTestCollection(av.LayoutTypeTable, itemID, blockValue, firstValue, secondValue)

	fillAttributeViewTemplateValues(attrView, &av.View{ID: "view"}, collection, nil,
		NewAttributeViewRenderContext())

	if "first rendered" != firstValue.RenderedContent {
		t.Fatalf("unexpected first rendered content: %q", firstValue.RenderedContent)
	}
	if "" != secondValue.RenderedContent {
		t.Fatalf("display templates should only see stored raw values: %q", secondValue.RenderedContent)
	}
}

func TestGetTemplateKeyRelevantKeysByIDMod(t *testing.T) {
	secretKey := av.NewKey("secret", "Secret", "", av.KeyTypeRelation)
	visibleKey := av.NewKey("visible", "Visible", "", av.KeyTypeText)
	attrView := &av.AttributeView{KeyValues: []*av.KeyValues{{Key: secretKey}, {Key: visibleKey}}}

	for _, templateContent := range []string{
		`.action{index .id_mod "secret"}`,
		`.action{index .id_mod_raw "secret"}`,
	} {
		visibleKey.RenderTemplate = templateContent
		dependencies := GetTemplateKeyRelevantKeys(attrView, visibleKey)
		if 1 != len(dependencies) || secretKey.ID != dependencies[0].ID {
			t.Fatalf("unexpected dependencies for %q: %+v", templateContent, dependencies)
		}
	}

	visibleKey.RenderTemplate = `.action{index .id_mod (printf "%s" "secret")}`
	dependencies := GetTemplateKeyRelevantKeys(attrView, visibleKey)
	if 2 != len(dependencies) {
		t.Fatalf("dynamic ID lookup should conservatively depend on every field: %+v", dependencies)
	}
}

func newRenderTemplateTestCollection(layoutType av.LayoutType, itemID string, values ...*av.Value) av.Collection {
	switch layoutType {
	case av.LayoutTypeTable:
		row := &av.TableRow{ID: itemID}
		for _, value := range values {
			row.Cells = append(row.Cells, &av.TableCell{BaseValue: &av.BaseValue{
				ID: value.ID, Value: value, ValueType: value.Type,
			}})
		}
		return &av.Table{Rows: []*av.TableRow{row}}
	case av.LayoutTypeGallery:
		card := &av.GalleryCard{ID: itemID}
		for _, value := range values {
			card.Values = append(card.Values, &av.GalleryFieldValue{BaseValue: &av.BaseValue{
				ID: value.ID, Value: value, ValueType: value.Type,
			}})
		}
		return &av.Gallery{Cards: []*av.GalleryCard{card}}
	default:
		card := &av.KanbanCard{ID: itemID}
		for _, value := range values {
			card.Values = append(card.Values, &av.KanbanFieldValue{BaseValue: &av.BaseValue{
				ID: value.ID, Value: value, ValueType: value.Type,
			}})
		}
		return &av.Kanban{Cards: []*av.KanbanCard{card}}
	}
}
