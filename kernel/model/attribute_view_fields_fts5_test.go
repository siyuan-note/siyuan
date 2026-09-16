//go:build fts5

package model

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAttributeViewFieldsUndoRedo(t *testing.T) {
	for _, typ := range []av.KeyType{av.KeyTypeText, av.KeyTypeNumber, av.KeyTypeDate, av.KeyTypeSelect,
		av.KeyTypeMSelect, av.KeyTypeMAsset, av.KeyTypeCheckbox, av.KeyTypeURL, av.KeyTypeEmail, av.KeyTypePhone} {
		t.Run(string(typ), func(t *testing.T) {
			fixture, before, tx := setupAttributeViewFieldsTest(t, typ)
			if err := PerformTxSync(tx); err != nil {
				t.Fatal(err)
			}
			op := tx.DoOperations[0]
			entry := GlobalUndoLog.Peek(fixture.sourceID)
			if entry == nil {
				t.Fatal("field deletion did not enter the undo log")
			}
			data, err := json.Marshal(tx)
			if err != nil || strings.Contains(string(data), "private field contents") {
				t.Fatalf("private snapshot leaked into transaction response: %s, %v", data, err)
			}
			deleted := readAttributeViewItemsTest(t, before.ID)
			if _, err = deleted.GetKey(op.ID); err == nil || slices.Contains(deleted.KeyIDs, op.ID) {
				t.Fatal("deleted field definition survived")
			}
			for _, view := range deleted.Views {
				if attrViewFiltersContainColumn(view.Filters, op.ID) ||
					view.Group != nil && (view.LayoutType != av.LayoutTypeKanban || view.Group.Field == op.ID) {
					t.Fatal("deleted field left a filter or group behind")
				}
			}
			for cycle := 0; cycle < 3; cycle++ {
				replayAttributeViewFieldsTest(t, entry.UndoOperationsForReplay())
				assertAttributeViewFieldsTest(t, before, readAttributeViewItemsTest(t, before.ID))
				replayAttributeViewFieldsTest(t, entry.DoOperationsForReplay())
				assertAttributeViewFieldsTest(t, deleted, readAttributeViewItemsTest(t, before.ID))
			}
		})
	}
}

func TestAttributeViewFieldsEmptyLayout(t *testing.T) {
	fixture, before, tx := setupAttributeViewFieldsTest(t, av.KeyTypeText)
	for _, layout := range before.Views {
		if layout.Gallery != nil {
			layout.Gallery.CardFields = layout.Gallery.CardFields[1:]
		}
		if layout.Kanban != nil {
			layout.Kanban.Fields = layout.Kanban.Fields[1:]
		}
	}
	if err := av.SaveAttributeView(before); err != nil {
		t.Fatal(err)
	}
	if err := PerformTxSync(tx); err != nil {
		t.Fatal(err)
	}
	entry := GlobalUndoLog.Peek(fixture.sourceID)
	for cycle := 0; cycle < 2; cycle++ {
		replayAttributeViewFieldsTest(t, entry.UndoOperationsForReplay())
		assertAttributeViewFieldsTest(t, before, readAttributeViewItemsTest(t, before.ID))
		replayAttributeViewFieldsTest(t, entry.DoOperationsForReplay())
	}
}

func TestAttributeViewFieldsUndoAfterKanbanRender(t *testing.T) {
	fixture, source, _ := setupAttributeViewGroupMoveTest(t, av.LayoutTypeKanban, "C")
	var layout *av.View
	for _, view := range source.Views {
		if view.LayoutType == av.LayoutTypeKanban {
			layout = view
			break
		}
	}
	if _, err := renderAttributeView(source, fixture.sourceID, layout.ID, "", "", 1, 50, nil, false, true, nil, ""); err != nil {
		t.Fatal(err)
	}
	before := readAttributeViewItemsTest(t, source.ID)
	keyID := layout.Group.Field
	tx := &Transaction{fromAPI: true,
		DoOperations:   []*Operation{{Action: "removeAttrViewCol", AvID: source.ID, ID: keyID, BlockID: fixture.sourceID}},
		UndoOperations: []*Operation{{Action: "addAttrViewCol", AvID: source.ID, ID: keyID, BlockID: fixture.sourceID}}}
	if err := PerformTxSync(tx); err != nil {
		t.Fatal(err)
	}
	entry := GlobalUndoLog.Peek(fixture.sourceID)
	for cycle := 0; cycle < 2; cycle++ {
		current := readAttributeViewItemsTest(t, source.ID)
		if _, err := renderAttributeView(current, fixture.sourceID, layout.ID, "", "", 1, 50, nil, false, true, nil, ""); err != nil {
			t.Fatal(err)
		}
		replayAttributeViewFieldsTest(t, entry.UndoOperationsForReplay())
		assertAttributeViewFieldsTest(t, before, readAttributeViewItemsTest(t, source.ID))
		replayAttributeViewFieldsTest(t, entry.DoOperationsForReplay())
	}
}

