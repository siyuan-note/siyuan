// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"fmt"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/cache"
)

func TestAttributeViewIconTransactionUndoLog(t *testing.T) {
	for _, legacy := range []bool{false, true} {
		t.Run(fmt.Sprint(legacy), func(t *testing.T) {
			fixture, database, _, _ := setupAttributeViewItemsTest(t, false)
			testAttributeViewIconTransactionUndoLog(t, fixture.sourceID, database, "", legacy)
		})
	}
}

func testAttributeViewIconTransactionUndoLog(t *testing.T, rootID string, database *av.AttributeView, boxID string, legacy bool) {
	t.Helper()
	base := database.Views[0].GetBaseLayout()
	base.ShowIcon, base.ShowRelationIcon = legacy, nil
	if err := av.SaveAttributeView(database); err != nil {
		t.Fatal(err)
	}
	GlobalUndoLog.Clear(rootID)
	type icons struct{ primary, relation bool }
	states := []icons{{legacy, legacy}, {!legacy, legacy}, {!legacy, !legacy}, {legacy, !legacy}, {!legacy, !legacy}}
	actions := []string{"setAttrViewShowIcon", "setAttrViewShowRelationIcon", "setAttrViewShowIcon", "setAttrViewShowIcon"}
	operation := func(action string, value bool) *Operation {
		return &Operation{Action: action, AvID: database.ID, BlockID: rootID, ViewID: database.Views[0].ID, Data: value}
	}
	check := func(want icons) {
		t.Helper()
		cache.ClearAVCache()
		stored, err := av.ParseAttributeViewForIndexInBox(database.ID, boxID)
		if err != nil {
			t.Fatal(err)
		}
		base := stored.Views[0].GetBaseLayout()
		if base.ShowIcon != want.primary || base.EffectiveShowRelationIcon() != want.relation {
			t.Fatalf("persisted icons: primary=%v relation=%v, want %+v", base.ShowIcon, base.EffectiveShowRelationIcon(), want)
		}
	}
	for i, action := range actions {
		before, after := states[i].primary, states[i+1].primary
		if action == "setAttrViewShowRelationIcon" {
			before, after = states[i].relation, states[i+1].relation
		}
		tx := &Transaction{DoOperations: []*Operation{operation(action, after)}, UndoOperations: []*Operation{operation(action, before)}}
		tx.MarkFromAPI()
		if err := PerformTxSync(tx); err != nil {
			t.Fatal(err)
		}
		check(states[i+1])
		entry := GlobalUndoLog.Peek(rootID)
		if entry == nil || len(entry.DoOperationsForReplay()) != 1 || entry.DoOperationsForReplay()[0].Action != action ||
			entry.DoOperationsForReplay()[0].Data != after {
			t.Fatalf("icon transaction %d (%s) did not enter the document undo log", i, action)
		}
		if roots := entry.MutatedRootIDs(); len(roots) != 1 || roots[0] != rootID {
			t.Fatalf("incorrect undo roots: %v", roots)
		}
	}
	for range 2 {
		for i := len(actions) - 1; i >= 0; i-- {
			entry := GlobalUndoLog.Undo(rootID)
			if entry == nil {
				t.Fatalf("missing undo entry %d", i)
			}
			tx := &Transaction{DoOperations: entry.UndoOperationsForReplay()}
			tx.MarkReplay()
			if err := PerformTxSync(tx); err != nil {
				GlobalUndoLog.UndoRollback(entry, rootID)
				t.Fatal(err)
			}
			GlobalUndoLog.UndoCommit(entry, rootID)
			check(states[i])
		}
		if GlobalUndoLog.Peek(rootID) != nil {
			t.Fatal("replay added an undo entry")
		}
		for i := range actions {
			entry := GlobalUndoLog.Redo(rootID)
			if entry == nil {
				t.Fatalf("missing redo entry %d", i)
			}
			tx := &Transaction{DoOperations: entry.DoOperationsForReplay()}
			tx.MarkReplay()
			if err := PerformTxSync(tx); err != nil {
				GlobalUndoLog.RedoRollback(entry, rootID)
				t.Fatal(err)
			}
			GlobalUndoLog.RedoCommit(entry, rootID)
			check(states[i+1])
		}
	}
}

func TestAttributeViewIconTransactionInvalidCarrier(t *testing.T) {
	for _, action := range []string{"setAttrViewShowIcon", "setAttrViewShowRelationIcon"} {
		t.Run(action, func(t *testing.T) {
			fixture, database, _, _ := setupAttributeViewItemsTest(t, false)
			invalidID := ast.NewNodeID()
			tx := &Transaction{DoOperations: []*Operation{{Action: action, AvID: database.ID, BlockID: invalidID, Data: false}},
				UndoOperations: []*Operation{{Action: action, AvID: database.ID, BlockID: invalidID, Data: true}}}
			tx.MarkFromAPI()
			if err := PerformTxSync(tx); err == nil {
				t.Fatal("missing carrier accepted")
			}
			cache.ClearAVCache()
			stored := readAttributeViewItemsTest(t, database.ID)
			if !stored.Views[0].GetBaseLayout().ShowIcon || !stored.Views[0].GetBaseLayout().EffectiveShowRelationIcon() {
				t.Fatal("failed transaction changed icons")
			}
			if GlobalUndoLog.Peek(fixture.sourceID) != nil || GlobalUndoLog.Peek(invalidID) != nil {
				t.Fatal("failed transaction entered undo log")
			}
		})
	}
}

func TestAttributeViewIconTransactionWithoutCarrier(t *testing.T) {
	for _, action := range []string{"setAttrViewShowIcon", "setAttrViewShowRelationIcon"} {
		t.Run(action, func(t *testing.T) {
			fixture, database, _, _ := setupAttributeViewItemsTest(t, false)
			tx := &Transaction{DoOperations: []*Operation{{Action: action, AvID: database.ID, Data: false}},
				UndoOperations: []*Operation{{Action: action, AvID: database.ID, Data: true}}}
			tx.MarkFromAPI()
			if err := PerformTxSync(tx); err != nil {
				t.Fatalf("omitted carrier rejected: %v", err)
			}
			cache.ClearAVCache()
			base := readAttributeViewItemsTest(t, database.ID).Views[0].GetBaseLayout()
			wantPrimary := action != "setAttrViewShowIcon"
			wantRelation := action != "setAttrViewShowRelationIcon"
			if base.ShowIcon != wantPrimary || base.EffectiveShowRelationIcon() != wantRelation {
				t.Fatal("carrier-free setting was not persisted independently")
			}
			if len(tx.GetMutatedRootIDs()) != 0 || GlobalUndoLog.Peek(fixture.sourceID) != nil {
				t.Fatal("carrier-free setting invented a document undo target")
			}
		})
	}
}
