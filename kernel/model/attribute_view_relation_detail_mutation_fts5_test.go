// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestRelationDetailRepairConfigurationTrustedUndo(t *testing.T) {
	f, ids, context := setupRelationDetailMutation(t)
	if err := PerformTxSync(&Transaction{DoOperations: []*Operation{detailChange(f, context, ids[:1], nil)}}); err != nil {
		t.Fatal(err)
	}
	source := readAttributeViewItemsTest(t, f.source.ID)
	key, _ := source.GetKey(f.keyID)
	missingID := ast.NewNodeID()
	key.Relation.DetailView.ViewID = missingID
	if err := av.SaveAttributeView(source); err != nil {
		t.Fatal(err)
	}
	op := &Operation{Action: "setAttrViewRelationDetail", AvID: source.ID, KeyID: f.keyID, BlockID: f.sourceBlockID,
		Data: &av.RelationDetailView{Spec: 1, Enabled: true, ViewID: f.target.Views[0].ID}}
	undo := *op
	undo.Data = key.Relation.DetailView
	tx := &Transaction{fromAPI: true, DoOperations: []*Operation{op}, UndoOperations: []*Operation{&undo}}
	if err := PerformTxSync(tx); err != nil {
		t.Fatal(err)
	}
	tree, err := LoadTreeByBlockID(f.sourceBlockID)
	if err != nil {
		t.Fatal(err)
	}
	entry := GlobalUndoLog.Peek(tree.ID)
	if entry == nil {
		t.Fatal("repair was not recorded in the native undo log")
	}
	trusted := entry.UndoOperationsForReplay()
	if trusted[0].relationDetailConfig == nil || trusted[0].relationDetailConfig == tx.UndoOperations[0].relationDetailConfig {
		t.Fatal("undo log did not copy private snapshot")
	}
	encoded, err := json.Marshal(trusted)
	if err != nil {
		t.Fatal(err)
	}
	var forged []*Operation
	if err = json.Unmarshal(encoded, &forged); err != nil {
		t.Fatal(err)
	}
	if err = PerformTxSync(&Transaction{DoOperations: forged, isReplay: true}); err == nil {
		t.Fatal("JSON replay forged permission to restore an invalid view")
	}
	for _, step := range []struct {
		ops    []*Operation
		viewID string
	}{{trusted, missingID}, {entry.DoOperationsForReplay(), f.target.Views[0].ID}} {
		if err = PerformTxSync(&Transaction{DoOperations: step.ops, isReplay: true}); err != nil {
			t.Fatal(err)
		}
		current := readAttributeViewItemsTest(t, source.ID)
		currentKey, _ := current.GetKey(f.keyID)
		if currentKey.Relation.DetailView.ViewID != step.viewID {
			t.Fatal("trusted replay restored the wrong display configuration")
		}
		assertContextFilterRelationIDs(t, current.GetValue(f.keyID, context.SourceItemID), ids[0])
		_, _, _, renderErr := RenderAttributeViewWithTargetOptions(f.sourceBlockID, f.target.ID, "", "", 1, 50, nil,
			"", false, false, "", "", AttributeViewRenderOptions{RelationContext: context})
		if step.viewID == missingID && !errors.Is(renderErr, av.ErrViewNotFound) || step.viewID != missingID && renderErr != nil {
			t.Fatalf("restored invalid view did not fail closed: %v", renderErr)
		}
	}
	for _, mode := range []string{"changed", "retarget", "deleted"} {
		current := readAttributeViewItemsTest(t, source.ID)
		currentKey, _ := current.GetKey(f.keyID)
		switch mode {
		case "changed":
			currentKey.Relation.DetailView = nil
		case "retarget":
			currentKey.Relation.AvID = ast.NewNodeID()
		case "deleted":
			for i, kv := range current.KeyValues {
				if kv.Key.ID == f.keyID {
					current.KeyValues = append(current.KeyValues[:i], current.KeyValues[i+1:]...)
					break
				}
			}
		}
		if err = av.SaveAttributeView(current); err != nil {
			t.Fatal(err)
		}
		if err = PerformTxSync(&Transaction{DoOperations: entry.UndoOperationsForReplay(), isReplay: true}); err == nil {
			t.Fatalf("trusted undo overwrote %s configuration", mode)
		}
		current = readAttributeViewItemsTest(t, source.ID)
		current.KeyValues = source.KeyValues
		key, _ = current.GetKey(f.keyID)
		key.Relation.AvID = f.target.ID
		key.Relation.DetailView = &av.RelationDetailView{Spec: 1, Enabled: true, ViewID: f.target.Views[0].ID}
		if err = av.SaveAttributeView(current); err != nil {
			t.Fatal(err)
		}
	}
	if err = PerformTxSync(&Transaction{DoOperations: entry.UndoOperationsForReplay(), isReplay: true}); err != nil {
		t.Fatal(err)
	}
	target := readAttributeViewItemsTest(t, f.target.ID)
	target.Views[0].ID = ast.NewNodeID()
	if err = av.SaveAttributeView(target); err != nil {
		t.Fatal(err)
	}
	if err = PerformTxSync(&Transaction{DoOperations: entry.DoOperationsForReplay(), isReplay: true}); err == nil {
		t.Fatal("redo restored a view that no longer exists")
	}
}