func TestAttributeViewFieldsPreserveUnrelatedEdits(t *testing.T) {
	fixture, before, tx := setupAttributeViewFieldsTest(t, av.KeyTypeNumber)
	if err := PerformTxSync(tx); err != nil {
		t.Fatal(err)
	}
	current := readAttributeViewItemsTest(t, before.ID)
	for _, view := range []*av.AttributeView{before, current} {
		view.Name = "Renamed database"
		view.Views[0].Name = "Renamed view"
		view.KeyValues[2].Values[0].Text.Content = "newer unrelated value"
	}
	if err := av.SaveAttributeView(current); err != nil {
		t.Fatal(err)
	}
	replayAttributeViewFieldsTest(t, GlobalUndoLog.Peek(fixture.sourceID).UndoOperationsForReplay())
	assertAttributeViewFieldsTest(t, before, readAttributeViewItemsTest(t, before.ID))
}

func TestAttributeViewFieldsConflict(t *testing.T) {
	for _, kind := range []string{"field", "filter", "item", "redo"} {
		t.Run(kind, func(t *testing.T) {
			fixture, before, tx := setupAttributeViewFieldsTest(t, av.KeyTypeNumber)
			if err := PerformTxSync(tx); err != nil {
				t.Fatal(err)
			}
			entry := GlobalUndoLog.Peek(fixture.sourceID)
			if kind == "redo" {
				replayAttributeViewFieldsTest(t, entry.UndoOperationsForReplay())
			}
			current := readAttributeViewItemsTest(t, before.ID)
			keyID := tx.DoOperations[0].ID
			switch kind {
			case "field":
				current.KeyValues = append(current.KeyValues, &av.KeyValues{Key: &av.Key{ID: keyID, Type: av.KeyTypeText}})
			case "filter":
				current.Views[0].Filters = fieldFilterRoot(fieldFilterLeaf(current.GetBlockKeyValues().Key.ID))
				current.Views[0].Filters[0].Filters[0].Value.Text.Content = "newer filter"
			case "item":
				current.GetBlockKeyValues().Values = current.GetBlockKeyValues().Values[1:]
			case "redo":
				kv, _ := current.GetKeyValues(keyID)
				kv.Values[0].Number.Content = 999
			}
			if err := av.SaveAttributeView(current); err != nil {
				t.Fatal(err)
			}
			current = readAttributeViewItemsTest(t, current.ID)
			operations := entry.UndoOperationsForReplay()
			if kind == "redo" {
				operations = entry.DoOperationsForReplay()
			}
			if err := PerformTxSync(&Transaction{DoOperations: operations, isReplay: true}); err == nil {
				t.Fatal("conflicting field replay was accepted")
			}
			assertAttributeViewFieldsTest(t, current, readAttributeViewItemsTest(t, before.ID))
		})
	}
}

