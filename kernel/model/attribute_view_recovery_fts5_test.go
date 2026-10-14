//go:build fts5

package model

import (
	"bytes"
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

func TestAttributeViewDocumentDeletionCleansRelations(t *testing.T) {
	fixture, source, _ := setupAttributeViewDeletedBlockTest(t, "container")
	dest, backID, targetID := addDeletedBlockTestRelation(t, source, false)
	keptID := source.GetBlockKeyValues().Values[2].BlockID
	dest.GetValue(backID, targetID).Relation.BlockIDs = append([]string{keptID}, dest.GetValue(backID, targetID).Relation.BlockIDs...)
	if err := av.SaveAttributeView(dest); err != nil {
		t.Fatal(err)
	}
	if _, err := removeDoc(fixture.box, fixture.sourcePath, util.NewLute()); err != nil {
		t.Fatal(err)
	}
	got := readAttributeViewItemsTest(t, dest.ID).GetValue(backID, targetID).Relation.BlockIDs
	if !slices.Equal(got, []string{keptID}) {
		t.Fatalf("deleted document remains related: %v", got)
	}
	current := readAttributeViewItemsTest(t, source.ID)
	for _, kv := range source.KeyValues {
		if kv.Key.Type == av.KeyTypeNumber {
			for _, value := range kv.Values {
				if current.GetValue(kv.Key.ID, value.BlockID) == nil {
					t.Fatal("document deletion discarded recoverable field values")
				}
			}
		}
	}
}

func TestAttributeViewDocumentHistoryRestoresCleanedDatabase(t *testing.T) {
	fixture, before, _, _ := setupAttributeViewItemsTest(t, false)
	tree, err := LoadTreeByBlockID(fixture.sourceID)
	if err != nil {
		t.Fatal(err)
	}
	node := &ast.Node{Type: ast.NodeAttributeView, ID: ast.NewNodeID(), AttributeViewID: before.ID}
	node.SetIALAttr("id", node.ID)
	tree.Root.AppendChild(node)
	if _, err = filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	treenode.UpsertBlockTree(tree)
	oldWorkspace := util.WorkspaceDir
	util.WorkspaceDir = filepath.Dir(util.HistoryDir)
	t.Cleanup(func() { util.WorkspaceDir = oldWorkspace })
	if _, err = removeDoc(fixture.box, fixture.sourcePath, util.NewLute()); err != nil {
		t.Fatal(err)
	}
	sql.FlushQueue()
	if err = os.Remove(av.GetAttributeViewDataPath(before.ID)); err != nil {
		t.Fatal(err)
	}
	cache.ClearAVCache()
	paths, err := filepath.Glob(filepath.Join(util.HistoryDir, "*-delete", fixture.box.ID, fixture.sourceID+".sy"))
	if err != nil || len(paths) != 1 {
		t.Fatalf("missing document history: %v %v", paths, err)
	}
	relative, err := filepath.Rel(util.WorkspaceDir, paths[0])
	if err != nil {
		t.Fatal(err)
	}
	if err = RollbackDocHistory(relative); err != nil {
		t.Fatal(err)
	}
	sql.FlushQueue()
	assertAttributeViewItemsEqual(t, before, readAttributeViewItemsTest(t, before.ID))
}

func TestAttributeViewMissingDatabaseHistoryRecovery(t *testing.T) {
	for _, encrypted := range []bool{false, true} {
		t.Run(map[bool]string{false: "ordinary", true: "encrypted"}[encrypted], func(t *testing.T) {
			_, before, _, _ := setupAttributeViewItemsTest(t, false)
			boxID := ""
			if encrypted {
				boxID = ast.NewNodeID()
				markRuntimeEncryptedBox(boxID)
				setDEKForTest(boxID, bytes.Repeat([]byte{0x73}, 32))
				av.SetAVBoxID(before.ID, boxID)
				t.Cleanup(func() {
					av.SetAVBoxID(before.ID, "")
					forgetRuntimeEncryptedBox(boxID)
					encryptedBoxLifecycles.Delete(boxID)
					cachedDEKsLock.Lock()
					delete(cachedDEKs, boxID)
					cachedDEKsLock.Unlock()
				})
				if err := av.SaveAttributeView(before); err != nil {
					t.Fatal(err)
				}
				if err := os.Remove(av.GetAttributeViewDataPath(before.ID)); err != nil {
					t.Fatal(err)
				}
			}
			filename := boundAttributeViewHistoryPath(util.DataDir, boxID, before.ID)
			data, err := os.ReadFile(filename)
			if err != nil {
				t.Fatal(err)
			}
			historyPath := filepath.Join(t.TempDir(), before.ID+".json")
			if err = os.WriteFile(historyPath, data, 0600); err != nil {
				t.Fatal(err)
			}
			if err = os.Remove(filename); err != nil {
				t.Fatal(err)
			}
			cache.ClearAVCache()
			for _, rollback := range []bool{true, false} {
				tx := &Transaction{trees: map[string]*parse.Tree{}}
				if err = tx.restoreEmbeddedAttributeViewHistory(historyPath, boxID, before.ID); err != nil {
					tx.finishAttributeViewMutation(true)
					t.Fatal(err)
				}
				restored, readErr := av.ParseAttributeViewForIndexInBox(before.ID, boxID)
				if readErr != nil {
					t.Fatal(readErr)
				}
				assertAttributeViewItemsEqual(t, before, restored)
				tx.finishAttributeViewMutation(rollback)
				if rollback {
					if _, err = os.Stat(filename); !os.IsNotExist(err) {
						t.Fatal("failed recovery retained a newly created database")
					}
				}
			}
			preserved, err := os.ReadFile(historyPath)
			if err != nil || !bytes.Equal(data, preserved) {
				t.Fatal("database history changed during recovery")
			}
			if encrypted {
				stored, err := os.ReadFile(filename)
				if err != nil || !util.IsCiphertext(stored) {
					t.Fatal("encrypted history produced a plaintext database")
				}
			}
		})
	}
}

func TestAttributeViewNotebookHistoryRestoresBindings(t *testing.T) {
	for _, scenario := range []struct {
		name            string
		cleanup, oneWay bool
	}{
		{"bound rows", false, false},
		{"cleaned embedded database", true, false},
		{"one-way relations", false, true},
		{"cleaned embedded one-way relations", true, true},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			cleanup := scenario.cleanup
			fixture, before, _ := setupAttributeViewDeletedBlockTest(t, "container")
			var dest *av.AttributeView
			var targetID string
			if scenario.oneWay {
				dest, _, targetID = addDeletedBlockOneWayTestRelation(t, before)
			} else {
				dest, _, targetID = addDeletedBlockTestRelation(t, before, false)
			}
			primary := dest.GetBlockValue(targetID)
			primary.IsDetached, primary.Block.ID = false, fixture.targetID
			dest.Views[0].ItemIDs = []string{targetID}
			if err := av.SaveAttributeView(dest); err != nil {
				t.Fatal(err)
			}
			targetTree, err := LoadTreeByBlockID(fixture.targetID)
			if err != nil {
				t.Fatal(err)
			}
			targetTree.Root.SetIALAttr(av.NodeAttrNameAvs, dest.ID)
			if _, err = filesys.WriteTree(targetTree); err != nil {
				t.Fatal(err)
			}
			treenode.UpsertBlockTree(targetTree)
			sql.IndexTreeQueue(targetTree)
			sql.FlushQueue()
			if cleanup {
				tree, err := LoadTreeByBlockID(fixture.sourceID)
				if err != nil {
					t.Fatal(err)
				}
				node := &ast.Node{Type: ast.NodeAttributeView, ID: ast.NewNodeID(), AttributeViewID: before.ID}
				node.SetIALAttr("id", node.ID)
				tree.Root.AppendChild(node)
				if _, err = filesys.WriteTree(tree); err != nil {
					t.Fatal(err)
				}
				treenode.UpsertBlockTree(tree)
			}
			oldWorkspace := util.WorkspaceDir
			util.WorkspaceDir = filepath.Dir(util.HistoryDir)
			t.Cleanup(func() { util.WorkspaceDir = oldWorkspace })
			if err := RemoveBox(fixture.box.ID); err != nil {
				t.Fatal(err)
			}
			if cleanup {
				if err := os.Remove(av.GetAttributeViewDataPath(before.ID)); err != nil {
					t.Fatal(err)
				}
				cache.ClearAVCache()
			} else {
				current := readAttributeViewItemsTest(t, before.ID)
				if len(current.GetBlockKeyValues().Values) != 2 {
					t.Fatal("notebook deletion retained bound rows")
				}
			}
			paths, err := filepath.Glob(filepath.Join(util.HistoryDir, "*-delete", fixture.box.ID))
			if err != nil || len(paths) != 1 {
				t.Fatalf("missing notebook history: %v %v", paths, err)
			}
			relative, err := filepath.Rel(util.WorkspaceDir, paths[0])
			if err != nil {
				t.Fatal(err)
			}
			if err = RollbackNotebookHistory(relative); err != nil {
				t.Fatal(err)
			}
			assertAttributeViewItemsEqual(t, before, readAttributeViewItemsTest(t, before.ID))
			assertAttributeViewFieldsTest(t, dest, readAttributeViewItemsTest(t, dest.ID))
			if !fixture.box.GetConf().Closed {
				t.Fatal("notebook recovery changed the closed state")
			}
		})
	}
}

