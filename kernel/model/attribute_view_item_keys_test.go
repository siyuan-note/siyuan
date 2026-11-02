// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"reflect"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/cache"
)

func TestAttributeViewItemKeysKeepComputedValuesAndPositions(t *testing.T) {
	fixture := setupDatabaseBlockTransactionTest(t, true)
	database := fixture.attrView
	database.KeyValues = database.KeyValues[:1]
	fixture.tableView.Table.Columns = fixture.tableView.Table.Columns[:1]
	blockValues := database.GetBlockKeyValues()
	otherID, itemID := ast.NewNodeID(), ast.NewNodeID()
	blockValues.Values = []*av.Value{
		{ID: ast.NewNodeID(), KeyID: blockValues.Key.ID, BlockID: otherID, Type: av.KeyTypeBlock,
			IsDetached: true, Block: &av.ValueBlock{Content: "Other"}},
		{ID: ast.NewNodeID(), KeyID: blockValues.Key.ID, BlockID: itemID, Type: av.KeyTypeBlock,
			Block: &av.ValueBlock{ID: fixture.tree.ID, Content: "Selected"}},
	}
	textKey := &av.Key{ID: ast.NewNodeID(), Name: "Text", Type: av.KeyTypeText}
	templateKey := &av.Key{ID: ast.NewNodeID(), Name: "Computed", Type: av.KeyTypeTemplate, Template: ".action{.Text}"}
	database.KeyValues = append(database.KeyValues,
		&av.KeyValues{Key: textKey, Values: []*av.Value{
			{ID: ast.NewNodeID(), KeyID: textKey.ID, BlockID: itemID, Type: textKey.Type, Text: &av.ValueText{Content: "Fresh"}},
		}}, &av.KeyValues{Key: templateKey})
	database.KeyIDs = []string{blockValues.Key.ID, templateKey.ID, textKey.ID}
	fixture.tableView.ItemIDs = []string{otherID, itemID}
	fixture.tableView.Table.Columns = append(fixture.tableView.Table.Columns,
		&av.ViewTableColumn{BaseField: &av.BaseField{ID: textKey.ID}},
		&av.ViewTableColumn{BaseField: &av.BaseField{ID: templateKey.ID}})
	fixture.tableView.Groups = []*av.View{{ID: ast.NewNodeID(), GroupItemIDs: []string{otherID, itemID}}}
	if err := av.SaveAttributeView(database); err != nil {
		t.Fatal(err)
	}
	wantPositions := getAttributeViewItemPositions(database, itemID)
	av.UpsertBlockRel(database.ID, "20260803091003-avblock")
	cache.PutBlockIALInBox(fixture.tree.ID, fixture.tree.Box, map[string]string{av.NodeAttrNameAvs: database.ID})
	t.Cleanup(func() { cache.RemoveBlockIALInBox(fixture.tree.ID, fixture.tree.Box) })
	for _, read := range []struct {
		name string
		get  func() []*BlockAttributeViewKeys
	}{
		{"item", func() []*BlockAttributeViewKeys { return GetAttributeViewItemKeys(database.ID, itemID, "") }},
		{"value ID fallback", func() []*BlockAttributeViewKeys {
			return GetAttributeViewItemKeys(database.ID, "missing", blockValues.Values[1].ID)
		}},
		{"bound block", func() []*BlockAttributeViewKeys { return GetBlockAttributeViewKeys(fixture.tree.ID) }},
	} {
		t.Run(read.name, func(t *testing.T) {
			keys := read.get()
			if len(keys) != 1 || keys[0].AvID != database.ID || !reflect.DeepEqual(keys[0].ItemPositions, wantPositions) {
				t.Fatalf("database or item positions changed: %+v", keys)
			}
			if len(keys[0].KeyValues) != 3 || keys[0].KeyValues[1].Key.ID != templateKey.ID {
				t.Fatalf("field order changed: %+v", keys[0].KeyValues)
			}
			for _, keyValues := range keys[0].KeyValues {
				if len(keyValues.Values) != 1 || keyValues.Values[0].BlockID != itemID {
					t.Fatalf("unexpected item values: %+v", keyValues)
				}
				if keyValues.Key.ID == templateKey.ID && keyValues.Values[0].String(true) != "Fresh" {
					t.Fatalf("computed value was not refreshed: %+v", keyValues.Values[0])
				}
			}
		})
	}
}

func TestGetAttributeViewItemKeyValuesPrefersRenderedValue(t *testing.T) {
	const (
		itemID        = "20260825000000-item001"
		templateKeyID = "20260825000001-template"
		textKeyID     = "20260825000002-textkey1"
		lineKeyID     = "20260825000003-linekey1"
	)
	staleTemplate := &av.Value{
		ID: "20260825000004-template", KeyID: templateKeyID, BlockID: itemID, Type: av.KeyTypeTemplate,
		Template: &av.ValueTemplate{Content: ".action{old}"},
	}
	storedText := &av.Value{
		ID: "20260825000005-textval1", KeyID: textKeyID, BlockID: itemID, Type: av.KeyTypeText,
		Text: &av.ValueText{Content: "stored"},
	}
	attrView := &av.AttributeView{KeyValues: []*av.KeyValues{
		{Key: &av.Key{ID: templateKeyID, Type: av.KeyTypeTemplate}, Values: []*av.Value{staleTemplate}},
		{Key: &av.Key{ID: textKeyID, Type: av.KeyTypeText}, Values: []*av.Value{storedText}},
		{Key: &av.Key{ID: lineKeyID, Type: av.KeyTypeLineNumber}},
	}}
	renderedTemplate := &av.Value{
		ID: staleTemplate.ID, KeyID: templateKeyID, BlockID: itemID, Type: av.KeyTypeTemplate,
		Template: &av.ValueTemplate{Content: "rendered"},
	}
	table := &av.Table{Rows: []*av.TableRow{{
		ID:    itemID,
		Cells: []*av.TableCell{{BaseValue: &av.BaseValue{Value: renderedTemplate}}},
	}}}

	keyValues := getAttributeViewItemKeyValues(attrView, table, itemID, false)
	if 2 != len(keyValues) {
		t.Fatalf("unexpected key values count: %d", len(keyValues))
	}
	if renderedTemplate != keyValues[0].Values[0] {
		t.Fatalf("rendered template value was not preferred: %+v", keyValues[0].Values[0])
	}
	if storedText != keyValues[1].Values[0] {
		t.Fatalf("stored text fallback was not used: %+v", keyValues[1].Values[0])
	}
}
