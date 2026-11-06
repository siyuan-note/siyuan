// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestRelationDetailDeltaAutomationNativeParity(t *testing.T) {
	for _, mode := range []string{"native", "delta", "delta-commit-failure"} {
		t.Run(mode, func(t *testing.T) {
			fixture, source, target, statusID, relationKey := setupAutomationTest(t)
			tree, err := LoadTreeByBlockID(fixture.sourceID)
			if err != nil {
				t.Fatal(err)
			}
			carrierID := ast.NewNodeID()
			carrier := &ast.Node{ID: carrierID, Type: ast.NodeAttributeView, AttributeViewID: source.ID, AttributeViewType: "table"}
			carrier.SetIALAttr("id", carrierID)
			tree.Root.AppendChild(carrier)
			if _, err = filesys.WriteTree(tree); err != nil {
				t.Fatal(err)
			}
			treenode.UpsertBlockTree(tree)
			itemID, targetItem := source.GetBlockKeyValues().Values[0].BlockID, ast.NewNodeID()
			target.GetBlockKeyValues().Values = []*av.Value{{ID: ast.NewNodeID(), KeyID: target.GetBlockKey().ID, BlockID: targetItem,
				Type: av.KeyTypeBlock, IsDetached: true, Block: &av.ValueBlock{Content: "Existing target"}}}
			target.Views[0].ItemIDs = []string{targetItem}
			source.Automations.Rules = []*av.AutomationRule{{ID: ast.NewNodeID(), Name: "Relation change", Enabled: true, Trigger: "changed", KeyID: relationKey,
				Actions: []*av.AutomationAction{{Type: "edit", Target: "current", Fields: map[string]*av.AutomationValue{
					statusID: {Mode: "static", Value: &av.Value{Type: av.KeyTypeSelect, MSelect: []*av.ValueSelect{{Content: "Triggered", Color: "1"}}}},
				}}}}}
			for _, database := range []*av.AttributeView{source, target} {
				if err := av.SaveAttributeView(database); err != nil {
					t.Fatal(err)
				}
			}
			op := &Operation{Action: "updateAttrViewRelationItems", AvID: source.ID, BlockID: carrierID, RowID: itemID, KeyID: relationKey,
				Data: AttributeViewRelationItemsChange{AddItemIDs: []string{targetItem}}}
			undo := *op
			undo.Data = AttributeViewRelationItemsChange{RemoveItemIDs: []string{targetItem}}
			if mode == "native" {
				op.Action, undo.Action = "updateAttrViewCell", "updateAttrViewCell"
				op.Data = &av.Value{Type: av.KeyTypeRelation, Relation: &av.ValueRelation{BlockIDs: []string{targetItem}}}
				undo.Data = &av.Value{Type: av.KeyTypeRelation, Relation: &av.ValueRelation{BlockIDs: []string{}}}
			}
			tx := &Transaction{fromAPI: true, DoOperations: []*Operation{op}, UndoOperations: []*Operation{&undo}}
			if mode == "delta-commit-failure" {
				tx.DoOperations = append(tx.DoOperations, &Operation{Action: "setAttrs", ID: fixture.sourceID, Data: `{"custom-check":"changed"}`})
				tx.writeTransactionTree = func(*parse.Tree) error { return errors.New("injected relation automation commit failure") }
			}
			err = PerformTxSync(tx)
			if mode == "delta-commit-failure" {
				if err == nil || !strings.Contains(err.Error(), "injected relation automation commit failure") {
					t.Fatalf("injected failure not reached: %v", err)
				}
				if got := readAttributeViewItemsTest(t, source.ID).GetValue(statusID, itemID).MSelect[0].Content; got != "Alpha" {
					t.Fatalf("automation rollback lost source: %s", got)
				}
				if value := readAttributeViewItemsTest(t, source.ID).GetValue(relationKey, itemID); value != nil && value.Relation != nil && len(value.Relation.BlockIDs) != 0 {
					t.Fatal("automation rollback retained relation")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if got := readAttributeViewItemsTest(t, source.ID).GetValue(statusID, itemID).MSelect[0].Content; got != "Triggered" {
				t.Fatalf("relation change omitted automation: %s", got)
			}
			for _, step := range []struct {
				ops  []*Operation
				want string
			}{{tx.UndoOperations, "Alpha"}, {tx.DoOperations, "Triggered"}} {
				if err = PerformTxSync(&Transaction{isReplay: true, DoOperations: cloneOperations(step.ops)}); err != nil {
					t.Fatal(err)
				}
				if got := readAttributeViewItemsTest(t, source.ID).GetValue(statusID, itemID).MSelect[0].Content; got != step.want {
					t.Fatalf("automation replay: %s", got)
				}
			}
		})
	}
}

func TestRelationMetadataNativeCarrierStorageOrdinary(t *testing.T) {
	f := setupRelationItemTest(t, nil)
	id := ast.NewNodeID()
	f.target.GetBlockKeyValues().Values = []*av.Value{{ID: ast.NewNodeID(), KeyID: f.target.GetBlockKey().ID, BlockID: id,
		Type: av.KeyTypeBlock, IsDetached: true, Block: &av.ValueBlock{Content: "Ordinary target"}}}
	f.target.Views[0].ItemIDs = []string{id}
	if err := av.SaveAttributeView(f.target); err != nil {
		t.Fatal(err)
	}
	checkNativeRelationCarrierStorage(t, f, id, "", ast.NewNodeID())
}

func checkNativeRelationCarrierStorage(t *testing.T, f *relationItemTestFixture, itemID, boxID, wrongBox string) {
	t.Helper()
	av.SetAVBoxID(f.target.ID, wrongBox)
	view, parsed, _, err := RenderAttributeViewWithTargetOptions(f.targetBlockID, f.target.ID, "", "", 1, 50, nil,
		"", false, false, "", "", AttributeViewRenderOptions{})
	if err != nil || view == nil || parsed.GetBlockValue(itemID) == nil {
		t.Fatalf("native carrier render used ambient map: %v", err)
	}
	if got, known := parsed.StorageContext(); !known || got != boxID {
		t.Fatalf("native render object lost pin: %q %v", got, known)
	}
	parsed, err = avParseView(f.target.ID, f.targetBlockID)
	if err != nil {
		t.Fatal(err)
	}
	if got, known := parsed.StorageContext(); !known || got != boxID {
		t.Fatalf("native carrier parse lost pin: %q %v", got, known)
	}
	av.SetAVBoxID(f.target.ID, wrongBox)
	parsed.Name = "Pinned native database"
	if err = avSaveView(parsed, f.targetBlockID); err != nil {
		t.Fatal(err)
	}
	current, err := av.ParseAttributeViewWithStorageContext(f.target.ID, boxID)
	if err != nil || current.Name != parsed.Name {
		t.Fatalf("native derived save changed storage domain: %v", err)
	}
	oldText := current.GetValue(f.textKeyID, itemID)
	if oldText == nil {
		oldText = &av.Value{Type: av.KeyTypeText, Text: &av.ValueText{}}
	}
	operation := &Operation{Action: "updateAttrViewCell", AvID: f.target.ID, BlockID: f.targetBlockID, RowID: itemID,
		KeyID: f.textKeyID, Data: &av.Value{Type: av.KeyTypeText, Text: &av.ValueText{Content: "Native pinned edit"}}}
	inverse := *operation
	inverse.Data = oldText
	tx := &Transaction{DoOperations: []*Operation{operation}, UndoOperations: []*Operation{&inverse}}
	previous := av.AttributeViewSaved
	av.AttributeViewSaved = func(id, savedBox string) {
		av.SetAVBoxID(f.target.ID, wrongBox)
		if previous != nil {
			previous(id, savedBox)
		}
	}
	defer func() { av.AttributeViewSaved = previous; av.SetAVBoxID(f.target.ID, boxID) }()
	if err = PerformTxSync(tx); err != nil {
		t.Fatal(err)
	}
	for _, step := range []struct {
		ops      []*Operation
		expected string
	}{{tx.UndoOperations, oldText.Text.Content}, {tx.DoOperations, "Native pinned edit"}} {
		av.SetAVBoxID(f.target.ID, wrongBox)
		if err = PerformTxSync(&Transaction{DoOperations: cloneOperations(step.ops), isReplay: true}); err != nil {
			t.Fatal(err)
		}
		current, err = av.ParseAttributeViewWithStorageContext(f.target.ID, boxID)
		value := current.GetValue(f.textKeyID, itemID)
		if err != nil || value == nil || value.Text == nil || value.Text.Content != step.expected {
			t.Fatalf("native replay crossed domain: %v %+v", err, value)
		}
	}
}

func checkEncryptedRelationNativeTwin(t *testing.T, f *relationItemTestFixture, target *av.AttributeView, itemID, boxID string) {
	t.Helper()
	twin, err := cloneAttributeViewForFieldMutation(target)
	if err != nil {
		t.Fatal(err)
	}
	if err = twin.SetStorageContext(""); err != nil {
		t.Fatal(err)
	}
	twin.Name = "Wrong ordinary twin"
	twin.GetBlockValue(itemID).Block.Content = "Wrong ordinary value"
	if err = av.SaveAttributeView(twin); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(util.DataDir, "storage", "av", target.ID+".json")
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = os.Remove(path); cache.ClearAVCache(); av.SetAVBoxID(target.ID, boxID) }()
	checkNativeRelationCarrierStorage(t, f, itemID, boxID, "")
	after, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(before, after) {
		t.Fatalf("native encrypted flow changed ordinary twin: %v", err)
	}
}

