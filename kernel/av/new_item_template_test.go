// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package av

import (
	"testing"

	"github.com/88250/lute/ast"
)

func TestSetNewItemTemplates(t *testing.T) {
	attrView := &AttributeView{Spec: CurrentSpec, ID: ast.NewNodeID()}
	textKey := NewKey(ast.NewNodeID(), "Text", "", KeyTypeText)
	attrView.KeyValues = append(attrView.KeyValues, &KeyValues{Key: textKey})
	attrView.KeyIDs = append(attrView.KeyIDs, textKey.ID)
	templateID := ast.NewNodeID()
	config := &NewItemTemplatesConfig{
		Templates: []*NewItemTemplate{{
			ID:             templateID,
			Name:           " Document ",
			Icon:           " 1f4c4 ",
			TargetType:     NewItemTargetDocument,
			HideInFileTree: true,
			FieldValues: map[string]*NewItemFieldValue{
				textKey.ID: {Mode: NewItemFieldValueStatic, Value: &Value{
					ID: ast.NewNodeID(), KeyID: "old", BlockID: "old", Type: KeyTypeNumber, Text: &ValueText{Content: "value"},
				}},
			},
		}},
		DefaultTemplateID: templateID,
	}

	if err := attrView.SetNewItemTemplates(config); nil != err {
		t.Fatalf("set new item templates failed: %s", err)
	}
	got := attrView.NewItemTemplates[0]
	if "Document" != got.Name {
		t.Fatalf("unexpected normalized name: %q", got.Name)
	}
	if "1f4c4" != got.Icon {
		t.Fatalf("unexpected normalized icon: %q", got.Icon)
	}
	if !got.HideInFileTree {
		t.Fatal("document template should preserve the file tree visibility setting")
	}
	value := got.FieldValues[textKey.ID].Value
	if KeyTypeText != value.Type || "" != value.ID || "" != value.KeyID || "" != value.BlockID {
		t.Fatalf("unexpected normalized value: %+v", value)
	}
	if templateID != attrView.DefaultTemplateID {
		t.Fatalf("unexpected default template: %q", attrView.DefaultTemplateID)
	}
	if " Document " != config.Templates[0].Name {
		t.Fatal("input config was mutated")
	}
	if " 1f4c4 " != config.Templates[0].Icon {
		t.Fatal("input icon was mutated")
	}
}

func TestSetNewItemTemplatesRejectsInvalidConfig(t *testing.T) {
	attrView := &AttributeView{Spec: CurrentSpec, ID: ast.NewNodeID()}
	textKey := NewKey(ast.NewNodeID(), "Text", "", KeyTypeText)
	attrView.KeyValues = append(attrView.KeyValues, &KeyValues{Key: textKey})
	attrView.KeyIDs = append(attrView.KeyIDs, textKey.ID)

	err := attrView.SetNewItemTemplates(&NewItemTemplatesConfig{Templates: []*NewItemTemplate{{
		ID: ast.NewNodeID(), Name: "Invalid", TargetType: NewItemTargetDetached,
		FieldValues: map[string]*NewItemFieldValue{textKey.ID: {Mode: NewItemFieldValueCurrentTime}},
	}}})
	if nil == err {
		t.Fatal("expected current time mode on a text field to fail")
	}

	numberKey := NewKey(ast.NewNodeID(), "Number", "", KeyTypeNumber)
	attrView.KeyValues = append(attrView.KeyValues, &KeyValues{Key: numberKey})
	attrView.KeyIDs = append(attrView.KeyIDs, numberKey.ID)
	err = attrView.SetNewItemTemplates(&NewItemTemplatesConfig{Templates: []*NewItemTemplate{{
		ID: ast.NewNodeID(), Name: "Invalid", TargetType: NewItemTargetDetached,
		FieldValues: map[string]*NewItemFieldValue{numberKey.ID: {
			Mode: NewItemFieldValueStatic, Value: &Value{Type: KeyTypeNumber, Text: &ValueText{Content: "not a number"}},
		}},
	}}})
	if nil == err {
		t.Fatal("expected a number field without number payload to fail")
	}

	for _, keyType := range []KeyType{KeyTypeSelect, KeyTypeMSelect} {
		selectKey := NewKey(ast.NewNodeID(), "Select", "", keyType)
		selectKey.Options = []*SelectOption{{Name: "Available", Color: "1"}}
		attrView.KeyValues = append(attrView.KeyValues, &KeyValues{Key: selectKey})
		attrView.KeyIDs = append(attrView.KeyIDs, selectKey.ID)
		err = attrView.SetNewItemTemplates(&NewItemTemplatesConfig{Templates: []*NewItemTemplate{{
			ID: ast.NewNodeID(), Name: "Invalid", TargetType: NewItemTargetDetached,
			FieldValues: map[string]*NewItemFieldValue{selectKey.ID: {
				Mode:  NewItemFieldValueStatic,
				Value: &Value{Type: keyType, MSelect: []*ValueSelect{{Content: "Unavailable", Color: "2"}}},
			}},
		}}})
		if nil == err {
			t.Fatalf("expected an unavailable %s option to fail", keyType)
		}
	}
}

