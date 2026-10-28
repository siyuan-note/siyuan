//go:build fts5

package model

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"sync"
	"testing"
	"time"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func setupSubItemsTest(t *testing.T, bound bool) (*fileOperationTestFixture, *av.AttributeView, *Operation, []*Operation) {
	t.Helper()
	fixture, source, removal, undo := setupAttributeViewItemsTest(t, bound)
	p, c := ast.NewNodeID(), ast.NewNodeID()
	source.SubItems = &av.SubItemsConfig{Enabled: true, ParentKeyID: p, ChildrenKeyID: c}
	source.KeyValues = append(source.KeyValues,
		&av.KeyValues{Key: &av.Key{ID: p, Type: av.KeyTypeRelation, Relation: &av.Relation{AvID: source.ID, IsTwoWay: true, BackKeyID: c}}},
		&av.KeyValues{Key: &av.Key{ID: c, Type: av.KeyTypeRelation, Relation: &av.Relation{AvID: source.ID, IsTwoWay: true, BackKeyID: p}}})
	ids := source.Views[0].ItemIDs
	if err := source.SetSubItemsParents(map[string]string{ids[1]: ids[0], ids[2]: ids[1], ids[3]: ids[2]}); err != nil {
		t.Fatal(err)
	}
	if err := av.SaveAttributeView(source); err != nil {
		t.Fatal(err)
	}
	return fixture, readAttributeViewItemsTest(t, source.ID), removal, undo
}

func runSubItemsOperation(t *testing.T, op *Operation) *Transaction {
	t.Helper()
	undo := *op
	tx := &Transaction{DoOperations: []*Operation{op}, UndoOperations: []*Operation{&undo}, fromAPI: true}
	if err := PerformTxSync(tx); err != nil {
		t.Fatal(err)
	}
	return tx
}

func assertSubItemsParent(t *testing.T, sourceID, id, parent string) {
	t.Helper()
	source := readAttributeViewItemsTest(t, sourceID)
	index, err := source.BuildSubItemsIndex()
	if err != nil {
		t.Fatal(err)
	}
	if index.Parents[id] != parent {
		t.Fatalf("parent of %s: got %q want %q", id, index.Parents[id], parent)
	}
}

func TestSubItemsTransactionsMoveCopyAndUndo(t *testing.T) {
	fixture, source, _, _ := setupSubItemsTest(t, false)
	ids := slices.Clone(source.Views[0].ItemIDs)
	op := &Operation{Action: "reparentAttrViewItems", AvID: source.ID, BlockID: fixture.sourceID, ViewID: source.Views[0].ID, SrcIDs: []string{ids[2], ids[3]}, ParentID: ids[0]}
	tx := runSubItemsOperation(t, op)
	assertSubItemsParent(t, source.ID, ids[2], ids[0])
	assertSubItemsParent(t, source.ID, ids[3], ids[2])
	for range 2 {
		if err := PerformTxSync(&Transaction{isReplay: true, DoOperations: cloneOperations(tx.UndoOperations)}); err != nil {
			t.Fatal(err)
		}
		assertSubItemsParent(t, source.ID, ids[2], ids[1])
		if err := PerformTxSync(&Transaction{isReplay: true, DoOperations: cloneOperations(tx.DoOperations)}); err != nil {
			t.Fatal(err)
		}
		assertSubItemsParent(t, source.ID, ids[2], ids[0])
	}
	copyTx := runSubItemsOperation(t, &Operation{Action: "duplicateAttrViewSubtree", AvID: source.ID, BlockID: fixture.sourceID, ViewID: source.Views[0].ID, SrcIDs: []string{ids[2]}})
	result, ok := copyTx.DoOperations[0].RetData.(*insertAttrViewBlockResult)
	if !ok || len(result.InsertedItemIDs) != 2 {
		t.Fatalf("copy result: %#v", copyTx.DoOperations[0].RetData)
	}
	assertSubItemsParent(t, source.ID, result.InsertedItemIDs[0], ids[0])
	assertSubItemsParent(t, source.ID, result.InsertedItemIDs[1], result.InsertedItemIDs[0])
	if err := PerformTxSync(&Transaction{isReplay: true, DoOperations: cloneOperations(copyTx.UndoOperations)}); err != nil {
		t.Fatal(err)
	}
	if len(readAttributeViewItemsTest(t, source.ID).GetBlockKeyValues().Values) != 4 {
		t.Fatal("undo did not remove copied subtree")
	}
}

