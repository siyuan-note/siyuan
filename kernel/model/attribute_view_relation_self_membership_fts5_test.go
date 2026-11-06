// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"slices"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func recordSelfMembershipCellEdit(t *testing.T, operation *Operation, previous *av.Value) (*UndoEntry, string) {
	t.Helper()
	tree, err := LoadTreeByBlockID(operation.BlockID)
	if err != nil {
		t.Fatal(err)
	}
	undo := *operation
	undo.Data = previous.Clone()
	tx := &Transaction{fromAPI: true, DoOperations: []*Operation{operation}, UndoOperations: []*Operation{&undo}}
	if operation.RelationContext == nil {
		tx.DoOperations = append(tx.DoOperations, &Operation{Action: "doUpdateUpdated", ID: operation.BlockID, Data: util.CurrentTimeSecondsStr()})
		tx.UndoOperations = append(tx.UndoOperations, &Operation{Action: "doUpdateUpdated", ID: operation.BlockID,
			Data: treenode.GetNodeInTree(tree, operation.BlockID).IALAttr("updated")})
	}
	if err = PerformTxSync(tx); err != nil {
		t.Fatal(err)
	}
	entry := GlobalUndoLog.Peek(tree.ID)
	if entry == nil {
		t.Fatal("cell edit omitted its real document undo entry")
	}
	return entry, tree.ID
}

func replaySelfMembershipHistory(t *testing.T, rootID string, expected *UndoEntry, undo bool) {
	t.Helper()
	var entry *UndoEntry
	if undo {
		entry = GlobalUndoLog.Undo(rootID)
	} else {
		entry = GlobalUndoLog.Redo(rootID)
	}
	if entry != expected {
		t.Fatal("native history selected a different transaction")
	}
	operations := entry.DoOperationsForReplay()
	if undo {
		operations = entry.UndoOperationsForReplay()
	}
	if err := PerformTxSync(&Transaction{isReplay: true, DoOperations: operations}); err != nil {
		if undo {
			GlobalUndoLog.UndoRollback(entry, rootID)
		} else {
			GlobalUndoLog.RedoRollback(entry, rootID)
		}
		t.Fatalf("history rejected membership changed by its own transaction: undo=%v %v", undo, err)
	}
	if undo {
		GlobalUndoLog.UndoCommit(entry, rootID)
	} else {
		GlobalUndoLog.RedoCommit(entry, rootID)
	}
}

func setupRelationBackSelfRemoval(t *testing.T, scoped bool) (*relationItemTestFixture, []string, *AttributeViewRelationContext, *UndoEntry, string) {
	t.Helper()
	f, ids, context := setupRelationDetailMutation(t)
	if err := PerformTxSync(&Transaction{DoOperations: []*Operation{detailChange(f, context, ids[:1], nil)}}); err != nil {
		t.Fatal(err)
	}
	blockID := f.targetBlockID
	var root *AttributeViewRelationContext
	if scoped {
		blockID, root = f.sourceBlockID, context
	}
	op := &Operation{Action: "updateAttrViewCell", AvID: f.target.ID, BlockID: blockID,
		KeyID: f.backKeyID, RowID: ids[0], RelationContext: root,
		Data: &av.Value{Type: av.KeyTypeRelation, Relation: &av.ValueRelation{BlockIDs: []string{}}}}
	previous := readAttributeViewItemsTest(t, f.target.ID).GetValue(f.backKeyID, ids[0])
	entry, rootID := recordSelfMembershipCellEdit(t, op, previous)
	assertContextFilterRelationIDs(t, readAttributeViewItemsTest(t, f.source.ID).GetValue(f.keyID, context.SourceItemID))
	return f, ids, context, entry, rootID
}

func TestRelationDetailBackCellSelfMembershipReplay(t *testing.T) {
	for _, scoped := range []bool{false, true} {
		t.Run(fmt.Sprintf("scoped=%v", scoped), func(t *testing.T) {
			f, ids, context, entry, rootID := setupRelationBackSelfRemoval(t, scoped)
			for range 2 {
				replaySelfMembershipHistory(t, rootID, entry, true)
				assertContextFilterRelationIDs(t, readAttributeViewItemsTest(t, f.source.ID).GetValue(f.keyID, context.SourceItemID), ids[0])
				assertContextFilterRelationIDs(t, readAttributeViewItemsTest(t, f.target.ID).GetValue(f.backKeyID, ids[0]), context.SourceItemID)
				replaySelfMembershipHistory(t, rootID, entry, false)
				assertContextFilterRelationIDs(t, readAttributeViewItemsTest(t, f.source.ID).GetValue(f.keyID, context.SourceItemID))
				assertContextFilterRelationIDs(t, readAttributeViewItemsTest(t, f.target.ID).GetValue(f.backKeyID, ids[0]))
			}
		})
	}
}

