// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5 && (sqlcipher || libsqlcipher)

package model

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAttributeViewColumnWidthTransactions(t *testing.T) {
	t.Run("plain", func(t *testing.T) {
		fixture, database, _, _ := setupAttributeViewItemsTest(t, false)
		testAttributeViewColumnWidthTransactions(t, fixture.sourceID, "", database)
	})
	t.Run("encrypted", func(t *testing.T) {
		fixture, database, _ := setupStoredAutomationEncryptedTest(t)
		testAttributeViewColumnWidthTransactions(t, fixture.sourceID, fixture.box.ID, database)
		data, err := os.ReadFile(filepath.Join(util.DataDir, fixture.box.ID, "storage", "av", database.ID+".json"))
		if err != nil || !util.IsCiphertext(data) {
			t.Fatalf("database lost encryption: %v", err)
		}
	})
}

func testAttributeViewColumnWidthTransactions(t *testing.T, rootID, boxID string, database *av.AttributeView) {
	t.Helper()
	keyID := database.GetBlockKeyValues().Key.ID
	second, third := av.NewTableView(), av.NewTableView()
	database.Views = append(database.Views, second, third)
	views := []string{database.Views[0].ID, second.ID, third.ID}
	for index, viewID := range views {
		view := database.GetView(viewID)
		view.Table.Columns = []*av.ViewTableColumn{{BaseField: &av.BaseField{ID: keyID}, Width: [3]string{"160px", "120px", ""}[index]}}
	}
	if err := av.SaveAttributeView(database); err != nil {
		t.Fatal(err)
	}
	GlobalUndoLog.Clear(rootID)
	t.Cleanup(func() { GlobalUndoLog.Clear(rootID) })
	assertWidths := func(want [3]string) {
		t.Helper()
		cache.ClearAVCache()
		current, err := av.ParseAttributeViewForIndexInBox(database.ID, boxID)
		if err != nil {
			t.Fatal(err)
		}
		for index, viewID := range views {
			if column := attributeViewTableColumn(current.GetView(viewID), keyID); column == nil || column.Width != want[index] {
				t.Fatalf("view %s: got %+v, want width %q", viewID, column, want[index])
			}
		}
	}
	perform := func(do, undo *Operation) {
		t.Helper()
		tx := &Transaction{DoOperations: []*Operation{do}}
		if undo != nil {
			tx.UndoOperations = []*Operation{undo}
		}
		tx.MarkFromAPI()
		if err := PerformTxSync(tx); err != nil {
			t.Fatal(err)
		}
	}
	replay := func(operations []*Operation) {
		t.Helper()
		if len(operations) != 1 {
			t.Fatalf("want a single replay operation, got %d", len(operations))
		}
		tx := &Transaction{DoOperations: operations}
		tx.MarkReplay()
		if err := PerformTxSync(tx); err != nil {
			t.Fatal(err)
		}
	}
	width := func(action string, data any) *Operation {
		return &Operation{Action: action, ID: keyID, AvID: database.ID, BlockID: rootID, ViewID: second.ID, Data: data}
	}
	perform(width("setAttrViewColWidth", "160px"), width("setAttrViewColWidth", "120px"))
	assertWidths([3]string{"160px", "160px", ""})
	drag := GlobalUndoLog.Undo(rootID)
	if drag == nil {
		t.Fatal("resize did not enter the document undo stack")
	}
	replay(drag.UndoOperationsForReplay())
	GlobalUndoLog.UndoCommit(drag, rootID)
	assertWidths([3]string{"160px", "120px", ""})

	perform(width("setAttrViewColsWidth", map[string]any{keyID: "110px"}),
		width("setAttrViewColsWidth", map[string]any{keyID: "120px"}))
	assertWidths([3]string{"160px", "110px", ""})
	syncOp := func() *Operation {
		return &Operation{Action: "syncAttrViewTableColWidth", ID: views[0], KeyID: keyID, AvID: database.ID, BlockID: rootID}
	}
	perform(syncOp(), nil)
	assertWidths([3]string{"160px", "160px", "160px"})
	synced := GlobalUndoLog.Peek(rootID)
	perform(syncOp(), nil)
	if synced == nil || GlobalUndoLog.Peek(rootID) != synced {
		t.Fatal("unchanged synchronization added an undo entry")
	}
	entry := GlobalUndoLog.Undo(rootID)
	replay(entry.UndoOperationsForReplay())
	GlobalUndoLog.UndoCommit(entry, rootID)
	assertWidths([3]string{"160px", "110px", ""})
	entry = GlobalUndoLog.Redo(rootID)
	replay(entry.DoOperationsForReplay())
	GlobalUndoLog.RedoCommit(entry, rootID)
	assertWidths([3]string{"160px", "160px", "160px"})
}