func TestSubItemsDeletePromotesAndUndoRestores(t *testing.T) {
	for _, bound := range []bool{false, true} {
		t.Run(map[bool]string{true: "bound", false: "detached"}[bound], func(t *testing.T) {
			_, source, op, undo := setupSubItemsTest(t, bound)
			ids := slices.Clone(source.Views[0].ItemIDs)
			tx := &Transaction{DoOperations: []*Operation{op}, UndoOperations: undo, fromAPI: true}
			if err := PerformTxSync(tx); err != nil {
				t.Fatal(err)
			}
			assertSubItemsParent(t, source.ID, ids[3], ids[0])
			for range 2 {
				if err := PerformTxSync(&Transaction{isReplay: true, DoOperations: cloneOperations(tx.UndoOperations)}); err != nil {
					t.Fatal(err)
				}
				assertSubItemsParent(t, source.ID, ids[3], ids[2])
				if err := PerformTxSync(&Transaction{isReplay: true, DoOperations: cloneOperations(tx.DoOperations)}); err != nil {
					t.Fatal(err)
				}
				assertSubItemsParent(t, source.ID, ids[3], ids[0])
			}
		})
	}
}

func TestSubItemsCellBatchAndAtomicRejection(t *testing.T) {
	fixture, source, _, _ := setupSubItemsTest(t, false)
	ids := source.Views[0].ItemIDs
	cell := func(id, parent string) *AttrViewCellUpdate {
		targets := []string{}
		if parent != "" {
			targets = []string{parent}
		}
		return &AttrViewCellUpdate{KeyID: source.SubItems.ParentKeyID, RowID: id, Data: map[string]any{"relation": map[string]any{"blockIDs": targets}}}
	}
	op := &Operation{Action: "updateAttrViewCells", AvID: source.ID, BlockID: fixture.sourceID, CellUpdates: []*AttrViewCellUpdate{cell(ids[1], ids[2]), cell(ids[2], ids[0])}}
	tx := runSubItemsOperation(t, op)
	assertSubItemsParent(t, source.ID, ids[1], ids[2])
	if err := PerformTxSync(&Transaction{isReplay: true, DoOperations: cloneOperations(tx.UndoOperations)}); err != nil {
		t.Fatal(err)
	}
	assertSubItemsParent(t, source.ID, ids[1], ids[0])
	path := filepath.Join(util.DataDir, "storage", "av", source.ID+".json")
	before, _ := os.ReadFile(path)
	bad := &Transaction{fromAPI: true, DoOperations: []*Operation{{Action: "updateAttrViewCells", AvID: source.ID, BlockID: fixture.sourceID, CellUpdates: []*AttrViewCellUpdate{cell(ids[0], ids[3])}}}}
	if err := PerformTxSync(bad); err == nil {
		t.Fatal("cycle accepted")
	}
	after, _ := os.ReadFile(path)
	if !bytes.Equal(before, after) {
		t.Fatal("rejected batch changed source")
	}
}