func TestAttributeViewFieldsRelations(t *testing.T) {
	for _, self := range []bool{false, true} {
		for _, removeDest := range []bool{false, true} {
			t.Run(fmt.Sprintf("self=%t/removeDest=%t", self, removeDest), func(t *testing.T) {
				fixture, source, dest, peer, tx := setupAttributeViewFieldRelationsTest(t, self, removeDest)
				if err := PerformTxSync(tx); err != nil {
					t.Fatal(err)
				}
				entry := GlobalUndoLog.Peek(fixture.sourceID)
				deleted := map[string]*av.AttributeView{}
				for _, view := range []*av.AttributeView{source, dest, peer} {
					deleted[view.ID] = readAttributeViewItemsTest(t, view.ID)
				}
				if got := slices.Contains(av.GetSrcAvIDs(source.ID), dest.ID); got != !removeDest {
					t.Fatalf("unexpected back relation index after deletion: %t", got)
				}
				if !self && slices.Contains(av.GetSrcAvIDs(dest.ID), source.ID) {
					t.Fatal("deleted source relation remained indexed")
				}
				for cycle := 0; cycle < 2; cycle++ {
					for _, view := range []*av.AttributeView{source, dest} {
						current := readAttributeViewItemsTest(t, view.ID)
						sql.RenderView(current, current.Views[0], "", false)
						if err := av.SaveAttributeView(current); err != nil {
							t.Fatal(err)
						}
					}
					replayAttributeViewFieldsTest(t, entry.UndoOperationsForReplay())
					for _, view := range []*av.AttributeView{source, dest, peer} {
						assertAttributeViewFieldsTest(t, view, readAttributeViewItemsTest(t, view.ID))
					}
					if !slices.Contains(av.GetSrcAvIDs(source.ID), dest.ID) || !slices.Contains(av.GetSrcAvIDs(dest.ID), source.ID) {
						t.Fatal("undo did not restore relation indexes")
					}
					for _, view := range []*av.AttributeView{source, dest} {
						current := readAttributeViewItemsTest(t, view.ID)
						sql.RenderView(current, current.Views[0], "", false)
						if err := av.SaveAttributeView(current); err != nil {
							t.Fatal(err)
						}
					}
					replayAttributeViewFieldsTest(t, entry.DoOperationsForReplay())
					for _, view := range deleted {
						assertAttributeViewFieldsTest(t, view, readAttributeViewItemsTest(t, view.ID))
					}
				}
			})
		}
	}
}

func TestAttributeViewFieldsRelationFailure(t *testing.T) {
	for _, phase := range []string{"delete write", "undo write", "undo conflict", "undo values"} {
		t.Run(phase, func(t *testing.T) {
			fixture, source, dest, peer, tx := setupAttributeViewFieldRelationsTest(t, false, false)
			if phase != "delete write" {
				if err := PerformTxSync(tx); err != nil {
					t.Fatal(err)
				}
				tx = &Transaction{DoOperations: GlobalUndoLog.Peek(fixture.sourceID).UndoOperationsForReplay(), isReplay: true}
			}
			if phase == "undo conflict" || phase == "undo values" {
				changed := readAttributeViewItemsTest(t, dest.ID)
				for _, kv := range changed.KeyValues {
					if kv.Key.Relation != nil {
						if phase == "undo conflict" {
							kv.Key.Relation.BackKeyID = ast.NewNodeID()
						} else {
							kv.Values[0].Relation.BlockIDs = kv.Values[0].Relation.BlockIDs[:1]
						}
					}
				}
				if err := av.SaveAttributeView(changed); err != nil {
					t.Fatal(err)
				}
			} else {
				tx.writeTransactionTree = func(*parse.Tree) error { return errors.New("injected field relation write failure") }
			}
			before := map[string]*av.AttributeView{}
			indexes := map[string][]string{}
			for _, view := range []*av.AttributeView{source, dest, peer} {
				before[view.ID] = readAttributeViewItemsTest(t, view.ID)
				indexes[view.ID] = av.GetSrcAvIDs(view.ID)
			}
			if err := PerformTxSync(tx); err == nil {
				t.Fatal("failed relation mutation succeeded")
			}
			for _, view := range before {
				assertAttributeViewFieldsTest(t, view, readAttributeViewItemsTest(t, view.ID))
				got, want := av.GetSrcAvIDs(view.ID), indexes[view.ID]
				slices.Sort(got)
				slices.Sort(want)
				if !slices.Equal(got, want) {
					t.Fatalf("failed transaction changed relation index: want %v, got %v", want, got)
				}
			}
		})
	}
}

