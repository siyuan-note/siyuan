//go:build fts5

package model

import (
	"errors"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/av"
)

func TestAttributeViewExternalDeletionClearsHistory(t *testing.T) {
	for _, mode := range []string{"block", "block without inverse", "item", "item transaction", "field"} {
		for _, redo := range []bool{false, true} {
			t.Run(mode+map[bool]string{false: "/undo", true: "/redo"}[redo], func(t *testing.T) {
				fixture, before, tx := setupAttributeViewDeletedBlockTest(t, "block")
				edit, kept := recordAttributeViewExternalHistoryTest(t, fixture.sourceID, before)
				if redo {
					entry := GlobalUndoLog.Undo(fixture.sourceID)
					replayAttributeViewFieldsTest(t, entry.UndoOperationsForReplay())
					GlobalUndoLog.UndoCommit(entry, fixture.sourceID)
				}
				var err error
				switch mode {
				case "block":
					tx.fromAPI = false
					err = PerformTxSync(tx)
				case "block without inverse":
					tx.UndoOperations = nil
					err = PerformTxSync(tx)
				case "item":
					err = RemoveAttributeViewBlock([]string{edit.RowID}, before.ID)
				case "item transaction":
					err = PerformTxSync(&Transaction{DoOperations: []*Operation{{Action: "removeAttrViewBlock",
						AvID: before.ID, BlockID: fixture.sourceID, SrcIDs: []string{edit.RowID}}}})
				case "field":
					err = RemoveAttributeViewKey(before.ID, edit.KeyID, false)
				}
				if err != nil {
					t.Fatal(err)
				}
				if GlobalUndoLog.Peek(fixture.sourceID) != kept {
					t.Fatal("external deletion did not clear stale history while preserving unrelated history")
				}
				if _, canRedo, _ := GlobalUndoLog.State(fixture.sourceID); canRedo {
					t.Fatal("external deletion left stale redo history")
				}
				replayAttributeViewFieldsTest(t, kept.UndoOperationsForReplay())
			})
		}
	}
}

func TestAttributeViewExternalDeletionFailurePreservesHistory(t *testing.T) {
	fixture, before, tx := setupAttributeViewDeletedBlockTest(t, "block")
	recordAttributeViewExternalHistoryTest(t, fixture.sourceID, before)
	entry := GlobalUndoLog.Peek(fixture.sourceID)
	before = readAttributeViewItemsTest(t, before.ID)
	if err := RemoveAttributeViewBlock([]string{ast.NewNodeID()}, before.ID); err != nil {
		t.Fatal(err)
	}
	if err := RemoveAttributeViewKey(before.ID, before.GetBlockKeyValues().Key.ID, false); err == nil {
		t.Fatal("primary field deletion succeeded")
	}
	tx.fromAPI = false
	injected := errors.New("injected external block deletion failure")
	tx.writeTransactionTree = func(*parse.Tree) error { return injected }
	if err := PerformTxSync(tx); err == nil {
		t.Fatal("failed block deletion succeeded")
	}
	if GlobalUndoLog.Peek(fixture.sourceID) != entry {
		t.Fatal("unsuccessful deletion discarded valid undo history")
	}
	assertAttributeViewFieldsTest(t, before, readAttributeViewItemsTest(t, before.ID))
	replayAttributeViewFieldsTest(t, entry.UndoOperationsForReplay())
}

func TestAttributeViewDeletionReplayPreservesHistory(t *testing.T) {
	fixture, before, tx := setupAttributeViewDeletedBlockTest(t, "block")
	recordAttributeViewExternalHistoryTest(t, fixture.sourceID, before)
	previous := GlobalUndoLog.Peek(fixture.sourceID)
	if err := PerformTxSync(tx); err != nil {
		t.Fatal(err)
	}
	entry := GlobalUndoLog.Undo(fixture.sourceID)
	replayAttributeViewFieldsTest(t, entry.UndoOperationsForReplay())
	GlobalUndoLog.UndoCommit(entry, fixture.sourceID)
	if GlobalUndoLog.Peek(fixture.sourceID) != previous {
		t.Fatal("undo discarded earlier editor history")
	}
	if GlobalUndoLog.Redo(fixture.sourceID) != entry {
		t.Fatal("undo discarded its redo entry")
	}
	replayAttributeViewFieldsTest(t, entry.DoOperationsForReplay())
	GlobalUndoLog.RedoCommit(entry, fixture.sourceID)
	if GlobalUndoLog.Peek(fixture.sourceID) != entry {
		t.Fatal("redo discarded its undo entry")
	}
}

func recordAttributeViewExternalHistoryTest(t *testing.T, rootID string, view *av.AttributeView) (*Operation, *UndoEntry) {
	t.Helper()
	if err := PerformTxSync(&Transaction{fromAPI: true,
		DoOperations:   []*Operation{{Action: "doUpdateUpdated", ID: rootID, Data: "20260101000000"}},
		UndoOperations: []*Operation{{Action: "doUpdateUpdated", ID: rootID, Data: "20250101000000"}},
	}); err != nil {
		t.Fatal(err)
	}
	kept := GlobalUndoLog.Peek(rootID)
	itemID := view.GetBlockKeyValues().Values[0].BlockID
	var keyID string
	for _, kv := range view.KeyValues {
		if kv.Key.Type == av.KeyTypeText {
			keyID = kv.Key.ID
			break
		}
	}
	edit := &Operation{Action: "updateAttrViewCell", AvID: view.ID, BlockID: rootID, KeyID: keyID, RowID: itemID,
		Data: map[string]any{"text": map[string]any{"content": "Edited before external deletion"}}}
	if err := PerformTxSync(&Transaction{fromAPI: true,
		DoOperations: []*Operation{edit, {Action: "doUpdateUpdated", ID: rootID, Data: "20260102000000"}},
		UndoOperations: []*Operation{{Action: edit.Action, AvID: view.ID, BlockID: rootID, KeyID: keyID, RowID: itemID,
			Data: map[string]any{"text": map[string]any{"content": view.GetValue(keyID, itemID).Text.Content}}}},
	}); err != nil {
		t.Fatal(err)
	}
	if entry := GlobalUndoLog.Peek(rootID); entry == nil || entry == kept {
		t.Fatal("cell edit did not enter the undo log")
	}
	return edit, kept
}