func checkEncryptedRelationSubItems(t *testing.T, f *relationItemTestFixture, rootID, boxID string) {
	t.Helper()
	original, err := av.ParseAttributeViewWithStorageContext(f.target.ID, boxID)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := av.SaveAttributeView(original); err != nil {
			t.Error(err)
		}
		av.SetAVBoxID(f.target.ID, boxID)
	}()
	source, err := cloneAttributeViewForFieldMutation(original)
	if err != nil {
		t.Fatal(err)
	}
	parentKey, childKey, parentID, childID := ast.NewNodeID(), ast.NewNodeID(), ast.NewNodeID(), ast.NewNodeID()
	source.SubItems = &av.SubItemsConfig{Enabled: true, ParentKeyID: parentKey, ChildrenKeyID: childKey}
	source.KeyValues = append(source.KeyValues,
		&av.KeyValues{Key: &av.Key{ID: parentKey, Type: av.KeyTypeRelation, Relation: &av.Relation{AvID: source.ID, IsTwoWay: true, BackKeyID: childKey}}},
		&av.KeyValues{Key: &av.Key{ID: childKey, Type: av.KeyTypeRelation, Relation: &av.Relation{AvID: source.ID, IsTwoWay: true, BackKeyID: parentKey}}})
	for _, id := range []string{parentID, childID} {
		source.GetBlockKeyValues().Values = append(source.GetBlockKeyValues().Values, &av.Value{ID: ast.NewNodeID(), KeyID: source.GetBlockKey().ID,
			BlockID: id, Type: av.KeyTypeBlock, IsDetached: true, Block: &av.ValueBlock{Content: "Encrypted child"}})
		source.Views[0].ItemIDs = append(source.Views[0].ItemIDs, id)
	}
	if err = source.SetSubItemsParents(map[string]string{parentID: rootID, childID: parentID}); err != nil {
		t.Fatal(err)
	}
	source.Automations = &av.AutomationConfig{Spec: 1, Rules: []*av.AutomationRule{{ID: ast.NewNodeID(), Name: "Child changed", Enabled: true,
		Trigger: "changed", KeyID: childKey, Actions: []*av.AutomationAction{{Type: "edit", Target: "current", Fields: map[string]*av.AutomationValue{
			f.textKeyID: {Mode: "static", Value: &av.Value{Type: av.KeyTypeText, Text: &av.ValueText{Content: "Encrypted automated reparent"}}},
		}}}}}}
	if err = av.SaveAttributeView(source); err != nil {
		t.Fatal(err)
	}
	operation := relationSubItemsChange(source, rootID, childKey, []string{childID}, nil)
	operation.BlockID = f.targetBlockID
	tx := runRelationSubItemsChanges(t, operation)
	current, err := av.ParseAttributeViewWithStorageContext(source.ID, boxID)
	if err != nil || current.GetValue(f.textKeyID, rootID).Text.Content != "Encrypted automated reparent" {
		t.Fatalf("encrypted delta omitted automation: %v", err)
	}
	for _, step := range []struct {
		ops    []*Operation
		parent string
	}{{tx.UndoOperations, parentID}, {tx.DoOperations, rootID}} {
		av.SetAVBoxID(source.ID, "")
		if err = PerformTxSync(&Transaction{DoOperations: cloneOperations(step.ops), isReplay: true}); err != nil {
			t.Fatal(err)
		}
		current, err = av.ParseAttributeViewWithStorageContext(source.ID, boxID)
		if err != nil {
			t.Fatal(err)
		}
		index, err := current.BuildSubItemsIndex()
		if err != nil || index.Parents[childID] != step.parent {
			t.Fatalf("encrypted reparent replay lost prior edge: %v", err)
		}
	}
	if _, err = os.Stat(filepath.Join(util.DataDir, "storage", "av", source.ID+".json")); !os.IsNotExist(err) {
		t.Fatal("encrypted reparent created an ordinary database")
	}
}

