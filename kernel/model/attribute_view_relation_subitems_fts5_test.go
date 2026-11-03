// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"bytes"
	"encoding/json"
	"errors"
	"maps"
	"os"
	"slices"
	"sync"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
)

func relationSubItemsChange(source *av.AttributeView, rowID, keyID string, add, remove []string) *Operation {
	return &Operation{Action: "updateAttrViewRelationItems", AvID: source.ID, RowID: rowID, KeyID: keyID,
		Data: AttributeViewRelationItemsChange{AddItemIDs: add, RemoveItemIDs: remove}}
}

func runRelationSubItemsChanges(t *testing.T, operations ...*Operation) *Transaction {
	t.Helper()
	undo := make([]*Operation, len(operations))
	for i, operation := range operations {
		inverse := *operation
		change := operation.Data.(AttributeViewRelationItemsChange)
		inverse.Data = AttributeViewRelationItemsChange{AddItemIDs: slices.Clone(change.RemoveItemIDs), RemoveItemIDs: slices.Clone(change.AddItemIDs)}
		undo[len(operations)-1-i] = &inverse
	}
	tx := &Transaction{fromAPI: true, DoOperations: operations, UndoOperations: undo}
	if err := PerformTxSync(tx); err != nil {
		t.Fatal(err)
	}
	return tx
}

func relationSubItemsParents(t *testing.T, sourceID string) map[string]string {
	t.Helper()
	source, err := av.ParseAttributeViewWithStorageContext(sourceID, "")
	if err != nil {
		t.Fatal(err)
	}
	index, err := source.BuildSubItemsIndex()
	if err != nil {
		t.Fatal(err)
	}
	return index.Parents
}

func assertRelationSubItemsParents(t *testing.T, sourceID string, expected map[string]string) {
	t.Helper()
	if actual := relationSubItemsParents(t, sourceID); !maps.Equal(actual, expected) {
		t.Fatalf("sub-item parents: got %v, want %v", actual, expected)
	}
}

func replayRelationSubItems(t *testing.T, operations []*Operation) {
	t.Helper()
	if err := PerformTxSync(&Transaction{isReplay: true, DoOperations: cloneOperations(operations)}); err != nil {
		t.Fatal(err)
	}
}

func TestRelationDetailSubItemsUndoRedo(t *testing.T) {
	for _, mode := range []string{"native-children", "native-parent", "children-add", "children-remove", "parent-replace", "parent-select", "parent-remove"} {
		t.Run(mode, func(t *testing.T) {
			fixture, source, _, _ := setupSubItemsTest(t, false)
			ids := source.Views[0].ItemIDs
			before := relationSubItemsParents(t, source.ID)
			rowID, keyID := ids[0], source.SubItems.ChildrenKeyID
			add, remove := []string{ids[3]}, []string{}
			after := maps.Clone(before)
			after[ids[3]] = ids[0]
			switch mode {
			case "children-remove":
				add, remove = nil, []string{ids[1]}
				after[ids[1]], after[ids[3]] = "", ids[2]
			case "native-parent", "parent-replace", "parent-select":
				rowID, keyID = ids[3], source.SubItems.ParentKeyID
				add, remove = []string{ids[0]}, []string{ids[2]}
				if mode == "parent-select" {
					remove = nil
				}
			case "parent-remove":
				rowID, keyID = ids[3], source.SubItems.ParentKeyID
				add, remove = nil, []string{ids[2]}
				after[ids[3]] = ""
			}
			key, _ := source.GetKey(keyID)
			key.Relation.DetailView = &av.RelationDetailView{Spec: 1, Enabled: true, ViewID: source.Views[0].ID}
			if err := av.SaveAttributeView(source); err != nil {
				t.Fatal(err)
			}
			var tx *Transaction
			if mode == "native-children" || mode == "native-parent" {
				selected := []string{ids[1], ids[3]}
				if mode == "native-parent" {
					selected = add
				}
				tx = runSubItemsOperation(t, &Operation{Action: "updateAttrViewCell", AvID: source.ID, BlockID: fixture.sourceID,
					RowID: rowID, KeyID: keyID, Data: &av.Value{Type: av.KeyTypeRelation, Relation: &av.ValueRelation{BlockIDs: selected}}})
			} else {
				tx = runRelationSubItemsChanges(t, relationSubItemsChange(source, rowID, keyID, add, remove))
				state := tx.DoOperations[0].attributeViewRelationSubItems
				if state == nil || len(state.before) != 1 || state != tx.UndoOperations[0].attributeViewRelationSubItems ||
					!tx.UndoOperations[0].attributeViewRelationSubUndo {
					t.Fatal("relation change did not capture its exact semantic inverse")
				}
				encoded, err := json.Marshal(tx)
				if err != nil || bytes.Contains(encoded, []byte("parentKeyID")) || bytes.Contains(encoded, []byte("storageBoxID")) {
					t.Fatalf("private relation snapshot leaked: %s, %v", encoded, err)
				}
			}
			assertRelationSubItemsParents(t, source.ID, after)
			for range 3 {
				replayRelationSubItems(t, tx.UndoOperations)
				assertRelationSubItemsParents(t, source.ID, before)
				replayRelationSubItems(t, tx.DoOperations)
				assertRelationSubItemsParents(t, source.ID, after)
			}
		})
	}
}