func TestRelationDetailOneWayAndConfigurationUndo(t *testing.T) {
	f, ids, context := setupRelationDetailMutation(t)
	key, _ := f.source.GetKey(f.keyID)
	key.Relation.IsTwoWay, key.Relation.BackKeyID = false, ""
	if err := av.SaveAttributeView(f.source); err != nil {
		t.Fatal(err)
	}
	if err := PerformTxSync(&Transaction{DoOperations: []*Operation{detailChange(f, context, ids[:1], nil)}}); err != nil {
		t.Fatal(err)
	}
	assertContextFilterRelationIDs(t, readAttributeViewItemsTest(t, f.source.ID).GetValue(f.keyID, context.SourceItemID), ids[0])
	if readAttributeViewItemsTest(t, f.target.ID).GetValue(f.backKeyID, ids[0]) != nil {
		t.Fatal("one-way relation wrote a reverse field")
	}
	op := &Operation{Action: "setAttrViewRelationDetail", AvID: f.source.ID, KeyID: f.keyID, BlockID: f.sourceBlockID, Data: nil}
	undo := &Operation{Action: op.Action, AvID: op.AvID, KeyID: op.KeyID, BlockID: op.BlockID, Data: key.Relation.DetailView}
	tx := &Transaction{DoOperations: []*Operation{op}, UndoOperations: []*Operation{undo}}
	tx.MarkFromAPI()
	if err := PerformTxSync(tx); err != nil {
		t.Fatal(err)
	}
	currentKey, _ := readAttributeViewItemsTest(t, f.source.ID).GetKey(f.keyID)
	if currentKey.Relation.DetailView != nil {
		t.Fatal("clearing detail configuration failed")
	}
	if err := PerformTxSync(&Transaction{DoOperations: cloneOperations(tx.UndoOperations), isReplay: true}); err != nil {
		t.Fatal(err)
	}
	currentKey, _ = readAttributeViewItemsTest(t, f.source.ID).GetKey(f.keyID)
	if currentKey.Relation.DetailView == nil || !currentKey.Relation.DetailView.Enabled {
		t.Fatal("configuration undo failed")
	}
}

func TestRelationDetailCreationLinkFailureRestoresTargets(t *testing.T) {
	f, _, context := setupRelationDetailMutation(t)
	key, _ := f.source.GetKey(f.keyID)
	key.Relation.CandidateFilters = []*av.ViewFilter{{Column: f.target.GetBlockKey().ID, Operator: av.FilterOperatorContains,
		Value: &av.Value{Type: av.KeyTypeBlock, Block: &av.ValueBlock{Content: "required"}}}}
	if err := av.SaveAttributeView(f.source); err != nil {
		t.Fatal(err)
	}
	before := map[string][]byte{}
	for _, view := range []*av.AttributeView{f.source, f.target} {
		path, _ := av.FindAttributeViewPath(view.ID)
		before[path], _ = os.ReadFile(path)
	}
	preview := PreviewAttributeViewRelationItem(f.source.ID, f.sourceBlockID, f.keyID, "Rejected new item")
	_, err := CreateAttributeViewRelationDetailItem(f.source.ID, f.sourceBlockID, f.keyID, "Rejected new item",
		[]*AttributeViewRelationItemCell{{ItemID: context.SourceItemID}}, preview, false, context)
	if err == nil {
		t.Fatal("ineligible created target was linked")
	}
	for path, data := range before {
		after, readErr := os.ReadFile(path)
		if readErr != nil || !bytes.Equal(data, after) {
			t.Fatalf("failed new-and-link left changes in %s: %v", path, readErr)
		}
	}
}

func TestRelationDetailSaveFailureAndInterruptedRecovery(t *testing.T) {
	for _, mode := range []string{"source-save", "interrupted"} {
		t.Run(mode, func(t *testing.T) {
			f, ids, context := setupRelationDetailMutation(t)
			before := map[string][]byte{}
			for _, view := range []*av.AttributeView{f.source, f.target} {
				path, _ := av.FindAttributeViewPath(view.ID)
				before[path], _ = os.ReadFile(path)
			}
			previousSaved := av.AttributeViewSaved
			var release func()
			if mode == "source-save" {
				av.AttributeViewSaved = func(id, box string) {
					if id == f.target.ID {
						release = av.RecordSourceWrites(f.source, func() bool { return true }, func(string, []byte, []byte) error {
							release()
							return errors.New("injected source save failure")
						})
					}
				}
			}
			t.Cleanup(func() {
				av.AttributeViewSaved = previousSaved
				if release != nil {
					release()
				}
			})
			tx := &Transaction{DoOperations: []*Operation{detailChange(f, context, ids[:1], nil)}, fromAPI: true, m: &sync.Mutex{}}
			if mode == "source-save" {
				if err := PerformTxSync(tx); err == nil {
					t.Fatal("source save failure was accepted")
				}
			} else {
				if err := tx.begin(); err != nil {
					t.Fatal(err)
				}
				defer func() {
					if tx.state.Load() == 1 {
						tx.rollback()
					}
				}()
				if err := tx.prepareRelationDetailOperations(); err != nil {
					t.Fatal(err)
				}
				if err := tx.updateAttrViewRelationItems(tx.DoOperations[0]); err != nil {
					t.Fatal(err)
				}
				journals, err := readDocumentSourceJournals()
				if err != nil || len(journals) != 1 || journals[0].Forward {
					t.Fatalf("missing durable relation recovery record: %v", err)
				}
				tx.finishAttributeViewMutation(false)
				tx.releaseDocumentSources(false)
				tx.state.Store(3)
				tx.m.Unlock()
				if err = recoverDocumentSources(); err != nil {
					t.Fatal(err)
				}
			}
			av.AttributeViewSaved = previousSaved
			for path, data := range before {
				after, err := os.ReadFile(path)
				if err != nil || !bytes.Equal(data, after) {
					t.Fatalf("partial relation write persisted: %s: %v", path, err)
				}
			}
		})
	}
}

