//go:build fts5

package model

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"strings"
	"sync"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAttributeViewItemsUndoRedo(t *testing.T) {
	for _, bound := range []bool{false, true} {
		name := "detached"
		if bound {
			name = "bound"
		}
		t.Run(name, func(t *testing.T) {
			fixture, before, op, undo := setupAttributeViewItemsTest(t, bound)
			tx := &Transaction{DoOperations: []*Operation{op}, UndoOperations: undo}
			tx.MarkFromAPI()
			if err := PerformTxSync(tx); err != nil {
				t.Fatal(err)
			}
			entry := GlobalUndoLog.Peek(fixture.sourceID)
			if entry == nil {
				t.Fatal("deletion did not enter the undo log")
			}
			data, err := json.Marshal(tx)
			if err != nil || strings.Contains(string(data), "private field contents") {
				t.Fatalf("private field snapshots leaked into response: %s, %v", data, err)
			}
			for cycle := 0; cycle < 3; cycle++ {
				deleted := readAttributeViewItemsTest(t, before.ID)
				for _, kv := range deleted.KeyValues {
					for _, value := range kv.Values {
						if slices.Contains(op.SrcIDs, value.BlockID) {
							t.Fatal("deletion left a item value behind")
						}
					}
				}
				replay := &Transaction{DoOperations: entry.UndoOperationsForReplay()}
				replay.MarkReplay()
				if err = PerformTxSync(replay); err != nil {
					t.Fatalf("undo cycle %d failed: %v", cycle, err)
				}
				assertAttributeViewItemsEqual(t, before, readAttributeViewItemsTest(t, before.ID))
				if bound {
					tree, loadErr := LoadTreeByBlockID(fixture.targetID)
					if loadErr != nil || tree.Root.IALAttr(av.NodeAttrNameAvs) != before.ID {
						t.Fatalf("binding was not restored: %v", loadErr)
					}
				}
				replay = &Transaction{DoOperations: entry.DoOperationsForReplay()}
				replay.MarkReplay()
				if err = PerformTxSync(replay); err != nil {
					t.Fatalf("redo cycle %d failed: %v", cycle, err)
				}
			}
		})
	}
}

func TestAttributeViewItemsUndoRelationConfiguration(t *testing.T) {
	fixture, source, op, undo := setupAttributeViewItemsTest(t, false)
	peer := av.NewAttributeView(ast.NewNodeID())
	for _, view := range []*av.AttributeView{source, peer} {
		keyID := ast.NewNodeID()
		view.KeyValues = append(view.KeyValues, &av.KeyValues{Key: &av.Key{ID: keyID, Type: av.KeyTypeRelation,
			Relation: &av.Relation{AvID: source.ID}}})
		value := &av.Value{Type: av.KeyTypeRelation, Relation: &av.ValueRelation{BlockIDs: append([]string(nil), op.SrcIDs...)}}
		view.Views[0].Filters = fieldFilterRoot(&av.ViewFilter{Column: keyID,
			Operator: av.FilterOperatorContainsAnyItem, Value: value.Clone()})
		view.NewItemTemplates = []*av.NewItemTemplate{{ID: ast.NewNodeID(), Name: "Default", TargetType: av.NewItemTargetDetached,
			FieldValues: map[string]*av.NewItemFieldValue{keyID: {Mode: av.NewItemFieldValueStatic, Value: value.Clone()}}}}
		if err := av.SaveAttributeView(view); err != nil {
			t.Fatal(err)
		}
		av.UpsertAvBackRel(view.ID, source.ID)
	}
	source, peer = readAttributeViewItemsTest(t, source.ID), readAttributeViewItemsTest(t, peer.ID)
	tx := &Transaction{DoOperations: []*Operation{op}, UndoOperations: undo, fromAPI: true}
	if err := PerformTxSync(tx); err != nil {
		t.Fatal(err)
	}
	entry := GlobalUndoLog.Peek(fixture.sourceID)
	for cycle := 0; cycle < 2; cycle++ {
		for _, before := range []*av.AttributeView{source, peer} {
			current := readAttributeViewItemsTest(t, before.ID)
			if len(current.Views[0].Filters[0].Filters) != 0 || len(current.NewItemTemplates[0].FieldValues) != 0 {
				t.Fatal("deletion did not remove relation configuration")
			}
			current.Name, before.Name = "Later name", "Later name"
			if err := av.SaveAttributeView(current); err != nil {
				t.Fatal(err)
			}
		}
		replayAttributeViewFieldsTest(t, entry.UndoOperationsForReplay())
		for _, before := range []*av.AttributeView{source, peer} {
			current := readAttributeViewItemsTest(t, before.ID)
			if !reflect.DeepEqual(before.NewItemTemplates, current.NewItemTemplates) ||
				!reflect.DeepEqual(before.Views[0].Filters, current.Views[0].Filters) || current.Name != before.Name {
				t.Fatal("item undo did not restore relation filters and template defaults")
			}
		}
		replayAttributeViewFieldsTest(t, entry.DoOperationsForReplay())
	}
	deleted := readAttributeViewItemsTest(t, source.ID)
	changed := readAttributeViewItemsTest(t, peer.ID)
	changed.Views[0].Filters = fieldFilterRoot(fieldFilterLeaf(changed.GetBlockKeyValues().Key.ID))
	if err := av.SaveAttributeView(changed); err != nil {
		t.Fatal(err)
	}
	if err := PerformTxSync(&Transaction{DoOperations: entry.UndoOperationsForReplay(), isReplay: true}); err == nil {
		t.Fatal("item undo overwrote a later relation filter edit")
	}
	assertAttributeViewFieldsTest(t, deleted, readAttributeViewItemsTest(t, source.ID))
	assertAttributeViewFieldsTest(t, changed, readAttributeViewItemsTest(t, peer.ID))
}

