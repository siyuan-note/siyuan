// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestSubItemsTemplateDocumentRedoConflictLeavesNoDocument(t *testing.T) {
	fixture := setupTemplateDocTreeTransactionTest(t)
	database := addTemplateAttributeViewTestFixture(t, fixture, ast.NewNodeID())
	source := database.attrView
	child, parent := source.Views[0].ItemIDs[0], ast.NewNodeID()
	primary := source.GetBlockKeyValues()
	primary.Values = append(primary.Values, &av.Value{ID: ast.NewNodeID(), KeyID: primary.Key.ID, BlockID: parent, Type: av.KeyTypeBlock, IsDetached: true, Block: &av.ValueBlock{Content: "Parent"}})
	for _, view := range source.Views {
		view.ItemIDs = append(view.ItemIDs, parent)
	}
	p, c := ast.NewNodeID(), ast.NewNodeID()
	source.SubItems = &av.SubItemsConfig{Enabled: true, ParentKeyID: p, ChildrenKeyID: c}
	source.KeyValues = append(source.KeyValues,
		&av.KeyValues{Key: &av.Key{ID: p, Type: av.KeyTypeRelation, Relation: &av.Relation{AvID: source.ID, IsTwoWay: true, BackKeyID: c}}},
		&av.KeyValues{Key: &av.Key{ID: c, Type: av.KeyTypeRelation, Relation: &av.Relation{AvID: source.ID, IsTwoWay: true, BackKeyID: p}}})
	if err := source.SetSubItemsParents(map[string]string{child: parent}); err != nil {
		t.Fatal(err)
	}
	template := &av.NewItemTemplate{ID: ast.NewNodeID(), Name: "Document", TargetType: av.NewItemTargetDocument, PrimaryKeyTemplate: "Adopted document",
		FieldValues: map[string]*av.NewItemFieldValue{c: {Mode: av.NewItemFieldValueStatic, Value: &av.Value{Type: av.KeyTypeRelation, Relation: &av.ValueRelation{BlockIDs: []string{child}}}}}}
	source.NewItemTemplates = []*av.NewItemTemplate{template}
	if err := av.SaveAttributeView(source); err != nil {
		t.Fatal(err)
	}
	result, err := CreateAttributeViewItem(source.ID, database.nodes[0].ID, source.Views[0].ID, template.ID, "", "")
	if err != nil {
		t.Fatal(err)
	}
	created, err := LoadTreeByBlockID(result.BlockID)
	if err != nil {
		t.Fatal(err)
	}
	createdPath := filepath.Join(util.DataDir, created.Box, created.Path)
	if err = PerformTxSync(&Transaction{isReplay: true, DoOperations: cloneOperations(result.Transaction.UndoOperations)}); err != nil {
		t.Fatal(err)
	}
	runSubItemsOperation(t, &Operation{Action: "reparentAttrViewItems", AvID: source.ID, BlockID: database.nodes[0].ID, SrcIDs: []string{child}})
	if err = PerformTxSync(&Transaction{isReplay: true, DoOperations: cloneOperations(result.Transaction.DoOperations)}); err == nil {
		t.Fatal("document redo accepted a parent conflict")
	}
	assertSubItemsParent(t, source.ID, child, "")
	if _, err = os.Stat(createdPath); !os.IsNotExist(err) {
		t.Fatalf("conflicting redo retained created document: %v", err)
	}
	if readAttributeViewItemsTest(t, source.ID).GetBlockValue(result.ItemID) != nil {
		t.Fatal("conflicting redo retained created bound row")
	}
}