func setupRelationDetailMutation(t *testing.T) (*relationItemTestFixture, []string, *AttributeViewRelationContext) {
	t.Helper()
	f := setupRelationItemTest(t, nil)
	key, _ := f.source.GetKey(f.keyID)
	key.Relation.DetailView = &av.RelationDetailView{Spec: 1, Enabled: true, ViewID: f.target.Views[0].ID}
	ids := []string{ast.NewNodeID(), ast.NewNodeID(), ast.NewNodeID()}
	for _, id := range ids {
		f.target.GetBlockKeyValues().Values = append(f.target.GetBlockKeyValues().Values, &av.Value{ID: ast.NewNodeID(), KeyID: f.target.GetBlockKey().ID,
			BlockID: id, Type: av.KeyTypeBlock, IsDetached: true, Block: &av.ValueBlock{Content: id}})
		f.target.Views[0].ItemIDs = append(f.target.Views[0].ItemIDs, id)
	}
	for _, view := range []*av.AttributeView{f.source, f.target} {
		if err := av.SaveAttributeView(view); err != nil {
			t.Fatal(err)
		}
	}
	return f, ids, &AttributeViewRelationContext{SourceAvID: f.source.ID, SourceItemID: f.itemIDs[1], RelationKeyID: f.keyID}
}

func detailChange(f *relationItemTestFixture, context *AttributeViewRelationContext, add, remove []string) *Operation {
	return &Operation{Action: "updateAttrViewRelationItems", AvID: context.SourceAvID, RowID: context.SourceItemID,
		KeyID: context.RelationKeyID, BlockID: f.sourceBlockID, Data: AttributeViewRelationItemsChange{AddItemIDs: add, RemoveItemIDs: remove}}
}

func TestRelationDetailDeltaUndoPreservesConcurrentEdges(t *testing.T) {
	f, ids, context := setupRelationDetailMutation(t)
	first := &Transaction{DoOperations: []*Operation{detailChange(f, context, ids[:1], nil)},
		UndoOperations: []*Operation{detailChange(f, context, nil, ids[:1])}}
	first.MarkFromAPI()
	if err := PerformTxSync(first); err != nil {
		t.Fatal(err)
	}
	if err := PerformTxSync(&Transaction{DoOperations: []*Operation{detailChange(f, context, ids[1:2], nil)}}); err != nil {
		t.Fatal(err)
	}
	assertContextFilterRelationIDs(t, readAttributeViewItemsTest(t, f.source.ID).GetValue(f.keyID, context.SourceItemID), ids[0], ids[1])
	if err := PerformTxSync(&Transaction{DoOperations: cloneOperations(first.UndoOperations), isReplay: true}); err != nil {
		t.Fatal(err)
	}
	assertContextFilterRelationIDs(t, readAttributeViewItemsTest(t, f.source.ID).GetValue(f.keyID, context.SourceItemID), ids[1])
	target := readAttributeViewItemsTest(t, f.target.ID)
	if target.GetBlockValue(ids[0]) == nil {
		t.Fatal("unlink deleted the target item")
	}
	assertContextFilterRelationIDs(t, target.GetValue(f.backKeyID, ids[0]))
	assertContextFilterRelationIDs(t, target.GetValue(f.backKeyID, ids[1]), context.SourceItemID)
	if err := PerformTxSync(&Transaction{DoOperations: cloneOperations(first.DoOperations), isReplay: true}); err != nil {
		t.Fatal(err)
	}
	assertContextFilterRelationIDs(t, readAttributeViewItemsTest(t, f.source.ID).GetValue(f.keyID, context.SourceItemID), ids[1], ids[0])
}

func TestRelationDetailMutationRollbackAndScope(t *testing.T) {
	f, ids, context := setupRelationDetailMutation(t)
	bad := *context
	bad.SourceItemID = ast.NewNodeID()
	if err := PerformTxSync(&Transaction{DoOperations: []*Operation{detailChange(f, context, ids[:1], nil), detailChange(f, &bad, ids[1:2], nil)}}); err == nil {
		t.Fatal("invalid second operation succeeded")
	}
	if value := readAttributeViewItemsTest(t, f.source.ID).GetValue(f.keyID, context.SourceItemID); value != nil && len(value.Relation.BlockIDs) != 0 {
		t.Fatal("failed transaction retained the first relation change")
	}
	if value := readAttributeViewItemsTest(t, f.target.ID).GetValue(f.backKeyID, ids[0]); value != nil && len(value.Relation.BlockIDs) != 0 {
		t.Fatal("failed transaction retained the reverse relation")
	}
	if err := PerformTxSync(&Transaction{DoOperations: []*Operation{detailChange(f, context, ids[:1], nil)}}); err != nil {
		t.Fatal(err)
	}
	change := func(id string) *Operation {
		return &Operation{Action: "updateAttrViewCell", AvID: f.target.ID, BlockID: f.sourceBlockID, KeyID: f.textKeyID,
			RowID: id, RelationContext: context, Data: &av.Value{Type: av.KeyTypeText, Text: &av.ValueText{Content: "Edited"}}}
	}
	if err := PerformTxSync(&Transaction{DoOperations: []*Operation{change(ids[0]), change(ids[1])}}); err == nil {
		t.Fatal("out-of-scope grouped cell operation succeeded")
	}
	if value := readAttributeViewItemsTest(t, f.target.ID).GetValue(f.textKeyID, ids[0]); value != nil && value.Text != nil && value.Text.Content != "" {
		t.Fatal("failed grouped cell operation changed an earlier cell")
	}
	if err := PerformTxSync(&Transaction{DoOperations: []*Operation{change(ids[0])}}); err != nil {
		t.Fatal(err)
	}
	if value := readAttributeViewItemsTest(t, f.target.ID).GetValue(f.textKeyID, ids[0]); value == nil || value.Text.Content != "Edited" {
		t.Fatal("in-scope cell edit was lost")
	}
}