func setupRelationSelfMembershipSubItems(t *testing.T) (*fileOperationTestFixture, *av.AttributeView, string, *AttributeViewRelationContext) {
	t.Helper()
	f, source, _, _ := setupSubItemsTest(t, false)
	ids := source.Views[0].ItemIDs
	if err := source.SetSubItemsParents(map[string]string{ids[1]: ids[0], ids[2]: ids[0], ids[3]: ""}); err != nil {
		t.Fatal(err)
	}
	key, _ := source.GetKey(source.SubItems.ChildrenKeyID)
	key.Relation.DetailView = &av.RelationDetailView{Spec: 1, Enabled: true, ViewID: source.Views[0].ID}
	if err := av.SaveAttributeView(source); err != nil {
		t.Fatal(err)
	}
	tree, err := LoadTreeByBlockID(f.sourceID)
	if err != nil {
		t.Fatal(err)
	}
	node := &ast.Node{ID: ast.NewNodeID(), Type: ast.NodeAttributeView, AttributeViewID: source.ID, AttributeViewType: "table"}
	node.SetIALAttr("id", node.ID)
	tree.Root.AppendChild(node)
	if _, err = filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	treenode.UpsertBlockTree(tree)
	av.BatchUpsertBlockRel([]*ast.Node{node})
	return f, source, node.ID, &AttributeViewRelationContext{SourceAvID: source.ID, SourceItemID: ids[0], RelationKeyID: key.ID}
}

func TestRelationDetailParentCellSelfMembershipReplay(t *testing.T) {
	for _, scoped := range []bool{false, true} {
		t.Run(fmt.Sprintf("scoped=%v", scoped), func(t *testing.T) {
			_, source, carrier, context := setupRelationSelfMembershipSubItems(t)
			ids := source.Views[0].ItemIDs
			var root *AttributeViewRelationContext
			if scoped {
				root = context
			}
			op := &Operation{Action: "updateAttrViewCell", AvID: source.ID, BlockID: carrier,
				KeyID: source.SubItems.ParentKeyID, RowID: ids[1], RelationContext: root,
				Data: &av.Value{Type: av.KeyTypeRelation, Relation: &av.ValueRelation{BlockIDs: []string{ids[3]}}}}
			entry, rootID := recordSelfMembershipCellEdit(t, op, source.GetValue(source.SubItems.ParentKeyID, ids[1]))
			assertSubItemsParent(t, source.ID, ids[1], ids[3])
			for range 2 {
				replaySelfMembershipHistory(t, rootID, entry, true)
				assertSubItemsParent(t, source.ID, ids[1], ids[0])
				assertSubItemsParent(t, source.ID, ids[2], ids[0])
				replaySelfMembershipHistory(t, rootID, entry, false)
				assertSubItemsParent(t, source.ID, ids[1], ids[3])
				assertSubItemsParent(t, source.ID, ids[2], ids[0])
			}
		})
	}
}

func TestRelationDetailParentCellBatchSelfMembershipReplay(t *testing.T) {
	for _, bulk := range []bool{false, true} {
		for _, scoped := range []bool{false, true} {
			t.Run(fmt.Sprintf("bulk=%v/scoped=%v", bulk, scoped), func(t *testing.T) {
				f, source, carrier, context := setupRelationSelfMembershipSubItems(t)
				ids := slices.Clone(source.Views[0].ItemIDs)
				untouched := ast.NewNodeID()
				source.GetBlockKeyValues().Values = append(source.GetBlockKeyValues().Values, &av.Value{ID: ast.NewNodeID(),
					KeyID: source.GetBlockKey().ID, BlockID: untouched, Type: av.KeyTypeBlock, IsDetached: true,
					Block: &av.ValueBlock{Content: "Untouched sibling"}})
				for _, view := range source.Views {
					view.ItemIDs = append(view.ItemIDs, untouched)
				}
				if err := source.SetSubItemsParents(map[string]string{untouched: ids[0]}); err != nil {
					t.Fatal(err)
				}
				if err := av.SaveAttributeView(source); err != nil {
					t.Fatal(err)
				}
				before := relationSubItemsParents(t, source.ID)
				var root *AttributeViewRelationContext
				if scoped {
					root = context
				}
				var do, undo []*Operation
				var edits, inverses []*AttrViewCellUpdate
				for _, rowID := range ids[1:3] {
					value := &av.Value{Type: av.KeyTypeRelation, Relation: &av.ValueRelation{BlockIDs: []string{ids[3]}}}
					previous := source.GetValue(source.SubItems.ParentKeyID, rowID).Clone()
					if bulk {
						edits = append(edits, &AttrViewCellUpdate{KeyID: source.SubItems.ParentKeyID, RowID: rowID, Data: value})
						inverses = append([]*AttrViewCellUpdate{{KeyID: source.SubItems.ParentKeyID, RowID: rowID, Data: previous}}, inverses...)
					} else {
						op := &Operation{Action: "updateAttrViewCell", AvID: source.ID, BlockID: carrier,
							KeyID: source.SubItems.ParentKeyID, RowID: rowID, RelationContext: root, Data: value}
						inverse := *op
						inverse.Data = previous
						do = append(do, op)
						undo = append([]*Operation{&inverse}, undo...)
					}
				}
				if bulk {
					do = []*Operation{{Action: "updateAttrViewCells", AvID: source.ID, BlockID: carrier, RelationContext: root, CellUpdates: edits}}
					undo = []*Operation{{Action: "updateAttrViewCells", AvID: source.ID, BlockID: carrier, RelationContext: root, CellUpdates: inverses}}
				}
				if !scoped {
					tree, err := LoadTreeByBlockID(carrier)
					if err != nil {
						t.Fatal(err)
					}
					do = append(do, &Operation{Action: "doUpdateUpdated", ID: carrier, Data: util.CurrentTimeSecondsStr()})
					undo = append(undo, &Operation{Action: "doUpdateUpdated", ID: carrier, Data: treenode.GetNodeInTree(tree, carrier).IALAttr("updated")})
				}
				if err := PerformTxSync(&Transaction{fromAPI: true, DoOperations: do, UndoOperations: undo}); err != nil {
					t.Fatalf("parent cell batch rejected its own source membership changes: %v", err)
				}
				entry := GlobalUndoLog.Peek(f.sourceID)
				if entry == nil {
					t.Fatal("parent cell batch omitted native history")
				}
				assertMoved := func() {
					t.Helper()
					expected := map[string]string{}
					for id, parent := range before {
						expected[id] = parent
					}
					expected[ids[1]], expected[ids[2]] = ids[3], ids[3]
					assertRelationSubItemsParents(t, source.ID, expected)
					current := readAttributeViewItemsTest(t, source.ID)
					assertContextFilterRelationIDs(t, current.GetValue(source.SubItems.ChildrenKeyID, ids[0]), untouched)
					assertContextFilterRelationIDs(t, current.GetValue(source.SubItems.ChildrenKeyID, ids[3]), ids[1:3]...)
				}
				assertMoved()
				for range 2 {
					replaySelfMembershipHistory(t, f.sourceID, entry, true)
					assertRelationSubItemsParents(t, source.ID, before)
					assertContextFilterRelationIDs(t, readAttributeViewItemsTest(t, source.ID).GetValue(source.SubItems.ChildrenKeyID, ids[0]), ids[1], ids[2], untouched)
					replaySelfMembershipHistory(t, f.sourceID, entry, false)
					assertMoved()
				}
			})
		}
	}
}

