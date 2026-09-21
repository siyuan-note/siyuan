//go:build fts5

// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"bytes"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAttributeViewCalendarDateUndoAndEncryptedReplay(t *testing.T) {
	for _, encrypted := range []bool{false, true} {
		name := "ordinary"
		if encrypted {
			name = "encrypted"
		}
		t.Run(name, func(t *testing.T) {
			_, original, _, _ := setupAttributeViewItemsTest(t, false)
			util.AttrViewLangs["en"]["calendar"] = "Calendar"
			if err := changeAttrViewLayout(original, original.Views[0], av.LayoutTypeCalendar); err != nil {
				t.Fatal(err)
			}
			boxID := ""
			plainPath := filepath.Join(util.DataDir, "storage", "av", original.ID+".json")
			if encrypted {
				boxID = ast.NewNodeID()
				markRuntimeEncryptedBox(boxID)
				setDEKForTest(boxID, bytes.Repeat([]byte{0x63}, 32))
				av.SetAVBoxID(original.ID, boxID)
				t.Cleanup(func() {
					av.SetAVBoxID(original.ID, "")
					forgetRuntimeEncryptedBox(boxID)
					encryptedBoxLifecycles.Delete(boxID)
					cachedDEKsLock.Lock()
					delete(cachedDEKs, boxID)
					cachedDEKsLock.Unlock()
				})
			}
			if err := av.SaveAttributeView(original); err != nil {
				t.Fatal(err)
			}
			if encrypted {
				if err := os.Remove(plainPath); err != nil {
					t.Fatal(err)
				}
			}
			settings := original.Views[0].Calendar.Settings
			nextSettings := settings
			nextSettings.RowLimit = 5
			setRows := func(value av.CalendarSettings) *Operation {
				return &Operation{Action: "setAttrViewCalendar", AvID: original.ID, ViewID: original.Views[0].ID, Data: value}
			}
			key, _ := original.GetKeyValues(settings.DateKeyID)
			value := key.Values[0]
			before := *value.Date
			after := before
			after.Content += 2 * 86400000
			after.Content2 += 2 * 86400000
			operation := func(date av.ValueDate) *Operation {
				return &Operation{Action: "updateAttrViewCell", AvID: original.ID, KeyID: key.Key.ID,
					RowID: value.BlockID, ID: value.ID, Data: map[string]any{"type": "date", "date": date}}
			}
			tx := &Transaction{DoOperations: []*Operation{operation(after), setRows(nextSettings)},
				UndoOperations: []*Operation{operation(before), setRows(settings)}, fromAPI: true}
			if err := PerformTxSync(tx); err != nil {
				t.Fatal(err)
			}
			for _, replay := range []struct {
				operations []*Operation
				expected   av.ValueDate
				settings   av.CalendarSettings
			}{{tx.DoOperations, after, nextSettings}, {tx.UndoOperations, before, settings}, {tx.DoOperations, after, nextSettings}} {
				if err := PerformTxSync(&Transaction{DoOperations: cloneOperations(replay.operations), isReplay: true}); err != nil {
					t.Fatal(err)
				}
				cache.ClearAVCache()
				stored, err := av.ParseAttributeViewForIndexInBox(original.ID, boxID)
				if err != nil {
					t.Fatal(err)
				}
				storedKey, _ := stored.GetKeyValues(key.Key.ID)
				actual := *storedKey.Values[0].Date
				actual.FormattedContent = ""
				if !reflect.DeepEqual(actual, replay.expected) || stored.Views[0].Calendar.Settings != replay.settings {
					t.Fatalf("date replay: actual=%+v expected=%+v settings=%+v", actual, replay.expected, stored.Views[0].Calendar.Settings)
				}
			}
			if encrypted {
				path := filepath.Join(util.DataDir, boxID, "storage", "av", original.ID+".json")
				ciphertext, err := os.ReadFile(path)
				if err != nil || !util.IsCiphertext(ciphertext) {
					t.Fatal("calendar did not retain encrypted storage")
				}
				if _, err = os.Stat(plainPath); !os.IsNotExist(err) {
					t.Fatal("calendar produced a plaintext copy")
				}
				ciphertext[len(ciphertext)-1] ^= 1
				if err = os.WriteFile(path, ciphertext, 0600); err != nil {
					t.Fatal(err)
				}
				cache.ClearAVCache()
				if err = PerformTxSync(&Transaction{DoOperations: cloneOperations(tx.UndoOperations), isReplay: true}); err == nil {
					t.Fatal("calendar replay accepted unauthenticated data")
				}
				preserved, err := os.ReadFile(path)
				if err != nil || !bytes.Equal(ciphertext, preserved) {
					t.Fatal("failed calendar replay modified ciphertext")
				}
			}
		})
	}
}

