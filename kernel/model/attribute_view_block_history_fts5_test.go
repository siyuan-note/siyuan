//go:build fts5

package model

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAttributeViewBoundHistoryRejectsInvalidData(t *testing.T) {
	_, before, _ := setupAttributeViewDeletedBlockTest(t, "block")
	for _, invalid := range []string{"new format", "missing primary", "null field", "null value"} {
		t.Run(invalid, func(t *testing.T) {
			historical, err := cloneAttributeViewForFieldMutation(before)
			if err != nil {
				t.Fatal(err)
			}
			switch invalid {
			case "new format":
				historical.Spec = av.CurrentSpec + 1
			case "missing primary":
				historical.KeyValues = nil
			case "null field":
				historical.KeyValues = append(historical.KeyValues, nil)
			case "null value":
				historical.GetBlockKeyValues().Values = append(historical.GetBlockKeyValues().Values, nil)
			}
			data, err := json.Marshal(historical)
			if err != nil {
				t.Fatal(err)
			}
			filename := filepath.Join(t.TempDir(), before.ID+".json")
			if err = os.WriteFile(filename, data, 0600); err != nil {
				t.Fatal(err)
			}
			tx := &Transaction{trees: map[string]*parse.Tree{}}
			err = tx.restoreEmbeddedAttributeViewHistory(filename, "", before.ID)
			tx.finishAttributeViewMutation(err != nil)
			if err == nil {
				t.Fatal("invalid database history was accepted")
			}
			assertAttributeViewFieldsTest(t, before, readAttributeViewItemsTest(t, before.ID))
			preserved, err := os.ReadFile(filename)
			if err != nil || !bytes.Equal(data, preserved) {
				t.Fatal("invalid history was overwritten")
			}
		})
	}
}

func TestAttributeViewBoundHistoryRelations(t *testing.T) {
	for _, self := range []bool{false, true} {
		t.Run(map[bool]string{false: "other database", true: "same database"}[self], func(t *testing.T) {
			fixture, before, _ := setupAttributeViewDeletedBlockTest(t, "container")
			dest, backID, targetID := addDeletedBlockTestRelation(t, before, self)
			tree, err := LoadTreeByBlockID(fixture.sourceID)
			if err != nil {
				t.Fatal(err)
			}
			historyDir := t.TempDir()
			if err = backupBoundAttributeViewHistory(tree, historyDir); err != nil {
				t.Fatal(err)
			}
			bound := map[string]map[string]struct{}{}
			collectDeletedAttributeViewBlocks(tree.Root, true, bound)
			current := readAttributeViewItemsTest(t, before.ID)
			removeAttributeViewBoundItems(current, bound[before.ID], true)
			if err = av.SaveAttributeView(current); err != nil {
				t.Fatal(err)
			}
			changed := readAttributeViewItemsTest(t, dest.ID)
			keptID := before.GetBlockKeyValues().Values[2].BlockID
			changed.GetValue(backID, targetID).Relation.BlockIDs = []string{keptID}
			if err = av.SaveAttributeView(changed); err != nil {
				t.Fatal(err)
			}
			tx := &Transaction{trees: map[string]*parse.Tree{}}
			err = tx.restoreBoundAttributeViewHistory(tree, historyDir)
			tx.finishAttributeViewMutation(err != nil)
			if err != nil {
				t.Fatal(err)
			}
			back := readAttributeViewItemsTest(t, dest.ID).GetValue(backID, targetID)
			expected := append([]string{keptID}, dest.GetValue(backID, targetID).Relation.BlockIDs...)
			if !slices.Equal(expected, back.Relation.BlockIDs) {
				t.Fatalf("history did not merge back relations: %v", back.Relation.BlockIDs)
			}
		})
	}
}