func TestRelationCellCreateParentSelfMembershipReplay(t *testing.T) {
	for _, count := range []int{1, 2} {
		for _, scoped := range []bool{false, true} {
			t.Run(fmt.Sprintf("count=%d/scoped=%v", count, scoped), func(t *testing.T) {
				f, source, carrier, context := setupRelationSelfMembershipSubItems(t)
				ids := source.Views[0].ItemIDs
				rows := slices.Clone(ids[1 : 1+count])
				cells := make([]*AttributeViewRelationItemCell, len(rows))
				for i, id := range rows {
					cells[i] = &AttributeViewRelationItemCell{ItemID: id}
				}
				var result *CreateAttributeViewItemResult
				var err error
				if scoped {
					cellContext := &AttributeViewRelationCellContext{RelationContext: *context, SourceItemIDs: rows}
					preview := PreviewAttributeViewRelationCellItem(source.ID, carrier, source.SubItems.ParentKeyID, "New parent", cellContext)
					if preview.Error != "" {
						t.Fatal(preview.Error)
					}
					result, err = CreateAttributeViewRelationCellItem(source.ID, carrier, source.SubItems.ParentKeyID, "New parent", cells, preview, false, cellContext)
				} else {
					preview := PreviewAttributeViewRelationItem(source.ID, carrier, source.SubItems.ParentKeyID, "New parent")
					if preview.Error != "" {
						t.Fatal(preview.Error)
					}
					result, err = CreateAttributeViewRelationItem(source.ID, carrier, source.SubItems.ParentKeyID, "New parent", cells, preview, false)
				}
				if err != nil || result == nil {
					t.Fatalf("creation rejected its own membership change: %v", err)
				}
				assertCreated := func() {
					t.Helper()
					current := readAttributeViewItemsTest(t, source.ID)
					if current.GetBlockValue(result.ItemID) == nil || len(current.GetBlockKeyValues().Values) != len(source.GetBlockKeyValues().Values)+1 {
						t.Fatal("creation must add exactly one new parent")
					}
					for _, id := range rows {
						assertSubItemsParent(t, source.ID, id, result.ItemID)
					}
					assertContextFilterRelationIDs(t, current.GetValue(source.SubItems.ChildrenKeyID, ids[0]), ids[1+count:3]...)
				}
				assertCreated()
				entry := GlobalUndoLog.Peek(f.sourceID)
				if entry == nil {
					t.Fatal("parent creation omitted its real root document undo entry")
				}
				for range 2 {
					replaySelfMembershipHistory(t, f.sourceID, entry, true)
					for _, id := range rows {
						assertSubItemsParent(t, source.ID, id, ids[0])
					}
					if readAttributeViewItemsTest(t, source.ID).GetBlockValue(result.ItemID) != nil {
						t.Fatal("undo retained the newly created parent")
					}
					replaySelfMembershipHistory(t, f.sourceID, entry, false)
					assertCreated()
				}
			})
		}
	}
}

