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

func TestFillAttributeViewKeyValuesSkipsMissingKey(t *testing.T) {
	const existingKeyID = "20260806000000-existing"
	attrView := &av.AttributeView{
		ID: "20260806000001-avtest1",
		KeyValues: []*av.KeyValues{{
			Key: &av.Key{ID: existingKeyID, Type: av.KeyTypeText},
		}},
	}
	table := &av.Table{Rows: []*av.TableRow{{
		ID: "20260806000002-item001",
		Cells: []*av.TableCell{{BaseValue: &av.BaseValue{Value: &av.Value{
			ID:      "20260806000003-value01",
			KeyID:   "20260806000004-missing",
			BlockID: "20260806000002-item001",
			Type:    av.KeyTypeText,
			Text:    &av.ValueText{Content: "source"},
		}}}},
	}}}

	fillAttributeViewKeyValues(attrView, table)
	if 0 != len(attrView.KeyValues[0].Values) {
		t.Fatalf("value for a missing key was added to the existing key: %+v", attrView.KeyValues[0].Values)
	}
}

func TestFillAttributeViewKeyValuesReplacesRenderedValues(t *testing.T) {
	const (
		itemID        = "20260825000000-item001"
		templateKeyID = "20260825000001-template"
		textKeyID     = "20260825000002-textkey1"
		valueID       = "20260825000003-value001"
		createdKeyID  = "20260825000006-created1"
		updatedKeyID  = "20260825000007-updated1"
	)
	staleTemplate := &av.Value{
		ID: valueID, KeyID: templateKeyID, BlockID: itemID, Type: av.KeyTypeTemplate,
		Template: &av.ValueTemplate{Content: ".action{old}"},
	}
	duplicateTemplate := staleTemplate.Clone()
	storedText := &av.Value{
		ID: "20260825000004-textval1", KeyID: textKeyID, BlockID: itemID, Type: av.KeyTypeText,
		Text: &av.ValueText{Content: "stored"},
	}
	attrView := &av.AttributeView{KeyValues: []*av.KeyValues{
		{Key: &av.Key{ID: templateKeyID, Type: av.KeyTypeTemplate}, Values: []*av.Value{staleTemplate, duplicateTemplate}},
		{Key: &av.Key{ID: createdKeyID, Type: av.KeyTypeCreated}, Values: []*av.Value{{
			ID: "20260825000008-createdv", KeyID: createdKeyID, BlockID: itemID, Type: av.KeyTypeCreated,
		}}},
		{Key: &av.Key{ID: updatedKeyID, Type: av.KeyTypeUpdated}, Values: []*av.Value{{
			ID: "20260825000009-updatedv", KeyID: updatedKeyID, BlockID: itemID, Type: av.KeyTypeUpdated,
		}}},
		{Key: &av.Key{ID: textKeyID, Type: av.KeyTypeText}, Values: []*av.Value{storedText}},
	}}
	renderedTemplate := &av.Value{
		ID: valueID, KeyID: templateKeyID, BlockID: itemID, Type: av.KeyTypeTemplate,
		Template: &av.ValueTemplate{Content: ".action{current}"},
	}
	renderedText := &av.Value{
		ID: storedText.ID, KeyID: textKeyID, BlockID: itemID, Type: av.KeyTypeText,
		Text: &av.ValueText{Content: "rendered"},
	}
	renderedCreated := &av.Value{
		ID: "20260825000008-createdv", KeyID: createdKeyID, BlockID: itemID, Type: av.KeyTypeCreated,
	}
	renderedUpdated := &av.Value{
		ID: "20260825000009-updatedv", KeyID: updatedKeyID, BlockID: itemID, Type: av.KeyTypeUpdated,
	}
	table := &av.Table{Rows: []*av.TableRow{{
		ID: itemID,
		Cells: []*av.TableCell{
			{BaseValue: &av.BaseValue{Value: renderedTemplate}},
			{BaseValue: &av.BaseValue{Value: renderedCreated}},
			{BaseValue: &av.BaseValue{Value: renderedUpdated}},
			{BaseValue: &av.BaseValue{Value: renderedText}},
		},
	}}}

	fillAttributeViewKeyValues(attrView, table)
	if 1 != len(attrView.KeyValues[0].Values) || renderedTemplate != attrView.KeyValues[0].Values[0] {
		t.Fatalf("rendered template value was not used: %+v", attrView.KeyValues[0].Values)
	}
	if !renderedTemplate.IsRenderAutoFill {
		t.Fatal("rendered template value was not marked as auto-filled")
	}
	if renderedCreated != attrView.KeyValues[1].Values[0] || !renderedCreated.IsRenderAutoFill {
		t.Fatalf("rendered created value was not used: %+v", attrView.KeyValues[1].Values[0])
	}
	if renderedUpdated != attrView.KeyValues[2].Values[0] || !renderedUpdated.IsRenderAutoFill {
		t.Fatalf("rendered updated value was not used: %+v", attrView.KeyValues[2].Values[0])
	}
	if storedText != attrView.KeyValues[3].Values[0] || "stored" != attrView.KeyValues[3].Values[0].Text.Content {
		t.Fatalf("stored text value was replaced: %+v", attrView.KeyValues[3].Values[0])
	}
}

func TestFillAttributeViewBlockRefSubtypes(t *testing.T) {
	const avID = "20260814000000-avtest1"
	dynamic := &av.Value{
		Type: av.KeyTypeBlock,
		Block: &av.ValueBlock{
			ID: "20260814000001-dynamic", Content: "Dynamic",
		},
	}
	static := &av.Value{
		Type: av.KeyTypeBlock,
		Block: &av.ValueBlock{
			ID: "20260814000002-static1", Content: "Old",
		},
	}
	detached := &av.Value{
		Type:       av.KeyTypeBlock,
		IsDetached: true,
		Block:      &av.ValueBlock{Content: "Detached", RefSubtype: av.BlockRefSubtypeStatic},
	}
	attrView := &av.AttributeView{
		ID: avID,
		KeyValues: []*av.KeyValues{{
			Key:    &av.Key{ID: "20260814000003-primary", Type: av.KeyTypeBlock},
			Values: []*av.Value{dynamic, static, detached},
		}},
	}
	attrs := map[string]map[string]string{
		dynamic.Block.ID: {},
		static.Block.ID: {
			av.NodeAttrViewStaticText + "-" + avID: "Static",
		},
	}

	fillAttributeViewBlockRefSubtypes(attrView, attrs)

	if av.BlockRefSubtypeDynamic != dynamic.Block.RefSubtype || "Dynamic" != dynamic.Block.Content {
		t.Fatalf("unexpected dynamic block value: %+v", dynamic.Block)
	}
	if av.BlockRefSubtypeStatic != static.Block.RefSubtype || "Static" != static.Block.Content {
		t.Fatalf("unexpected static block value: %+v", static.Block)
	}
	if "" != detached.Block.RefSubtype {
		t.Fatalf("detached block value retained a reference subtype: %+v", detached.Block)
	}
}