func TestAttributeViewFieldsWriteFailure(t *testing.T) {
	for _, undo := range []bool{false, true} {
		t.Run(map[bool]string{false: "delete", true: "undo"}[undo], func(t *testing.T) {
			fixture, before, tx := setupAttributeViewFieldsTest(t, av.KeyTypeText)
			if undo {
				if err := PerformTxSync(tx); err != nil {
					t.Fatal(err)
				}
				tx = &Transaction{DoOperations: GlobalUndoLog.Peek(fixture.sourceID).UndoOperationsForReplay(), isReplay: true}
			}
			before = readAttributeViewItemsTest(t, before.ID)
			injected := errors.New("injected document write failure")
			tx.writeTransactionTree = func(*parse.Tree) error { return injected }
			if err := PerformTxSync(tx); err == nil || !strings.Contains(err.Error(), injected.Error()) {
				t.Fatalf("unexpected write failure: %v", err)
			}
			assertAttributeViewFieldsTest(t, before, readAttributeViewItemsTest(t, before.ID))
		})
	}
}

func TestAttributeViewFieldsEncryptedReplay(t *testing.T) {
	_, before, tx := setupAttributeViewFieldsTest(t, av.KeyTypeText)
	boxID := ast.NewNodeID()
	markRuntimeEncryptedBox(boxID)
	setDEKForTest(boxID, bytes.Repeat([]byte{0x62}, 32))
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
	tx.DoOperations[0].BlockID, tx.UndoOperations[0].BlockID = "", ""
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
	path := filepath.Join(util.DataDir, boxID, "storage", "av", before.ID+".json")
	ciphertext, err := os.ReadFile(path)
	if err != nil || !util.IsCiphertext(ciphertext) {
		t.Fatalf("database was not encrypted: %v", err)
	}
	if _, err = os.Stat(plainPath); !os.IsNotExist(err) {
		t.Fatalf("replay produced plaintext: %v", err)
	}
	for _, failure := range []string{"locked", "corrupted"} {
		t.Run(failure, func(t *testing.T) {
			if failure == "locked" {
				cachedDEKsLock.Lock()
				delete(cachedDEKs, boxID)
				cachedDEKsLock.Unlock()
				defer setDEKForTest(boxID, bytes.Repeat([]byte{0x62}, 32))
			} else {
				ciphertext[len(ciphertext)-1] ^= 1
				if err = os.WriteFile(path, ciphertext, 0600); err != nil {
					t.Fatal(err)
				}
			}
			cache.ClearAVCache()
			if err = PerformTxSync(&Transaction{DoOperations: cloneOperations(tx.UndoOperations), isReplay: true}); err == nil {
				t.Fatal("replay accepted inaccessible encrypted data")
			}
			preserved, readErr := os.ReadFile(path)
			if readErr != nil || !bytes.Equal(ciphertext, preserved) {
				t.Fatalf("failed replay changed encrypted data: %v", readErr)
			}
		})
	}
}

