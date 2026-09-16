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
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAttributeViewOptionUndoRedo(t *testing.T) {
	for _, action := range []string{"delete", "merge", "rename"} {
		for _, typ := range []av.KeyType{av.KeyTypeSelect, av.KeyTypeMSelect} {
			t.Run(action+"/"+string(typ), func(t *testing.T) {
				fixture, source, peer, tx := setupAttributeViewOptionUndoTest(t, action, typ)
				if err := PerformTxSync(tx); err != nil {
					t.Fatal(err)
				}
				entry := GlobalUndoLog.Peek(fixture.sourceID)
				if entry == nil {
					t.Fatal("option operation did not enter the undo log")
				}
				data, err := json.Marshal(tx)
				if err != nil || strings.Contains(string(data), "Private template") {
					t.Fatalf("private option snapshot leaked into response: %s, %v", data, err)
				}
				after, peerAfter := readAttributeViewItemsTest(t, source.ID), readAttributeViewItemsTest(t, peer.ID)
				field, _ := after.GetKeyValues(tx.DoOperations[0].ID)
				want := [][]string{{}, {"B"}, {"B"}, {"C"}}
				if action != "delete" {
					name := "B"
					if action == "rename" {
						name = "Renamed"
					}
					want[0] = []string{name}
					if typ == av.KeyTypeSelect {
						want[2] = []string{name}
					} else if action == "rename" {
						want[2] = []string{name, "B"}
					}
				} else if typ == av.KeyTypeSelect {
					want[2] = nil
				}
				for i, value := range field.Values {
					var got []string
					for _, option := range value.MSelect {
						got = append(got, option.Content)
					}
					if !slices.Equal(got, want[i]) {
						t.Fatalf("unexpected option values at item %d: want %v, got %v", i, want[i], got)
					}
				}
				if action == "delete" && field.Key.GetOption("A") != nil {
					t.Fatal("deleted option definition remains")
				}
				if action == "merge" && field.Key.GetOption("B").Desc != "Target description" {
					t.Fatal("merge changed the target option definition")
				}
				for cycle := 0; cycle < 3; cycle++ {
					replayAttributeViewFieldsTest(t, entry.UndoOperationsForReplay())
					assertAttributeViewFieldsTest(t, source, readAttributeViewItemsTest(t, source.ID))
					assertAttributeViewFieldsTest(t, peer, readAttributeViewItemsTest(t, peer.ID))
					// 渲染会刷新派生字段，不能因此阻止下一次重做。
					rendered := readAttributeViewItemsTest(t, source.ID)
					for _, view := range rendered.Views {
						sql.RenderView(rendered, view, "", false)
					}
					if err = av.SaveAttributeView(rendered); err != nil {
						t.Fatal(err)
					}
					replayAttributeViewFieldsTest(t, entry.DoOperationsForReplay())
					assertAttributeViewFieldsTest(t, after, readAttributeViewItemsTest(t, source.ID))
					assertAttributeViewFieldsTest(t, peerAfter, readAttributeViewItemsTest(t, peer.ID))
				}
			})
		}
	}
}

func TestAttributeViewOptionDeleteLastUndo(t *testing.T) {
	fixture, source, peer, tx := setupAttributeViewOptionUndoTest(t, "delete", av.KeyTypeMSelect)
	field, _ := source.GetKeyValues(tx.DoOperations[0].ID)
	field.Key.Options = field.Key.Options[:1]
	for _, value := range field.Values {
		value.MSelect = optionUndoSelections("A")
	}
	regenAttrViewGroups(source)
	if err := av.SaveAttributeView(source); err != nil {
		t.Fatal(err)
	}
	source = readAttributeViewItemsTest(t, source.ID)
	if err := PerformTxSync(tx); err != nil {
		t.Fatal(err)
	}
	entry := GlobalUndoLog.Peek(fixture.sourceID)
	for cycle := 0; cycle < 2; cycle++ {
		deleted := readAttributeViewItemsTest(t, source.ID)
		key, _ := deleted.GetKey(field.Key.ID)
		if len(key.Options) != 0 {
			t.Fatal("last option was not deleted")
		}
		replayAttributeViewFieldsTest(t, entry.UndoOperationsForReplay())
		assertAttributeViewFieldsTest(t, source, readAttributeViewItemsTest(t, source.ID))
		assertAttributeViewFieldsTest(t, peer, readAttributeViewItemsTest(t, peer.ID))
		replayAttributeViewFieldsTest(t, entry.DoOperationsForReplay())
	}
}

