// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"bytes"
	"os"
	"path/filepath"
	"slices"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestRollbackAttributeViewHistoryState(t *testing.T) {
	for _, encrypted := range []bool{false, true} {
		for _, invalid := range []bool{false, true} {
			name := map[bool]string{false: "plain", true: "encrypted"}[encrypted] + map[bool]string{false: "/success", true: "/invalid"}[invalid]
			t.Run(name, func(t *testing.T) {
				fixture, historical, _, _ := setupAttributeViewItemsTest(t, false)
				originalWorkspace := util.WorkspaceDir
				util.WorkspaceDir = filepath.Dir(util.HistoryDir)
				t.Cleanup(func() { util.WorkspaceDir = originalWorkspace })
				boxID := ""
				if encrypted {
					boxID = ast.NewNodeID()
					prepareUnlockedEncryptedBoxTest(t, boxID, bytes.Repeat([]byte{0x74}, 32))
				}
				oldTarget, newTarget := av.NewAttributeView(ast.NewNodeID()), av.NewAttributeView(ast.NewNodeID())
				for _, view := range []*av.AttributeView{historical, oldTarget, newTarget} {
					av.SetAVBoxID(view.ID, boxID)
					t.Cleanup(func() { av.SetAVBoxID(view.ID, "") })
					if err := av.SaveAttributeView(view); err != nil {
						t.Fatal(err)
					}
				}
				key := av.NewKey(ast.NewNodeID(), "Related", "", av.KeyTypeRelation)
				key.Relation = &av.Relation{AvID: oldTarget.ID}
				historical.KeyValues = append(historical.KeyValues, &av.KeyValues{Key: key})
				if err := av.SaveAttributeView(historical); err != nil {
					t.Fatal(err)
				}
				livePath := boundAttributeViewHistoryPath(util.DataDir, boxID, historical.ID)
				snapshot, err := os.ReadFile(livePath)
				if err != nil {
					t.Fatal(err)
				}
				current, err := cloneAttributeViewForFieldMutation(historical)
				if err != nil {
					t.Fatal(err)
				}
				current.Name = "Current database"
				current.KeyValues[len(current.KeyValues)-1].Key.Relation.AvID = newTarget.ID
				if err = av.SaveAttributeView(current); err != nil {
					t.Fatal(err)
				}
				av.UpsertAvBackRel(current.ID, newTarget.ID)
				original, err := os.ReadFile(livePath)
				if err != nil {
					t.Fatal(err)
				}
				if invalid {
					if encrypted {
						snapshot[len(snapshot)-1] ^= 1
					} else {
						snapshot = []byte("invalid history")
					}
				}
				historyPath := boundAttributeViewHistoryPath(filepath.Join(util.HistoryDir, "2026-10-26-120000-update"), boxID, current.ID)
				if err = os.MkdirAll(filepath.Dir(historyPath), 0755); err != nil {
					t.Fatal(err)
				}
				if err = os.WriteFile(historyPath, snapshot, 0600); err != nil {
					t.Fatal(err)
				}
				affected := &UndoEntry{undoOperations: []*Operation{{Action: "setAttrViewName", AvID: current.ID}}}
				kept := &UndoEntry{doOperations: []*Operation{{Action: "setAttrViewName", AvID: newTarget.ID}}}
				for _, rootID := range []string{fixture.sourceID, fixture.targetID} {
					GlobalUndoLog.stacks[rootID] = &undoStack{undoStack: []*UndoEntry{kept, affected}, redoStack: []*UndoEntry{affected, kept}}
				}
				relative, err := filepath.Rel(util.WorkspaceDir, historyPath)
				if err != nil {
					t.Fatal(err)
				}
				err = RollbackAttributeViewHistory(relative)
				if (err != nil) != invalid {
					t.Fatalf("unexpected restore result: %v", err)
				}
				for _, stack := range GlobalUndoLog.stacks {
					if invalid {
						if !slices.Contains(stack.undoStack, affected) || !slices.Contains(stack.redoStack, affected) {
							t.Fatal("failed recovery discarded valid history")
						}
					} else if !slices.Equal(stack.undoStack, []*UndoEntry{kept}) || !slices.Equal(stack.redoStack, []*UndoEntry{kept}) {
						t.Fatal("restoration left stale history or removed unrelated history")
					}
				}
				if invalid {
					if data, err := os.ReadFile(livePath); err != nil || !bytes.Equal(data, original) {
						t.Fatal("invalid history changed current data")
					}
				} else {
					cache.ClearAVCache()
					restored, err := av.ParseAttributeViewForIndexInBox(current.ID, boxID)
					if err != nil {
						t.Fatal(err)
					}
					assertAttributeViewFieldsTest(t, historical, restored)
				}
				if slices.Contains(av.GetSrcAvIDs(oldTarget.ID), current.ID) != !invalid || slices.Contains(av.GetSrcAvIDs(newTarget.ID), current.ID) != invalid {
					t.Fatal("relation dependencies do not match restored state")
				}
				if data, err := os.ReadFile(historyPath); err != nil || !bytes.Equal(data, snapshot) {
					t.Fatal("restoration changed source history")
				}
				if encrypted {
					if data, err := os.ReadFile(livePath); err != nil || !util.IsCiphertext(data) {
						t.Fatal("restoration exposed encrypted database contents")
					}
				}
			})
		}
	}
}