func TestAttributeViewItemsUndoPreservesUnrelatedEdits(t *testing.T) {
	fixture, expected, op, undo := setupAttributeViewItemsTest(t, false)
	tx := &Transaction{DoOperations: []*Operation{op}, UndoOperations: undo, fromAPI: true}
	if err := PerformTxSync(tx); err != nil {
		t.Fatal(err)
	}
	current := readAttributeViewItemsTest(t, expected.ID)
	keptID := expected.GetBlockKeyValues().Values[0].BlockID
	for _, view := range []*av.AttributeView{expected, current} {
		view.KeyValues[2].GetValue(keptID).Text.Content = "unrelated newer edit"
		view.Name = "Renamed database"
	}
	if err := av.SaveAttributeView(current); err != nil {
		t.Fatal(err)
	}
	replay := &Transaction{DoOperations: GlobalUndoLog.Peek(fixture.sourceID).UndoOperationsForReplay(), isReplay: true}
	if err := PerformTxSync(replay); err != nil {
		t.Fatal(err)
	}
	actual := readAttributeViewItemsTest(t, expected.ID)
	assertAttributeViewItemsEqual(t, expected, actual)
	if actual.Name != expected.Name {
		t.Fatal("undo overwrote the database name")
	}
}

func TestAttributeViewItemsUndoConflict(t *testing.T) {
	for _, conflict := range []string{"item", "field", "binding", "redo"} {
		t.Run(conflict, func(t *testing.T) {
			fixture, before, op, undo := setupAttributeViewItemsTest(t, conflict == "binding")
			tx := &Transaction{DoOperations: []*Operation{op}, UndoOperations: undo}
			tx.MarkFromAPI()
			if err := PerformTxSync(tx); err != nil {
				t.Fatal(err)
			}
			entry := GlobalUndoLog.Peek(fixture.sourceID)
			if conflict == "redo" {
				replay := &Transaction{DoOperations: entry.UndoOperationsForReplay()}
				replay.MarkReplay()
				if err := PerformTxSync(replay); err != nil {
					t.Fatal(err)
				}
			}
			current := readAttributeViewItemsTest(t, before.ID)
			switch conflict {
			case "item":
				current.GetBlockKeyValues().Values = append(current.GetBlockKeyValues().Values, before.GetBlockValue(op.SrcIDs[0]).Clone())
			case "field":
				current.KeyValues[2].Key.Type = av.KeyTypeNumber
			case "binding":
				value := before.GetBlockValue(op.SrcIDs[0]).Clone()
				value.BlockID = ast.NewNodeID()
				current.GetBlockKeyValues().Values = append(current.GetBlockKeyValues().Values, value)
			case "redo":
				current.KeyValues[2].GetValue(op.SrcIDs[0]).Text.Content = "newer edit"
			}
			if err := av.SaveAttributeView(current); err != nil {
				t.Fatal(err)
			}
			current = readAttributeViewItemsTest(t, before.ID)
			operations := entry.UndoOperationsForReplay()
			if conflict == "redo" {
				operations = entry.DoOperationsForReplay()
			}
			replay := &Transaction{DoOperations: operations}
			replay.MarkReplay()
			if err := PerformTxSync(replay); err == nil {
				t.Fatal("conflicting replay was accepted")
			}
			assertAttributeViewItemsEqual(t, current, readAttributeViewItemsTest(t, before.ID))
		})
	}
}