func TestSubItemsEnableUndoRetainsFormat(t *testing.T) {
	fixture, source, _, _ := setupAttributeViewItemsTest(t, false)
	source.Spec = 13
	if err := av.SaveAttributeView(source); err != nil {
		t.Fatal(err)
	}
	tx := runSubItemsOperation(t, &Operation{Action: "setAttrViewSubItems", AvID: source.ID, BlockID: fixture.sourceID, ViewID: source.Views[0].ID, Data: map[string]any{"enabled": true}})
	enabled := readAttributeViewItemsTest(t, source.ID)
	if !enabled.HasSubItems() || enabled.Spec != av.SubItemsSpec {
		t.Fatal("enable did not upgrade source")
	}
	if enabled.Views[0].SubItemsDisplay != "nested" || enabled.Views[1].SubItemsDisplay == "nested" {
		t.Fatal("enable changed the wrong view")
	}
	for _, column := range enabled.Views[0].Table.Columns {
		if enabled.IsSubItemsKey(column.ID) && !column.Hidden {
			t.Fatal("new hierarchy columns should be hidden")
		}
	}
	if err := PerformTxSync(&Transaction{isReplay: true, DoOperations: cloneOperations(tx.UndoOperations)}); err != nil {
		t.Fatal(err)
	}
	disabled := readAttributeViewItemsTest(t, source.ID)
	if disabled.HasSubItems() || disabled.Spec != av.SubItemsSpec {
		t.Fatal("undo downgraded source")
	}
	if err := PerformTxSync(&Transaction{isReplay: true, DoOperations: cloneOperations(tx.DoOperations)}); err != nil {
		t.Fatal(err)
	}
	runSubItemsOperation(t, &Operation{Action: "setAttrViewSubItemsDisplay", AvID: source.ID, BlockID: fixture.sourceID, ViewID: source.Views[1].ID, Data: "nested"})
	runSubItemsOperation(t, &Operation{Action: "setAttrViewSubItems", AvID: source.ID, BlockID: fixture.sourceID, Data: map[string]any{"enabled": false}})
	for _, view := range readAttributeViewItemsTest(t, source.ID).Views {
		if view.SubItemsDisplay != "flat" {
			t.Fatal("disable retained nested preference")
		}
	}
	runSubItemsOperation(t, &Operation{Action: "setAttrViewSubItems", AvID: source.ID, BlockID: fixture.sourceID, ViewID: source.Views[0].ID, Data: map[string]any{"enabled": true}})
	if readAttributeViewItemsTest(t, source.ID).Views[1].SubItemsDisplay != "flat" {
		t.Fatal("reenable restored another view's old nested preference")
	}
}

func TestSubItemsEncryptedFailurePreservesSource(t *testing.T) {
	_, source, _, _ := setupAttributeViewItemsTest(t, false)
	source.Spec = 13
	boxID := ast.NewNodeID()
	markRuntimeEncryptedBox(boxID)
	setDEKForTest(boxID, bytes.Repeat([]byte{0x62}, 32))
	repairEncryptedBoxStateFromDEK(boxID)
	av.SetAVBoxID(source.ID, boxID)
	t.Cleanup(func() {
		av.SetAVBoxID(source.ID, "")
		forgetRuntimeEncryptedBox(boxID)
		encryptedBoxLifecycles.Delete(boxID)
		cachedDEKsLock.Lock()
		delete(cachedDEKs, boxID)
		cachedDEKsLock.Unlock()
	})
	if err := av.SaveAttributeView(source); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(filepath.Join(util.DataDir, "storage", "av", source.ID+".json")); err != nil {
		t.Fatal(err)
	}
	legacyPath := filepath.Join(util.DataDir, boxID, "storage", "av", source.ID+".json")
	legacyCipher, err := os.ReadFile(legacyPath)
	if err != nil {
		t.Fatal(err)
	}
	runSubItemsOperation(t, &Operation{Action: "setAttrViewSubItems", AvID: source.ID, Data: map[string]any{"enabled": true}})
	legacyPlain, err := av.DecryptAVData(boxID, source.ID, legacyCipher)
	if err != nil {
		t.Fatal("old encrypted format became unreadable", err)
	}
	legacy, err := av.ParseAttributeViewData(source.ID, legacyPlain)
	if err != nil || legacy.HasSubItems() {
		t.Fatal("legacy source reader changed", err)
	}
	ids := source.Views[0].ItemIDs
	tx := runSubItemsOperation(t, &Operation{Action: "reparentAttrViewItems", AvID: source.ID, SrcIDs: []string{ids[2]}, ParentID: ids[0]})
	path := filepath.Join(util.DataDir, boxID, "storage", "av", source.ID+".json")
	ciphertext, err := os.ReadFile(path)
	if err != nil || !util.IsCiphertext(ciphertext) {
		t.Fatal("missing encrypted source", err)
	}
	ciphertext[len(ciphertext)-1] ^= 1
	if err = os.WriteFile(path, ciphertext, 0600); err != nil {
		t.Fatal(err)
	}
	cache.ClearAVCache()
	if err = PerformTxSync(&Transaction{isReplay: true, DoOperations: cloneOperations(tx.UndoOperations)}); err == nil {
		t.Fatal("accepted corrupted source")
	}
	preserved, _ := os.ReadFile(path)
	if !bytes.Equal(ciphertext, preserved) {
		t.Fatal("corrupt source overwritten")
	}
}