func TestEmptyNewItemTemplatesUseVirtualDefault(t *testing.T) {
	attrView := &AttributeView{Spec: CurrentSpec, ID: ast.NewNodeID()}
	config := &NewItemTemplatesConfig{}
	if err := attrView.SetNewItemTemplates(config); nil != err {
		t.Fatalf("restore default new item template failed: %s", err)
	}
	if 0 != len(attrView.NewItemTemplates) || "" != attrView.DefaultTemplateID {
		t.Fatalf("expected virtual default template, got templates=%+v default=%q", attrView.NewItemTemplates, attrView.DefaultTemplateID)
	}
	if "" != config.DefaultTemplateID || 0 != len(config.Templates) {
		t.Fatal("input config was mutated")
	}
}

func TestDetachedNewItemTemplateDropsIcon(t *testing.T) {
	attrView := &AttributeView{Spec: CurrentSpec, ID: ast.NewNodeID()}
	config := &NewItemTemplatesConfig{Templates: []*NewItemTemplate{{
		ID: ast.NewNodeID(), Name: "Detached", Icon: "1f4c4", TargetType: NewItemTargetDetached, HideInFileTree: true,
	}}}
	if err := attrView.SetNewItemTemplates(config); nil != err {
		t.Fatalf("set detached new item template failed: %s", err)
	}
	if "" != attrView.NewItemTemplates[0].Icon {
		t.Fatalf("detached template icon should be empty: %q", attrView.NewItemTemplates[0].Icon)
	}
	if attrView.NewItemTemplates[0].HideInFileTree {
		t.Fatal("detached template should not preserve the file tree visibility setting")
	}
	if "1f4c4" != config.Templates[0].Icon {
		t.Fatal("input icon was mutated")
	}
}

