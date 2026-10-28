// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"fmt"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/treenode"
)

func TestTransactionHistoryDrainsQueuedEditsBeforeSelection(t *testing.T) {
	fixture := setupStructureTransactionTest(t)
	setupFoldTransactionDatabase(t, fixture)
	previousLog := GlobalUndoLog
	GlobalUndoLog = newUndoLog(64)
	t.Cleanup(func() { GlobalUndoLog = previousLog })
	dom := func(text string) string {
		return fmt.Sprintf(`<div data-node-id="%s" data-type="NodeParagraph"><div contenteditable="true">%s</div></div>`, fixture.childID, text)
	}
	first := &Transaction{fromAPI: true, DoOperations: []*Operation{{Action: "update", ID: fixture.childID, Data: dom("First")}},
		UndoOperations: []*Operation{{Action: "update", ID: fixture.childID, Data: dom("")}}}
	if err := PerformTxSync(first); err != nil {
		t.Fatal(err)
	}
	second := &Transaction{fromAPI: true, DoOperations: []*Operation{{Action: "update", ID: fixture.childID, Data: dom("Second")}},
		UndoOperations: []*Operation{{Action: "update", ID: fixture.childID, Data: dom("First")}}}
	flushLock.Lock()
	queued := []*Transaction{second}
	PerformTransactions(&queued)
	flushLock.Unlock()
	WithTransactionHistory(func(execute func(*Transaction) error) bool {
		entry := GlobalUndoLog.Undo(fixture.sourceID)
		if entry == nil || entry.UndoOperationsForReplay()[0].Data != dom("First") {
			t.Fatal("history selected an entry before the queued edit")
		}
		tx := &Transaction{isReplay: true, DoOperations: entry.UndoOperationsForReplay()}
		if err := execute(tx); err != nil {
			t.Fatal(err)
		}
		GlobalUndoLog.UndoCommit(entry, fixture.sourceID)
		return true
	})
	tree, err := LoadTreeByBlockID(fixture.childID)
	if err != nil || treenode.GetNodeInTree(tree, fixture.childID).Text() != "First" {
		t.Fatalf("undo did not restore the state before the latest queued edit: %v", err)
	}
	WithTransactionHistory(func(execute func(*Transaction) error) bool {
		entry := GlobalUndoLog.Redo(fixture.sourceID)
		if entry == nil {
			t.Fatal("queued edit lost its redo entry")
		}
		if err := execute(&Transaction{isReplay: true, DoOperations: entry.DoOperationsForReplay()}); err != nil {
			t.Fatal(err)
		}
		GlobalUndoLog.RedoCommit(entry, fixture.sourceID)
		return true
	})
	tree, err = LoadTreeByBlockID(fixture.childID)
	if err != nil || treenode.GetNodeInTree(tree, fixture.childID).Text() != "Second" {
		t.Fatalf("redo did not restore the queued edit: %v", err)
	}
}