func TestRelationDetailSelfMembershipReplayPreservesUnrelatedMembers(t *testing.T) {
	f, ids, context, entry, _ := setupRelationBackSelfRemoval(t, true)
	if err := PerformTxSync(&Transaction{DoOperations: []*Operation{detailChange(f, context, ids[1:2], nil)}}); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if err := PerformTxSync(&Transaction{isReplay: true, DoOperations: entry.UndoOperationsForReplay()}); err != nil {
			t.Fatal(err)
		}
		assertContextFilterRelationIDs(t, readAttributeViewItemsTest(t, f.source.ID).GetValue(f.keyID, context.SourceItemID), ids[:2]...)
		assertContextFilterRelationIDs(t, readAttributeViewItemsTest(t, f.target.ID).GetValue(f.backKeyID, ids[1]), context.SourceItemID)
		if err := PerformTxSync(&Transaction{isReplay: true, DoOperations: entry.DoOperationsForReplay()}); err != nil {
			t.Fatal(err)
		}
		assertContextFilterRelationIDs(t, readAttributeViewItemsTest(t, f.source.ID).GetValue(f.keyID, context.SourceItemID), ids[1])
	}
}

func TestRelationDetailSelfMembershipReplayRejectsChangedAuthority(t *testing.T) {
	for _, mode := range []string{"retarget", "deleted-root-field", "disabled-detail", "deleted-root-row", "missing-public-context", "different-source-row", "different-root-carrier", "different-target-table", "different-target-row", "target-cell-changed"} {
		t.Run(mode, func(t *testing.T) {
			f, ids, context, entry, _ := setupRelationBackSelfRemoval(t, true)
			operations := entry.UndoOperationsForReplay()
			snapshotIDs := []string{f.source.ID, f.target.ID}
			source := readAttributeViewItemsTest(t, f.source.ID)
			key, _ := source.GetKey(f.keyID)
			switch mode {
			case "retarget":
				key.Relation.AvID = source.ID
			case "deleted-root-field":
				source.KeyValues = slices.DeleteFunc(source.KeyValues, func(kv *av.KeyValues) bool { return kv.Key.ID == f.keyID })
			case "disabled-detail":
				key.Relation.DetailView.Enabled = false
			case "deleted-root-row":
				primary := source.GetBlockKeyValues()
				primary.Values = slices.DeleteFunc(primary.Values, func(value *av.Value) bool { return value.BlockID == context.SourceItemID })
				for _, view := range source.Views {
					view.ItemIDs = slices.DeleteFunc(view.ItemIDs, func(id string) bool { return id == context.SourceItemID })
				}
			case "different-source-row":
				for _, operation := range operations {
					if operation.RelationContext != nil {
						changed := *operation.RelationContext
						changed.SourceItemID = f.itemIDs[0]
						operation.RelationContext = &changed
					}
				}
			case "missing-public-context":
				for _, operation := range operations {
					operation.RelationContext = nil
				}
			case "different-root-carrier":
				operations[0].BlockID = f.targetBlockID
			case "different-target-table":
				twin, err := cloneAttributeViewForFieldMutation(readAttributeViewItemsTest(t, f.target.ID))
				if err != nil {
					t.Fatal(err)
				}
				twin.ID = ast.NewNodeID()
				if err = twin.SetStorageContext(""); err != nil {
					t.Fatal(err)
				}
				if err = av.SaveAttributeView(twin); err != nil {
					t.Fatal(err)
				}
				snapshotIDs = append(snapshotIDs, twin.ID)
				operations[0].AvID = twin.ID
			case "different-target-row":
				if err := PerformTxSync(&Transaction{DoOperations: []*Operation{detailChange(f, context, ids[1:2], nil)}}); err != nil {
					t.Fatal(err)
				}
				operations[0].RowID = ids[1]
			case "target-cell-changed":
				if err := PerformTxSync(&Transaction{DoOperations: []*Operation{{Action: "updateAttrViewCell", AvID: f.target.ID,
					BlockID: f.targetBlockID, KeyID: f.backKeyID, RowID: ids[0],
					Data: &av.Value{Type: av.KeyTypeRelation, Relation: &av.ValueRelation{BlockIDs: []string{f.itemIDs[0]}}}}}}); err != nil {
					t.Fatal(err)
				}
			}
			if mode == "retarget" || mode == "deleted-root-field" || mode == "disabled-detail" || mode == "deleted-root-row" {
				if err := av.SaveAttributeView(source); err != nil {
					t.Fatal(err)
				}
			}
			before := relationCellSnapshot(t, snapshotIDs...)
			if err := PerformTxSync(&Transaction{isReplay: true, DoOperations: operations}); err == nil {
				t.Fatalf("trusted replay overwrote %s", mode)
			}
			requireRelationCellUnchanged(t, before)
		})
	}
}

func TestRelationDetailReplayRejectsExternalMembershipRemoval(t *testing.T) {
	f, ids, context := setupRelationDetailMutation(t)
	if err := PerformTxSync(&Transaction{DoOperations: []*Operation{detailChange(f, context, ids[:1], nil)}}); err != nil {
		t.Fatal(err)
	}
	op := &Operation{Action: "updateAttrViewCell", AvID: f.target.ID, BlockID: f.sourceBlockID, RowID: ids[0],
		KeyID: f.textKeyID, RelationContext: context, Data: &av.Value{Type: av.KeyTypeText, Text: &av.ValueText{Content: "Scoped edit"}}}
	entry, _ := recordSelfMembershipCellEdit(t, op, &av.Value{Type: av.KeyTypeText, Text: &av.ValueText{}})
	if err := PerformTxSync(&Transaction{DoOperations: []*Operation{detailChange(f, context, nil, ids[:1])}}); err != nil {
		t.Fatal(err)
	}
	before := relationCellSnapshot(t, f.source.ID, f.target.ID)
	if err := PerformTxSync(&Transaction{isReplay: true, DoOperations: entry.UndoOperationsForReplay()}); err == nil {
		t.Fatal("a normal target edit acquired authority over membership removed externally")
	}
	requireRelationCellUnchanged(t, before)
}