func TestAttributeViewDeleteDocumentUnreadableChildPreservesData(t *testing.T) {
	fixture, before, _ := setupAttributeViewDeletedBlockTest(t, "block")
	childID := ast.NewNodeID()
	child := treenode.NewTree(fixture.box.ID, "/"+fixture.sourceID+"/"+childID+".sy", "/Source/Child", "Child")
	if _, err := filesys.WriteTree(child); err != nil {
		t.Fatal(err)
	}
	treenode.UpsertBlockTree(child)
	childPath := filepath.Join(util.DataDir, child.Box, child.Path)
	corrupted := []byte("unreadable child document")
	if err := os.WriteFile(childPath, corrupted, 0600); err != nil {
		t.Fatal(err)
	}
	cache.RemoveTreeData(child.ID)
	t.Cleanup(func() { cache.RemoveTreeData(child.ID) })
	if _, err := removeDoc(fixture.box, fixture.sourcePath, util.NewLute()); err == nil {
		t.Fatal("document deletion skipped unreadable child history")
	}
	if _, err := os.Stat(filepath.Join(util.DataDir, fixture.box.ID, fixture.sourcePath)); err != nil {
		t.Fatalf("failed deletion removed the parent document: %v", err)
	}
	if data, err := os.ReadFile(childPath); err != nil || !bytes.Equal(data, corrupted) {
		t.Fatalf("failed deletion changed the unreadable child: %v", err)
	}
	assertAttributeViewFieldsTest(t, before, readAttributeViewItemsTest(t, before.ID))
}

func TestAttributeViewDeletedDocumentHistory(t *testing.T) {
	fixture, before, _ := setupAttributeViewDeletedBlockTest(t, "container")
	sourceTree, err := LoadTreeByBlockID(fixture.sourceID)
	if err != nil {
		t.Fatal(err)
	}
	primary := before.GetBlockKeyValues().Values[2]
	primary.IsDetached, primary.Block.ID = false, fixture.sourceID
	sourceTree.Root.SetIALAttr(av.NodeAttrNameAvs, before.ID)
	if _, err = filesys.WriteTree(sourceTree); err != nil {
		t.Fatal(err)
	}
	if err = av.SaveAttributeView(before); err != nil {
		t.Fatal(err)
	}
	oldWorkspace := util.WorkspaceDir
	util.WorkspaceDir = filepath.Dir(util.HistoryDir)
	t.Cleanup(func() { util.WorkspaceDir = oldWorkspace })
	if _, err := removeDoc(fixture.box, fixture.sourcePath, util.NewLute()); err != nil {
		t.Fatal(err)
	}
	sql.FlushQueue()
	paths, err := filepath.Glob(filepath.Join(util.HistoryDir, "*-delete", fixture.box.ID, fixture.sourceID+".sy"))
	if err != nil || len(paths) != 1 {
		t.Fatalf("deleted document history is missing: %v, %v", paths, err)
	}
	current := readAttributeViewItemsTest(t, before.ID)
	if len(current.GetBlockKeyValues().Values) != 1 {
		t.Fatal("document deletion did not remove its database entries")
	}
	current.Name = "Later database name"
	if err = av.SaveAttributeView(current); err != nil {
		t.Fatal(err)
	}
	before.Name = current.Name
	relative, err := filepath.Rel(util.WorkspaceDir, paths[0])
	if err != nil {
		t.Fatal(err)
	}
	if err = RollbackDocHistory(relative); err != nil {
		t.Fatal(err)
	}
	sql.FlushQueue()
	assertAttributeViewItemsEqual(t, before, readAttributeViewItemsTest(t, before.ID))
	tree, err := LoadTreeByBlockID(fixture.sourceID)
	if err != nil {
		t.Fatal(err)
	}
	for _, primary := range before.GetBlockKeyValues().Values {
		if !primary.IsDetached {
			node := treenode.GetNodeInTree(tree, primary.Block.ID)
			if node == nil || !strings.Contains(node.IALAttr(av.NodeAttrNameAvs), before.ID) {
				t.Fatal("document history did not restore its database bindings")
			}
		}
	}
}