func TestAttributeViewItemsUndoRelations(t *testing.T) {
	for _, self := range []bool{false, true} {
		t.Run(map[bool]string{false: "other database", true: "same database"}[self], func(t *testing.T) {
			fixture, source, op, undo := setupAttributeViewItemsTest(t, false)
			dest := av.NewAttributeView(ast.NewNodeID())
			if self {
				dest = source
			} else {
				key := dest.GetBlockKeyValues()
				key.Values = []*av.Value{{ID: ast.NewNodeID(), KeyID: key.Key.ID, BlockID: ast.NewNodeID(),
					Type: av.KeyTypeBlock, IsDetached: true, Block: &av.ValueBlock{Content: "Target"}}}
			}
			targetID := dest.GetBlockKeyValues().Values[0].BlockID
			keyID, backID := ast.NewNodeID(), ast.NewNodeID()
			relation := &av.KeyValues{Key: &av.Key{ID: keyID, Type: av.KeyTypeRelation,
				Relation: &av.Relation{AvID: dest.ID, IsTwoWay: true, BackKeyID: backID}}}
			back := &av.KeyValues{Key: &av.Key{ID: backID, Type: av.KeyTypeRelation,
				Relation: &av.Relation{AvID: source.ID, IsTwoWay: true, BackKeyID: keyID}}}
			for _, id := range op.SrcIDs {
				relation.Values = append(relation.Values, &av.Value{ID: ast.NewNodeID(), KeyID: keyID, BlockID: id,
					Type: av.KeyTypeRelation, Relation: &av.ValueRelation{BlockIDs: []string{targetID}}})
			}
			keptID := source.GetBlockKeyValues().Values[3].BlockID
			back.Values = []*av.Value{{ID: ast.NewNodeID(), KeyID: backID, BlockID: targetID, Type: av.KeyTypeRelation,
				Relation: &av.ValueRelation{BlockIDs: append([]string{keptID}, op.SrcIDs...)}}}
			source.KeyValues = append(source.KeyValues, relation)
			dest.KeyValues = append(dest.KeyValues, back)
			for _, view := range []*av.AttributeView{source, dest} {
				if err := av.SaveAttributeView(view); err != nil {
					t.Fatal(err)
				}
			}
			av.UpsertAvBackRel(source.ID, dest.ID)
			av.UpsertAvBackRel(dest.ID, source.ID)
			tx := &Transaction{DoOperations: []*Operation{op}, UndoOperations: undo}
			tx.MarkFromAPI()
			if err := PerformTxSync(tx); err != nil {
				t.Fatal(err)
			}
			entry := GlobalUndoLog.Peek(fixture.sourceID)
			for cycle := 0; cycle < 2; cycle++ {
				deletedDest := readAttributeViewItemsTest(t, dest.ID)
				if got := av.GetValue(deletedDest.KeyValues, backID, targetID).Relation.BlockIDs; !slices.Equal(got, []string{keptID}) {
					t.Fatalf("delete did not clear back relations: %v", got)
				}
				replay := &Transaction{DoOperations: entry.UndoOperationsForReplay(), isReplay: true}
				if err := PerformTxSync(replay); err != nil {
					t.Fatal(err)
				}
				restored := readAttributeViewItemsTest(t, source.ID)
				for _, value := range relation.Values {
					if got := av.GetValue(restored.KeyValues, keyID, value.BlockID); !reflect.DeepEqual(value, got) {
						t.Fatalf("relation value was not restored: %+v", got)
					}
				}
				backValue := av.GetValue(readAttributeViewItemsTest(t, dest.ID).KeyValues, backID, targetID)
				if !slices.Equal(backValue.Relation.BlockIDs, back.Values[0].Relation.BlockIDs) {
					t.Fatalf("back relations were not restored: %v", backValue.Relation.BlockIDs)
				}
				replay = &Transaction{DoOperations: entry.DoOperationsForReplay(), isReplay: true}
				if err := PerformTxSync(replay); err != nil {
					t.Fatal(err)
				}
			}
		})
	}
}