func TestSubItemsBatchConflictsAndInverseMove(t *testing.T) {
	_, source, _, _ := setupSubItemsTest(t, false)
	ids := source.Views[0].ItemIDs
	childCell := func(parent string, children ...string) *AttrViewCellUpdate {
		return &AttrViewCellUpdate{KeyID: source.SubItems.ChildrenKeyID, RowID: parent, Data: map[string]any{"relation": map[string]any{"blockIDs": children}}}
	}
	if _, err := subItemsCellChanges(source, []*AttrViewCellUpdate{childCell(ids[0], ids[3]), childCell(ids[1], ids[3])}); err == nil {
		t.Fatal("accepted conflicting explicit parents")
	}
	for _, cells := range [][]*AttrViewCellUpdate{{childCell(ids[0], ids[1], ids[3]), childCell(ids[2])}, {childCell(ids[2]), childCell(ids[0], ids[1], ids[3])}} {
		changes, err := subItemsCellChanges(source, cells)
		if err != nil || changes[ids[3]] != ids[0] {
			t.Fatal("old parent removal overrode new parent", err, changes)
		}
	}
}

func TestSubItemsDatabaseCopyRemapsOnlyIdentity(t *testing.T) {
	_, source, _, _ := setupSubItemsTest(t, true)
	oldIDs := slices.Clone(source.Views[0].ItemIDs)
	for _, kv := range source.KeyValues {
		kv.Key.Name, kv.Key.Desc, kv.Key.Template = oldIDs[0], oldIDs[0], oldIDs[0]
		for _, value := range kv.Values {
			if value.Text != nil {
				value.Text.Content = oldIDs[0]
			}
			if value.URL != nil {
				value.URL.Content = oldIDs[0]
			}
			for _, option := range value.MSelect {
				option.Content = oldIDs[0]
			}
		}
	}
	copy, err := remapCopiedSubItemsDatabase(source)
	if err != nil {
		t.Fatal(err)
	}
	if copy.SubItems.ParentKeyID == source.SubItems.ParentKeyID || copy.Views[0].ID == source.Views[0].ID {
		t.Fatal("copy retained source field or view identity")
	}
	index, err := copy.BuildSubItemsIndex()
	if err != nil {
		t.Fatal(err)
	}
	newIDs := copy.Views[0].ItemIDs
	if index.Parents[newIDs[3]] != newIDs[2] || slices.Contains(oldIDs, newIDs[0]) {
		t.Fatal("copy retained source item references")
	}
	if copy.GetBlockValue(newIDs[1]).Block.ID != source.GetBlockValue(oldIDs[1]).Block.ID {
		t.Fatal("copy changed bound document identity")
	}
	for i, kv := range copy.KeyValues {
		if kv.Key.Name != oldIDs[0] || kv.Key.Desc != oldIDs[0] || kv.Key.Template != oldIDs[0] {
			t.Fatal("copy rewrote ordinary field metadata")
		}
		for j, value := range kv.Values {
			old := source.KeyValues[i].Values[j]
			if value.Text != nil && value.Text.Content != old.Text.Content {
				t.Fatal("copy rewrote text content")
			}
			if value.URL != nil && value.URL.Content != old.URL.Content {
				t.Fatal("copy rewrote URL content")
			}
			for k, option := range value.MSelect {
				if option.Content != old.MSelect[k].Content {
					t.Fatal("copy rewrote select content")
				}
			}
		}
	}
}

func TestSubItemsInsertionAndFieldProtection(t *testing.T) {
	fixture, source, _, _ := setupSubItemsTest(t, false)
	parent := source.Views[0].ItemIDs[0]
	newID := ast.NewNodeID()
	tx := &Transaction{fromAPI: true, DoOperations: []*Operation{{Action: "insertAttrViewBlock", AvID: source.ID, BlockID: fixture.sourceID, ViewID: source.Views[0].ID, ParentID: parent, Srcs: []map[string]any{{"id": newID, "itemID": newID, "isDetached": true, "content": "child"}}}}}
	if err := PerformTxSync(tx); err != nil {
		t.Fatal(err)
	}
	assertSubItemsParent(t, source.ID, newID, parent)
	for _, op := range []*Operation{{Action: "removeAttrViewCol", ID: source.SubItems.ParentKeyID}, {Action: "updateAttrViewCol", ID: source.SubItems.ChildrenKeyID, Typ: string(av.KeyTypeText)}, {Action: "updateAttrViewColRelation", KeyID: source.SubItems.ParentKeyID, ID: source.ID}} {
		op.AvID, op.BlockID = source.ID, fixture.sourceID
		if err := PerformTxSync(&Transaction{fromAPI: true, DoOperations: []*Operation{op}}); err == nil {
			t.Fatal("accepted protected hierarchy field mutation", op.Action)
		}
	}
	rename := &Operation{Action: "updateAttrViewColRelation", AvID: source.ID, BlockID: fixture.sourceID, ID: source.ID, KeyID: source.SubItems.ParentKeyID, IsTwoWay: true, BackRelationKeyID: source.SubItems.ChildrenKeyID, Format: "Parent renamed", Name: "Children renamed"}
	if err := PerformTxSync(&Transaction{fromAPI: true, DoOperations: []*Operation{rename}}); err != nil {
		t.Fatal("protected relation rename was rejected", err)
	}
	current := readAttributeViewItemsTest(t, source.ID)
	key, _ := current.GetKey(source.SubItems.ParentKeyID)
	back, _ := current.GetKey(source.SubItems.ChildrenKeyID)
	if key.Name != "Parent renamed" || back.Name != "Children renamed" {
		t.Fatal("relation rename was not saved")
	}
}

