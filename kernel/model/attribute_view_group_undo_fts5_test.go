//go:build fts5

package model

import (
	"bytes"
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
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAttributeViewGroupMoveUndoRedo(t *testing.T) {
	for _, layout := range []av.LayoutType{av.LayoutTypeTable, av.LayoutTypeGallery, av.LayoutTypeKanban} {
		for _, target := range []string{"B", "C", groupValueDefault} {
			t.Run(string(layout)+"/"+target, func(t *testing.T) {
				fixture, before, tx := setupAttributeViewGroupMoveTest(t, layout, target)
				if err := PerformTxSync(tx); err != nil {
					t.Fatal(err)
				}
				entry := GlobalUndoLog.Peek(fixture.sourceID)
				if entry == nil {
					t.Fatal("group move did not enter the undo log")
				}
				encoded, err := json.Marshal(tx)
				if err != nil || strings.Contains(string(encoded), "mSelect") {
					t.Fatalf("private group move snapshot leaked: %s, %v", encoded, err)
				}
				after := readAttributeViewItemsTest(t, before.ID)
				for cycle := 0; cycle < 3; cycle++ {
					replayAttributeViewFieldsTest(t, entry.UndoOperationsForReplay())
					assertAttributeViewFieldsTest(t, before, readAttributeViewItemsTest(t, before.ID))
					rendered := readAttributeViewItemsTest(t, before.ID)
					for _, view := range rendered.Views {
						sql.RenderView(rendered, view, "", false)
					}
					if err = av.SaveAttributeView(rendered); err != nil {
						t.Fatal(err)
					}
					replayAttributeViewFieldsTest(t, entry.DoOperationsForReplay())
					assertAttributeViewFieldsTest(t, after, readAttributeViewItemsTest(t, before.ID))
				}
			})
		}
	}
}

func TestAttributeViewGroupMoveFailure(t *testing.T) {
	for _, failure := range []string{"write", "conflict"} {
		t.Run(failure, func(t *testing.T) {
			_, before, tx := setupAttributeViewGroupMoveTest(t, av.LayoutTypeTable, "C")
			if failure == "write" {
				tx.writeTransactionTree = func(*parse.Tree) error { return errors.New("injected group move write failure") }
			} else {
				if err := PerformTxSync(tx); err != nil {
					t.Fatal(err)
				}
				before = readAttributeViewItemsTest(t, before.ID)
				view := before.GetView(tx.DoOperations[0].ViewID)
				before.GetValue(view.Group.Field, tx.DoOperations[1].ID).MSelect = optionUndoSelections("A", "B", "C")
				if err := av.SaveAttributeView(before); err != nil {
					t.Fatal(err)
				}
				tx = &Transaction{DoOperations: cloneOperations(tx.UndoOperations), isReplay: true}
			}
			if err := PerformTxSync(tx); err == nil {
				t.Fatal("group move accepted a failed write or conflicting value")
			}
			assertAttributeViewFieldsTest(t, before, readAttributeViewItemsTest(t, before.ID))
		})
	}
}

func TestAttributeViewGroupMoveBoundItem(t *testing.T) {
	fixture, before, tx := setupAttributeViewGroupMoveTest(t, av.LayoutTypeTable, "C")
	primary := before.GetBlockValue(tx.DoOperations[0].ID)
	primary.IsDetached, primary.Block.ID = false, fixture.targetID
	if err := av.SaveAttributeView(before); err != nil {
		t.Fatal(err)
	}
	if err := PerformTxSync(tx); err != nil {
		t.Fatal(err)
	}
	for cycle := 0; cycle < 2; cycle++ {
		current := readAttributeViewItemsTest(t, before.ID)
		for _, view := range current.Views {
			sql.RenderView(current, view, "", false)
		}
		if err := av.SaveAttributeView(current); err != nil {
			t.Fatal(err)
		}
		replayAttributeViewFieldsTest(t, cloneOperations(tx.UndoOperations))
		assertAttributeViewFieldsTest(t, before, readAttributeViewItemsTest(t, before.ID))
		replayAttributeViewFieldsTest(t, cloneOperations(tx.DoOperations))
	}
}

func TestAttributeViewGroupMoveEncrypted(t *testing.T) {
	_, before, tx := setupAttributeViewGroupMoveTest(t, av.LayoutTypeKanban, "C")
	boxID := ast.NewNodeID()
	markRuntimeEncryptedBox(boxID)
	setDEKForTest(boxID, bytes.Repeat([]byte{0x65}, 32))
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
	plainPath := filepath.Join(util.DataDir, "storage", "av", before.ID+".json")
	if err := os.Remove(plainPath); err != nil {
		t.Fatal(err)
	}
	for _, operations := range [][]*Operation{tx.DoOperations, tx.UndoOperations} {
		for _, op := range operations {
			op.BlockID = ""
		}
	}
	if err := PerformTxSync(tx); err != nil {
		t.Fatal(err)
	}
	replayAttributeViewFieldsTest(t, cloneOperations(tx.UndoOperations))
	restored, err := av.ParseAttributeViewForIndexInBox(before.ID, boxID)
	if err != nil {
		t.Fatal(err)
	}
	assertAttributeViewFieldsTest(t, before, restored)
	replayAttributeViewFieldsTest(t, cloneOperations(tx.DoOperations))
	if _, err = os.Stat(plainPath); !os.IsNotExist(err) {
		t.Fatalf("group move produced plaintext: %v", err)
	}
	cachedDEKsLock.Lock()
	delete(cachedDEKs, boxID)
	cachedDEKsLock.Unlock()
	if err = PerformTxSync(&Transaction{DoOperations: cloneOperations(tx.UndoOperations), isReplay: true}); err == nil {
		t.Fatal("group move replay accepted a locked notebook")
	}
}

func setupAttributeViewGroupMoveTest(t *testing.T, layout av.LayoutType, target string) (*fileOperationTestFixture, *av.AttributeView, *Transaction) {
	t.Helper()
	fixture, source, _, _ := setupAttributeViewOptionUndoTest(t, "delete", av.KeyTypeMSelect)
	var view *av.View
	for _, candidate := range source.Views {
		candidate.Filters = fieldFilterRoot()
		if candidate.LayoutType == layout && view == nil {
			view = candidate
		}
	}
	regenAttrViewGroups(source)
	if err := av.SaveAttributeView(source); err != nil {
		t.Fatal(err)
	}
	var from, to *av.View
	for _, group := range view.Groups {
		if group.GetGroupValue() == "A" {
			from = group
		}
		if group.GetGroupValue() == target {
			to = group
		}
	}
	if from == nil || to == nil {
		t.Fatalf("missing fixture groups: source %v, target %v", from, to)
	}
	tx := &Transaction{fromAPI: true}
	for _, id := range from.GroupItemIDs {
		op := &Operation{Action: "sortAttrViewRow", AvID: source.ID, BlockID: fixture.sourceID,
			ViewID: view.ID, ID: id, GroupID: from.ID, TargetGroupID: to.ID}
		inverse := &Operation{Action: op.Action, AvID: source.ID, BlockID: fixture.sourceID,
			ViewID: view.ID, ID: id, GroupID: to.ID, TargetGroupID: from.ID}
		tx.DoOperations = append(tx.DoOperations, op)
		tx.UndoOperations = append(tx.UndoOperations, inverse)
	}
	slices.Reverse(tx.UndoOperations)
	return fixture, readAttributeViewItemsTest(t, source.ID), tx
}