func TestRelationDetailCandidateAdmissionAndExistingMembers(t *testing.T) {
	f, ids, context := setupRelationDetailMutation(t)
	if err := PerformTxSync(&Transaction{DoOperations: []*Operation{detailChange(f, context, ids[:1], nil)}}); err != nil {
		t.Fatal(err)
	}
	source := readAttributeViewItemsTest(t, f.source.ID)
	key, _ := source.GetKey(f.keyID)
	key.Relation.CandidateFilters = []*av.ViewFilter{{Column: f.target.GetBlockKey().ID, Operator: av.FilterOperatorContains,
		Value: &av.Value{Type: av.KeyTypeBlock, Block: &av.ValueBlock{Content: "ineligible"}}}}
	if err := av.SaveAttributeView(source); err != nil {
		t.Fatal(err)
	}
	if err := PerformTxSync(&Transaction{DoOperations: []*Operation{detailChange(f, context, ids[1:2], nil)}}); err == nil {
		t.Fatal("ineligible addition was accepted")
	}
	if err := PerformTxSync(&Transaction{DoOperations: []*Operation{detailChange(f, context, nil, ids[:1])}}); err != nil {
		t.Fatal(err)
	}
	if readAttributeViewItemsTest(t, f.target.ID).GetBlockValue(ids[0]) == nil {
		t.Fatal("removing an old ineligible edge deleted its target")
	}
}

func TestRelationDetailCreationAppendsCurrentMembershipWithoutCarrier(t *testing.T) {
	f, ids, context := setupRelationDetailMutation(t)
	if err := PerformTxSync(&Transaction{DoOperations: []*Operation{detailChange(f, context, ids[:1], nil)}}); err != nil {
		t.Fatal(err)
	}
	av.RemoveBlockRel(f.target.ID, f.targetBlockID, func(string) bool { return true })
	preview := PreviewAttributeViewRelationItem(f.source.ID, "", f.keyID, "New related item")
	if preview.Error != "" {
		t.Fatal(preview.Error)
	}
	result, err := CreateAttributeViewRelationDetailItem(f.source.ID, "", f.keyID, "New related item",
		[]*AttributeViewRelationItemCell{{ItemID: context.SourceItemID, RelatedItemIDs: []string{ids[1]}}}, preview, false, context)
	if err != nil {
		t.Fatal(err)
	}
	if !result.IsDetached {
		t.Fatal("missing default template did not create detached item")
	}
	assertContextFilterRelationIDs(t, readAttributeViewItemsTest(t, f.source.ID).GetValue(f.keyID, context.SourceItemID), ids[0], result.ItemID)
	if err = PerformTxSync(&Transaction{DoOperations: cloneOperations(result.Transaction.UndoOperations), isReplay: true}); err != nil {
		t.Fatal(err)
	}
	assertContextFilterRelationIDs(t, readAttributeViewItemsTest(t, f.source.ID).GetValue(f.keyID, context.SourceItemID), ids[0])
	if readAttributeViewItemsTest(t, f.target.ID).GetBlockValue(result.ItemID) != nil {
		t.Fatal("creation undo retained newly created target")
	}
}