func TestAttributeViewItemsTransactionFailure(t *testing.T) {
	for _, restoring := range []bool{false, true} {
		t.Run(map[bool]string{false: "delete", true: "undo"}[restoring], func(t *testing.T) {
			fixture, original, op, undo := setupAttributeViewItemsTest(t, true)
			if restoring {
				tx := &Transaction{DoOperations: []*Operation{op}, UndoOperations: undo}
				tx.MarkFromAPI()
				if err := PerformTxSync(tx); err != nil {
					t.Fatal(err)
				}
				op = GlobalUndoLog.Peek(fixture.sourceID).UndoOperationsForReplay()[0]
			}
			before := readAttributeViewItemsTest(t, original.ID)
			treeBefore, err := LoadTreeByBlockID(fixture.targetID)
			if err != nil {
				t.Fatal(err)
			}
			tx := &Transaction{DoOperations: []*Operation{op}, UndoOperations: undo, m: &sync.Mutex{}, fromAPI: true, isReplay: restoring}
			if err = tx.begin(); err != nil {
				t.Fatal(err)
			}
			defer func() {
				if tx.state.Load() == 1 {
					tx.rollback()
				}
			}()
			var txErr *TxErr
			if restoring {
				txErr = tx.doInsertAttrViewBlock(op)
			} else {
				txErr = tx.doRemoveAttrViewBlock(op)
			}
			if txErr != nil {
				t.Fatal(txErr)
			}
			injected := errors.New("injected second document write failure")
			writes := 0
			tx.writeTransactionTree = func(tree *parse.Tree) error {
				writes++
				if writes == 2 {
					return injected
				}
				return writeTreeUpsertQueue(tree)
			}
			if err = tx.commit(); !errors.Is(err, injected) {
				t.Fatalf("unexpected commit result: %v", err)
			}
			tx.rollback()
			assertAttributeViewItemsEqual(t, before, readAttributeViewItemsTest(t, original.ID))
			treeAfter, err := LoadTreeByBlockID(fixture.targetID)
			if err != nil || !reflect.DeepEqual(parse.IAL2Map(treeBefore.Root.KramdownIAL), parse.IAL2Map(treeAfter.Root.KramdownIAL)) {
				t.Fatalf("failed transaction changed binding attributes: %v, before=%v, after=%v", err,
					treeBefore.Root.KramdownIAL, treeAfter.Root.KramdownIAL)
			}
		})
	}
}