func TestAttributeViewDeletedDocumentClearsDatabaseHistory(t *testing.T) {
	for _, redo := range []bool{false, true} {
		t.Run(map[bool]string{false: "undo", true: "redo"}[redo], func(t *testing.T) {
			fixture, before, _, _ := setupAttributeViewItemsTest(t, true)
			unrelated := &Transaction{fromAPI: true,
				DoOperations:   []*Operation{{Action: "doUpdateUpdated", ID: fixture.sourceID, Data: "20260101000000"}},
				UndoOperations: []*Operation{{Action: "doUpdateUpdated", ID: fixture.sourceID, Data: "20250101000000"}},
			}
			if err := PerformTxSync(unrelated); err != nil {
				t.Fatal(err)
			}
			keptEntry := GlobalUndoLog.Peek(fixture.sourceID)
			itemID := before.GetBlockKeyValues().Values[1].BlockID
			var keyID string
			for _, kv := range before.KeyValues {
				if kv.Key.Type == av.KeyTypeText {
					keyID = kv.Key.ID
					break
				}
			}
			edit := &Transaction{fromAPI: true,
				DoOperations: []*Operation{
					{Action: "updateAttrViewCell", AvID: before.ID, BlockID: fixture.sourceID, KeyID: keyID, RowID: itemID,
						Data: map[string]any{"text": map[string]any{"content": "Edited before deleting document"}}},
					{Action: "doUpdateUpdated", ID: fixture.sourceID, Data: "20260102000000"},
				},
				UndoOperations: []*Operation{{Action: "updateAttrViewCell", AvID: before.ID, BlockID: fixture.sourceID,
					KeyID: keyID, RowID: itemID, Data: map[string]any{"text": map[string]any{"content": "private field contents"}}}},
			}
			if err := PerformTxSync(edit); err != nil {
				t.Fatal(err)
			}
			if entry := GlobalUndoLog.Peek(fixture.sourceID); entry == nil || entry == keptEntry {
				t.Fatal("cell edit did not enter the undo log")
			}
			if redo {
				entry := GlobalUndoLog.Undo(fixture.sourceID)
				replayAttributeViewFieldsTest(t, entry.UndoOperationsForReplay())
				GlobalUndoLog.UndoCommit(entry, fixture.sourceID)
			}
			if _, err := removeDoc(fixture.box, fixture.targetPath, util.NewLute()); err != nil {
				t.Fatal(err)
			}
			sql.FlushQueue()
			if readAttributeViewItemsTest(t, before.ID).GetBlockValue(itemID) != nil {
				t.Fatal("deleted document remains bound to the database item")
			}
			if entry := GlobalUndoLog.Redo(fixture.sourceID); entry != nil {
				t.Fatal("deleted database item still has a redo entry")
			}
			entry := GlobalUndoLog.Undo(fixture.sourceID)
			if entry == nil {
				t.Fatal("unrelated document history was removed")
			}
			replayAttributeViewFieldsTest(t, entry.UndoOperationsForReplay())
			if entry != keptEntry {
				t.Fatal("deleted database item still has an undo entry")
			}
			GlobalUndoLog.UndoCommit(entry, fixture.sourceID)
		})
	}
}