func TestDeletedFlashcardBlockReplayRetainsDeckAttribute(t *testing.T) {
	fixture, _, tx := setupAttributeViewDeletedBlockTest(t, "block")
	tree, err := LoadTreeByBlockID(fixture.sourceID)
	if err != nil {
		t.Fatal(err)
	}
	id := tx.DoOperations[0].ID
	node := treenode.GetNodeInTree(tree, id)
	node.SetIALAttr(NodeAttrRiffDecks, "20230218211946-2kw8jgx")
	if _, err = filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	tx.UndoOperations[0].Data = GetBlockDOM(id)
	if err = PerformTxSync(tx); err != nil {
		t.Fatal(err)
	}
	entry := GlobalUndoLog.Peek(fixture.sourceID)
	for cycle := 0; cycle < 2; cycle++ {
		replayAttributeViewFieldsTest(t, entry.UndoOperationsForReplay())
		restored, err := LoadTreeByBlockID(fixture.sourceID)
		if err != nil {
			t.Fatal(err)
		}
		if treenode.GetNodeInTree(restored, id).IALAttr(NodeAttrRiffDecks) != "20230218211946-2kw8jgx" {
			t.Fatal("flashcard undo lost its deck attribute")
		}
		replayAttributeViewFieldsTest(t, entry.DoOperationsForReplay())
	}
}