func TestRelationDetailSelfMembershipJSONCannotForgeReplayAuthority(t *testing.T) {
	f, _, _, entry, _ := setupRelationBackSelfRemoval(t, true)
	encoded, err := json.Marshal(entry.UndoOperationsForReplay())
	if err != nil || bytes.Contains(encoded, []byte("storageBoxID")) {
		t.Fatalf("private replay storage escaped serialization: %s %v", encoded, err)
	}
	for _, replay := range []bool{false, true} {
		var forged []*Operation
		if err = json.Unmarshal(encoded, &forged); err != nil {
			t.Fatal(err)
		}
		before := relationCellSnapshot(t, f.source.ID, f.target.ID)
		if err = PerformTxSync(&Transaction{fromAPI: true, isReplay: replay, DoOperations: forged}); err == nil {
			t.Fatalf("JSON operation gained authority to restore its missing source membership: replay=%v", replay)
		}
		requireRelationCellUnchanged(t, before)
	}
	if err = PerformTxSync(&Transaction{isReplay: true, DoOperations: entry.UndoOperationsForReplay()}); err != nil {
		t.Fatalf("rejecting JSON damaged the trusted native undo entry: %v", err)
	}
}

func TestRelationCellParentCreateSelfMembershipRejectsConcurrentParent(t *testing.T) {
	f, source, carrier, context := setupRelationSelfMembershipSubItems(t)
	ids := source.Views[0].ItemIDs
	cellContext := &AttributeViewRelationCellContext{RelationContext: *context, SourceItemIDs: []string{ids[1]}}
	preview := PreviewAttributeViewRelationCellItem(source.ID, carrier, source.SubItems.ParentKeyID, "Created parent", cellContext)
	result, err := CreateAttributeViewRelationCellItem(source.ID, carrier, source.SubItems.ParentKeyID, "Created parent",
		[]*AttributeViewRelationItemCell{{ItemID: ids[1]}}, preview, false, cellContext)
	if err != nil {
		t.Fatal(err)
	}
	entry := GlobalUndoLog.Peek(f.sourceID)
	if entry == nil {
		t.Fatal("parent creation omitted native history")
	}
	current := readAttributeViewItemsTest(t, source.ID)
	if err = current.SetSubItemsParents(map[string]string{ids[1]: ids[3]}); err != nil {
		t.Fatal(err)
	}
	if err = av.SaveAttributeView(current); err != nil {
		t.Fatal(err)
	}
	before := relationCellSnapshot(t, source.ID)
	if err = PerformTxSync(&Transaction{isReplay: true, DoOperations: entry.UndoOperationsForReplay()}); err == nil {
		t.Fatal("parent creation undo replaced a later parent selection")
	}
	requireRelationCellUnchanged(t, before)
	if readAttributeViewItemsTest(t, source.ID).GetBlockValue(result.ItemID) == nil {
		t.Fatal("rejected undo removed the created parent before validating current relations")
	}
}

func TestRelationDetailSelfMembershipHistoryRespectsReadonlyAdmission(t *testing.T) {
	f, _, _, entry, _ := setupRelationBackSelfRemoval(t, true)
	previousReadonly := util.ReadOnly
	t.Cleanup(func() { util.ReadOnly = previousReadonly })
	for _, scenario := range []struct {
		name     string
		role     Role
		readonly bool
	}{{"reader", RoleReader, false}, {"visitor", RoleVisitor, false}, {"readonly-kernel", RoleAdministrator, true}} {
		t.Run(scenario.name, func(t *testing.T) {
			util.ReadOnly = scenario.readonly
			before := relationCellSnapshot(t, f.source.ID, f.target.ID)
			entered := false
			engine := gin.New()
			engine.Use(func(c *gin.Context) { c.Set(RoleContextKey, scenario.role); c.Next() })
			engine.POST("/replay", CheckReadonly, func(c *gin.Context) {
				entered = true
				if err := PerformTxSync(&Transaction{isReplay: true, DoOperations: entry.UndoOperationsForReplay()}); err != nil {
					t.Errorf("unexpected execution after readonly admission: %v", err)
				}
			})
			recorder := httptest.NewRecorder()
			engine.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/replay", nil))
			var response struct {
				Code int `json:"code"`
			}
			if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || entered || response.Code != -1 {
				t.Fatalf("trusted undo bypassed readonly admission: entered=%v body=%s err=%v", entered, recorder.Body.String(), err)
			}
			requireRelationCellUnchanged(t, before)
		})
	}
}