func TestRelationDetailSelfRelationAndDistinctKeys(t *testing.T) {
	for _, self := range []bool{false, true} {
		t.Run(map[bool]string{false: "same-target-two-keys", true: "self-relation"}[self], func(t *testing.T) {
			f, ids, context := setupRelationDetailMutation(t)
			key, _ := f.source.GetKey(f.keyID)
			if self {
				f.target = f.source
				ids = f.itemIDs[:1]
				key.Relation.AvID = f.source.ID
				key.Relation.DetailView.ViewID = f.source.Views[0].ID
				f.backKeyID = ast.NewNodeID()
				key.Relation.BackKeyID = f.backKeyID
				f.source.KeyValues = append(f.source.KeyValues, &av.KeyValues{Key: &av.Key{ID: f.backKeyID, Type: av.KeyTypeRelation,
					Relation: &av.Relation{AvID: f.source.ID, IsTwoWay: true, BackKeyID: f.keyID}}})
			}
			secondKeyID := ast.NewNodeID()
			f.source.KeyValues = append(f.source.KeyValues, &av.KeyValues{Key: &av.Key{ID: secondKeyID, Type: av.KeyTypeRelation,
				Relation: &av.Relation{AvID: f.target.ID, DetailView: &av.RelationDetailView{Spec: 1, Enabled: true, ViewID: f.target.Views[0].ID}}}})
			if err := av.SaveAttributeView(f.source); err != nil {
				t.Fatal(err)
			}
			tx := &Transaction{DoOperations: []*Operation{detailChange(f, context, ids[:1], nil)}, UndoOperations: []*Operation{detailChange(f, context, nil, ids[:1])}, fromAPI: true}
			if err := PerformTxSync(tx); err != nil {
				t.Fatal(err)
			}
			if self {
				current := readAttributeViewItemsTest(t, f.source.ID)
				assertContextFilterRelationIDs(t, current.GetValue(f.backKeyID, ids[0]), context.SourceItemID)
			}
			secondContext := &AttributeViewRelationContext{SourceAvID: f.source.ID, SourceItemID: context.SourceItemID, RelationKeyID: secondKeyID}
			view, _, _, err := RenderAttributeViewWithTargetOptions(f.sourceBlockID, f.target.ID, "", "", 1, 50, nil, "", false, false, "", "", AttributeViewRenderOptions{RelationContext: secondContext})
			if err != nil || view.(*av.Table).RowCount != 0 {
				t.Fatalf("relation keys leaked memberships: %v", err)
			}
			if err = PerformTxSync(&Transaction{DoOperations: cloneOperations(tx.UndoOperations), isReplay: true}); err != nil {
				t.Fatal(err)
			}
			assertContextFilterRelationIDs(t, readAttributeViewItemsTest(t, f.source.ID).GetValue(f.keyID, context.SourceItemID))
			if self {
				before := len(readAttributeViewItemsTest(t, f.source.ID).GetBlockKeyValues().Values)
				preview := PreviewAttributeViewRelationItem(f.source.ID, f.sourceBlockID, f.keyID, "Self child")
				created, createErr := CreateAttributeViewRelationDetailItem(f.source.ID, f.sourceBlockID, f.keyID, "Self child", []*AttributeViewRelationItemCell{{ItemID: context.SourceItemID}}, preview, false, context)
				if createErr != nil {
					t.Fatal(createErr)
				}
				current := readAttributeViewItemsTest(t, f.source.ID)
				if len(current.GetBlockKeyValues().Values) != before+1 {
					t.Fatal("self relation creation duplicated or lost rows")
				}
				assertContextFilterRelationIDs(t, current.GetValue(f.keyID, context.SourceItemID), created.ItemID)
			}
		})
	}
}

func TestRelationDetailBatchNoopUndoPreservesExistingEdges(t *testing.T) {
	f, ids, context := setupRelationDetailMutation(t)
	if err := PerformTxSync(&Transaction{DoOperations: []*Operation{detailChange(f, context, ids[:1], nil)}}); err != nil {
		t.Fatal(err)
	}
	tx := &Transaction{DoOperations: []*Operation{detailChange(f, context, ids[:1], nil), detailChange(f, context, ids[1:2], nil)},
		UndoOperations: []*Operation{detailChange(f, context, nil, ids[1:2]), detailChange(f, context, nil, ids[:1])}, fromAPI: true}
	if err := PerformTxSync(tx); err != nil {
		t.Fatal(err)
	}
	if err := PerformTxSync(&Transaction{DoOperations: cloneOperations(tx.UndoOperations), isReplay: true}); err != nil {
		t.Fatal(err)
	}
	assertContextFilterRelationIDs(t, readAttributeViewItemsTest(t, f.source.ID).GetValue(f.keyID, context.SourceItemID), ids[0])
	assertContextFilterRelationIDs(t, readAttributeViewItemsTest(t, f.target.ID).GetValue(f.backKeyID, ids[0]), context.SourceItemID)
}