func TestAttributeViewBoundHistoryRestore(t *testing.T) {
	for _, encrypted := range []bool{false, true} {
		t.Run(map[bool]string{false: "ordinary", true: "encrypted"}[encrypted], func(t *testing.T) {
			fixture, before, _ := setupAttributeViewDeletedBlockTest(t, "container")
			tree, err := LoadTreeByBlockID(fixture.sourceID)
			if err != nil {
				t.Fatal(err)
			}
			boxID := ""
			if encrypted {
				boxID = ast.NewNodeID()
				markRuntimeEncryptedBox(boxID)
				setDEKForTest(boxID, bytes.Repeat([]byte{0x67}, 32))
				av.SetAVBoxID(before.ID, boxID)
				tree.Box = boxID
				t.Cleanup(func() {
					av.SetAVBoxID(before.ID, "")
					forgetRuntimeEncryptedBox(boxID)
					encryptedBoxLifecycles.Delete(boxID)
					cachedDEKsLock.Lock()
					delete(cachedDEKs, boxID)
					cachedDEKsLock.Unlock()
				})
				if err = av.SaveAttributeView(before); err != nil {
					t.Fatal(err)
				}
				if err = os.Remove(filepath.Join(util.DataDir, "storage", "av", before.ID+".json")); err != nil {
					t.Fatal(err)
				}
			}
			historyDir := t.TempDir()
			tree.Root.AppendChild(&ast.Node{Type: ast.NodeAttributeView, ID: ast.NewNodeID(), AttributeViewID: before.ID})
			if err = backupBoundAttributeViewHistory(tree, historyDir); err != nil {
				t.Fatal(err)
			}
			historyPath := boundAttributeViewHistoryPath(historyDir, boxID, before.ID)
			originalBytes, err := os.ReadFile(historyPath)
			if err != nil || util.IsCiphertext(originalBytes) != encrypted {
				t.Fatalf("incorrect history encryption: %v", err)
			}
			bound := map[string]map[string]struct{}{}
			collectDeletedAttributeViewBlocks(tree.Root, true, bound)
			current, _ := cloneAttributeViewForFieldMutation(before)
			removeAttributeViewBoundItems(current, bound[before.ID], true)
			current.Name = "Later database name"
			current.KeyValues[2].Values[0].Text.Content = "Later unrelated edit"
			before.Name = current.Name
			before.KeyValues[2].Values[2].Text.Content = "Later unrelated edit"
			if err = av.SaveAttributeView(current); err != nil {
				t.Fatal(err)
			}
			if err = backupBoundAttributeViewHistory(tree, historyDir); err != nil {
				t.Fatal(err)
			}
			preserved, err := os.ReadFile(historyPath)
			if err != nil || !bytes.Equal(originalBytes, preserved) {
				t.Fatal("a later deletion replaced the original recovery snapshot")
			}
			tx := &Transaction{trees: map[string]*parse.Tree{}}
			err = tx.restoreBoundAttributeViewHistory(tree, historyDir)
			tx.finishAttributeViewMutation(err != nil)
			if err != nil {
				t.Fatal(err)
			}
			restored, err := av.ParseAttributeViewForIndexInBox(before.ID, boxID)
			if err != nil {
				t.Fatal(err)
			}
			assertAttributeViewItemsEqual(t, before, restored)
			if restored.Name != "Later database name" {
				t.Fatal("history recovery overwrote a later database edit")
			}
			tx = &Transaction{trees: map[string]*parse.Tree{}}
			if err = tx.restoreEmbeddedAttributeViewHistory(historyPath, boxID, before.ID); err != nil {
				tx.finishAttributeViewMutation(true)
				t.Fatal(err)
			}
			tx.finishAttributeViewMutation(true)
			preservedView, err := av.ParseAttributeViewForIndexInBox(before.ID, boxID)
			if err != nil {
				t.Fatal(err)
			}
			assertAttributeViewFieldsTest(t, restored, preservedView)
			if encrypted {
				originalBytes[len(originalBytes)-1] ^= 1
				if err = os.WriteFile(historyPath, originalBytes, 0600); err != nil {
					t.Fatal(err)
				}
				tx = &Transaction{trees: map[string]*parse.Tree{}}
				err = tx.restoreBoundAttributeViewHistory(tree, historyDir)
				tx.finishAttributeViewMutation(err != nil)
				if err == nil {
					t.Fatal("corrupted database history was accepted")
				}
				tx = &Transaction{trees: map[string]*parse.Tree{}}
				err = tx.restoreEmbeddedAttributeViewHistory(historyPath, boxID, before.ID)
				tx.finishAttributeViewMutation(err != nil)
				if err == nil {
					t.Fatal("corrupted embedded database history was accepted")
				}
				preservedView, err = av.ParseAttributeViewForIndexInBox(before.ID, boxID)
				if err != nil {
					t.Fatal(err)
				}
				assertAttributeViewFieldsTest(t, restored, preservedView)
			}
		})
	}
}
