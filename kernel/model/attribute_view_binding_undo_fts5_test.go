//go:build fts5

package model

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAttributeViewBindingUndoRedo(t *testing.T) {
	for _, bound := range []bool{false, true} {
		t.Run(map[bool]string{false: "detached", true: "bound"}[bound], func(t *testing.T) {
			fixture, before, tx := setupAttributeViewBindingUndoTest(t, bound)
			if err := PerformTxSync(tx); err != nil {
				t.Fatal(err)
			}
			entry := GlobalUndoLog.Peek(fixture.sourceID)
			if entry == nil {
				t.Fatal("binding did not enter the database document undo log")
			}
			itemID := tx.DoOperations[0].PreviousID
			data, err := json.Marshal(tx)
			if err != nil || strings.Contains(string(data), "Original primary") {
				t.Fatalf("private primary snapshot leaked into response: %s, %v", data, err)
			}
			after := readAttributeViewItemsTest(t, before.ID)
			if after.GetBlockValue(itemID).Block.ID != fixture.sourceID {
				t.Fatal("replacement did not bind the new block")
			}
			for cycle := 0; cycle < 3; cycle++ {
				assertAttributeViewBindingBacklink(t, fixture.targetID, before.ID, false)
				assertAttributeViewBindingBacklink(t, fixture.sourceID, before.ID, true)
				if err = PerformTxSync(&Transaction{DoOperations: entry.UndoOperationsForReplay(), isReplay: true}); err != nil {
					t.Fatal(err)
				}
				assertAttributeViewItemsEqual(t, before, readAttributeViewItemsTest(t, before.ID))
				assertAttributeViewBindingBacklink(t, fixture.targetID, before.ID, bound)
				assertAttributeViewBindingBacklink(t, fixture.sourceID, before.ID, false)
				if err = PerformTxSync(&Transaction{DoOperations: entry.DoOperationsForReplay(), isReplay: true}); err != nil {
					t.Fatal(err)
				}
				assertAttributeViewItemsEqual(t, after, readAttributeViewItemsTest(t, before.ID))
			}
		})
	}
}

func TestAttributeViewBindingUndoPreservesOtherEdits(t *testing.T) {
	fixture, before, tx := setupAttributeViewBindingUndoTest(t, true)
	if err := PerformTxSync(tx); err != nil {
		t.Fatal(err)
	}
	current := readAttributeViewItemsTest(t, before.ID)
	for _, view := range []*av.AttributeView{before, current} {
		view.Name = "New database name"
		view.KeyValues[2].Values[1].Text.Content = "Later field edit"
		view.GetBlockValue(tx.DoOperations[0].PreviousID).Block.Updated = 789
	}
	if err := av.SaveAttributeView(current); err != nil {
		t.Fatal(err)
	}
	if err := PerformTxSync(&Transaction{DoOperations: GlobalUndoLog.Peek(fixture.sourceID).UndoOperationsForReplay(), isReplay: true}); err != nil {
		t.Fatal(err)
	}
	assertAttributeViewItemsEqual(t, before, readAttributeViewItemsTest(t, before.ID))
}

func TestAttributeViewBindingCreatedDocumentReplay(t *testing.T) {
	fixture, before, tx := setupAttributeViewBindingUndoTest(t, false)
	docID := ast.NewNodeID()
	tree := treenode.NewTree(fixture.box.ID, "/"+docID+".sy", "/Created", "Created")
	if _, err := filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	treenode.UpsertBlockTree(tree)
	op := tx.DoOperations[0]
	op.NextID = docID
	tx.DoOperations = append([]*Operation{{Action: "restoreCreatedDoc", ID: docID, Tree: tree}}, tx.DoOperations...)
	tx.UndoOperations = append(tx.UndoOperations, &Operation{Action: "removeCreatedDoc", ID: docID, Tree: tree})
	if err := PerformTxSync(tx); err != nil {
		t.Fatal(err)
	}
	entry := GlobalUndoLog.Peek(fixture.sourceID)
	for cycle := 0; cycle < 2; cycle++ {
		if err := PerformTxSync(&Transaction{DoOperations: entry.UndoOperationsForReplay(), isReplay: true}); err != nil {
			t.Fatal(err)
		}
		assertAttributeViewItemsEqual(t, before, readAttributeViewItemsTest(t, before.ID))
		if _, err := os.Stat(filepath.Join(util.DataDir, fixture.box.ID, tree.Path)); !os.IsNotExist(err) {
			t.Fatalf("undo did not remove the created document: %v", err)
		}
		if err := PerformTxSync(&Transaction{DoOperations: entry.DoOperationsForReplay(), isReplay: true}); err != nil {
			t.Fatal(err)
		}
		current := readAttributeViewItemsTest(t, before.ID)
		if current.GetBlockValue(op.PreviousID).Block.ID != docID {
			t.Fatal("redo did not restore the created document binding")
		}
		assertAttributeViewBindingBacklink(t, docID, before.ID, true)
	}
}

func TestAttributeViewBindingDuplicateUndo(t *testing.T) {
	fixture, before, tx := setupAttributeViewBindingUndoTest(t, true)
	other := before.GetBlockKeyValues().Values[0]
	other.IsDetached, other.Block.ID = false, fixture.sourceID
	if err := av.SaveAttributeView(before); err != nil {
		t.Fatal(err)
	}
	if err := PerformTxSync(tx); err != nil {
		t.Fatal(err)
	}
	result := tx.DoOperations[0].RetData.(map[string]any)
	if result["duplicate"] != true || result["targetItemID"] != other.BlockID {
		t.Fatalf("duplicate binding did not locate the existing item: %v", result)
	}
	entry := GlobalUndoLog.Peek(fixture.sourceID)
	for _, operations := range [][]*Operation{entry.UndoOperationsForReplay(), entry.DoOperationsForReplay()} {
		if err := PerformTxSync(&Transaction{DoOperations: operations, isReplay: true}); err != nil {
			t.Fatal(err)
		}
		assertAttributeViewItemsEqual(t, before, readAttributeViewItemsTest(t, before.ID))
		assertAttributeViewBindingBacklink(t, fixture.targetID, before.ID, true)
	}
}