func TestSubItemsTemplateRedoRejectsParentConflict(t *testing.T) {
	fixture, source, _, _ := setupSubItemsTest(t, false)
	ids := slices.Clone(source.Views[0].ItemIDs)
	template := &av.NewItemTemplate{ID: ast.NewNodeID(), Name: "Adopt", TargetType: av.NewItemTargetDetached,
		FieldValues: map[string]*av.NewItemFieldValue{source.SubItems.ChildrenKeyID: {Mode: av.NewItemFieldValueStatic,
			Value: &av.Value{Type: av.KeyTypeRelation, Relation: &av.ValueRelation{BlockIDs: []string{ids[1]}}}}}}
	if err := source.SetNewItemTemplates(&av.NewItemTemplatesConfig{Templates: []*av.NewItemTemplate{template}}); err != nil {
		t.Fatal(err)
	}
	if err := av.SaveAttributeView(source); err != nil {
		t.Fatal(err)
	}
	result, err := CreateAttributeViewItem(source.ID, fixture.sourceID, source.Views[0].ID, template.ID, "", "")
	if err != nil {
		t.Fatal(err)
	}
	if err = PerformTxSync(&Transaction{isReplay: true, DoOperations: cloneOperations(result.Transaction.UndoOperations)}); err != nil {
		t.Fatal(err)
	}
	runSubItemsOperation(t, &Operation{Action: "reparentAttrViewItems", AvID: source.ID, BlockID: fixture.sourceID, SrcIDs: []string{ids[1]}})
	if err = PerformTxSync(&Transaction{isReplay: true, DoOperations: cloneOperations(result.Transaction.DoOperations)}); err == nil {
		t.Fatal("redo overwrote a later parent change")
	}
	assertSubItemsParent(t, source.ID, ids[1], "")
	if readAttributeViewItemsTest(t, source.ID).GetBlockValue(result.ItemID) != nil {
		t.Fatal("conflicting redo retained a partial new item")
	}
}

func TestSubItemsDeletionUndoRejectsOrderConflict(t *testing.T) {
	fixture, source, _, _ := setupSubItemsTest(t, false)
	ids := slices.Clone(source.Views[0].ItemIDs)
	if err := source.SetSubItemsParents(map[string]string{ids[1]: ids[0], ids[2]: ids[0], ids[3]: ""}); err != nil {
		t.Fatal(err)
	}
	if err := av.SaveAttributeView(source); err != nil {
		t.Fatal(err)
	}
	remove := &Operation{Action: "removeAttrViewBlock", AvID: source.ID, BlockID: fixture.sourceID, SrcIDs: []string{ids[0]}}
	undo := &Operation{Action: "insertAttrViewBlock", AvID: source.ID, BlockID: fixture.sourceID,
		Srcs: []map[string]any{{"itemID": ids[0], "id": ids[0], "isDetached": true, "content": "Primary"}}}
	tx := &Transaction{fromAPI: true, DoOperations: []*Operation{remove}, UndoOperations: []*Operation{undo}}
	if err := PerformTxSync(tx); err != nil {
		t.Fatal(err)
	}
	current := readAttributeViewItemsTest(t, source.ID)
	current.Views[0].ItemIDs = []string{ids[2], ids[1], ids[3]}
	if err := av.SaveAttributeView(current); err != nil {
		t.Fatal(err)
	}
	if err := PerformTxSync(&Transaction{isReplay: true, DoOperations: cloneOperations(tx.UndoOperations)}); err == nil {
		t.Fatal("undo accepted a later promoted sibling order")
	}
	restored := readAttributeViewItemsTest(t, source.ID)
	if !slices.Equal(restored.Views[0].ItemIDs, current.Views[0].ItemIDs) || restored.GetBlockValue(ids[0]) != nil {
		t.Fatal("failed undo changed the source")
	}
}