func TestAttributeViewItemsEncryptedReplay(t *testing.T) {
	_, original, op, undo := setupAttributeViewItemsTest(t, false)
	boxID := ast.NewNodeID()
	markRuntimeEncryptedBox(boxID)
	setDEKForTest(boxID, bytes.Repeat([]byte{0x62}, 32))
	av.SetAVBoxID(original.ID, boxID)
	t.Cleanup(func() {
		av.SetAVBoxID(original.ID, "")
		forgetRuntimeEncryptedBox(boxID)
		encryptedBoxLifecycles.Delete(boxID)
		cachedDEKsLock.Lock()
		delete(cachedDEKs, boxID)
		cachedDEKsLock.Unlock()
	})
	if err := av.SaveAttributeView(original); err != nil {
		t.Fatal(err)
	}
	plainPath := filepath.Join(util.DataDir, "storage", "av", original.ID+".json")
	if err := os.Remove(plainPath); err != nil {
		t.Fatal(err)
	}
	op.BlockID = ""
	for _, inverse := range undo {
		inverse.BlockID = ""
	}
	tx := &Transaction{DoOperations: []*Operation{op}, UndoOperations: undo, fromAPI: true}
	if err := PerformTxSync(tx); err != nil {
		t.Fatal(err)
	}
	replay := &Transaction{DoOperations: cloneOperations(tx.UndoOperations), isReplay: true}
	if err := PerformTxSync(replay); err != nil {
		t.Fatal(err)
	}
	restored, err := av.ParseAttributeViewForIndexInBox(original.ID, boxID)
	if err != nil {
		t.Fatal(err)
	}
	assertAttributeViewItemsEqual(t, original, restored)
	replay = &Transaction{DoOperations: cloneOperations(tx.DoOperations), isReplay: true}
	if err = PerformTxSync(replay); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(util.DataDir, boxID, "storage", "av", original.ID+".json")
	ciphertext, err := os.ReadFile(path)
	if err != nil || !util.IsCiphertext(ciphertext) {
		t.Fatalf("database was not persisted as ciphertext: %v", err)
	}
	if _, err = os.Stat(plainPath); !os.IsNotExist(err) {
		t.Fatalf("replay produced a plaintext database: %v", err)
	}
	for _, failure := range []string{"locked", "corrupted"} {
		t.Run(failure, func(t *testing.T) {
			if failure == "locked" {
				cachedDEKsLock.Lock()
				delete(cachedDEKs, boxID)
				cachedDEKsLock.Unlock()
				defer setDEKForTest(boxID, bytes.Repeat([]byte{0x62}, 32))
			} else {
				ciphertext[len(ciphertext)-1] ^= 1
				if err = os.WriteFile(path, ciphertext, 0600); err != nil {
					t.Fatal(err)
				}
			}
			cache.ClearAVCache()
			replay = &Transaction{DoOperations: cloneOperations(tx.UndoOperations), isReplay: true}
			if err = PerformTxSync(replay); err == nil {
				t.Fatal("replay accepted inaccessible encrypted data")
			}
			preserved, readErr := os.ReadFile(path)
			if readErr != nil || !bytes.Equal(ciphertext, preserved) {
				t.Fatalf("failed replay modified ciphertext: %v", readErr)
			}
		})
	}
}