func TestFlashcardCopyRedoPreservesNormalizedAttributes(t *testing.T) {
	fixture, _, original := setupAttributeViewDeletedBlockTest(t, "block")
	originalID := original.DoOperations[0].ID
	tree, err := LoadTreeByBlockID(fixture.sourceID)
	if err != nil {
		t.Fatal(err)
	}
	treenode.GetNodeInTree(tree, originalID).SetIALAttr(NodeAttrRiffDecks, "20230218211946-2kw8jgx")
	if _, err = filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	copyID := ast.NewNodeID()
	data := strings.ReplaceAll(GetBlockDOM(originalID), originalID, copyID)
	tx := &Transaction{fromAPI: true,
		DoOperations:   []*Operation{{Action: "insert", ID: copyID, PreviousID: originalID, Data: data}},
		UndoOperations: []*Operation{{Action: "delete", ID: copyID}},
	}
	if err = PerformTxSync(tx); err != nil {
		t.Fatal(err)
	}
	check := func() {
		t.Helper()
		current, loadErr := LoadTreeByBlockID(fixture.sourceID)
		if loadErr != nil {
			t.Fatal(loadErr)
		}
		if got := treenode.GetNodeInTree(current, copyID).IALAttr(NodeAttrRiffDecks); got != "" {
			t.Fatalf("copied block became a flashcard: %s", got)
		}
		if got := treenode.GetNodeInTree(current, originalID).IALAttr(NodeAttrRiffDecks); got != "20230218211946-2kw8jgx" {
			t.Fatal("copy changed the original flashcard")
		}
	}
	check()
	entry := GlobalUndoLog.Peek(fixture.sourceID)
	for cycle := 0; cycle < 2; cycle++ {
		replayAttributeViewFieldsTest(t, entry.UndoOperationsForReplay())
		replayAttributeViewFieldsTest(t, entry.DoOperationsForReplay())
		check()
	}
}

func addDeletedBlockOneWayTestRelation(t *testing.T, source *av.AttributeView) (*av.AttributeView, string, string) {
	t.Helper()
	dest, keyID, itemID := addDeletedBlockTestRelation(t, source, false)
	source.KeyValues = slices.DeleteFunc(source.KeyValues, func(kv *av.KeyValues) bool { return kv.Key.Type == av.KeyTypeRelation })
	key, _ := dest.GetKey(keyID)
	key.Relation.IsTwoWay, key.Relation.BackKeyID = false, ""
	for _, view := range []*av.AttributeView{source, dest} {
		if err := av.SaveAttributeView(view); err != nil {
			t.Fatal(err)
		}
	}
	av.RemoveAvRel(source.ID, dest.ID)
	return dest, keyID, itemID
}