func TestAttributeViewCalendarCreateItemUndo(t *testing.T) {
	fixture := setupTemplateDocTreeTransactionTest(t)
	database := addTemplateAttributeViewTestFixture(t, fixture, ast.NewNodeID())
	blockID := database.nodes[0].ID
	view := database.attrView.Views[0]
	util.AttrViewLangs["en"]["calendar"] = "Calendar"
	if err := changeAttrViewLayout(database.attrView, view, av.LayoutTypeCalendar); err != nil {
		t.Fatal(err)
	}
	dateKey := av.NewKey(ast.NewNodeID(), "Date", "", av.KeyTypeDate)
	addAttributeViewKey(database.attrView, view, dateKey, "")
	view.Calendar.Settings.DateKeyID = dateKey.ID
	if err := av.SaveAttributeView(database.attrView); err != nil {
		t.Fatal(err)
	}
	date := int64(1788220800000)
	created, err := CreateAttributeViewItem(database.attrView.ID, blockID, view.ID, "", "", "", &date)
	if err != nil {
		t.Fatal(err)
	}
	stored, err := av.ParseAttributeView(database.attrView.ID)
	if err != nil {
		t.Fatal(err)
	}
	value := stored.GetValue(dateKey.ID, created.ItemID)
	if value == nil || value.Date.Content != date || !value.Date.IsNotTime {
		t.Fatal("calendar date missing from newly created item")
	}
	if err = PerformTxSync(&Transaction{DoOperations: cloneOperations(created.Transaction.UndoOperations), isReplay: true}); err != nil {
		t.Fatal(err)
	}
	stored, err = av.ParseAttributeView(database.attrView.ID)
	if err != nil || stored.GetBlockValue(created.ItemID) != nil || stored.GetValue(dateKey.ID, created.ItemID) != nil {
		t.Fatal("undo must remove both the item and its calendar date")
	}
	if err = PerformTxSync(&Transaction{DoOperations: cloneOperations(created.Transaction.DoOperations), isReplay: true}); err != nil {
		t.Fatal(err)
	}
	stored, err = av.ParseAttributeView(database.attrView.ID)
	if err != nil || stored.GetValue(dateKey.ID, created.ItemID) == nil || stored.GetValue(dateKey.ID, created.ItemID).Date.Content != date {
		t.Fatal("redo must restore the calendar date")
	}
}

func TestAttributeViewCalendarSetupUndo(t *testing.T) {
	_, database, _, _ := setupAttributeViewItemsTest(t, false)
	util.AttrViewLangs["en"]["calendar"] = "Calendar"
	view := database.Views[0]
	if err := changeAttrViewLayout(database, view, av.LayoutTypeCalendar); err != nil {
		t.Fatal(err)
	}
	if err := av.SaveAttributeView(database); err != nil {
		t.Fatal(err)
	}
	previous := view.Calendar.Settings
	keyID := ast.NewNodeID()
	next := previous
	next.DateKeyID = keyID
	next.WeekStart = 0
	next.RowLimit = 10
	setting := func(value av.CalendarSettings) *Operation {
		return &Operation{Action: "setAttrViewCalendar", AvID: database.ID, ViewID: view.ID, Data: value}
	}
	tx := &Transaction{fromAPI: true, DoOperations: []*Operation{
		{Action: "addAttrViewCol", AvID: database.ID, ViewID: view.ID, ID: keyID, Typ: "date", Name: "Date"}, setting(next),
	}, UndoOperations: []*Operation{setting(previous), {Action: "removeAttrViewCol", AvID: database.ID, ID: keyID}}}
	if err := PerformTxSync(tx); err != nil {
		t.Fatal(err)
	}
	for _, step := range []struct {
		operations []*Operation
		settings   av.CalendarSettings
		present    bool
	}{{nil, next, true}, {tx.UndoOperations, previous, false}, {tx.DoOperations, next, true}} {
		if step.operations != nil {
			if err := PerformTxSync(&Transaction{DoOperations: cloneOperations(step.operations), isReplay: true}); err != nil {
				t.Fatal(err)
			}
		}
		stored, err := av.ParseAttributeView(database.ID)
		if err != nil {
			t.Fatal(err)
		}
		field, _ := stored.GetKeyValues(keyID)
		if stored.Views[0].Calendar.Settings != step.settings || (field != nil) != step.present {
			t.Fatal("calendar setup undo lost field or binding")
		}
		if field != nil && len(field.Values) != 0 {
			t.Fatal("calendar setup must not fill ordinary dates for existing entries")
		}
	}
}