func TestSubItemsExportBindingIsolationAndDatabaseCopy(t *testing.T) {
	_, source, _, _ := setupSubItemsTest(t, true)
	source.KeyValues = slices.DeleteFunc(source.KeyValues, func(kv *av.KeyValues) bool { return kv.Key.Type != av.KeyTypeBlock && !source.IsSubItemsKey(kv.Key.ID) })
	source.GetBlockKeyValues().Values[0].Block.Content = source.ID
	if err := av.SaveAttributeView(source); err != nil {
		t.Fatal(err)
	}
	out := t.TempDir()
	if err := exportAv(source.ID, "", out, out, map[string]string{}); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(out, source.ID+".json"))
	if err != nil {
		t.Fatal(err)
	}
	for _, encryptedTarget := range []bool{false, true} {
		importedData, err := isolateImportedAttributeViewBindings(data, map[string]bool{}, encryptedTarget)
		if err != nil {
			t.Fatal(err)
		}
		imported, err := av.ParseAttributeViewData(source.ID, importedData)
		if err != nil {
			t.Fatal(err)
		}
		if !imported.HasSubItems() || imported.SubItems.ParentKeyID != source.SubItems.ParentKeyID {
			t.Fatal("binding isolation lost hierarchy metadata")
		}
		oldIndex, _ := source.BuildSubItemsIndex()
		newIndex, _ := imported.BuildSubItemsIndex()
		for id, parent := range oldIndex.Parents {
			if newIndex.Parents[id] != parent {
				t.Fatal("binding isolation changed hierarchy")
			}
		}
		for _, value := range imported.GetBlockKeyValues().Values {
			if encryptedTarget && !value.IsDetached {
				t.Fatal("external binding was not isolated")
			}
		}
	}
	newID, _, err := DuplicateDatabaseBlock(source.ID)
	if err != nil {
		t.Fatal(err)
	}
	copy := readAttributeViewItemsTest(t, newID)
	index, err := copy.BuildSubItemsIndex()
	if err != nil {
		t.Fatal(err)
	}
	if len(index.Parents) != 4 || copy.SubItems.ParentKeyID == source.SubItems.ParentKeyID || copy.Views[0].ID == source.Views[0].ID {
		t.Fatal("complete copy did not remap hierarchy identities")
	}
	if copy.GetBlockKeyValues().Values[0].Block.Content != source.ID {
		t.Fatal("complete copy rewrote a database ID used as ordinary text")
	}
}