func setupAttributeViewFieldsTest(t *testing.T, typ av.KeyType) (*fileOperationTestFixture, *av.AttributeView, *Transaction) {
	t.Helper()
	fixture, view, _, _ := setupAttributeViewItemsTest(t, false)
	util.AttrViewLangs["en"]["gallery"], util.AttrViewLangs["en"]["kanban"] = "Gallery", "Kanban"
	var field *av.KeyValues
	for _, kv := range view.KeyValues {
		if kv.Key.Type == typ && len(kv.Values) > 0 {
			field = kv
			break
		}
	}
	if field == nil {
		t.Fatalf("missing fixture field: %s", typ)
	}
	key := field.Key
	key.Name, key.Icon, key.Desc = "Restored field", "iconDatabase", "Field description"
	if typ == av.KeyTypeSelect || typ == av.KeyTypeMSelect {
		key.Options = []*av.SelectOption{{Name: "Alpha", Color: "1"}, {Name: "Beta", Color: "2"}}
	}
	for _, kv := range view.KeyValues {
		view.KeyIDs = append(view.KeyIDs, kv.Key.ID)
	}
	view.Views = append(view.Views, av.NewGalleryView(), av.NewKanbanView())
	for _, layout := range view.Views {
		base := &av.BaseField{ID: key.ID, Wrap: true, Hidden: true, Desc: "Layout field description"}
		if layout.Table != nil {
			layout.Table.Columns = append(layout.Table.Columns, &av.ViewTableColumn{BaseField: base, Width: "233px", Pin: true})
		}
		if layout.Gallery != nil {
			layout.Gallery.CardFields = []*av.ViewGalleryCardField{{BaseField: &av.BaseField{ID: view.GetBlockKeyValues().Key.ID}}, {BaseField: base, FullRow: true}}
		}
		if layout.Kanban != nil {
			layout.Kanban.Fields = []*av.ViewKanbanField{{BaseField: &av.BaseField{ID: view.GetBlockKeyValues().Key.ID}}, {BaseField: base, FullRow: true}}
		}
		layout.Filters = fieldFilterRoot(fieldFilterLeaf(key.ID), fieldFilterLeaf(view.GetBlockKeyValues().Key.ID))
		layout.Sorts = []*av.ViewSort{{Column: key.ID, Order: av.SortOrderDesc}}
		layout.Group = &av.ViewGroup{Field: key.ID}
		layout.GroupCreated = 123
		layout.Groups = []*av.View{{ID: ast.NewNodeID(), GroupFolded: true, GroupSort: 3,
			GroupKey: key, GroupVal: &av.Value{Type: av.KeyTypeText, Text: &av.ValueText{Content: "Group"}},
			GroupItemIDs: append([]string(nil), view.Views[0].ItemIDs...)}}
	}
	view.NewItemTemplates = []*av.NewItemTemplate{{ID: ast.NewNodeID(), Name: "Default", TargetType: av.NewItemTargetDetached,
		FieldValues: map[string]*av.NewItemFieldValue{key.ID: {Mode: av.NewItemFieldValueStatic, Value: field.Values[0].Clone()}}}}
	view.DefaultTemplateID = view.NewItemTemplates[0].ID
	view.CardCoverPositions = map[string]map[string]*av.CardCoverPosition{field.Values[0].BlockID: {
		av.CardCoverSource(av.CoverFromAssetField, key.ID): {Image: "assets/example.png", X: 0.3, Y: 0.7}}}
	if err := av.SaveAttributeView(view); err != nil {
		t.Fatal(err)
	}
	view = readAttributeViewItemsTest(t, view.ID)
	op := &Operation{Action: "removeAttrViewCol", AvID: view.ID, ID: key.ID, BlockID: fixture.sourceID}
	inverse := &Operation{Action: "addAttrViewCol", AvID: view.ID, ID: key.ID, BlockID: fixture.sourceID, Name: key.Name, Typ: string(typ)}
	return fixture, view, &Transaction{DoOperations: []*Operation{op}, UndoOperations: []*Operation{inverse}, fromAPI: true}
}