func TestAttributeViewBindingReplayConflict(t *testing.T) {
	for _, conflict := range []string{"duplicate", "changed", "missing"} {
		t.Run(conflict, func(t *testing.T) {
			fixture, before, tx := setupAttributeViewBindingUndoTest(t, true)
			if err := PerformTxSync(tx); err != nil {
				t.Fatal(err)
			}
			current := readAttributeViewItemsTest(t, before.ID)
			switch conflict {
			case "duplicate":
				other := current.GetBlockKeyValues().Values[0]
				other.IsDetached, other.Block.ID = false, fixture.targetID
			case "changed":
				value := current.GetBlockValue(tx.DoOperations[0].PreviousID)
				value.IsDetached, value.Block.ID = true, ""
			case "missing":
				treenode.RemoveBlockTree(fixture.box.ID, fixture.targetID)
			}
			if err := av.SaveAttributeView(current); err != nil {
				t.Fatal(err)
			}
			if err := PerformTxSync(&Transaction{DoOperations: GlobalUndoLog.Peek(fixture.sourceID).UndoOperationsForReplay(), isReplay: true}); err == nil {
				t.Fatal("conflicting binding replay succeeded")
			}
			assertAttributeViewItemsEqual(t, current, readAttributeViewItemsTest(t, before.ID))
			assertAttributeViewBindingBacklink(t, fixture.sourceID, before.ID, true)
		})
	}
}

func TestAttributeViewBindingWriteFailure(t *testing.T) {
	for _, undo := range []bool{false, true} {
		t.Run(map[bool]string{false: "replace", true: "undo"}[undo], func(t *testing.T) {
			fixture, before, tx := setupAttributeViewBindingUndoTest(t, true)
			if undo {
				if err := PerformTxSync(tx); err != nil {
					t.Fatal(err)
				}
				tx = &Transaction{DoOperations: GlobalUndoLog.Peek(fixture.sourceID).UndoOperationsForReplay(), isReplay: true}
			}
			before = readAttributeViewItemsTest(t, before.ID)
			writes := 0
			tx.writeTransactionTree = func(tree *parse.Tree) error {
				writes++
				if writes == 2 {
					return errors.New("injected binding write failure")
				}
				_, err := filesys.WriteTree(tree)
				return err
			}
			if err := PerformTxSync(tx); err == nil || !strings.Contains(err.Error(), "injected binding write failure") {
				t.Fatalf("unexpected write result: %v", err)
			}
			assertAttributeViewItemsEqual(t, before, readAttributeViewItemsTest(t, before.ID))
			assertAttributeViewBindingBacklink(t, fixture.targetID, before.ID, !undo)
			assertAttributeViewBindingBacklink(t, fixture.sourceID, before.ID, undo)
		})
	}
}

func setupAttributeViewBindingUndoTest(t *testing.T, bound bool) (*fileOperationTestFixture, *av.AttributeView, *Transaction) {
	t.Helper()
	fixture, view, deletion, _ := setupAttributeViewItemsTest(t, bound)
	value := view.GetBlockValue(deletion.SrcIDs[0])
	value.Block.Content, value.Block.Icon = "Original primary", "1f600"
	if bound {
		tree, err := LoadTreeByBlockID(fixture.targetID)
		if err != nil {
			t.Fatal(err)
		}
		tree.Root.SetIALAttr(av.NodeAttrViewStaticText+"-"+view.ID, value.Block.Content)
		tree.Root.SetIALAttr("icon", value.Block.Icon)
		if _, err = filesys.WriteTree(tree); err != nil {
			t.Fatal(err)
		}
		treenode.UpsertBlockTree(tree)
		value.Block.RefSubtype = av.BlockRefSubtypeStatic
	}
	if err := av.SaveAttributeView(view); err != nil {
		t.Fatal(err)
	}
	op := &Operation{Action: "replaceAttrViewBlock", AvID: view.ID, BlockID: fixture.sourceID,
		PreviousID: value.BlockID, NextID: fixture.sourceID}
	// 前端可能只发送取消绑定，内核必须以执行前的真实状态恢复原绑定和主键文本。
	inverse := &Operation{Action: "replaceAttrViewBlock", AvID: view.ID, BlockID: fixture.sourceID,
		PreviousID: value.BlockID, IsDetached: true}
	return fixture, readAttributeViewItemsTest(t, view.ID), &Transaction{
		DoOperations: []*Operation{op}, UndoOperations: []*Operation{inverse}, fromAPI: true}
}

func assertAttributeViewBindingBacklink(t *testing.T, blockID, avID string, bound bool) {
	t.Helper()
	tree, err := LoadTreeByBlockID(blockID)
	if err != nil {
		t.Fatal(err)
	}
	node := treenode.GetNodeInTree(tree, blockID)
	if slices.Contains(strings.Split(node.IALAttr(av.NodeAttrNameAvs), ","), avID) != bound {
		t.Fatalf("block [%s] has incorrect database bindings: %s", blockID, node.IALAttr(av.NodeAttrNameAvs))
	}
	if !bound && node.IALAttr(av.NodeAttrNameAvs) == "" && node.IALAttr(av.NodeAttrViewNames) != "" {
		t.Fatal("unbound block retained database names")
	}
}