func TestSubItemsBoundHistoryRecovery(t *testing.T) {
	for _, encrypted := range []bool{false, true} {
		t.Run(map[bool]string{false: "plain", true: "encrypted"}[encrypted], func(t *testing.T) {
			fixture, source, _, _ := setupSubItemsTest(t, true)
			tree, err := LoadTreeByBlockID(fixture.targetID)
			if err != nil {
				t.Fatal(err)
			}
			boxID := ""
			if encrypted {
				boxID = ast.NewNodeID()
				markRuntimeEncryptedBox(boxID)
				prepareUnlockedEncryptedBoxTest(t, boxID, bytes.Repeat([]byte{0x67}, 32))
				av.SetAVBoxID(source.ID, boxID)
				tree.Box = boxID
				t.Cleanup(func() {
					av.SetAVBoxID(source.ID, "")
					forgetRuntimeEncryptedBox(boxID)
					encryptedBoxLifecycles.Delete(boxID)
					cachedDEKsLock.Lock()
					delete(cachedDEKs, boxID)
					cachedDEKsLock.Unlock()
				})
				if err = av.SaveAttributeView(source); err != nil {
					t.Fatal(err)
				}
				if err = os.Remove(filepath.Join(util.DataDir, "storage", "av", source.ID+".json")); err != nil {
					t.Fatal(err)
				}
			}
			historyDir := t.TempDir()
			if err = backupBoundAttributeViewHistory(tree, historyDir); err != nil {
				t.Fatal(err)
			}
			historyPath := boundAttributeViewHistoryPath(historyDir, boxID, source.ID)
			historyBytes, err := os.ReadFile(historyPath)
			if err != nil || util.IsCiphertext(historyBytes) != encrypted {
				t.Fatal("incorrect recovery source", err)
			}
			current, err := cloneAttributeViewForFieldMutation(source)
			if err != nil {
				t.Fatal(err)
			}
			if !removeAttributeViewBoundItems(current, map[string]struct{}{fixture.targetID: {}}, true) {
				t.Fatal("bound parent was not removed")
			}
			if err = av.SaveAttributeView(current); err != nil {
				t.Fatal(err)
			}
			tx := &Transaction{trees: map[string]*parse.Tree{}}
			err = tx.restoreBoundAttributeViewHistory(tree, historyDir)
			tx.finishAttributeViewMutation(err != nil)
			if err != nil {
				t.Fatal(err)
			}
			restored, err := av.ParseAttributeViewForIndexInBox(source.ID, boxID)
			if err != nil {
				t.Fatal(err)
			}
			index, err := restored.BuildSubItemsIndex()
			if err != nil {
				t.Fatal(err)
			}
			ids := source.Views[0].ItemIDs
			if index.Parents[ids[2]] != ids[1] {
				t.Fatal("history did not restore promoted child's parent")
			}
			preserved, _ := os.ReadFile(historyPath)
			if !bytes.Equal(historyBytes, preserved) {
				t.Fatal("history recovery overwrote recovery source")
			}
			if encrypted {
				historyBytes[len(historyBytes)-1] ^= 1
				if err = os.WriteFile(historyPath, historyBytes, 0600); err != nil {
					t.Fatal(err)
				}
				tx = &Transaction{trees: map[string]*parse.Tree{}}
				err = tx.restoreEmbeddedAttributeViewHistory(historyPath, boxID, source.ID)
				tx.finishAttributeViewMutation(err != nil)
				if err == nil {
					t.Fatal("corrupted recovery source accepted")
				}
				preserved, _ = os.ReadFile(historyPath)
				if !bytes.Equal(historyBytes, preserved) {
					t.Fatal("corrupted recovery source overwritten")
				}
			}
		})
	}
}

func TestSubItemsLegacyHistoryAndFailedTransaction(t *testing.T) {
	fixture, source, _, _ := setupAttributeViewItemsTest(t, false)
	source.Spec = 13
	if err := av.SaveAttributeView(source); err != nil {
		t.Fatal(err)
	}
	legacy, _ := json.Marshal(source)
	path := filepath.Join(t.TempDir(), source.ID+".json")
	if err := os.WriteFile(path, legacy, 0600); err != nil {
		t.Fatal(err)
	}
	op := &Operation{Action: "setAttrViewSubItems", AvID: source.ID, BlockID: fixture.sourceID, Data: map[string]any{"enabled": true}}
	tx := &Transaction{fromAPI: true, DoOperations: []*Operation{op}, m: &sync.Mutex{}}
	if err := tx.begin(); err != nil {
		t.Fatal(err)
	}
	if txErr := tx.doAttributeViewSubItems(op); txErr != nil {
		tx.rollback()
		t.Fatal(txErr)
	}
	tx.writeTransactionTree = func(*parse.Tree) error { return errors.New("injected carrier write failure") }
	if err := tx.commit(); err == nil {
		tx.rollback()
		t.Fatal("injected write failure did not abort")
	}
	tx.rollback()
	restored := readAttributeViewItemsTest(t, source.ID)
	if restored.Spec != 13 || restored.HasSubItems() {
		t.Fatal("failed enable did not restore original source")
	}
	runSubItemsOperation(t, &Operation{Action: "setAttrViewSubItems", AvID: source.ID, BlockID: fixture.sourceID, Data: map[string]any{"enabled": true}})
	historyTx := &Transaction{trees: map[string]*parse.Tree{}}
	err := historyTx.restoreEmbeddedAttributeViewHistory(path, "", source.ID)
	historyTx.finishAttributeViewMutation(err != nil)
	if err != nil {
		t.Fatal(err)
	}
	restored = readAttributeViewItemsTest(t, source.ID)
	if restored.Spec != av.SubItemsSpec || restored.HasSubItems() {
		t.Fatal("legacy recovery changed permanent format upgrade")
	}
	preserved, _ := os.ReadFile(path)
	if !bytes.Equal(legacy, preserved) {
		t.Fatal("legacy recovery source overwritten")
	}
}

