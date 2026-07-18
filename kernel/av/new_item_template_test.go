// SiYuan - Refactor your thinking
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
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestSetNewItemTemplates(t *testing.T) {
	attrView := &AttributeView{Spec: CurrentSpec, ID: ast.NewNodeID()}
	textKey := NewKey(ast.NewNodeID(), "Text", "", KeyTypeText)
	attrView.KeyValues = append(attrView.KeyValues, &KeyValues{Key: textKey})
	attrView.KeyIDs = append(attrView.KeyIDs, textKey.ID)
	templateID := ast.NewNodeID()
	config := &NewItemTemplatesConfig{
		Templates: []*NewItemTemplate{{
			ID:         templateID,
			Name:       " Document ",
			TargetType: NewItemTargetDocument,
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
}

func TestEmptyNewItemTemplatesRestoreEditableDefault(t *testing.T) {
	setTestAttrViewLang(t)

	attrView := &AttributeView{Spec: CurrentSpec, ID: ast.NewNodeID()}
	config := &NewItemTemplatesConfig{}
	if err := attrView.SetNewItemTemplates(config); nil != err {
		t.Fatalf("restore default new item template failed: %s", err)
	}
	if 1 != len(attrView.NewItemTemplates) {
		t.Fatalf("expected one default template, got %d", len(attrView.NewItemTemplates))
	}
	itemTemplate := attrView.NewItemTemplates[0]
	if "Empty" != itemTemplate.Name || NewItemTargetDetached != itemTemplate.TargetType || itemTemplate.ID != attrView.DefaultTemplateID {
		t.Fatalf("unexpected default template: %+v", itemTemplate)
	}
	if "" != config.DefaultTemplateID || 0 != len(config.Templates) {
		t.Fatal("input config was mutated")
	}
}

func setTestAttrViewLang(t *testing.T) {
	originalLang := util.Lang
	originalLangs := util.AttrViewLangs
	util.Lang = "test"
	util.AttrViewLangs = map[string]map[string]any{"test": {"empty": "Empty"}}
	t.Cleanup(func() {
		util.Lang = originalLang
		util.AttrViewLangs = originalLangs
	})
}
