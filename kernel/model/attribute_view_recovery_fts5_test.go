//go:build fts5

package model

import (
	"bytes"
	"os"
	"path/filepath"
	"slices"
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
	for _, cleanup := range []bool{false, true} {
		t.Run(map[bool]string{false: "bound rows", true: "cleaned embedded database"}[cleanup], func(t *testing.T) {
			fixture, before, _ := setupAttributeViewDeletedBlockTest(t, "container")
			dest, _, targetID := addDeletedBlockTestRelation(t, before, false)
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