func TestRelationDetailSameCellRetainThenRemoveSelfMembershipReplay(t *testing.T) {
	for _, scoped := range []bool{false, true} {
		t.Run(fmt.Sprintf("scoped=%v", scoped), func(t *testing.T) {
			f, ids, context := setupRelationDetailMutation(t)
			if err := PerformTxSync(&Transaction{DoOperations: []*Operation{detailChange(f, context, ids[:1], nil)}}); err != nil {
				t.Fatal(err)
			}
			blockID := f.targetBlockID
			var root *AttributeViewRelationContext
			if scoped {
				blockID, root = f.sourceBlockID, context
			}
			retained := readAttributeViewItemsTest(t, f.target.ID).GetValue(f.backKeyID, ids[0]).Clone()
			retain := &Operation{Action: "updateAttrViewCell", AvID: f.target.ID, BlockID: blockID, RowID: ids[0], KeyID: f.backKeyID,
				RelationContext: root, Data: retained.Clone()}
			remove, undoRemove, undoRetain := *retain, *retain, *retain
			remove.Data = &av.Value{Type: av.KeyTypeRelation, Relation: &av.ValueRelation{BlockIDs: []string{}}}
			undoRemove.Data, undoRetain.Data = retained.Clone(), retained.Clone()
			tx := &Transaction{fromAPI: true, DoOperations: []*Operation{retain, &remove}, UndoOperations: []*Operation{&undoRemove, &undoRetain}}
			tree, err := LoadTreeByBlockID(blockID)
			if err != nil {
				t.Fatal(err)
			}
			if !scoped {
				tx.DoOperations = append(tx.DoOperations, &Operation{Action: "doUpdateUpdated", ID: blockID, Data: util.CurrentTimeSecondsStr()})
				tx.UndoOperations = append(tx.UndoOperations, &Operation{Action: "doUpdateUpdated", ID: blockID,
					Data: treenode.GetNodeInTree(tree, blockID).IALAttr("updated")})
			}
			if err = PerformTxSync(tx); err != nil {
				t.Fatalf("retain-then-remove cell group failed: %v", err)
			}
			entry := GlobalUndoLog.Peek(tree.ID)
			if entry == nil {
				t.Fatal("same-cell group omitted native history")
			}
			assertContextFilterRelationIDs(t, readAttributeViewItemsTest(t, f.source.ID).GetValue(f.keyID, context.SourceItemID))
			for range 2 {
				replaySelfMembershipHistory(t, tree.ID, entry, true)
				assertContextFilterRelationIDs(t, readAttributeViewItemsTest(t, f.source.ID).GetValue(f.keyID, context.SourceItemID), ids[0])
				assertContextFilterRelationIDs(t, readAttributeViewItemsTest(t, f.target.ID).GetValue(f.backKeyID, ids[0]), context.SourceItemID)
				replaySelfMembershipHistory(t, tree.ID, entry, false)
				assertContextFilterRelationIDs(t, readAttributeViewItemsTest(t, f.source.ID).GetValue(f.keyID, context.SourceItemID))
				assertContextFilterRelationIDs(t, readAttributeViewItemsTest(t, f.target.ID).GetValue(f.backKeyID, ids[0]))
			}
		})
	}
}

func TestRelationDetailBulkDuplicateCausalAddressFailsClosed(t *testing.T) {
	for _, scoped := range []bool{false, true} {
		name := "native-last-write"
		if scoped {
			name = "scoped-duplicate-causal-address-rejected"
		}
		t.Run(name, func(t *testing.T) {
			f, ids, context := setupRelationDetailMutation(t)
			if err := PerformTxSync(&Transaction{DoOperations: []*Operation{detailChange(f, context, ids[:1], nil)}}); err != nil {
				t.Fatal(err)
			}
			blockID := f.targetBlockID
			var root *AttributeViewRelationContext
			if scoped {
				blockID, root = f.sourceBlockID, context
			}
			retained := readAttributeViewItemsTest(t, f.target.ID).GetValue(f.backKeyID, ids[0]).Clone()
			op := &Operation{Action: "updateAttrViewCells", AvID: f.target.ID, BlockID: blockID, RelationContext: root,
				CellUpdates: []*AttrViewCellUpdate{
					{KeyID: f.backKeyID, RowID: ids[0], Data: retained.Clone()},
					{KeyID: f.backKeyID, RowID: ids[0], Data: &av.Value{Type: av.KeyTypeRelation, Relation: &av.ValueRelation{BlockIDs: []string{}}}},
				}}
			inverse := *op
			inverse.CellUpdates = []*AttrViewCellUpdate{{KeyID: f.backKeyID, RowID: ids[0], Data: retained.Clone()},
				{KeyID: f.backKeyID, RowID: ids[0], Data: retained.Clone()}}
			tx := &Transaction{fromAPI: true, DoOperations: []*Operation{op}, UndoOperations: []*Operation{&inverse}}
			tree, err := LoadTreeByBlockID(blockID)
			if err != nil {
				t.Fatal(err)
			}
			if !scoped {
				tx.DoOperations = append(tx.DoOperations, &Operation{Action: "doUpdateUpdated", ID: blockID, Data: util.CurrentTimeSecondsStr()})
				tx.UndoOperations = append(tx.UndoOperations, &Operation{Action: "doUpdateUpdated", ID: blockID,
					Data: treenode.GetNodeInTree(tree, blockID).IALAttr("updated")})
			}
			before := relationCellSnapshot(t, f.source.ID, f.target.ID)
			type historySnapshot struct {
				undo, redo      []*UndoEntry
				exists, hasUndo bool
			}
			snapshotHistory := func() historySnapshot {
				GlobalUndoLog.mu.Lock()
				defer GlobalUndoLog.mu.Unlock()
				stack := GlobalUndoLog.stacks[tree.ID]
				if stack == nil {
					return historySnapshot{}
				}
				return historySnapshot{undo: slices.Clone(stack.undoStack), redo: slices.Clone(stack.redoStack), exists: true, hasUndo: stack.hasUndo}
			}
			historyBefore := snapshotHistory()
			err = PerformTxSync(tx)
			if scoped {
				if err == nil {
					t.Fatal("scoped bulk accepted an ambiguous duplicate causal address")
				}
				requireRelationCellUnchanged(t, before)
				historyAfter := snapshotHistory()
				if historyBefore.exists != historyAfter.exists || historyBefore.hasUndo != historyAfter.hasUndo ||
					!slices.Equal(historyBefore.undo, historyAfter.undo) || !slices.Equal(historyBefore.redo, historyAfter.redo) {
					t.Fatal("rejected duplicate-address request changed existing history")
				}
				return
			}
			if err != nil {
				t.Fatalf("native ordinary relation duplicate-address semantics changed: %v", err)
			}
			assertContextFilterRelationIDs(t, readAttributeViewItemsTest(t, f.source.ID).GetValue(f.keyID, context.SourceItemID))
			entry := GlobalUndoLog.Peek(tree.ID)
			if entry == nil {
				t.Fatal("native duplicate-address edit omitted native history")
			}
			for range 2 {
				replaySelfMembershipHistory(t, tree.ID, entry, true)
				assertContextFilterRelationIDs(t, readAttributeViewItemsTest(t, f.source.ID).GetValue(f.keyID, context.SourceItemID), ids[0])
				replaySelfMembershipHistory(t, tree.ID, entry, false)
				assertContextFilterRelationIDs(t, readAttributeViewItemsTest(t, f.source.ID).GetValue(f.keyID, context.SourceItemID))
			}
		})
	}
}