func TestAttributeViewOptionUndoPreservesOtherEdits(t *testing.T) {
	for _, action := range []string{"delete", "merge"} {
		t.Run(action, func(t *testing.T) {
			fixture, source, _, tx := setupAttributeViewOptionUndoTest(t, action, av.KeyTypeMSelect)
			for _, view := range source.Views {
				view.Group, view.Groups = nil, nil
			}
			if err := av.SaveAttributeView(source); err != nil {
				t.Fatal(err)
			}
			if err := PerformTxSync(tx); err != nil {
				t.Fatal(err)
			}
			current := readAttributeViewItemsTest(t, source.ID)
			for _, view := range []*av.AttributeView{source, current} {
				view.Name = "New database name"
				view.KeyValues[2].Values[0].Text.Content = "Later text edit"
				field, _ := view.GetKeyValues(tx.DoOperations[0].ID)
				field.Key.Options = append(field.Key.Options, &av.SelectOption{Name: "Later", Color: "4"})
				field.Values[1].MSelect = optionUndoSelections("C")
			}
			if err := av.SaveAttributeView(current); err != nil {
				t.Fatal(err)
			}
			replayAttributeViewFieldsTest(t, GlobalUndoLog.Peek(fixture.sourceID).UndoOperationsForReplay())
			assertAttributeViewFieldsTest(t, source, readAttributeViewItemsTest(t, source.ID))
		})
	}
}

func TestAttributeViewOptionReplayConflict(t *testing.T) {
	for _, conflict := range []string{"value", "option", "type", "item", "relatedFilter"} {
		t.Run(conflict, func(t *testing.T) {
			fixture, source, peer, tx := setupAttributeViewOptionUndoTest(t, "delete", av.KeyTypeMSelect)
			if err := PerformTxSync(tx); err != nil {
				t.Fatal(err)
			}
			source, peer = readAttributeViewItemsTest(t, source.ID), readAttributeViewItemsTest(t, peer.ID)
			field, _ := source.GetKeyValues(tx.DoOperations[0].ID)
			switch conflict {
			case "value":
				field.Values[0].MSelect = optionUndoSelections("C")
			case "option":
				field.Key.Options = append(field.Key.Options, &av.SelectOption{Name: "A", Color: "4"})
			case "type":
				field.Key.Type = av.KeyTypeText
			case "item":
				field.Values = field.Values[1:]
			case "relatedFilter":
				peer.KeyValues[2].Key.Relation.CandidateFilters = fieldFilterRoot(fieldFilterLeaf(source.GetBlockKey().ID))
			}
			for _, view := range []*av.AttributeView{source, peer} {
				if err := av.SaveAttributeView(view); err != nil {
					t.Fatal(err)
				}
			}
			if err := PerformTxSync(&Transaction{DoOperations: GlobalUndoLog.Peek(fixture.sourceID).UndoOperationsForReplay(), isReplay: true}); err == nil {
				t.Fatal("conflicting option replay succeeded")
			}
			assertAttributeViewFieldsTest(t, source, readAttributeViewItemsTest(t, source.ID))
			assertAttributeViewFieldsTest(t, peer, readAttributeViewItemsTest(t, peer.ID))
		})
	}
}

func TestAttributeViewOptionWriteFailure(t *testing.T) {
	for _, action := range []string{"delete", "merge"} {
		for _, undo := range []bool{false, true} {
			t.Run(action+map[bool]string{false: "/apply", true: "/undo"}[undo], func(t *testing.T) {
				fixture, source, peer, tx := setupAttributeViewOptionUndoTest(t, action, av.KeyTypeMSelect)
				if undo {
					if err := PerformTxSync(tx); err != nil {
						t.Fatal(err)
					}
					tx = &Transaction{DoOperations: GlobalUndoLog.Peek(fixture.sourceID).UndoOperationsForReplay(), isReplay: true}
				}
				source, peer = readAttributeViewItemsTest(t, source.ID), readAttributeViewItemsTest(t, peer.ID)
				tx.writeTransactionTree = func(*parse.Tree) error { return errors.New("injected option write failure") }
				if err := PerformTxSync(tx); err == nil || !strings.Contains(err.Error(), "injected option write failure") {
					t.Fatalf("unexpected write result: %v", err)
				}
				assertAttributeViewFieldsTest(t, source, readAttributeViewItemsTest(t, source.ID))
				assertAttributeViewFieldsTest(t, peer, readAttributeViewItemsTest(t, peer.ID))
			})
		}
	}
}