func TestSubItemsGroupOrderWithDifferentOwnValues(t *testing.T) {
	database, ids := nestedFixture(t, 3)
	if err := database.SetSubItemsParents(map[string]string{ids[1]: ids[0], ids[2]: ids[0]}); err != nil {
		t.Fatal(err)
	}
	view := database.Views[0]
	key := database.KeyValues[1].Key
	key.Type, key.Options = av.KeyTypeMSelect, []*av.SelectOption{{Name: "A"}, {Name: "B"}}
	for i, id := range ids {
		choice := "A"
		if i == 1 {
			choice = "B"
		}
		database.KeyValues[1].Values = append(database.KeyValues[1].Values, &av.Value{ID: ast.NewNodeID(), KeyID: key.ID, BlockID: id, Type: key.Type, MSelect: []*av.ValueSelect{{Content: choice}}})
	}
	view.Group = &av.ViewGroup{Field: key.ID, Method: av.GroupMethodValue}
	regenAttrViewGroups(database)
	groupID := view.GetGroupByGroupValue("A").ID
	index, err := database.BuildSubItemsIndex()
	if err != nil {
		t.Fatal(err)
	}
	moveSubItemOrder(view, index, []string{ids[1]}, "", ids[2], groupID)
	regenAttrViewGroups(database)
	for _, display := range []string{"flat", "nested"} {
		view.SubItemsDisplay = display
		regenAttrViewGroups(database)
		group := view.GetGroupByID(groupID)
		if slices.Contains(group.GroupItemIDs, ids[1]) {
			t.Fatal("tree order changed flat group membership")
		}
		if len(group.SubItemsItemIDs) == 0 {
			t.Fatal("display switch dropped tree order")
		}
	}
	result := nestedRender(t, database, "", 1, 50, nil, AttributeViewRenderOptions{Nested: &av.NestedRequest{ExpandedIDs: []string{ids[0]}}})
	for _, group := range result.Groups {
		table := av.TableFromViewable(group)
		if table.Name != "A" {
			continue
		}
		actual := []string{}
		for _, row := range table.Rows {
			actual = append(actual, row.ID)
		}
		if !slices.Equal(actual, ids) {
			t.Fatalf("cross-group child order: %v", actual)
		}
	}
	copy, err := remapCopiedSubItemsDatabase(database)
	if err != nil {
		t.Fatal(err)
	}
	if slices.Equal(copy.Views[0].GetGroupByGroupValue("A").SubItemsItemIDs, view.GetGroupByID(groupID).SubItemsItemIDs) {
		t.Fatal("copy retained tree order identities")
	}
	encoded, err := json.Marshal(database)
	if err != nil {
		t.Fatal(err)
	}
	importedData, mappings, err := remapImportedSubItemsDatabases(map[string][]byte{database.ID: encoded}, map[string]string{database.ID: ast.NewNodeID()}, nil)
	if err != nil {
		t.Fatal(err)
	}
	var imported av.AttributeView
	if err = json.Unmarshal(importedData[database.ID], &imported); err != nil {
		t.Fatal(err)
	}
	want := []string{}
	for _, id := range view.GetGroupByID(groupID).SubItemsItemIDs {
		want = append(want, mappings[database.ID][id])
	}
	if !slices.Equal(imported.Views[0].GetGroupByGroupValue("A").SubItemsItemIDs, want) {
		t.Fatal("native import dropped tree order identity mapping")
	}
	cloned := database.Clone()
	for _, group := range cloned.Views[0].Groups {
		if len(group.SubItemsItemIDs) > 0 {
			t.Fatal("empty template clone retained tree order")
		}
	}
	key.Options = []*av.SelectOption{{Name: "B"}}
	for _, value := range database.KeyValues[1].Values {
		value.MSelect = []*av.ValueSelect{{Content: "B"}}
	}
	regenAttrViewGroups(database)
	if view.GetGroupByID(groupID) != nil {
		t.Fatal("removed group retained its tree order")
	}
}

