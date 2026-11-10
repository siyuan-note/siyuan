// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"slices"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
)

func TestSubItemsTemplateAdoptionReplayAndConflict(t *testing.T) {
	fixture, source, _, _ := setupSubItemsTest(t, false)
	ids := slices.Clone(source.Views[0].ItemIDs)
	template := &av.NewItemTemplate{ID: ast.NewNodeID(), Name: "Adopt child", Icon: "1f600", TargetType: av.NewItemTargetDetached,
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
	assertSubItemsParent(t, source.ID, ids[1], result.ItemID)
	for range 2 {
		if err = PerformTxSync(&Transaction{isReplay: true, DoOperations: cloneOperations(result.Transaction.UndoOperations)}); err != nil {
			t.Fatal(err)
		}
		assertSubItemsParent(t, source.ID, ids[1], ids[0])
		if readAttributeViewItemsTest(t, source.ID).GetBlockValue(result.ItemID) != nil {
			t.Fatal("undo retained created item")
		}
		if err = PerformTxSync(&Transaction{isReplay: true, DoOperations: cloneOperations(result.Transaction.DoOperations)}); err != nil {
			t.Fatal(err)
		}
		assertSubItemsParent(t, source.ID, ids[1], result.ItemID)
	}
	runSubItemsOperation(t, &Operation{Action: "reparentAttrViewItems", AvID: source.ID, BlockID: fixture.sourceID, SrcIDs: []string{ids[1]}})
	if err = PerformTxSync(&Transaction{isReplay: true, DoOperations: cloneOperations(result.Transaction.UndoOperations)}); err == nil {
		t.Fatal("undo overwrote a subsequent parent change")
	}
	assertSubItemsParent(t, source.ID, ids[1], "")
	if readAttributeViewItemsTest(t, source.ID).GetBlockValue(result.ItemID) == nil {
		t.Fatal("conflicting undo removed created item")
	}
}

func TestSubItemsRepeatedActionsInOneTransaction(t *testing.T) {
	for _, action := range []string{"reparentAttrViewItems", "duplicateAttrViewSubtree"} {
		t.Run(action, func(t *testing.T) {
			fixture, source, _, _ := setupSubItemsTest(t, false)
			ids := slices.Clone(source.Views[0].ItemIDs)
			if err := source.SetSubItemsParents(map[string]string{ids[2]: ""}); err != nil {
				t.Fatal(err)
			}
			if err := av.SaveAttributeView(source); err != nil {
				t.Fatal(err)
			}
			first := &Operation{Action: action, AvID: source.ID, BlockID: fixture.sourceID, SrcIDs: []string{ids[1]}}
			second := &Operation{Action: action, AvID: source.ID, BlockID: fixture.sourceID, SrcIDs: []string{ids[3]}}
			u1, u2 := *first, *second
			tx := &Transaction{fromAPI: true, DoOperations: []*Operation{first, second}, UndoOperations: []*Operation{&u2, &u1}}
			if err := PerformTxSync(tx); err != nil {
				t.Fatal(err)
			}
			for range 2 {
				if err := PerformTxSync(&Transaction{isReplay: true, DoOperations: cloneOperations(tx.UndoOperations)}); err != nil {
					t.Fatal(err)
				}
				assertSubItemsParent(t, source.ID, ids[1], ids[0])
				assertSubItemsParent(t, source.ID, ids[3], ids[2])
				if len(readAttributeViewItemsTest(t, source.ID).GetBlockKeyValues().Values) != 4 {
					t.Fatal("undo retained copied items")
				}
				if err := PerformTxSync(&Transaction{isReplay: true, DoOperations: cloneOperations(tx.DoOperations)}); err != nil {
					t.Fatal(err)
				}
				if action == "reparentAttrViewItems" {
					assertSubItemsParent(t, source.ID, ids[1], "")
					assertSubItemsParent(t, source.ID, ids[3], "")
				} else if len(readAttributeViewItemsTest(t, source.ID).GetBlockKeyValues().Values) != 6 {
					t.Fatal("redo did not restore both copied items")
				}
			}
		})
	}
}

func TestSubItemsGroupedOrderMoveDeleteAndReplay(t *testing.T) {
	fixture, source, _, _ := setupSubItemsTest(t, false)
	ids := slices.Clone(source.Views[0].ItemIDs)
	if err := source.SetSubItemsParents(map[string]string{ids[1]: ids[0], ids[2]: ids[0], ids[3]: ""}); err != nil {
		t.Fatal(err)
	}
	view := source.Views[0]
	key := &av.Key{ID: ast.NewNodeID(), Type: av.KeyTypeMSelect, Options: []*av.SelectOption{{Name: "A"}, {Name: "B"}}}
	kv := &av.KeyValues{Key: key}
	for _, id := range ids {
		kv.Values = append(kv.Values, &av.Value{ID: ast.NewNodeID(), KeyID: key.ID, BlockID: id, Type: key.Type,
			MSelect: []*av.ValueSelect{{Content: "A"}, {Content: "B"}}})
	}
	addAttributeViewKey(source, view, key, "")
	added, _ := source.GetKeyValues(key.ID)
	added.Values = kv.Values
	view.Group = &av.ViewGroup{Field: key.ID, Method: av.GroupMethodValue}
	regenAttrViewGroups(source)
	groupID := view.GetGroupByGroupValue("A").ID
	oldOrders := map[string][]string{}
	for _, group := range view.Groups {
		oldOrders[group.ID] = slices.Clone(group.GroupItemIDs)
	}
	if err := av.SaveAttributeView(source); err != nil {
		t.Fatal(err)
	}
	tx := runSubItemsOperation(t, &Operation{Action: "reparentAttrViewItems", AvID: source.ID, BlockID: fixture.sourceID,
		ViewID: view.ID, GroupID: groupID, SrcIDs: []string{ids[2]}, ParentID: ids[0], NextID: ids[1]})
	current := readAttributeViewItemsTest(t, source.ID)
	if !slices.Equal(current.Views[0].GetGroupByID(groupID).GroupItemIDs, []string{ids[0], ids[2], ids[1], ids[3]}) {
		t.Fatalf("group move did not change the selected group's order: %v", current.Views[0].GetGroupByID(groupID).GroupItemIDs)
	}
	for _, group := range current.Views[0].Groups {
		if group.ID != groupID && !slices.Equal(group.GroupItemIDs, oldOrders[group.ID]) {
			t.Fatal("group move changed another group's order")
		}
	}
	if err := PerformTxSync(&Transaction{isReplay: true, DoOperations: cloneOperations(tx.UndoOperations)}); err != nil {
		t.Fatal(err)
	}
	current = readAttributeViewItemsTest(t, source.ID)
	// 子项排在父项之前时，也必须在被删除父项的位置提升。
	for _, group := range current.Views[0].Groups {
		if group.GetGroupValue() == groupValueDefault {
			continue
		}
		group.GroupItemIDs = []string{ids[2], ids[3], ids[0], ids[1]}
		group.SubItemsItemIDs = slices.Clone(group.GroupItemIDs)
	}
	if err := av.SaveAttributeView(current); err != nil {
		t.Fatal(err)
	}
	remove := &Operation{Action: "removeAttrViewBlock", AvID: source.ID, BlockID: fixture.sourceID, SrcIDs: []string{ids[0]}}
	undo := &Operation{Action: "insertAttrViewBlock", AvID: source.ID, BlockID: fixture.sourceID,
		Srcs: []map[string]any{{"itemID": ids[0], "id": ids[0], "isDetached": true, "content": "Primary"}}}
	deletion := &Transaction{fromAPI: true, DoOperations: []*Operation{remove}, UndoOperations: []*Operation{undo}}
	if err := PerformTxSync(deletion); err != nil {
		t.Fatal(err)
	}
	for _, group := range readAttributeViewItemsTest(t, source.ID).Views[0].Groups {
		if group.GetGroupValue() == groupValueDefault {
			continue
		}
		if !slices.Equal(group.GroupItemIDs, []string{ids[3], ids[2], ids[1]}) {
			t.Fatalf("group promotion order: %v", group.GroupItemIDs)
		}
		if !slices.Equal(group.SubItemsItemIDs, group.GroupItemIDs) {
			t.Fatalf("tree group promotion order: %v", group.SubItemsItemIDs)
		}
	}
	for range 2 {
		if err := PerformTxSync(&Transaction{isReplay: true, DoOperations: cloneOperations(deletion.UndoOperations)}); err != nil {
			t.Fatal(err)
		}
		for _, group := range readAttributeViewItemsTest(t, source.ID).Views[0].Groups {
			if group.GetGroupValue() != groupValueDefault && !slices.Equal(group.GroupItemIDs, []string{ids[2], ids[3], ids[0], ids[1]}) {
				t.Fatalf("undo failed to restore promoted group order: %v", group.GroupItemIDs)
			}
			if group.GetGroupValue() != groupValueDefault && !slices.Equal(group.SubItemsItemIDs, group.GroupItemIDs) {
				t.Fatal("undo failed to restore tree group order")
			}
		}
		if err := PerformTxSync(&Transaction{isReplay: true, DoOperations: cloneOperations(deletion.DoOperations)}); err != nil {
			t.Fatal(err)
		}
	}
}

func TestSubItemsCopiedAutomationReferences(t *testing.T) {
	_, source, _, _ := setupSubItemsTest(t, false)
	keyID := source.KeyValues[1].Key.ID
	assetIndex := slices.IndexFunc(source.KeyValues, func(kv *av.KeyValues) bool { return kv.Key.Type == av.KeyTypeMAsset })
	rowID := source.Views[0].ItemIDs[0]
	source.SetCardCoverPosition(rowID, av.CardCoverSource(av.CoverFromAssetField, source.KeyValues[assetIndex].Key.ID), &av.CardCoverPosition{Image: "assets/test.png", X: .4, Y: .6})
	externalID, externalKey := ast.NewNodeID(), ast.NewNodeID()
	text := `literal ` + keyID + ` .action{field "` + keyID + `"}`
	source.Automations = &av.AutomationConfig{Spec: 1, Rules: []*av.AutomationRule{{ID: ast.NewNodeID(), Enabled: true,
		Actions: []*av.AutomationAction{
			{Type: "edit", Target: "current", Fields: map[string]*av.AutomationValue{keyID: {Mode: "template", Template: text}}},
			{Type: "edit", Target: "filtered", AvID: externalID, Filters: []*av.ViewFilter{{Column: externalKey}},
				Fields: map[string]*av.AutomationValue{externalKey: {Mode: "source", KeyID: keyID}}},
		}}}}
	copied, err := remapCopiedSubItemsDatabase(source)
	if err != nil {
		t.Fatal(err)
	}
	newKeyID := copied.KeyValues[1].Key.ID
	if copied.GetCardCoverPosition(copied.Views[0].ItemIDs[0], av.CardCoverSource(av.CoverFromAssetField, copied.KeyValues[assetIndex].Key.ID), "assets/test.png") == nil {
		t.Fatal("copy retained old asset field identity in cover source")
	}
	rule := copied.Automations.Rules[0]
	if rule.Enabled || rule.Actions[0].Fields[newKeyID] == nil || rule.Actions[0].Fields[newKeyID].Template != `literal `+keyID+` .action{field "`+newKeyID+`"}` {
		t.Fatalf("copied local automation not remapped: %+v", rule)
	}
	external := rule.Actions[1]
	if external.AvID != externalID || external.Filters[0].Column != externalKey || external.Fields[externalKey] == nil || external.Fields[externalKey].KeyID != newKeyID {
		t.Fatal("copied external automation changed target or retained old source field")
	}
}