func TestAttributeViewOptionEncryptedReplay(t *testing.T) {
	for _, action := range []string{"delete", "merge"} {
		t.Run(action, func(t *testing.T) {
			_, source, peer, tx := setupAttributeViewOptionUndoTest(t, action, av.KeyTypeMSelect)
			boxID := ast.NewNodeID()
			dek := bytes.Repeat([]byte{0x64}, 32)
			markRuntimeEncryptedBox(boxID)
			setDEKForTest(boxID, dek)
			t.Cleanup(func() {
				for _, view := range []*av.AttributeView{source, peer} {
					av.SetAVBoxID(view.ID, "")
				}
				forgetRuntimeEncryptedBox(boxID)
				encryptedBoxLifecycles.Delete(boxID)
				cachedDEKsLock.Lock()
				delete(cachedDEKs, boxID)
				cachedDEKsLock.Unlock()
			})
			for _, view := range []*av.AttributeView{source, peer} {
				av.SetAVBoxID(view.ID, boxID)
				if err := av.SaveAttributeView(view); err != nil {
					t.Fatal(err)
				}
				if err := os.Remove(filepath.Join(util.DataDir, "storage", "av", view.ID+".json")); err != nil {
					t.Fatal(err)
				}
			}
			tx.DoOperations[0].BlockID, tx.UndoOperations[0].BlockID = "", ""
			for _, view := range []*av.AttributeView{source, peer} {
				av.UpsertAvBackRel(view.ID, source.ID)
			}
			if err := PerformTxSync(tx); err != nil {
				t.Fatal(err)
			}
			if tx.DoOperations[0].attributeViewFields.changes[peer.ID] == nil {
				t.Fatal("encrypted related filters were not included in the snapshot")
			}
			replayAttributeViewFieldsTest(t, cloneOperations(tx.UndoOperations))
			for _, view := range []*av.AttributeView{source, peer} {
				restored, err := av.ParseAttributeViewForIndexInBox(view.ID, boxID)
				if err != nil {
					t.Fatal(err)
				}
				assertAttributeViewFieldsTest(t, view, restored)
				if _, err = os.Stat(filepath.Join(util.DataDir, "storage", "av", view.ID+".json")); !os.IsNotExist(err) {
					t.Fatalf("option replay produced plaintext: %v", err)
				}
			}
			replayAttributeViewFieldsTest(t, cloneOperations(tx.DoOperations))
			for _, failure := range []string{"locked", "corruptedPeer"} {
				t.Run(failure, func(t *testing.T) {
					if failure == "locked" {
						cachedDEKsLock.Lock()
						delete(cachedDEKs, boxID)
						cachedDEKsLock.Unlock()
						defer setDEKForTest(boxID, dek)
					} else {
						path := filepath.Join(util.DataDir, boxID, "storage", "av", peer.ID+".json")
						data, err := os.ReadFile(path)
						if err != nil {
							t.Fatal(err)
						}
						data[len(data)-1] ^= 1
						if err = os.WriteFile(path, data, 0600); err != nil {
							t.Fatal(err)
						}
					}
					ciphertexts := map[string][]byte{}
					for _, view := range []*av.AttributeView{source, peer} {
						path := filepath.Join(util.DataDir, boxID, "storage", "av", view.ID+".json")
						data, err := os.ReadFile(path)
						if err != nil || !util.IsCiphertext(data) {
							t.Fatalf("database was not encrypted: %v", err)
						}
						ciphertexts[path] = data
					}
					cache.ClearAVCache()
					if err := PerformTxSync(&Transaction{DoOperations: cloneOperations(tx.UndoOperations), isReplay: true}); err == nil {
						t.Fatal("option replay accepted inaccessible encrypted data")
					}
					for path, expected := range ciphertexts {
						actual, err := os.ReadFile(path)
						if err != nil || !bytes.Equal(actual, expected) {
							t.Fatalf("failed replay changed encrypted data: %v", err)
						}
					}
				})
			}
		})
	}
}

func optionUndoSelections(names ...string) []*av.ValueSelect {
	ret := make([]*av.ValueSelect, 0, len(names))
	for _, name := range names {
		ret = append(ret, &av.ValueSelect{Content: name, Color: map[string]string{"A": "1", "B": "2", "C": "3"}[name]})
	}
	return ret
}