func TestRelationDetailSubItemsConcurrentSibling(t *testing.T) {
	fixture, source, _, _ := setupSubItemsTest(t, false)
	ids := source.Views[0].ItemIDs
	sibling := ast.NewNodeID()
	source.GetBlockKeyValues().Values = append(source.GetBlockKeyValues().Values, &av.Value{ID: ast.NewNodeID(),
		KeyID: source.GetBlockKey().ID, BlockID: sibling, Type: av.KeyTypeBlock, IsDetached: true, Block: &av.ValueBlock{Content: "Concurrent child"}})
	source.Views[0].ItemIDs = append(source.Views[0].ItemIDs, sibling)
	if err := av.SaveAttributeView(source); err != nil {
		t.Fatal(err)
	}
	before := relationSubItemsParents(t, source.ID)
	tx := runRelationSubItemsChanges(t, relationSubItemsChange(source, ids[0], source.SubItems.ChildrenKeyID, []string{ids[3]}, nil))
	runSubItemsOperation(t, &Operation{Action: "reparentAttrViewItems", AvID: source.ID, BlockID: fixture.sourceID,
		SrcIDs: []string{sibling}, ParentID: ids[0]})
	before[sibling] = ids[0]
	after := maps.Clone(before)
	after[ids[3]] = ids[0]
	state := tx.DoOperations[0].attributeViewRelationSubItems
	snapshotBefore, snapshotAfter := maps.Clone(state.before), maps.Clone(state.after)
	for range 2 {
		replayRelationSubItems(t, tx.UndoOperations)
		assertRelationSubItemsParents(t, source.ID, before)
		replayRelationSubItems(t, tx.DoOperations)
		assertRelationSubItemsParents(t, source.ID, after)
	}
	if !maps.Equal(state.before, snapshotBefore) || !maps.Equal(state.after, snapshotAfter) {
		t.Fatal("replay mutated the shared undo snapshot")
	}
}