func TestRelationDetailRepeatedAndInterleavedUndo(t *testing.T) {
	for _, mode := range []string{"repeated-add", "repeated-remove", "interleaved-keys"} {
		t.Run(mode, func(t *testing.T) {
			f, ids, context := setupRelationDetailMutation(t)
			var do, undo []*Operation
			var expected []string
			if mode != "repeated-add" {
				if err := PerformTxSync(&Transaction{DoOperations: []*Operation{detailChange(f, context, ids[:1], nil)}}); err != nil {
					t.Fatal(err)
				}
				expected = ids[:1]
			}
			var otherContext *AttributeViewRelationContext
			switch mode {
			case "repeated-add":
				do = []*Operation{detailChange(f, context, ids[:1], nil), detailChange(f, context, ids[:1], nil)}
				undo = []*Operation{detailChange(f, context, nil, ids[:1]), detailChange(f, context, nil, ids[:1])}
			case "repeated-remove":
				do = []*Operation{detailChange(f, context, nil, ids[:1]), detailChange(f, context, nil, ids[:1])}
				undo = []*Operation{detailChange(f, context, ids[:1], nil), detailChange(f, context, ids[:1], nil)}
			default:
				source := readAttributeViewItemsTest(t, f.source.ID)
				otherKey := ast.NewNodeID()
				source.KeyValues = append(source.KeyValues, &av.KeyValues{Key: &av.Key{ID: otherKey, Type: av.KeyTypeRelation, Relation: &av.Relation{AvID: f.target.ID}}})
				if err := av.SaveAttributeView(source); err != nil {
					t.Fatal(err)
				}
				otherContext = &AttributeViewRelationContext{SourceAvID: f.source.ID, SourceItemID: context.SourceItemID, RelationKeyID: otherKey}
				do = []*Operation{detailChange(f, context, ids[:1], nil), detailChange(f, otherContext, ids[1:2], nil), detailChange(f, context, ids[2:], nil), detailChange(f, otherContext, ids[1:2], nil)}
				undo = []*Operation{detailChange(f, otherContext, nil, ids[1:2]), detailChange(f, context, nil, ids[2:]), detailChange(f, otherContext, nil, ids[1:2]), detailChange(f, context, nil, ids[:1])}
			}
			tx := &Transaction{DoOperations: do, UndoOperations: undo, fromAPI: true}
			if err := PerformTxSync(tx); err != nil {
				t.Fatal(err)
			}
			changed := 0
			for _, inverse := range tx.UndoOperations {
				value := inverse.Data.(AttributeViewRelationItemsChange)
				if len(value.AddItemIDs)+len(value.RemoveItemIDs) > 0 {
					changed++
				}
			}
			wanted := 1
			if mode == "interleaved-keys" {
				wanted = 2
			}
			if changed != wanted {
				t.Fatalf("undo consumed wrong number of actual deltas: %d", changed)
			}
			if err := PerformTxSync(&Transaction{DoOperations: cloneOperations(tx.UndoOperations), isReplay: true}); err != nil {
				t.Fatal(err)
			}
			source := readAttributeViewItemsTest(t, f.source.ID)
			assertContextFilterRelationIDs(t, source.GetValue(f.keyID, context.SourceItemID), expected...)
			if otherContext != nil {
				assertContextFilterRelationIDs(t, source.GetValue(otherContext.RelationKeyID, context.SourceItemID))
			}
		})
	}
}

func TestRelationDetailBoundDocumentAndHeadingEdits(t *testing.T) {
	f, _, context := setupRelationDetailMutation(t)
	boxID, err := CreateBox("Related targets")
	if err != nil {
		t.Fatal(err)
	}
	documentID := ast.NewNodeID()
	tree := treenode.NewTree(boxID, "/"+documentID+".sy", "/Related document", "Related document")
	heading := &ast.Node{Type: ast.NodeHeading, ID: ast.NewNodeID(), HeadingLevel: 2}
	heading.SetIALAttr("id", heading.ID)
	heading.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("Heading target")})
	tree.Root.AppendChild(heading)
	var itemIDs []string
	for _, node := range []*ast.Node{tree.Root, heading} {
		itemID := ast.NewNodeID()
		itemIDs = append(itemIDs, itemID)
		node.SetIALAttr(av.NodeAttrNameAvs, f.target.ID)
		f.target.GetBlockKeyValues().Values = append(f.target.GetBlockKeyValues().Values, &av.Value{ID: ast.NewNodeID(), KeyID: f.target.GetBlockKey().ID, BlockID: itemID, Type: av.KeyTypeBlock, IsDetached: false, Block: &av.ValueBlock{ID: node.ID, Content: "Original target"}})
		f.target.Views[0].ItemIDs = append(f.target.Views[0].ItemIDs, itemID)
	}
	if _, err = filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	treenode.UpsertBlockTree(tree)
	if err = av.SaveAttributeView(f.target); err != nil {
		t.Fatal(err)
	}
	if err = PerformTxSync(&Transaction{DoOperations: []*Operation{detailChange(f, context, itemIDs, nil)}}); err != nil {
		t.Fatal(err)
	}
	var operations []*Operation
	for _, id := range itemIDs {
		operations = append(operations, &Operation{Action: "updateAttrViewCell", AvID: f.target.ID, BlockID: f.sourceBlockID, RowID: id, KeyID: f.target.GetBlockKey().ID, RelationContext: context, Data: map[string]any{"block": map[string]any{"content": "Scoped anchor"}}},
			&Operation{Action: "updateAttrViewCell", AvID: f.target.ID, BlockID: f.sourceBlockID, RowID: id, KeyID: f.textKeyID, RelationContext: context, Data: &av.Value{Type: av.KeyTypeText, Text: &av.ValueText{Content: "Scoped field"}}})
	}
	if err = PerformTxSync(&Transaction{DoOperations: operations, fromAPI: true}); err != nil {
		t.Fatal(err)
	}
	current := readAttributeViewItemsTest(t, f.target.ID)
	for i, id := range itemIDs {
		nodeID := []string{documentID, heading.ID}[i]
		node, boundTree, loadErr := getNodeByBlockID(nil, nodeID)
		if loadErr != nil || boundTree.Box != boxID || node.IALAttr(av.NodeAttrViewStaticText+"-"+f.target.ID) != "Scoped anchor" {
			t.Fatalf("scoped edit did not reach actual bound target: %v", loadErr)
		}
		if value := current.GetBlockValue(id); value.IsDetached || value.Block.ID != nodeID || value.Block.Content != "Scoped anchor" {
			t.Fatalf("bound identity changed: %+v", value)
		}
		if value := current.GetValue(f.textKeyID, id); value == nil || value.Text.Content != "Scoped field" {
			t.Fatal("scoped field edit missed bound target row")
		}
		if node.Type == ast.NodeDocument && node.IALAttr("title") != "Related document" {
			t.Fatal("native anchor edit renamed document")
		}
		if node.Type == ast.NodeHeading && string(node.FirstChild.Tokens) != "Heading target" {
			t.Fatal("native anchor edit rewrote heading")
		}
	}
	sourceNode, _, err := getNodeByBlockID(nil, f.sourceBlockID)
	if err != nil || sourceNode.IALAttr(av.NodeAttrViewStaticText+"-"+f.target.ID) != "" {
		t.Fatal("target edit wrote source carrier attributes")
	}
}