func TestAttributeViewDocumentHistoryOneWayRelations(t *testing.T) {
	fixture, source, _ := setupAttributeViewDeletedBlockTest(t, "container")
	dest, keyID, itemID := addDeletedBlockOneWayTestRelation(t, source)
	want := append([]string(nil), dest.GetValue(keyID, itemID).Relation.BlockIDs...)
	oldWorkspace := util.WorkspaceDir
	util.WorkspaceDir = filepath.Dir(util.HistoryDir)
	t.Cleanup(func() { util.WorkspaceDir = oldWorkspace })
	if _, err := removeDoc(fixture.box, fixture.sourcePath, util.NewLute()); err != nil {
		t.Fatal(err)
	}
	sql.FlushQueue()
	current := readAttributeViewItemsTest(t, dest.ID)
	if got := current.GetValue(keyID, itemID).Relation.BlockIDs; len(got) != 0 {
		t.Fatalf("deletion did not clear incoming IDs: %v", got)
	}
	keptID := source.GetBlockKeyValues().Values[2].BlockID
	current.GetValue(keyID, itemID).Relation.BlockIDs = []string{keptID}
	if err := av.SaveAttributeView(current); err != nil {
		t.Fatal(err)
	}
	paths, err := filepath.Glob(filepath.Join(util.HistoryDir, "*-delete", fixture.box.ID, fixture.sourceID+".sy"))
	if err != nil || len(paths) != 1 {
		t.Fatalf("history paths: %v %v", paths, err)
	}
	relative, err := filepath.Rel(util.WorkspaceDir, paths[0])
	if err != nil {
		t.Fatal(err)
	}
	if err = RollbackDocHistory(relative); err != nil {
		t.Fatal(err)
	}
	sql.FlushQueue()
	assertAttributeViewItemsEqual(t, source, readAttributeViewItemsTest(t, source.ID))
	want = append(want, keptID)
	if got := readAttributeViewItemsTest(t, dest.ID).GetValue(keyID, itemID).Relation.BlockIDs; !slices.Equal(got, want) {
		t.Fatalf("recovery lost one-way relations or later edits: want %v, got %v", want, got)
	}
}

func TestAttributeViewExternalDeletionUnreadableRelationPreservesData(t *testing.T) {
	for _, notebook := range []bool{false, true} {
		t.Run(map[bool]string{false: "document", true: "notebook"}[notebook], func(t *testing.T) {
			fixture, source, _ := setupAttributeViewDeletedBlockTest(t, "container")
			dest, _, _ := addDeletedBlockTestRelation(t, source, false)
			corrupted := []byte("invalid database JSON")
			filename := av.GetAttributeViewDataPath(dest.ID)
			if err := os.WriteFile(filename, corrupted, 0600); err != nil {
				t.Fatal(err)
			}
			cache.ClearAVCache()
			var err error
			if notebook {
				err = RemoveBox(fixture.box.ID)
			} else {
				_, err = removeDoc(fixture.box, fixture.sourcePath, util.NewLute())
			}
			if err == nil {
				t.Fatal("unreadable relation did not abort deletion")
			}
			if _, err = os.Stat(filepath.Join(util.DataDir, fixture.box.ID, fixture.sourcePath)); err != nil {
				t.Fatalf("failed deletion removed the document: %v", err)
			}
			assertAttributeViewItemsEqual(t, source, readAttributeViewItemsTest(t, source.ID))
			if data, err := os.ReadFile(filename); err != nil || !bytes.Equal(data, corrupted) {
				t.Fatal("failed deletion changed the unreadable database")
			}
			if notebook && fixture.box.GetConf().Closed {
				t.Fatal("failed preflight closed the notebook")
			}
		})
	}
}

func TestAttributeViewExternalDeletionSaveFailureRollsBackBatch(t *testing.T) {
	fixture, source, _ := setupAttributeViewDeletedBlockTest(t, "container")
	dest, _, _ := addDeletedBlockTestRelation(t, source, false)
	tree, err := LoadTreeByBlockID(fixture.sourceID)
	if err != nil {
		t.Fatal(err)
	}
	deleted := map[string]map[string]struct{}{}
	collectDeletedAttributeViewBlocks(tree.Root, true, deleted)
	tx := &Transaction{}
	before, after, err := tx.prepareDeletedBoundAttributeViewBlocks(deleted, "")
	if err != nil {
		t.Fatal(err)
	}
	ids := sortedAttributeViewFieldKeys(after)
	after[ids[len(ids)-1]].ID = "invalid"
	err = tx.saveAttributeViewFieldChanges(&attributeViewFieldsSnapshot{}, before, after)
	tx.finishAttributeViewMutation(err != nil)
	if err == nil {
		t.Fatal("invalid save did not fail")
	}
	assertAttributeViewFieldsTest(t, source, readAttributeViewItemsTest(t, source.ID))
	assertAttributeViewFieldsTest(t, dest, readAttributeViewItemsTest(t, dest.ID))
}