func TestRelationDetailSubItemsCellUndoOrdinary(t *testing.T) {
	f, ids, context := setupRelationDetailMutation(t)
	if err := PerformTxSync(&Transaction{DoOperations: []*Operation{detailChange(f, context, ids[:1], nil)}}); err != nil {
		t.Fatal(err)
	}
	checkRelationDetailSubItemsCellUndo(t, f, ids[0], "")
}

func checkRelationDetailSubItemsCellUndo(t *testing.T, f *relationItemTestFixture, rootID, boxID string) {
	t.Helper()
	original, err := av.ParseAttributeViewWithStorageContext(f.target.ID, boxID)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := av.SaveAttributeView(original); err != nil {
			t.Error(err)
		}
		av.SetAVBoxID(f.target.ID, boxID)
	}()
	target, err := cloneAttributeViewForFieldMutation(original)
	if err != nil {
		t.Fatal(err)
	}
	parentKey, childKey, parentID, childID := ast.NewNodeID(), ast.NewNodeID(), ast.NewNodeID(), ast.NewNodeID()
	target.SubItems = &av.SubItemsConfig{Enabled: true, ParentKeyID: parentKey, ChildrenKeyID: childKey}
	target.Automations = nil
	target.KeyValues = append(target.KeyValues,
		&av.KeyValues{Key: &av.Key{ID: parentKey, Type: av.KeyTypeRelation, Relation: &av.Relation{AvID: target.ID, IsTwoWay: true, BackKeyID: childKey}}},
		&av.KeyValues{Key: &av.Key{ID: childKey, Type: av.KeyTypeRelation, Relation: &av.Relation{AvID: target.ID, IsTwoWay: true, BackKeyID: parentKey}}})
	for _, id := range []string{parentID, childID} {
		target.GetBlockKeyValues().Values = append(target.GetBlockKeyValues().Values, &av.Value{ID: ast.NewNodeID(), KeyID: target.GetBlockKey().ID,
			BlockID: id, Type: av.KeyTypeBlock, IsDetached: true, Block: &av.ValueBlock{Content: "Sub-item"}})
		target.Views[0].ItemIDs = append(target.Views[0].ItemIDs, id)
	}
	if err = target.SetSubItemsParents(map[string]string{rootID: parentID, childID: parentID}); err != nil {
		t.Fatal(err)
	}
	for _, related := range []bool{false, true} {
		for _, parent := range []bool{false, true} {
			for _, batch := range []bool{false, true} {
				name := map[bool]string{false: "native", true: "related"}[related] + "/" +
					map[bool]string{false: "children", true: "parent"}[parent] + "/" + map[bool]string{false: "single", true: "batch"}[batch]
				t.Run(name, func(t *testing.T) {
					if err := av.SaveAttributeView(target); err != nil {
						t.Fatal(err)
					}
					wrongBox := ast.NewNodeID()
					twinPath := ""
					var twinBytes []byte
					if boxID != "" {
						twin, cloneErr := cloneAttributeViewForFieldMutation(target)
						if cloneErr != nil {
							t.Fatal(cloneErr)
						}
						if err := twin.SetStorageContext(""); err != nil {
							t.Fatal(err)
						}
						twin.Name = "Ordinary twin"
						if err := av.SaveAttributeView(twin); err != nil {
							t.Fatal(err)
						}
						twinPath, _ = twin.StoragePath()
						twinBytes, err = os.ReadFile(twinPath)
						if err != nil {
							t.Fatal(err)
						}
						defer func() { _ = os.Remove(twinPath); cache.ClearAVCache() }()
						wrongBox = ""
					}
					keyID, beforeIDs, trackedID, afterParent := childKey, []string{}, childID, rootID
					if parent {
						keyID, beforeIDs, trackedID, afterParent = parentKey, []string{parentID}, rootID, childID
					}
					operation := &Operation{Action: "updateAttrViewCell", AvID: target.ID, BlockID: f.targetBlockID,
						RowID: rootID, KeyID: keyID, Data: &av.Value{Type: av.KeyTypeRelation, Relation: &av.ValueRelation{BlockIDs: []string{childID}}}}
					if related {
						operation.BlockID = f.sourceBlockID
						operation.RelationContext = &AttributeViewRelationContext{SourceAvID: f.source.ID, SourceItemID: f.itemIDs[1], RelationKeyID: f.keyID}
						previousSaved := av.AttributeViewSaved
						av.AttributeViewSaved = func(id, savedBox string) {
							if previousSaved != nil {
								previousSaved(id, savedBox)
							}
							if id == target.ID {
								av.SetAVBoxID(id, wrongBox)
							}
						}
						defer func() { av.AttributeViewSaved = previousSaved }()
					}
					inverse := *operation
					inverse.Data = &av.Value{Type: av.KeyTypeRelation, Relation: &av.ValueRelation{BlockIDs: beforeIDs}}
					if batch {
						operation.Action, inverse.Action = "updateAttrViewCells", "updateAttrViewCells"
						operation.CellUpdates = []*AttrViewCellUpdate{{RowID: rootID, KeyID: keyID, Data: operation.Data}}
						inverse.CellUpdates = []*AttrViewCellUpdate{{RowID: rootID, KeyID: keyID, Data: inverse.Data}}
					}
					av.SetAVBoxID(target.ID, wrongBox)
					tx := &Transaction{fromAPI: true, DoOperations: []*Operation{operation,
						{Action: "doUpdateUpdated", ID: operation.BlockID, Data: util.CurrentTimeSecondsStr()}}, UndoOperations: []*Operation{&inverse}}
					if err := PerformTxSync(tx); err != nil {
						t.Fatal(err)
					}
					tree, loadErr := LoadTreeByBlockIDInExactBox(operation.BlockID, boxID)
					if loadErr != nil {
						t.Fatal(loadErr)
					}
					entry := GlobalUndoLog.Peek(tree.ID)
					if entry == nil {
						t.Fatal("sub-item cell was not recorded in the native undo log")
					}
					assertSnapshot := func(operation *Operation) {
						t.Helper()
						if state := operation.attributeViewFields; state == nil || !state.storageKnown || state.boxID != boxID {
							t.Fatalf("sub-item cell snapshot lost domain: %+v, expected known %q", state, boxID)
						}
					}
					assertSnapshot(operation)
					captured := operation.attributeViewFields
					captured.boxID, captured.storageKnown = wrongBox, false
					undo, redo := entry.UndoOperationsForReplay(), entry.DoOperationsForReplay()
					for _, operations := range [][]*Operation{undo, redo} {
						assertSnapshot(operations[0])
						operations[0].attributeViewFields.boxID = wrongBox
						operations[0].attributeViewFields.storageKnown = false
					}
					captured.boxID, captured.storageKnown = boxID, true
					undo, redo = entry.UndoOperationsForReplay(), entry.DoOperationsForReplay()
					assertSnapshot(undo[0])
					assertSnapshot(redo[0])
					for _, step := range []struct {
						ops    []*Operation
						parent string
					}{{nil, afterParent}, {undo, parentID}, {redo, afterParent}} {
						av.SetAVBoxID(target.ID, wrongBox)
						if step.ops != nil {
							if err := PerformTxSync(&Transaction{isReplay: true, DoOperations: step.ops}); err != nil {
								t.Fatal(err)
							}
						}
						current, readErr := av.ParseAttributeViewWithStorageContext(target.ID, boxID)
						if readErr != nil {
							t.Fatal(readErr)
						}
						index, indexErr := current.BuildSubItemsIndex()
						if indexErr != nil || index.Parents[trackedID] != step.parent {
							t.Fatalf("sub-item cell replay graph mismatch: %v", indexErr)
						}
						if twinPath != "" {
							after, readErr := os.ReadFile(twinPath)
							if readErr != nil || !bytes.Equal(twinBytes, after) {
								t.Fatalf("sub-item cell replay changed ordinary twin: %v", readErr)
							}
						}
					}
				})
			}
		}
	}
}