func TestRelationDetailSubItemsParentSelectionCurrentState(t *testing.T) {
	_, source, _, _ := setupSubItemsTest(t, false)
	ids := source.Views[0].ItemIDs
	keyID := source.SubItems.ParentKeyID
	before := relationSubItemsParents(t, source.ID)
	noop := runRelationSubItemsChanges(t, relationSubItemsChange(source, ids[3], keyID, []string{ids[2]}, nil))
	if change := noop.DoOperations[0].Data.(AttributeViewRelationItemsChange); len(change.AddItemIDs)+len(change.RemoveItemIDs) != 0 {
		t.Fatalf("selecting the current parent changed edges: %+v", change)
	}
	replayRelationSubItems(t, noop.UndoOperations)
	assertRelationSubItemsParents(t, source.ID, before)
	if err := PerformTxSync(&Transaction{DoOperations: []*Operation{relationSubItemsChange(source, ids[3], keyID, ids[:2], nil)}}); err == nil {
		t.Fatal("parent selection accepted multiple parents")
	}
	assertRelationSubItemsParents(t, source.ID, before)
	// 面板选择前父项被另一处改成第二项，执行与撤销必须基于此最新值。
	current := readAttributeViewItemsTest(t, source.ID)
	if err := current.SetSubItemsParents(map[string]string{ids[3]: ids[1]}); err != nil {
		t.Fatal(err)
	}
	if err := av.SaveAttributeView(current); err != nil {
		t.Fatal(err)
	}
	tx := runRelationSubItemsChanges(t, relationSubItemsChange(source, ids[3], keyID, []string{ids[0]}, nil))
	assertSubItemsParent(t, source.ID, ids[3], ids[0])
	replayRelationSubItems(t, tx.UndoOperations)
	assertSubItemsParent(t, source.ID, ids[3], ids[1])
	replayRelationSubItems(t, tx.DoOperations)
	current = readAttributeViewItemsTest(t, source.ID)
	if err := current.SetSubItemsParents(map[string]string{ids[3]: ids[2]}); err != nil {
		t.Fatal(err)
	}
	if err := av.SaveAttributeView(current); err != nil {
		t.Fatal(err)
	}
	if err := PerformTxSync(&Transaction{DoOperations: cloneOperations(tx.UndoOperations), isReplay: true}); err == nil {
		t.Fatal("parent selection undo overwrote a later parent edit")
	}
	assertSubItemsParent(t, source.ID, ids[3], ids[2])
}