func setupAttributeViewOptionUndoTest(t *testing.T, action string, typ av.KeyType) (*fileOperationTestFixture, *av.AttributeView, *av.AttributeView, *Transaction) {
	t.Helper()
	fixture, source, _, _ := setupAttributeViewItemsTest(t, false)
	util.AttrViewLangs["en"]["gallery"], util.AttrViewLangs["en"]["kanban"] = "Gallery", "Kanban"
	var field *av.KeyValues
	for _, kv := range source.KeyValues {
		if kv.Key.Type == typ && len(kv.Values) != 0 {
			field = kv
			break
		}
	}
	field.Key.Name = "Options"
	field.Key.Options = []*av.SelectOption{{Name: "A", Color: "1", Desc: "Original description"},
		{Name: "B", Color: "2", Desc: "Target description"}, {Name: "C", Color: "3"}}
	selections := [][]string{{"A"}, {"B"}, {"A", "B"}, {"C"}}
	if typ == av.KeyTypeSelect {
		selections[2] = []string{"A"}
	}
	for i, value := range field.Values {
		value.MSelect = optionUndoSelections(selections[i]...)
	}
	optionFilter := func(names ...string) *av.ViewFilter {
		return &av.ViewFilter{Column: field.Key.ID, Operator: av.FilterOperatorContains,
			Value: &av.Value{Type: typ, MSelect: optionUndoSelections(names...)}}
	}
	source.Views = append(source.Views, av.NewGalleryView(), av.NewKanbanView())
	for _, view := range source.Views {
		view.Filters = fieldFilterRoot(&av.ViewFilter{Combination: av.FilterCombinationOr,
			Filters: []*av.ViewFilter{optionFilter("A"), optionFilter("A", "B")}}, optionFilter("B"))
		view.Group = &av.ViewGroup{Field: field.Key.ID, Method: av.GroupMethodValue}
		if view.Table != nil {
			view.Table.Columns = append(view.Table.Columns, &av.ViewTableColumn{BaseField: &av.BaseField{ID: field.Key.ID}})
		}
		if view.Gallery != nil {
			view.Gallery.CardFields = []*av.ViewGalleryCardField{{BaseField: &av.BaseField{ID: field.Key.ID}}}
		}
		if view.Kanban != nil {
			view.Kanban.Fields = []*av.ViewKanbanField{{BaseField: &av.BaseField{ID: field.Key.ID}}}
		}
	}
	for _, names := range [][]string{{"A"}, {"A", "B"}, {"B"}} {
		source.NewItemTemplates = append(source.NewItemTemplates, &av.NewItemTemplate{ID: ast.NewNodeID(), Name: "Private template",
			TargetType: av.NewItemTargetDetached, FieldValues: map[string]*av.NewItemFieldValue{
				field.Key.ID: {Mode: av.NewItemFieldValueStatic, Value: &av.Value{Type: typ, MSelect: optionUndoSelections(names...)}},
			}})
	}
	peer := av.NewAttributeView(ast.NewNodeID())
	for _, view := range []*av.AttributeView{source, peer} {
		relationID := ast.NewNodeID()
		view.KeyValues = append(view.KeyValues,
			&av.KeyValues{Key: &av.Key{ID: relationID, Type: av.KeyTypeRelation,
				Relation: &av.Relation{AvID: source.ID, CandidateFilters: fieldFilterRoot(optionFilter("A"), optionFilter("A", "B"))}}},
			&av.KeyValues{Key: &av.Key{ID: ast.NewNodeID(), Type: av.KeyTypeRollup,
				Rollup: &av.Rollup{RelationKeyID: relationID, KeyID: field.Key.ID, Filters: fieldFilterRoot(optionFilter("A"))}}})
		if err := av.SaveAttributeView(view); err != nil {
			t.Fatal(err)
		}
		av.UpsertAvBackRel(view.ID, source.ID)
	}
	regenAttrViewGroups(source)
	for _, view := range source.Views {
		for i, group := range view.Groups {
			group.GroupFolded, group.GroupSort = true, i+2
			slices.Reverse(group.GroupItemIDs)
		}
	}
	if err := av.SaveAttributeView(source); err != nil {
		t.Fatal(err)
	}
	op := &Operation{Action: "removeAttrViewColOption", ID: field.Key.ID, AvID: source.ID, BlockID: fixture.sourceID, Data: "A"}
	inverse := &Operation{Action: "updateAttrViewColOptions", ID: field.Key.ID, AvID: source.ID, BlockID: fixture.sourceID, Data: field.Key.Options}
	if action != "delete" {
		name := "B"
		if action == "rename" {
			name = "Renamed"
		}
		op.Action, inverse.Action = "updateAttrViewColOption", "updateAttrViewColOption"
		op.Data = map[string]any{"oldName": "A", "newName": name, "newColor": "1", "newDesc": "Changed"}
		inverse.Data = map[string]any{"oldName": name, "newName": "A", "newColor": "1", "newDesc": "Original description"}
	}
	return fixture, readAttributeViewItemsTest(t, source.ID), readAttributeViewItemsTest(t, peer.ID),
		&Transaction{DoOperations: []*Operation{op}, UndoOperations: []*Operation{inverse}, fromAPI: true}
}