func TestAttributeViewBoundHistoryOneWayEncrypted(t *testing.T) {
	fixture, source, _ := setupAttributeViewDeletedBlockTest(t, "container")
	dest, keyID, itemID := addDeletedBlockOneWayTestRelation(t, source)
	boxID := ast.NewNodeID()
	markRuntimeEncryptedBox(boxID)
	setDEKForTest(boxID, bytes.Repeat([]byte{0x79}, 32))
	t.Cleanup(func() {
		for _, view := range []*av.AttributeView{source, dest} {
			av.SetAVBoxID(view.ID, "")
		}
		forgetRuntimeEncryptedBox(boxID)
		encryptedBoxLifecycles.Delete(boxID)
		cachedDEKsLock.Lock()
		delete(cachedDEKs, boxID)
		cachedDEKsLock.Unlock()
	})
	for _, view := range []*av.AttributeView{source, dest} {
		av.SetAVBoxID(view.ID, boxID)
		if err := av.SaveAttributeView(view); err != nil {
			t.Fatal(err)
		}
		if err := os.Remove(av.GetAttributeViewDataPath(view.ID)); err != nil {
			t.Fatal(err)
		}
	}
	av.UpsertAvBackRel(dest.ID, source.ID)
	tree, err := LoadTreeByBlockID(fixture.sourceID)
	if err != nil {
		t.Fatal(err)
	}
	tree.Box = boxID
	historyDir := t.TempDir()
	if err = backupBoundAttributeViewHistory(tree, historyDir); err != nil {
		t.Fatal(err)
	}
	historyPath := boundAttributeViewHistoryPath(historyDir, boxID, dest.ID)
	data, err := os.ReadFile(historyPath)
	if err != nil || !util.IsCiphertext(data) {
		t.Fatalf("incoming relation history is not encrypted: %v", err)
	}
	deleted := map[string]map[string]struct{}{}
	collectDeletedAttributeViewBlocks(tree.Root, true, deleted)
	tx := &Transaction{}
	before, after, err := tx.prepareDeletedBoundAttributeViewBlocks(deleted, boxID)
	if err == nil {
		err = tx.saveAttributeViewFieldChanges(&attributeViewFieldsSnapshot{boxID: boxID}, before, after)
	}
	tx.finishAttributeViewMutation(err != nil)
	if err != nil {
		t.Fatal(err)
	}
	corrupted := append([]byte(nil), data...)
	corrupted[len(corrupted)-1] ^= 1
	if err = os.WriteFile(historyPath, corrupted, 0600); err != nil {
		t.Fatal(err)
	}
	tx = &Transaction{}
	err = tx.restoreBoundAttributeViewHistory(tree, historyDir)
	tx.finishAttributeViewMutation(err != nil)
	if err == nil {
		t.Fatal("corrupted incoming relation history was accepted")
	}
	current, err := av.ParseAttributeViewForIndexInBox(dest.ID, boxID)
	if err != nil || len(current.GetValue(keyID, itemID).Relation.BlockIDs) != 0 {
		t.Fatalf("failed authentication changed incoming relations: %v", err)
	}
	if err = os.WriteFile(historyPath, data, 0600); err != nil {
		t.Fatal(err)
	}
	tx = &Transaction{}
	err = tx.restoreBoundAttributeViewHistory(tree, historyDir)
	tx.finishAttributeViewMutation(err != nil)
	if err != nil {
		t.Fatal(err)
	}
	current, err = av.ParseAttributeViewForIndexInBox(dest.ID, boxID)
	if err != nil {
		t.Fatal(err)
	}
	assertAttributeViewFieldsTest(t, dest, current)
	for _, view := range []*av.AttributeView{source, dest} {
		stored, readErr := os.ReadFile(boundAttributeViewHistoryPath(util.DataDir, boxID, view.ID))
		if readErr != nil || !util.IsCiphertext(stored) {
			t.Fatal("recovery wrote a plaintext database")
		}
	}
}