func TestSubItemsReverseCellMoveAndUndo(t *testing.T) {
	fixture, source, _, _ := setupSubItemsTest(t, false)
	ids := source.Views[0].ItemIDs
	op := &Operation{Action: "updateAttrViewCell", AvID: source.ID, BlockID: fixture.sourceID, KeyID: source.SubItems.ChildrenKeyID, RowID: ids[0], Data: map[string]any{"relation": map[string]any{"blockIDs": []string{ids[1], ids[3]}}}}
	tx := runSubItemsOperation(t, op)
	assertSubItemsParent(t, source.ID, ids[3], ids[0])
	index, err := readAttributeViewItemsTest(t, source.ID).BuildSubItemsIndex()
	if err != nil || len(index.Children[ids[2]]) != 0 {
		t.Fatal("old parent inverse retained moved child", err)
	}
	if err = PerformTxSync(&Transaction{isReplay: true, DoOperations: cloneOperations(tx.UndoOperations)}); err != nil {
		t.Fatal(err)
	}
	assertSubItemsParent(t, source.ID, ids[3], ids[2])
}

func TestSubItemsInvalidConfigurationPreservesSource(t *testing.T) {
	fixture, source, _, _ := setupSubItemsTest(t, false)
	path := filepath.Join(util.DataDir, "storage", "av", source.ID+".json")
	before, _ := os.ReadFile(path)
	for _, data := range []any{nil, map[string]any{}, map[string]any{"enabled": nil}, map[string]any{"enabled": "false"}} {
		err := PerformTxSync(&Transaction{fromAPI: true, DoOperations: []*Operation{{Action: "setAttrViewSubItems", AvID: source.ID, BlockID: fixture.sourceID, Data: data}}})
		if err == nil {
			t.Fatal("accepted missing or invalid enabled boolean", data)
		}
		after, _ := os.ReadFile(path)
		if !bytes.Equal(before, after) {
			t.Fatal("invalid enable request changed source")
		}
	}
}