func TestRelationDetailInvalidReverseFieldFailsClosed(t *testing.T) {
	f, ids, context := setupRelationDetailMutation(t)
	for i, kv := range f.target.KeyValues {
		if kv.Key.ID == f.backKeyID {
			f.target.KeyValues = append(f.target.KeyValues[:i], f.target.KeyValues[i+1:]...)
			break
		}
	}
	if err := av.SaveAttributeView(f.target); err != nil {
		t.Fatal(err)
	}
	if err := PerformTxSync(&Transaction{DoOperations: []*Operation{detailChange(f, context, ids[:1], nil)}}); err == nil {
		t.Fatal("invalid two-way target silently accepted one-sided change")
	}
	value := readAttributeViewItemsTest(t, f.source.ID).GetValue(f.keyID, context.SourceItemID)
	if value != nil && value.Relation != nil && len(value.Relation.BlockIDs) != 0 {
		t.Fatal("invalid reverse field left a source edge")
	}
}

func TestRelationDetailCarrierlessDocumentTemplate(t *testing.T) {
	for _, mode := range []string{"explicit-notebook", "link-failure", "missing-notebook"} {
		t.Run(mode, func(t *testing.T) {
			f, _, context := setupRelationDetailMutation(t)
			av.RemoveBlockRel(f.target.ID, f.targetBlockID, func(string) bool { return true })
			template := &av.NewItemTemplate{ID: ast.NewNodeID(), Name: "Document", TargetType: av.NewItemTargetDocument, PrimaryKeyTemplate: "Planned relation document", SaveLocation: &av.NewItemSaveLocation{BoxID: f.files.box.ID, PathTemplate: "/Relation documents/"}}
			template.ContentTemplatePath, template.Icon = "/relation-owned.md", "1f600"
			if err := os.MkdirAll(filepath.Join(util.DataDir, "templates"), 0755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(util.DataDir, "templates", "relation-owned.md"), []byte("Owned template content"), 0600); err != nil {
				t.Fatal(err)
			}
			if mode == "missing-notebook" {
				template.SaveLocation.BoxID = ""
			}
			if err := f.target.SetNewItemTemplates(&av.NewItemTemplatesConfig{Templates: []*av.NewItemTemplate{template}, DefaultTemplateID: template.ID}); err != nil {
				t.Fatal(err)
			}
			if err := av.SaveAttributeView(f.target); err != nil {
				t.Fatal(err)
			}
			if legacy := PreviewAttributeViewRelationItem(f.source.ID, "", f.keyID, "Input"); legacy.Error == "" {
				t.Fatal("unscoped carrierless document preview changed behavior")
			}
			preview := PreviewAttributeViewRelationItem(f.source.ID, "", f.keyID, "Input", context)
			if mode == "missing-notebook" {
				if preview.Error == "" {
					t.Fatal("carrierless document guessed a notebook")
				}
				return
			}
			if preview.Error != "" {
				t.Fatal(preview.Error)
			}
			if mode == "link-failure" {
				source := readAttributeViewItemsTest(t, f.source.ID)
				key, _ := source.GetKey(f.keyID)
				key.Relation.CandidateFilters = []*av.ViewFilter{{Column: f.target.GetBlockKey().ID, Operator: av.FilterOperatorContains, Value: &av.Value{Type: av.KeyTypeBlock, Block: &av.ValueBlock{Content: "not eligible"}}}}
				if err := av.SaveAttributeView(source); err != nil {
					t.Fatal(err)
				}
			}
			countDocs := func() int {
				count := 0
				_ = filepath.WalkDir(filepath.Join(util.DataDir, f.files.box.ID), func(path string, entry os.DirEntry, err error) error {
					if err == nil && !entry.IsDir() && filepath.Ext(path) == ".sy" {
						count++
					}
					return err
				})
				return count
			}
			beforeDocs := countDocs()
			result, err := CreateAttributeViewRelationDetailItem(f.source.ID, "", f.keyID, "Input", []*AttributeViewRelationItemCell{{ItemID: context.SourceItemID}}, preview, true, context)
			if mode == "link-failure" {
				if err == nil {
					t.Fatal("ineligible new document was linked")
				}
				if countDocs() != beforeDocs {
					t.Fatal("failed link retained created document or parent")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if result.IsDetached || result.BlockID == "" || result.Content != "Input" {
				t.Fatalf("carrierless template did not follow input title: %+v", result)
			}
			tree, err := LoadTreeByBlockID(result.BlockID)
			if err != nil || tree.Box != f.files.box.ID || tree.Root.IALAttr("title") != "Input" {
				t.Fatalf("document planned in wrong notebook: %v", err)
			}
			assertContextFilterRelationIDs(t, readAttributeViewItemsTest(t, f.source.ID).GetValue(f.keyID, context.SourceItemID), result.ItemID)
			if err = PerformTxSync(&Transaction{DoOperations: cloneOperations(result.Transaction.UndoOperations), isReplay: true}); err != nil {
				t.Fatal(err)
			}
			if readAttributeViewItemsTest(t, f.target.ID).GetBlockValue(result.ItemID) != nil {
				t.Fatal("carrierless document undo retained target item")
			}
		})
	}
}

func TestRelationDetailRetargetDeletedViewUndo(t *testing.T) {
	f, _, _ := setupRelationDetailMutation(t)
	key, _ := f.source.GetKey(f.keyID)
	key.Relation.DetailView.ViewID = ast.NewNodeID()
	original := *key.Relation.DetailView
	if err := av.SaveAttributeView(f.source); err != nil {
		t.Fatal(err)
	}
	other := av.NewAttributeView(ast.NewNodeID())
	if err := av.SaveAttributeView(other); err != nil {
		t.Fatal(err)
	}
	tx := &Transaction{fromAPI: true,
		DoOperations: []*Operation{{Action: "updateAttrViewColRelation", AvID: f.source.ID, KeyID: f.keyID,
			ID: other.ID, BlockID: f.sourceBlockID}, {Action: "doUpdateUpdated", ID: f.sourceBlockID, Data: util.CurrentTimeSecondsStr()}},
		UndoOperations: []*Operation{{Action: "updateAttrViewColRelation", AvID: f.source.ID, KeyID: f.keyID,
			ID: f.target.ID, BlockID: f.sourceBlockID, IsTwoWay: true, BackRelationKeyID: f.backKeyID},
			{Action: "setAttrViewRelationDetail", AvID: f.source.ID, KeyID: f.keyID, Data: &original}}}
	payload, err := json.Marshal(tx.UndoOperations[1].Data)
	if err != nil || json.Unmarshal(payload, &tx.UndoOperations[1].Data) != nil {
		t.Fatal("configuration fixture did not use the client JSON shape")
	}
	if err := PerformTxSync(tx); err != nil {
		t.Fatal(err)
	}
	tree, err := LoadTreeByBlockID(f.sourceBlockID)
	if err != nil {
		t.Fatal(err)
	}
	entry := GlobalUndoLog.Peek(tree.ID)
	if entry == nil {
		t.Fatal("retarget was not recorded in the native undo log")
	}
	for range 2 {
		if err = PerformTxSync(&Transaction{DoOperations: entry.UndoOperationsForReplay(), isReplay: true}); err != nil {
			t.Fatalf("retarget undo did not restore original repairable configuration: %v", err)
		}
		current := readAttributeViewItemsTest(t, f.source.ID)
		currentKey, _ := current.GetKey(f.keyID)
		if currentKey.Relation.AvID != f.target.ID || currentKey.Relation.DetailView == nil ||
			currentKey.Relation.DetailView.Spec != original.Spec || currentKey.Relation.DetailView.Enabled != original.Enabled ||
			currentKey.Relation.DetailView.ViewID != original.ViewID {
			t.Fatalf("retarget undo lost original configuration: %+v", currentKey.Relation)
		}
		if err = PerformTxSync(&Transaction{DoOperations: entry.DoOperationsForReplay(), isReplay: true}); err != nil {
			t.Fatal(err)
		}
		current = readAttributeViewItemsTest(t, f.source.ID)
		currentKey, _ = current.GetKey(f.keyID)
		if currentKey.Relation.AvID != other.ID || currentKey.Relation.DetailView != nil {
			t.Fatalf("retarget redo restored the wrong configuration: %+v", currentKey.Relation)
		}
	}
	current := readAttributeViewItemsTest(t, f.source.ID)
	currentKey, _ := current.GetKey(f.keyID)
	currentKey.Relation.DetailView = &av.RelationDetailView{Spec: 1, Enabled: true, ViewID: other.Views[0].ID}
	if err = av.SaveAttributeView(current); err != nil {
		t.Fatal(err)
	}
	if err = PerformTxSync(&Transaction{DoOperations: entry.UndoOperationsForReplay(), isReplay: true}); err == nil {
		t.Fatal("retarget undo cleared a later configuration before checking it")
	}
	current = readAttributeViewItemsTest(t, f.source.ID)
	currentKey, _ = current.GetKey(f.keyID)
	if currentKey.Relation.AvID != other.ID || currentKey.Relation.DetailView == nil || currentKey.Relation.DetailView.ViewID != other.Views[0].ID {
		t.Fatal("rejected retarget undo changed the current target or display configuration")
	}
	currentKey.Relation.DetailView = nil
	if err = av.SaveAttributeView(current); err != nil {
		t.Fatal(err)
	}
	payload, err = json.Marshal(entry.UndoOperationsForReplay())
	var forged []*Operation
	if err != nil || json.Unmarshal(payload, &forged) != nil {
		t.Fatal("configuration replay fixture was not serializable")
	}
	if err = PerformTxSync(&Transaction{DoOperations: forged, isReplay: true}); err == nil {
		t.Fatal("JSON retarget undo forged permission to restore an invalid configuration")
	}
	current = readAttributeViewItemsTest(t, f.source.ID)
	currentKey, _ = current.GetKey(f.keyID)
	if currentKey.Relation.AvID != other.ID || currentKey.Relation.DetailView != nil {
		t.Fatal("failed retarget and setter pair did not roll back together")
	}
}