func setupAttributeViewItemsTest(t *testing.T, bound bool) (*fileOperationTestFixture, *av.AttributeView, *Operation, []*Operation) {
	t.Helper()
	fixture := setupStructureTransactionTest(t)
	setupFoldTransactionDatabase(t, fixture)
	oldLang, oldAVLangs, oldUndoLog := util.Lang, util.AttrViewLangs, GlobalUndoLog
	util.Lang = "en"
	util.AttrViewLangs = map[string]map[string]any{"en": {"key": "Key", "select": "Select", "table": "Table"}}
	GlobalUndoLog = newUndoLog(64)
	cache.ClearAVCache()
	t.Cleanup(func() {
		util.Lang, util.AttrViewLangs, GlobalUndoLog = oldLang, oldAVLangs, oldUndoLog
		cache.ClearAVCache()
	})
	view := av.NewAttributeView(ast.NewNodeID())
	itemIDs := []string{ast.NewNodeID(), ast.NewNodeID(), ast.NewNodeID(), ast.NewNodeID()}
	for _, id := range itemIDs {
		view.GetBlockKeyValues().Values = append(view.GetBlockKeyValues().Values, &av.Value{
			ID: ast.NewNodeID(), KeyID: view.GetBlockKeyValues().Key.ID, BlockID: id, Type: av.KeyTypeBlock, IsDetached: true,
			CreatedAt: 123, UpdatedAt: 456, Block: &av.ValueBlock{Content: "Primary", Created: 123, Updated: 456},
		})
	}
	if bound {
		value := view.GetBlockValue(itemIDs[1])
		value.IsDetached, value.Block.ID = false, fixture.targetID
		tree, err := LoadTreeByBlockID(fixture.targetID)
		if err != nil {
			t.Fatal(err)
		}
		tree.Root.SetIALAttr(av.NodeAttrNameAvs, view.ID)
		if _, err = filesys.WriteTree(tree); err != nil {
			t.Fatal(err)
		}
		treenode.UpsertBlockTree(tree)
	}
	for _, payload := range []string{
		`{"type":"text","text":{"content":"private field contents"}}`,
		`{"type":"number","number":{"content":42.5,"isNotEmpty":true}}`,
		`{"type":"date","date":{"content":1700000000000,"isNotEmpty":true,"content2":1700000300000,"isNotEmpty2":true,"hasEndDate":true}}`,
		`{"type":"select","mSelect":[{"content":"Alpha","color":"1"}]}`,
		`{"type":"mSelect","mSelect":[{"content":"Alpha","color":"1"},{"content":"Beta","color":"2"}]}`,
		`{"type":"mAsset","mAsset":[{"type":"file","content":"assets/example.png","name":"example"}]}`,
		`{"type":"checkbox","checkbox":{"checked":true}}`,
		`{"type":"url","url":{"content":"https://example.com"}}`,
		`{"type":"email","email":{"content":"test@example.com"}}`,
		`{"type":"phone","phone":{"content":"12345"}}`,
	} {
		var value av.Value
		if err := json.Unmarshal([]byte(payload), &value); err != nil {
			t.Fatal(err)
		}
		key := &av.Key{ID: ast.NewNodeID(), Type: value.Type}
		if key.Type == av.KeyTypeDate {
			key.Date = &av.Date{AutoFillNow: true, FillSpecificTime: true}
		}
		kv := &av.KeyValues{Key: key}
		for _, id := range itemIDs {
			if key.Type == av.KeyTypeDate && id == itemIDs[2] {
				continue
			}
			copy := value.Clone()
			copy.ID, copy.KeyID, copy.BlockID, copy.CreatedAt, copy.UpdatedAt = ast.NewNodeID(), key.ID, id, 123, 456
			kv.Values = append(kv.Values, copy)
		}
		view.KeyValues = append(view.KeyValues, kv)
	}
	view.Views[0].ItemIDs = append([]string(nil), itemIDs...)
	viewData, _ := json.Marshal(view.Views[0])
	var other av.View
	if err := json.Unmarshal(viewData, &other); err != nil {
		t.Fatal(err)
	}
	other.ID = ast.NewNodeID()
	slices.Reverse(other.ItemIDs)
	view.Views = append(view.Views, &other)
	view.CardCoverPositions = map[string]map[string]*av.CardCoverPosition{itemIDs[1]: {"cover": {Image: "assets/example.png", X: 0.3, Y: 0.7}}}
	if err := av.SaveAttributeView(view); err != nil {
		t.Fatal(err)
	}
	before := readAttributeViewItemsTest(t, view.ID)
	op := &Operation{Action: "removeAttrViewBlock", AvID: view.ID, BlockID: fixture.sourceID, SrcIDs: []string{itemIDs[1], itemIDs[2]}}
	var undo []*Operation
	for _, id := range op.SrcIDs {
		primary := view.GetBlockValue(id)
		sourceID := id
		if !primary.IsDetached {
			sourceID = primary.Block.ID
		}
		undo = append(undo, &Operation{Action: "insertAttrViewBlock", AvID: view.ID, BlockID: fixture.sourceID,
			Srcs: []map[string]any{{"itemID": id, "id": sourceID, "isDetached": primary.IsDetached, "content": "Primary"}}})
	}
	return fixture, before, op, undo
}

func readAttributeViewItemsTest(t *testing.T, id string) *av.AttributeView {
	t.Helper()
	ret, err := av.ParseAttributeViewForIndexInBox(id, "")
	if err != nil {
		t.Fatal(err)
	}
	return ret
}

func assertAttributeViewItemsEqual(t *testing.T, expected, actual *av.AttributeView) {
	t.Helper()
	for _, kv := range expected.KeyValues {
		other, err := actual.GetKeyValues(kv.Key.ID)
		if err != nil || len(kv.Values) != len(other.Values) {
			t.Fatalf("field %s value count changed: %v", kv.Key.Type, err)
		}
		for _, value := range kv.Values {
			got := other.GetValue(value.BlockID)
			if !reflect.DeepEqual(value, got) {
				wantJSON, _ := json.Marshal(value)
				gotJSON, _ := json.Marshal(got)
				t.Fatalf("field %s value changed:\nwant %s\ngot  %s", kv.Key.Type, wantJSON, gotJSON)
			}
		}
	}
	for _, view := range expected.Views {
		if !slices.Equal(view.ItemIDs, actual.GetView(view.ID).ItemIDs) {
			t.Fatal("view item order changed")
		}
	}
	if !reflect.DeepEqual(expected.CardCoverPositions, actual.CardCoverPositions) {
		t.Fatal("card cover positions changed")
	}
}
