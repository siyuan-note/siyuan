// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"context"
	"reflect"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/templatehttp"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func setupAttributeViewItemKeysTest(t *testing.T) *databaseBlockTransactionTestFixture {
	t.Helper()
	oldTempDir := util.TempDir
	util.TempDir = t.TempDir()
	t.Cleanup(func() { util.TempDir = oldTempDir })
	fixture := setupDatabaseBlockTransactionTest(t, true)
	// 面板读取会保存字段顺序并刷新引用索引，需要独立的 SQL 和队列生命周期。
	setupNotebookDocumentImportDatabase(t)
	treenode.UpsertBlockTree(fixture.tree)
	return fixture
}

func TestAttributeViewItemKeysHTTPExecution(t *testing.T) {
	fixture := setupAttributeViewItemKeysTest(t)
	database := fixture.attrView
	primary := database.GetBlockKeyValues()
	itemID := ast.NewNodeID()
	primary.Values = []*av.Value{{ID: ast.NewNodeID(), KeyID: primary.Key.ID, BlockID: itemID,
		Type: av.KeyTypeBlock, Block: &av.ValueBlock{ID: fixture.tree.ID, Content: "Selected"}}}
	key := av.NewKey(ast.NewNodeID(), "HTTP", "", av.KeyTypeTemplate)
	key.Template = `.action{(httpGet "https://example.com/data").error}`
	database.KeyValues = append(database.KeyValues, &av.KeyValues{Key: key})
	fixture.tableView.ItemIDs = []string{itemID}
	fixture.tableView.Table.Columns = append(fixture.tableView.Table.Columns,
		&av.ViewTableColumn{BaseField: &av.BaseField{ID: key.ID}})
	if err := av.SaveAttributeView(database); err != nil {
		t.Fatal(err)
	}
	av.UpsertBlockRel(database.ID, "20260803091003-avblock")
	fixture.tree.Root.SetIALAttr(av.NodeAttrNameAvs, database.ID)
	if _, err := filesys.WriteTree(fixture.tree); err != nil {
		t.Fatal(err)
	}
	cache.RemoveBlockIAL(fixture.tree.ID)
	t.Cleanup(func() { cache.RemoveBlockIAL(fixture.tree.ID) })
	for _, mode := range []string{"item", "bound", "carrier"} {
		t.Run(mode, func(t *testing.T) {
			confirmations := 0
			execution := templatehttp.New(context.Background(), "panel", func(context.Context, templatehttp.Request) bool {
				confirmations++
				return false
			})
			defer execution.Close()
			var keys []*BlockAttributeViewKeys
			switch mode {
			case "item":
				keys = GetAttributeViewItemKeys(database.ID, itemID, "", execution)
			case "bound":
				keys = GetBlockAttributeViewKeys(fixture.tree.ID, execution)
			case "carrier":
				var err error
				keys, err = GetAttributeViewItemKeysWithContext(database.ID, itemID, "", "20260803091003-avblock",
					&AttributeViewRelationContext{SourceAvID: database.ID}, false, execution)
				if err != nil {
					t.Fatal(err)
				}
			}
			if len(keys) != 1 {
				t.Fatalf("missing panel values: %+v", keys)
			}
			found := false
			for _, values := range keys[0].KeyValues {
				if values.Key.ID == key.ID {
					found = true
					if got := values.Values[0].Template.Content; got != "denied" {
						t.Fatalf("panel did not use execution: %q", got)
					}
				}
			}
			if !found || confirmations != 1 {
				t.Fatalf("unexpected HTTP field or prompts: %v %d", found, confirmations)
			}
		})
	}
}

func TestAttributeViewItemKeysKeepComputedValuesAndPositions(t *testing.T) {
	fixture := setupAttributeViewItemKeysTest(t)
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
	fixture.tree.Root.SetIALAttr(av.NodeAttrNameAvs, database.ID)
	if _, err := filesys.WriteTree(fixture.tree); err != nil {
		t.Fatal(err)
	}
	cache.RemoveBlockIAL(fixture.tree.ID)
	t.Cleanup(func() { cache.RemoveBlockIAL(fixture.tree.ID) })
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