func TestSubItemsGroupedDuplicateAndCrossGroupMove(t *testing.T) {
	fixture, source, _, _ := setupSubItemsTest(t, false)
	ids := slices.Clone(source.Views[0].ItemIDs)
	if err := source.SetSubItemsParents(map[string]string{ids[1]: ids[0], ids[2]: "", ids[3]: ids[2]}); err != nil {
		t.Fatal(err)
	}
	view := source.Views[0]
	view.SubItemsDisplay = "nested"
	key := &av.Key{ID: ast.NewNodeID(), Type: av.KeyTypeMSelect, Options: []*av.SelectOption{{Name: "A"}, {Name: "B"}}}
	addAttributeViewKey(source, view, key, "")
	kv, _ := source.GetKeyValues(key.ID)
	for i, id := range ids {
		choice := "B"
		if i == 0 {
			choice = "A"
		}
		kv.Values = append(kv.Values, &av.Value{ID: ast.NewNodeID(), KeyID: key.ID, BlockID: id, Type: key.Type, MSelect: []*av.ValueSelect{{Content: choice}}})
	}
	view.Group = &av.ViewGroup{Field: key.ID, Method: av.GroupMethodValue}
	regenAttrViewGroups(source)
	groupID := view.GetGroupByGroupValue("A").ID
	if err := av.SaveAttributeView(source); err != nil {
		t.Fatal(err)
	}
	op := &Operation{Action: "duplicateAttrViewSubtree", AvID: source.ID, BlockID: fixture.sourceID, ViewID: view.ID, SrcIDs: []string{ids[0]}}
	tx := runSubItemsOperation(t, op)
	copiedIDs := op.RetData.(*insertAttrViewBlockResult).InsertedItemIDs
	check := func() {
		current := readAttributeViewItemsTest(t, source.ID)
		group := current.Views[0].GetGroupByID(groupID)
		if !slices.Equal(group.GroupItemIDs, []string{ids[0], copiedIDs[0]}) || len(group.SubItemsItemIDs) != 4 {
			t.Fatalf("copied root was omitted from its tree group: flat=%v tree=%v", group.GroupItemIDs, group.SubItemsItemIDs)
		}
		result := nestedRender(t, current, "", 1, 50, nil, AttributeViewRenderOptions{Nested: &av.NestedRequest{ExpandedIDs: []string{ids[0], copiedIDs[0]}}})
		for _, instance := range result.Groups {
			table := av.TableFromViewable(instance)
			if table.Name != "A" {
				continue
			}
			actual := []string{}
			for _, row := range table.Rows {
				actual = append(actual, row.ID)
			}
			if !slices.Equal(actual, []string{ids[0], ids[1], copiedIDs[0], copiedIDs[1]}) {
				t.Fatalf("copied tree lost group sibling placement: %v", actual)
			}
		}
	}
	check()
	if err := PerformTxSync(&Transaction{isReplay: true, DoOperations: cloneOperations(tx.UndoOperations)}); err != nil {
		t.Fatal(err)
	}
	if err := PerformTxSync(&Transaction{isReplay: true, DoOperations: cloneOperations(tx.DoOperations)}); err != nil {
		t.Fatal(err)
	}
	check()
	runSubItemsOperation(t, &Operation{Action: "reparentAttrViewItems", AvID: source.ID, BlockID: fixture.sourceID,
		ViewID: view.ID, GroupID: groupID, SrcIDs: []string{ids[1]}, ParentID: ids[2]})
	current := readAttributeViewItemsTest(t, source.ID)
	if slices.Contains(current.Views[0].GetGroupByID(groupID).SubItemsItemIDs, ids[1]) {
		t.Fatal("cross-group reparent retained old group's tree order member")
	}
	assertSubItemsParent(t, source.ID, ids[1], ids[2])
}

func TestSubItemsGroupMoveKeepsOtherGroupFallback(t *testing.T) {
	database, ids := nestedFixture(t, 3)
	if err := database.SetSubItemsParents(map[string]string{ids[1]: ids[0], ids[2]: ids[0]}); err != nil {
		t.Fatal(err)
	}
	view := database.Views[0]
	key := database.KeyValues[1].Key
	key.Type, key.Options = av.KeyTypeMSelect, []*av.SelectOption{{Name: "A"}, {Name: "B"}}
	database.KeyValues[1].Values = []*av.Value{{ID: ast.NewNodeID(), KeyID: key.ID, BlockID: ids[0], Type: key.Type,
		MSelect: []*av.ValueSelect{{Content: "A"}, {Content: "B"}}}}
	view.Group = &av.ViewGroup{Field: key.ID, Method: av.GroupMethodValue}
	regenAttrViewGroups(database)
	index, err := database.BuildSubItemsIndex()
	if err != nil {
		t.Fatal(err)
	}
	moveSubItemOrder(view, index, []string{ids[2]}, "", ids[1], view.GetGroupByGroupValue("A").ID)
	regenAttrViewGroups(database)
	result := nestedRender(t, database, "", 1, 50, nil, AttributeViewRenderOptions{Nested: &av.NestedRequest{ExpandedIDs: []string{ids[0]}}})
	for _, instance := range result.Groups {
		table := av.TableFromViewable(instance)
		if table.Name != "A" && table.Name != "B" {
			continue
		}
		actual := []string{}
		for _, row := range table.Rows {
			actual = append(actual, row.ID)
		}
		want := ids
		if table.Name == "A" {
			want = []string{ids[0], ids[2], ids[1]}
		}
		if !slices.Equal(actual, want) {
			t.Fatalf("group %s lost independent sibling order: %v", table.Name, actual)
		}
	}
}