func TestRelationDetailRetainedRequestCannotClaimExternalMembershipLoss(t *testing.T) {
	f, ids, context := setupRelationDetailMutation(t)
	if err := PerformTxSync(&Transaction{DoOperations: []*Operation{detailChange(f, context, ids[:1], nil)}}); err != nil {
		t.Fatal(err)
	}
	target, err := av.ParseAttributeViewWithStorageContext(f.target.ID, "")
	if err != nil {
		t.Fatal(err)
	}
	op := &Operation{Action: "updateAttrViewCell", AvID: f.target.ID, BlockID: f.sourceBlockID, RowID: ids[0], KeyID: f.backKeyID,
		RelationContext: context, Data: target.GetValue(f.backKeyID, ids[0]).Clone()}
	inverse := *op
	inverse.Data = target.GetValue(f.backKeyID, ids[0]).Clone()
	tx := &Transaction{fromAPI: true, DoOperations: []*Operation{op}, UndoOperations: []*Operation{&inverse}}
	capture, err := tx.beginRelationCellReplay(tx.DoOperations)
	if err != nil {
		t.Fatal(err)
	}
	source, err := av.ParseAttributeViewWithStorageContext(f.source.ID, "")
	if err != nil {
		t.Fatal(err)
	}
	source.GetValue(f.keyID, context.SourceItemID).Relation.BlockIDs = []string{}
	target.GetValue(f.backKeyID, ids[0]).Relation.BlockIDs = []string{}
	for _, view := range []*av.AttributeView{source, target} {
		if err = av.SaveAttributeView(view); err != nil {
			t.Fatal(err)
		}
	}
	before := relationCellSnapshot(t, f.source.ID, f.target.ID)
	if err = tx.finishRelationCellReplay(capture); err != nil {
		t.Logf("external membership drift rejected: %v", err)
	}
	if op.relationCellReplay != nil || inverse.relationCellReplay != nil {
		t.Fatal("a request retaining the root acquired proof for an external membership loss")
	}
	requireRelationCellUnchanged(t, before)
	if err = PerformTxSync(&Transaction{isReplay: true, DoOperations: cloneOperations(tx.UndoOperations)}); err == nil {
		t.Fatal("retained request replay restored membership removed by an external write")
	}
	requireRelationCellUnchanged(t, before)
}