func TestRelationDetailSubItemsCreateParent(t *testing.T) {
	for _, reject := range []bool{false, true} {
		t.Run(map[bool]string{false: "create-undo-redo", true: "link-failure"}[reject], func(t *testing.T) {
			_, source, _, _ := setupSubItemsTest(t, false)
			ids := source.Views[0].ItemIDs
			keyID := source.SubItems.ParentKeyID
			key, _ := source.GetKey(keyID)
			key.Relation.DetailView = &av.RelationDetailView{Spec: 1, Enabled: true, ViewID: source.Views[0].ID}
			if reject {
				key.Relation.CandidateFilters = []*av.ViewFilter{{Column: source.GetBlockKey().ID, Operator: av.FilterOperatorContains,
					Value: &av.Value{Type: av.KeyTypeBlock, Block: &av.ValueBlock{Content: "required"}}}}
			}
			if err := av.SaveAttributeView(source); err != nil {
				t.Fatal(err)
			}
			before := relationSubItemsParents(t, source.ID)
			path, _ := source.StoragePath()
			original, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			context := &AttributeViewRelationContext{SourceAvID: source.ID, SourceItemID: ids[3], RelationKeyID: keyID}
			preview := PreviewAttributeViewRelationItem(source.ID, "", keyID, "New parent", context)
			created, err := CreateAttributeViewRelationDetailItem(source.ID, "", keyID, "New parent",
				[]*AttributeViewRelationItemCell{{ItemID: ids[3]}}, preview, false, context)
			if reject {
				if err == nil {
					t.Fatal("ineligible new parent was linked")
				}
				after, readErr := os.ReadFile(path)
				if readErr != nil || !bytes.Equal(original, after) {
					t.Fatalf("failed parent creation changed the source: %v", readErr)
				}
				assertRelationSubItemsParents(t, source.ID, before)
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			assertSubItemsParent(t, source.ID, ids[3], created.ItemID)
			for range 2 {
				replayRelationSubItems(t, created.Transaction.UndoOperations)
				assertRelationSubItemsParents(t, source.ID, before)
				if readAttributeViewItemsTest(t, source.ID).GetBlockValue(created.ItemID) != nil {
					t.Fatal("parent creation undo left the new item")
				}
				replayRelationSubItems(t, created.Transaction.DoOperations)
				assertSubItemsParent(t, source.ID, ids[3], created.ItemID)
			}
		})
	}
}

func TestRelationDetailSubItemsReplayConflict(t *testing.T) {
	for _, mode := range []string{"undo", "redo", "cycle"} {
		t.Run(mode, func(t *testing.T) {
			fixture, source, _, _ := setupSubItemsTest(t, false)
			ids := source.Views[0].ItemIDs
			tx := runRelationSubItemsChanges(t, relationSubItemsChange(source, ids[0], source.SubItems.ChildrenKeyID, []string{ids[3]}, nil))
			operations := tx.UndoOperations
			if mode == "redo" {
				replayRelationSubItems(t, tx.UndoOperations)
				operations = tx.DoOperations
			}
			child, parent := ids[3], ids[1]
			if mode == "cycle" {
				child, parent = ids[2], ids[3]
			}
			runSubItemsOperation(t, &Operation{Action: "reparentAttrViewItems", AvID: source.ID, BlockID: fixture.sourceID,
				SrcIDs: []string{child}, ParentID: parent})
			path, _ := source.StoragePath()
			before, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			if err = PerformTxSync(&Transaction{isReplay: true, DoOperations: cloneOperations(operations)}); err == nil {
				t.Fatal("conflicting sub-item replay succeeded")
			}
			after, err := os.ReadFile(path)
			if err != nil || !bytes.Equal(before, after) {
				t.Fatalf("conflicting replay changed the source: %v", err)
			}
		})
	}
}

func TestRelationDetailSubItemsReplayConfiguration(t *testing.T) {
	for _, mode := range []string{"disabled", "parent-key", "storage-context", "operation-key"} {
		t.Run(mode, func(t *testing.T) {
			_, source, _, _ := setupSubItemsTest(t, false)
			ids := source.Views[0].ItemIDs
			tx := runRelationSubItemsChanges(t, relationSubItemsChange(source, ids[0], source.SubItems.ChildrenKeyID, []string{ids[3]}, nil))
			operations := cloneOperations(tx.UndoOperations)
			current := readAttributeViewItemsTest(t, source.ID)
			switch mode {
			case "disabled":
				current.SubItems.Enabled = false
			case "parent-key":
				parents, _ := current.GetKeyValues(current.SubItems.ParentKeyID)
				parents.Key.ID = ast.NewNodeID()
				for _, value := range parents.Values {
					value.KeyID = parents.Key.ID
				}
				current.SubItems.ParentKeyID = parents.Key.ID
				children, _ := current.GetKey(current.SubItems.ChildrenKeyID)
				children.Relation.BackKeyID = parents.Key.ID
			case "storage-context":
				context := *operations[0].relationDetailContext
				context.storageBoxID = ast.NewNodeID()
				operations[0].relationDetailContext = &context
			case "operation-key":
				operations[0].KeyID = current.SubItems.ParentKeyID
			}
			if err := av.SaveAttributeView(current); err != nil {
				t.Fatal(err)
			}
			path, _ := current.StoragePath()
			before, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			if err = PerformTxSync(&Transaction{isReplay: true, DoOperations: operations}); err == nil {
				t.Fatal("changed sub-item replay configuration was accepted")
			}
			after, err := os.ReadFile(path)
			if err != nil || !bytes.Equal(before, after) {
				t.Fatalf("rejected configuration replay changed the source: %v", err)
			}
		})
	}
}

func TestRelationDetailSubItemsPinnedReplay(t *testing.T) {
	_, source, _, _ := setupSubItemsTest(t, false)
	ids := source.Views[0].ItemIDs
	before := relationSubItemsParents(t, source.ID)
	tx := runRelationSubItemsChanges(t, relationSubItemsChange(source, ids[0], source.SubItems.ChildrenKeyID, []string{ids[3]}, nil))
	after := relationSubItemsParents(t, source.ID)
	otherBox := ast.NewNodeID()
	av.SetAVBoxID(source.ID, otherBox)
	t.Cleanup(func() { av.SetAVBoxID(source.ID, "") })
	for _, phase := range []struct {
		operations []*Operation
		parents    map[string]string
	}{{tx.UndoOperations, before}, {tx.DoOperations, after}} {
		operations := cloneOperations(phase.operations)
		operations[0].relationDetailContext = nil
		replayRelationSubItems(t, operations)
		assertRelationSubItemsParents(t, source.ID, phase.parents)
		if av.GetAVBoxID(source.ID) != otherBox {
			t.Fatal("scoped replay changed the global storage mapping")
		}
	}
}

func TestRelationDetailSubItemsRepeatedAndMixedOperations(t *testing.T) {
	_, source, _, _ := setupSubItemsTest(t, false)
	ids := source.Views[0].ItemIDs
	before := relationSubItemsParents(t, source.ID)
	tx := runRelationSubItemsChanges(t,
		relationSubItemsChange(source, ids[0], source.SubItems.ChildrenKeyID, []string{ids[3]}, nil),
		relationSubItemsChange(source, ids[3], source.SubItems.ParentKeyID, []string{ids[1]}, []string{ids[0]}),
		relationSubItemsChange(source, ids[0], source.SubItems.ChildrenKeyID, []string{ids[3]}, nil),
		relationSubItemsChange(source, ids[0], source.SubItems.ChildrenKeyID, []string{ids[3]}, nil))
	after := maps.Clone(before)
	after[ids[3]] = ids[0]
	for i, operation := range tx.DoOperations {
		inverse := tx.UndoOperations[len(tx.UndoOperations)-1-i]
		if operation.attributeViewRelationSubItems == nil || operation.attributeViewRelationSubItems != inverse.attributeViewRelationSubItems {
			t.Fatal("repeated operations consumed the wrong inverse")
		}
	}
	for _, operation := range []*Operation{tx.DoOperations[3], tx.UndoOperations[0]} {
		change := operation.Data.(AttributeViewRelationItemsChange)
		if len(change.AddItemIDs)+len(change.RemoveItemIDs) != 0 || len(operation.attributeViewRelationSubItems.before) != 0 {
			t.Fatal("no-op relation change acquired an inverse edge")
		}
	}
	for range 3 {
		replayRelationSubItems(t, tx.UndoOperations)
		assertRelationSubItemsParents(t, source.ID, before)
		replayRelationSubItems(t, tx.DoOperations)
		assertRelationSubItemsParents(t, source.ID, after)
	}
}

func TestRelationDetailSubItemsActualDelta(t *testing.T) {
	_, source, _, _ := setupSubItemsTest(t, false)
	ids := source.Views[0].ItemIDs
	before := relationSubItemsParents(t, source.ID)
	missing := ast.NewNodeID()
	tx := runRelationSubItemsChanges(t, relationSubItemsChange(source, ids[0], source.SubItems.ChildrenKeyID,
		[]string{ids[3], ids[3], ids[1]}, []string{missing, missing}))
	change := tx.DoOperations[0].Data.(AttributeViewRelationItemsChange)
	inverse := tx.UndoOperations[0].Data.(AttributeViewRelationItemsChange)
	if !slices.Equal(change.AddItemIDs, []string{ids[3]}) || len(change.RemoveItemIDs) != 0 ||
		len(inverse.AddItemIDs) != 0 || !slices.Equal(inverse.RemoveItemIDs, []string{ids[3]}) {
		t.Fatalf("relation delta was not normalized: do=%+v, undo=%+v", change, inverse)
	}
	replayRelationSubItems(t, tx.UndoOperations)
	assertRelationSubItemsParents(t, source.ID, before)
}

func TestRelationDetailSubItemsReplaySaveFailure(t *testing.T) {
	_, source, _, _ := setupSubItemsTest(t, false)
	ids := source.Views[0].ItemIDs
	tx := runRelationSubItemsChanges(t, relationSubItemsChange(source, ids[0], source.SubItems.ChildrenKeyID, []string{ids[3]}, nil))
	current, err := av.ParseAttributeViewWithStorageContext(source.ID, "")
	if err != nil {
		t.Fatal(err)
	}
	path, _ := current.StoragePath()
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	replay := &Transaction{isReplay: true, DoOperations: cloneOperations(tx.UndoOperations), m: &sync.Mutex{}}
	if err = replay.begin(); err != nil {
		t.Fatal(err)
	}
	defer func() {
		if replay.state.Load() == 1 {
			replay.rollback()
		}
	}()
	if err = replay.prepareRelationDetailOperations(); err != nil {
		t.Fatal(err)
	}
	release := av.RecordSourceWrites(current, func() bool { return true }, func(string, []byte, []byte) error {
		return errors.New("injected sub-item replay save failure")
	})
	defer release()
	if err = replay.updateAttrViewRelationItems(replay.DoOperations[0]); err == nil {
		t.Fatal("injected replay save failure was accepted")
	}
	release()
	replay.rollback()
	after, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(before, after) {
		t.Fatalf("failed replay changed the source: %v", err)
	}
	replayRelationSubItems(t, tx.UndoOperations)
	assertSubItemsParent(t, source.ID, ids[3], ids[2])
}