func setupAttributeViewFieldRelationsTest(t *testing.T, self, removeDest bool) (*fileOperationTestFixture, *av.AttributeView, *av.AttributeView, *av.AttributeView, *Transaction) {
	t.Helper()
	fixture, source, tx := setupAttributeViewFieldsTest(t, av.KeyTypeText)
	keyID := tx.DoOperations[0].ID
	field, _ := source.GetKeyValues(keyID)
	dest, _ := cloneAttributeViewForFieldMutation(source)
	dest.ID = ast.NewNodeID()
	if self {
		dest = source
	}
	backID := ast.NewNodeID()
	field.Key.Type = av.KeyTypeRelation
	field.Key.Relation = &av.Relation{AvID: dest.ID, BackKeyID: backID, IsTwoWay: true}
	targetID := dest.GetBlockKeyValues().Values[0].BlockID
	for _, value := range field.Values {
		value.Type, value.Text = av.KeyTypeRelation, nil
		value.Relation = &av.ValueRelation{BlockIDs: []string{targetID}}
	}
	back := &av.KeyValues{Key: &av.Key{ID: backID, Type: av.KeyTypeRelation,
		Relation: &av.Relation{AvID: source.ID, BackKeyID: keyID, IsTwoWay: true}},
		Values: []*av.Value{{ID: ast.NewNodeID(), KeyID: backID, BlockID: targetID, Type: av.KeyTypeRelation,
			Relation: &av.ValueRelation{BlockIDs: append([]string(nil), source.Views[0].ItemIDs...)}}}}
	dest.KeyValues = append(dest.KeyValues, back)
	dest.KeyIDs = append(dest.KeyIDs, backID)
	for _, layout := range dest.Views {
		if layout.Table != nil {
			layout.Table.Columns = append(layout.Table.Columns, &av.ViewTableColumn{BaseField: &av.BaseField{ID: backID}, Width: "187px"})
		}
		if layout.Gallery != nil {
			layout.Gallery.CardFields = append(layout.Gallery.CardFields, &av.ViewGalleryCardField{BaseField: &av.BaseField{ID: backID}, FullRow: true})
		}
		if layout.Kanban != nil {
			layout.Kanban.Fields = append(layout.Kanban.Fields, &av.ViewKanbanField{BaseField: &av.BaseField{ID: backID}, FullRow: true})
		}
	}
	dest.NewItemTemplates[0].FieldValues[backID] = &av.NewItemFieldValue{Mode: av.NewItemFieldValueStatic, Value: back.Values[0].Clone()}
	peer := av.NewAttributeView(ast.NewNodeID())
	for _, target := range []struct {
		view *av.AttributeView
		key  string
	}{{source, keyID}, {dest, backID}} {
		relationID := ast.NewNodeID()
		peer.KeyValues = append(peer.KeyValues, &av.KeyValues{Key: &av.Key{ID: relationID, Type: av.KeyTypeRelation,
			Relation: &av.Relation{AvID: target.view.ID, CandidateFilters: fieldFilterRoot(fieldFilterLeaf(target.key))}}})
		peer.KeyValues = append(peer.KeyValues, &av.KeyValues{Key: &av.Key{ID: ast.NewNodeID(), Type: av.KeyTypeRollup,
			Rollup: &av.Rollup{RelationKeyID: relationID, KeyID: target.key, Filters: fieldFilterRoot(fieldFilterLeaf(target.key))}},
			Values: []*av.Value{{ID: ast.NewNodeID(), Type: av.KeyTypeRollup, Rollup: &av.ValueRollup{Contents: []*av.Value{field.Values[0].Clone()}}}}})
	}
	for _, view := range []*av.AttributeView{source, dest, peer} {
		if err := av.SaveAttributeView(view); err != nil {
			t.Fatal(err)
		}
		for _, kv := range view.KeyValues {
			if kv.Key.Relation != nil {
				av.UpsertAvBackRel(view.ID, kv.Key.Relation.AvID)
			}
		}
	}
	tx.DoOperations[0].RemoveDest = removeDest
	return fixture, readAttributeViewItemsTest(t, source.ID), readAttributeViewItemsTest(t, dest.ID), readAttributeViewItemsTest(t, peer.ID), tx
}

func replayAttributeViewFieldsTest(t *testing.T, operations []*Operation) {
	t.Helper()
	if err := PerformTxSync(&Transaction{DoOperations: operations, isReplay: true}); err != nil {
		t.Fatal(err)
	}
}

func assertAttributeViewFieldsTest(t *testing.T, expected, actual *av.AttributeView) {
	t.Helper()
	normalize := func(view *av.AttributeView) []byte {
		copy, err := cloneAttributeViewForFieldMutation(view)
		if err != nil {
			t.Fatal(err)
		}
		for _, layout := range copy.Views {
			layout.GroupCreated = 0
		}
		for _, kv := range copy.KeyValues {
			for _, value := range kv.Values {
				if value.Relation != nil {
					value.Relation.Contents = nil
				}
				if value.Rollup != nil {
					value.Rollup.Contents = nil
				}
				if value.Number != nil {
					value.Number.FormattedContent = ""
				}
				if value.Date != nil {
					value.Date.FormattedContent = ""
				}
			}
		}
		data, err := json.Marshal(copy)
		if err != nil {
			t.Fatal(err)
		}
		return data
	}
	want, got := normalize(expected), normalize(actual)
	if !bytes.Equal(want, got) {
		t.Fatalf("database did not match the expected state:\nwant %s\ngot  %s", want, got)
	}
}