func TestMaintainNewItemTemplateFieldValues(t *testing.T) {
	selectKey := NewKey(ast.NewNodeID(), "Select", "", KeyTypeMSelect)
	relationKey := NewKey(ast.NewNodeID(), "Relation", "", KeyTypeRelation)
	relationKey.Relation = &Relation{AvID: ast.NewNodeID()}
	relationItemID := ast.NewNodeID()
	attrView := &AttributeView{
		KeyValues: []*KeyValues{{Key: selectKey}, {Key: relationKey}},
		NewItemTemplates: []*NewItemTemplate{{
			ID: ast.NewNodeID(), Name: "Template", TargetType: NewItemTargetDetached,
			FieldValues: map[string]*NewItemFieldValue{
				selectKey.ID: {
					Mode: NewItemFieldValueStatic,
					Value: &Value{Type: KeyTypeMSelect, MSelect: []*ValueSelect{
						{Content: "Old", Color: "1"}, {Content: "Keep", Color: "2"},
					}},
				},
				relationKey.ID: {
					Mode:  NewItemFieldValueStatic,
					Value: &Value{Type: KeyTypeRelation, Relation: &ValueRelation{BlockIDs: []string{relationItemID}}},
				},
			},
		}},
	}

	attrView.RenameNewItemTemplateSelectOption(selectKey.ID, "Old", "Renamed", "3")
	selections := attrView.NewItemTemplates[0].FieldValues[selectKey.ID].Value.MSelect
	if 2 != len(selections) || "Renamed" != selections[0].Content || "3" != selections[0].Color {
		t.Fatalf("unexpected renamed selections: %+v", selections)
	}
	attrView.RemoveNewItemTemplateRelationItems(relationKey.Relation.AvID, []string{relationItemID})
	if nil != attrView.NewItemTemplates[0].FieldValues[relationKey.ID] {
		t.Fatal("removed relation item should be removed from the template")
	}
	attrView.RemoveNewItemTemplateFieldValue(selectKey.ID)
	if nil != attrView.NewItemTemplates[0].FieldValues {
		t.Fatalf("empty field values should be nil: %+v", attrView.NewItemTemplates[0].FieldValues)
	}
}

func TestPruneInvalidNewItemTemplateOptions(t *testing.T) {
	mSelectKey := NewKey(ast.NewNodeID(), "Multiple Select", "", KeyTypeMSelect)
	mSelectKey.Options = []*SelectOption{{Name: "Available", Color: "1"}}
	selectKey := NewKey(ast.NewNodeID(), "Select", "", KeyTypeSelect)
	selectKey.Options = []*SelectOption{{Name: "Available", Color: "1"}}
	templateID := ast.NewNodeID()
	attrView := &AttributeView{
		KeyValues: []*KeyValues{{Key: mSelectKey}, {Key: selectKey}},
		NewItemTemplates: []*NewItemTemplate{{
			ID: templateID, Name: "Template", TargetType: NewItemTargetDetached,
			FieldValues: map[string]*NewItemFieldValue{
				mSelectKey.ID: {
					Mode: NewItemFieldValueStatic,
					Value: &Value{Type: KeyTypeMSelect, MSelect: []*ValueSelect{
						{Content: "Available", Color: "1"}, {Content: "Unavailable", Color: "2"},
					}},
				},
				selectKey.ID: {
					Mode: NewItemFieldValueStatic,
					Value: &Value{Type: KeyTypeSelect, MSelect: []*ValueSelect{
						{Content: "Missing", Color: "2"},
					}},
				},
			},
		}},
	}

	pruned := attrView.PruneInvalidNewItemTemplateFieldValues()
	if 2 != len(pruned) {
		t.Fatalf("expected two pruned option records, got %+v", pruned)
	}
	prunedByKeyID := map[string]*PrunedNewItemTemplateOption{}
	for _, item := range pruned {
		prunedByKeyID[item.KeyID] = item
		if templateID != item.TemplateID {
			t.Fatalf("unexpected template ID: %q", item.TemplateID)
		}
	}
	if values := prunedByKeyID[mSelectKey.ID].Values; 1 != len(values) || "Unavailable" != values[0] {
		t.Fatalf("unexpected multiple select values: %+v", values)
	}
	if values := prunedByKeyID[selectKey.ID].Values; 1 != len(values) || "Missing" != values[0] {
		t.Fatalf("unexpected select values: %+v", values)
	}
	selections := attrView.NewItemTemplates[0].FieldValues[mSelectKey.ID].Value.MSelect
	if 1 != len(selections) || "Available" != selections[0].Content {
		t.Fatalf("unexpected retained multiple select values: %+v", selections)
	}
	if nil != attrView.NewItemTemplates[0].FieldValues[selectKey.ID] {
		t.Fatal("select field with no available option should be removed")
	}
}