func TestSubItemsLargeTransactionsAndReplay(t *testing.T) {
	fixture, source, _, _ := setupSubItemsTest(t, false)
	source.KeyValues = slices.DeleteFunc(source.KeyValues, func(kv *av.KeyValues) bool { return kv.Key.Type != av.KeyTypeBlock && !source.IsSubItemsKey(kv.Key.ID) })
	for _, kv := range source.KeyValues {
		kv.Values = nil
	}
	const count = 4000
	ids := make([]string, count)
	primary := source.GetBlockKeyValues()
	parents := map[string]string{}
	for i := range ids {
		ids[i] = ast.NewNodeID()
		primary.Values = append(primary.Values, &av.Value{ID: ast.NewNodeID(), KeyID: primary.Key.ID, BlockID: ids[i], Type: av.KeyTypeBlock, IsDetached: true, Block: &av.ValueBlock{Content: "entry"}})
		if i > 0 {
			parents[ids[i]] = ids[0]
		}
	}
	for _, view := range source.Views {
		view.ItemIDs = slices.Clone(ids)
	}
	if err := source.SetSubItemsParents(parents); err != nil {
		t.Fatal(err)
	}
	if err := av.SaveAttributeView(source); err != nil {
		t.Fatal(err)
	}
	started := time.Now()
	copyTx := runSubItemsOperation(t, &Operation{Action: "duplicateAttrViewSubtree", AvID: source.ID, BlockID: fixture.sourceID, ViewID: source.Views[0].ID, SrcIDs: ids})
	copied := copyTx.DoOperations[0].RetData.(*insertAttrViewBlockResult).InsertedItemIDs
	if len(copied) != count {
		t.Fatalf("copy count %d", len(copied))
	}
	t.Logf("copy %d selected entries and capture undo: %s", count, time.Since(started))
	started = time.Now()
	for _, ops := range [][]*Operation{copyTx.UndoOperations, copyTx.DoOperations} {
		if err := PerformTxSync(&Transaction{isReplay: true, DoOperations: cloneOperations(ops)}); err != nil {
			t.Fatal(err)
		}
	}
	t.Logf("copy undo and redo: %s", time.Since(started))
	undo := make([]*Operation, 0, count)
	for _, id := range copied {
		undo = append(undo, &Operation{Action: "insertAttrViewBlock", AvID: source.ID, BlockID: fixture.sourceID, Srcs: []map[string]any{{"id": id, "itemID": id, "isDetached": true}}})
	}
	deleteTx := &Transaction{fromAPI: true, DoOperations: []*Operation{{Action: "removeAttrViewBlock", AvID: source.ID, BlockID: fixture.sourceID, SrcIDs: copied}}, UndoOperations: undo}
	started = time.Now()
	if err := PerformTxSync(deleteTx); err != nil {
		t.Fatal(err)
	}
	for _, ops := range [][]*Operation{deleteTx.UndoOperations, deleteTx.DoOperations} {
		if err := PerformTxSync(&Transaction{isReplay: true, DoOperations: cloneOperations(ops)}); err != nil {
			t.Fatal(err)
		}
	}
	t.Logf("delete %d entries, undo and redo: %s", count, time.Since(started))
	index, err := readAttributeViewItemsTest(t, source.ID).BuildSubItemsIndex()
	if err != nil || len(index.Parents) != count {
		t.Fatal("large replay changed surviving forest", err)
	}
}

func TestSubItemsRootPromotionAndSiblingAnchors(t *testing.T) {
	fixture, source, _, _ := setupSubItemsTest(t, false)
	ids := slices.Clone(source.Views[0].ItemIDs)
	runSubItemsOperation(t, &Operation{Action: "promoteAttrViewItems", AvID: source.ID, BlockID: fixture.sourceID, ViewID: source.Views[0].ID, SrcIDs: []string{ids[0]}})
	if !slices.Equal(readAttributeViewItemsTest(t, source.ID).Views[0].ItemIDs, ids) {
		t.Fatal("promoting a root reordered it")
	}
	source = readAttributeViewItemsTest(t, source.ID)
	if err := source.SetSubItemsParents(map[string]string{ids[2]: ids[0], ids[3]: ids[0]}); err != nil {
		t.Fatal(err)
	}
	if err := av.SaveAttributeView(source); err != nil {
		t.Fatal(err)
	}
	runSubItemsOperation(t, &Operation{Action: "reparentAttrViewItems", AvID: source.ID, BlockID: fixture.sourceID, ViewID: source.Views[0].ID, SrcIDs: []string{ids[3]}, ParentID: ids[0], NextID: ids[1]})
	if !slices.Equal(readAttributeViewItemsTest(t, source.ID).Views[0].ItemIDs, []string{ids[0], ids[3], ids[1], ids[2]}) {
		t.Fatal("before anchor ignored hidden siblings")
	}
	runSubItemsOperation(t, &Operation{Action: "reparentAttrViewItems", AvID: source.ID, BlockID: fixture.sourceID, ViewID: source.Views[0].ID, SrcIDs: []string{ids[3]}, ParentID: ids[0]})
	if !slices.Equal(readAttributeViewItemsTest(t, source.ID).Views[0].ItemIDs, ids) {
		t.Fatal("unanchored move did not append")
	}
	source = readAttributeViewItemsTest(t, source.ID)
	source.Views[0].Sorts = []*av.ViewSort{{Column: source.GetBlockKey().ID, Order: av.SortOrderAsc}}
	if err := av.SaveAttributeView(source); err != nil {
		t.Fatal(err)
	}
	runSubItemsOperation(t, &Operation{Action: "reparentAttrViewItems", AvID: source.ID, BlockID: fixture.sourceID, ViewID: source.Views[0].ID, SrcIDs: []string{ids[2]}, ParentID: ids[1]})
	if !slices.Equal(readAttributeViewItemsTest(t, source.ID).Views[0].ItemIDs, ids) {
		t.Fatal("automatic sorting rewrote manual order")
	}
}