func checkEncryptedRelationSelfMembership(t *testing.T, f *relationItemTestFixture, itemID, boxID string) {
	t.Helper()
	type originalFile struct {
		path   string
		data   []byte
		exists bool
	}
	var originals []*av.AttributeView
	var ordinaryFiles []originalFile
	previousBoxes := map[string]string{}
	for _, id := range []string{f.source.ID, f.target.ID} {
		original, err := av.ParseAttributeViewWithStorageContext(id, boxID)
		if err != nil {
			t.Fatal(err)
		}
		originals = append(originals, original)
		_, previousBoxes[id] = av.FindAttributeViewPath(id)
		path := filepath.Join(util.DataDir, "storage", "av", id+".json")
		data, err := os.ReadFile(path)
		if err != nil && !os.IsNotExist(err) {
			t.Fatal(err)
		}
		ordinaryFiles = append(ordinaryFiles, originalFile{path: path, data: data, exists: err == nil})
	}
	defer func() {
		for _, original := range originals {
			if err := av.SaveAttributeView(original); err != nil {
				t.Error(err)
			}
		}
		for _, file := range ordinaryFiles {
			if file.exists {
				if err := os.WriteFile(file.path, file.data, 0600); err != nil {
					t.Error(err)
				}
			} else if err := os.Remove(file.path); err != nil && !os.IsNotExist(err) {
				t.Error(err)
			}
		}
		cache.ClearAVCache()
		for id, previousBox := range previousBoxes {
			av.SetAVBoxID(id, previousBox)
		}
	}()
	ordinaryBefore := map[string][]byte{}
	for _, original := range originals {
		twin, err := cloneAttributeViewForFieldMutation(original)
		if err != nil {
			t.Fatal(err)
		}
		if err = twin.SetStorageContext(""); err != nil {
			t.Fatal(err)
		}
		twin.Name = "Ordinary self-membership twin"
		if err = av.SaveAttributeView(twin); err != nil {
			t.Fatal(err)
		}
		path, _ := twin.StoragePath()
		ordinaryBefore[path], err = os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		av.SetAVBoxID(twin.ID, "")
	}
	plainBoxID, documentID, ordinaryCarrierID := ast.NewNodeID(), ast.NewNodeID(), ast.NewNodeID()
	tree := treenode.NewTree(plainBoxID, "/"+documentID+".sy", "/Ordinary proof carrier", "Ordinary proof carrier")
	carrier := &ast.Node{ID: ordinaryCarrierID, Type: ast.NodeAttributeView, AttributeViewID: f.source.ID, AttributeViewType: "table"}
	carrier.SetIALAttr("id", ordinaryCarrierID)
	tree.Root.AppendChild(carrier)
	if _, err := filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	treenode.UpsertBlockTree(tree)
	defer func() {
		treenode.RemoveBlockTreesByRootID(plainBoxID, tree.ID)
		if err := os.RemoveAll(filepath.Join(util.DataDir, plainBoxID)); err != nil {
			t.Error(err)
		}
	}()
	context := &AttributeViewRelationContext{SourceAvID: f.source.ID, SourceItemID: f.itemIDs[1], RelationKeyID: f.keyID}
	previous := originals[1].GetValue(f.backKeyID, itemID)
	if previous == nil || previous.Relation == nil || !slices.Contains(previous.Relation.BlockIDs, context.SourceItemID) {
		t.Fatal("encrypted fixture must contain the root member's reverse edge")
	}
	remaining := slices.DeleteFunc(slices.Clone(previous.Relation.BlockIDs), func(id string) bool { return id == context.SourceItemID })
	op := &Operation{Action: "updateAttrViewCell", AvID: f.target.ID, BlockID: f.sourceBlockID,
		KeyID: f.backKeyID, RowID: itemID, RelationContext: context,
		Data: &av.Value{Type: av.KeyTypeRelation, Relation: &av.ValueRelation{BlockIDs: remaining}}}
	entry, rootID := recordSelfMembershipCellEdit(t, op, previous)
	privateSource, err := av.ParseAttributeViewWithStorageContext(f.source.ID, boxID)
	if err != nil {
		t.Fatal(err)
	}
	assertContextFilterRelationIDs(t, privateSource.GetValue(f.keyID, context.SourceItemID))
	beforeRejection := map[string][]byte{}
	for _, original := range originals {
		path, _ := original.StoragePath()
		beforeRejection[path], err = os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
	}
	for _, blockID := range []string{ordinaryCarrierID, f.targetBlockID} {
		operations := entry.UndoOperationsForReplay()
		for _, operation := range operations {
			if operation.Action == "updateAttrViewCell" && operation.AvID == f.target.ID {
				operation.BlockID = blockID
			}
		}
		if err = PerformTxSync(&Transaction{isReplay: true, DoOperations: operations}); err == nil {
			t.Fatal("private self-membership proof accepted a changed carrier or encryption domain")
		}
		for path, expected := range beforeRejection {
			actual, readErr := os.ReadFile(path)
			if readErr != nil || !bytes.Equal(expected, actual) {
				t.Fatalf("rejected proof changed encrypted source %s: %v", path, readErr)
			}
		}
	}
	for range 2 {
		for _, undo := range []bool{true, false} {
			av.SetAVBoxID(f.source.ID, "")
			av.SetAVBoxID(f.target.ID, "")
			replaySelfMembershipHistory(t, rootID, entry, undo)
			currentSource, readErr := av.ParseAttributeViewWithStorageContext(f.source.ID, boxID)
			if readErr != nil {
				t.Fatal(readErr)
			}
			if undo {
				assertContextFilterRelationIDs(t, currentSource.GetValue(f.keyID, context.SourceItemID), itemID)
			} else {
				assertContextFilterRelationIDs(t, currentSource.GetValue(f.keyID, context.SourceItemID))
			}
			for path, expected := range ordinaryBefore {
				actual, readErr := os.ReadFile(path)
				if readErr != nil || !bytes.Equal(expected, actual) {
					t.Fatalf("encrypted self-membership replay changed ordinary twin %s: %v", path, readErr)
				}
			}
		}
	}
}
