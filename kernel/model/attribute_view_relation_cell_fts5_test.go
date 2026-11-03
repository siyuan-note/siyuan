// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type relationCellTestFixture struct {
	*relationItemTestFixture
	third                     *av.AttributeView
	memberIDs, candidateIDs   []string
	cellKeyID, thirdBackKeyID string
	context                   *AttributeViewRelationCellContext
}

func setupRelationCellTest(t *testing.T) *relationCellTestFixture {
	t.Helper()
	f, ids, root := setupRelationDetailMutation(t)
	if err := PerformTxSync(&Transaction{DoOperations: []*Operation{detailChange(f, root, ids[:2], nil)}}); err != nil {
		t.Fatal(err)
	}
	f.target = readAttributeViewItemsTest(t, f.target.ID)
	third := av.NewAttributeView(ast.NewNodeID())
	keyID, backKeyID := ast.NewNodeID(), ast.NewNodeID()
	f.target.KeyValues = append(f.target.KeyValues, &av.KeyValues{Key: &av.Key{ID: keyID, Name: "Nested relation", Type: av.KeyTypeRelation,
		Relation: &av.Relation{AvID: third.ID, IsTwoWay: true, BackKeyID: backKeyID}}})
	third.KeyValues = append(third.KeyValues, &av.KeyValues{Key: &av.Key{ID: backKeyID, Name: "Back to members", Type: av.KeyTypeRelation,
		Relation: &av.Relation{AvID: f.target.ID, IsTwoWay: true, BackKeyID: keyID}}})
	candidates := []string{ast.NewNodeID(), ast.NewNodeID(), ast.NewNodeID(), ast.NewNodeID()}
	for i, content := range []string{"Selected outside filter", "Allowed A", "Allowed B", "Allowed C"} {
		third.GetBlockKeyValues().Values = append(third.GetBlockKeyValues().Values, &av.Value{ID: ast.NewNodeID(), KeyID: third.GetBlockKey().ID,
			BlockID: candidates[i], Type: av.KeyTypeBlock, IsDetached: true, Block: &av.ValueBlock{Content: content}})
	}
	third.Views[0].ItemIDs = slices.Clone(candidates)
	for _, database := range []*av.AttributeView{f.target, third} {
		if err := database.SetStorageContext(""); err != nil {
			t.Fatal(err)
		}
		if err := av.SaveAttributeView(database); err != nil {
			t.Fatal(err)
		}
	}
	t.Cleanup(func() { av.SetAVBoxID(third.ID, "") })
	return &relationCellTestFixture{relationItemTestFixture: f, third: third, memberIDs: ids, candidateIDs: candidates,
		cellKeyID: keyID, thirdBackKeyID: backKeyID,
		context: &AttributeViewRelationCellContext{RelationContext: *root, SourceItemIDs: slices.Clone(ids[:2])}}
}

func (f *relationCellTestFixture) cells() []*AttributeViewRelationItemCell {
	ret := make([]*AttributeViewRelationItemCell, len(f.context.SourceItemIDs))
	for i, id := range f.context.SourceItemIDs {
		ret[i] = &AttributeViewRelationItemCell{ItemID: id}
	}
	return ret
}

func relationCellSnapshot(t *testing.T, ids ...string) map[string][]byte {
	t.Helper()
	ret := map[string][]byte{}
	for _, id := range ids {
		data, err := av.ReadAttributeViewData(id)
		if err != nil {
			t.Fatal(err)
		}
		ret[id] = data
	}
	return ret
}

func requireRelationCellUnchanged(t *testing.T, before map[string][]byte) {
	t.Helper()
	for id, data := range before {
		actual, err := av.ReadAttributeViewData(id)
		if err != nil || !bytes.Equal(actual, data) {
			t.Fatalf("rejected relation cell operation changed %s: %v", id, err)
		}
	}
}

func TestRelationCellCandidatesFilterSelectionAndPaging(t *testing.T) {
	f := setupRelationCellTest(t)
	key, _ := f.target.GetKey(f.cellKeyID)
	key.Relation.CandidateFilters = []*av.ViewFilter{{Column: f.third.GetBlockKey().ID, Operator: av.FilterOperatorContains,
		Value: &av.Value{Type: av.KeyTypeBlock, Block: &av.ValueBlock{Content: "Allowed"}}}}
	if err := av.SaveAttributeView(f.target); err != nil {
		t.Fatal(err)
	}
	before := relationCellSnapshot(t, f.source.ID, f.target.ID, f.third.ID)
	for page := 1; page <= 3; page++ {
		_, carriers, _, columns, selected, rows, total, err := GetAttributeViewRelationCellCandidates(f.target.ID, f.cellKeyID,
			f.sourceBlockID, "Allowed", []string{f.candidateIDs[0]}, page, 1,
			&av.ViewSort{Column: f.third.GetBlockKey().ID, Order: av.SortOrderAsc}, nil, f.context)
		if err != nil || total != 3 || len(rows) != 1 || rows[0].ID != f.candidateIDs[page] ||
			len(selected) != 1 || selected[0].ID != f.candidateIDs[0] || len(columns) == 0 || len(carriers) != 0 {
			t.Fatalf("page %d lost target filtering, selected values, or carrierless identity: total=%d rows=%+v selected=%+v carriers=%v err=%v",
				page, total, rows, selected, carriers, err)
		}
	}
	_, _, _, _, selected, rows, total, err := GetAttributeViewRelationCellCandidates(f.target.ID, f.cellKeyID, "", "",
		[]string{f.candidateIDs[0]}, 1, -1, nil, []string{f.candidateIDs[2]}, f.context)
	if err != nil || total != 2 || len(rows) != 2 || len(selected) != 1 || selected[0].ID != f.candidateIDs[0] {
		t.Fatalf("carrierless candidate exclusion lost the root scope: total=%d rows=%+v selected=%+v err=%v", total, rows, selected, err)
	}
	if key.Relation.DetailView != nil {
		t.Fatal("fixture must exercise a relation field without detail enabled")
	}
	requireRelationCellUnchanged(t, before)
}

func TestRelationCellCreateBatchPreservesCurrentValuesAndReplay(t *testing.T) {
	for _, count := range []int{1, 2} {
		t.Run(string(rune('0'+count)), func(t *testing.T) {
			f := setupRelationCellTest(t)
			f.context.SourceItemIDs = f.context.SourceItemIDs[:count]
			preview := PreviewAttributeViewRelationCellItem(f.target.ID, f.sourceBlockID, f.cellKeyID, "Created once", f.context)
			if preview.Error != "" {
				t.Fatal(preview.Error)
			}
			current := readAttributeViewItemsTest(t, f.target.ID)
			values, _ := current.GetKeyValues(f.cellKeyID)
			for _, id := range f.context.SourceItemIDs {
				values.Values = append(values.Values, &av.Value{ID: ast.NewNodeID(), KeyID: f.cellKeyID, BlockID: id,
					Type: av.KeyTypeRelation, Relation: &av.ValueRelation{BlockIDs: []string{f.candidateIDs[1]}}})
			}
			if err := av.SaveAttributeView(current); err != nil {
				t.Fatal(err)
			}
			cells := f.cells()
			for _, cell := range cells {
				cell.RelatedItemIDs = []string{f.candidateIDs[0], ast.NewNodeID()}
			}
			created, err := CreateAttributeViewRelationCellItem(f.target.ID, f.sourceBlockID, f.cellKeyID, "Created once", cells, preview, false, f.context)
			if err != nil || created == nil || created.Transaction == nil || !created.IsDetached {
				t.Fatalf("cell create failed: %+v %v", created, err)
			}
			assertCreated := func() {
				t.Helper()
				third := readAttributeViewItemsTest(t, f.third.ID)
				if len(third.GetBlockKeyValues().Values) != len(f.candidateIDs)+1 || third.GetBlockValue(created.ItemID) == nil {
					t.Fatal("batch creation did not create exactly one target entry")
				}
				current := readAttributeViewItemsTest(t, f.target.ID)
				for _, id := range f.context.SourceItemIDs {
					assertContextFilterRelationIDs(t, current.GetValue(f.cellKeyID, id), f.candidateIDs[1], created.ItemID)
				}
				assertContextFilterRelationIDs(t, third.GetValue(f.thirdBackKeyID, created.ItemID), f.context.SourceItemIDs...)
				assertContextFilterRelationIDs(t, readAttributeViewItemsTest(t, f.source.ID).GetValue(f.keyID, f.context.RelationContext.SourceItemID), f.memberIDs[:2]...)
			}
			assertCreated()
			entry := GlobalUndoLog.Peek(f.files.sourceID)
			if entry == nil {
				t.Fatal("creation omitted the real root document undo log")
			}
			found := false
			for _, op := range entry.DoOperationsForReplay() {
				if op.Action == "updateAttrViewRelationItems" && op.AvID == f.target.ID {
					found = true
					if op.BlockID != f.sourceBlockID || op.relationCellContext == nil {
						t.Fatal("cell operation lost root authority or its private replay scope")
					}
				}
			}
			if !found {
				t.Fatal("root undo log contains no cell creation delta")
			}
			encoded, err := json.Marshal(created.Transaction)
			if err != nil || bytes.Contains(encoded, []byte("relationCellContext")) || bytes.Contains(encoded, []byte("storageBoxID")) {
				t.Fatalf("private replay scope leaked to the client: %s %v", encoded, err)
			}
			for range 2 {
				if err := PerformTxSync(&Transaction{DoOperations: entry.UndoOperationsForReplay(), isReplay: true}); err != nil {
					t.Fatal(err)
				}
				if readAttributeViewItemsTest(t, f.third.ID).GetBlockValue(created.ItemID) != nil {
					t.Fatal("undo retained the created third-table entry")
				}
				for _, id := range f.context.SourceItemIDs {
					assertContextFilterRelationIDs(t, readAttributeViewItemsTest(t, f.target.ID).GetValue(f.cellKeyID, id), f.candidateIDs[1])
				}
				if err := PerformTxSync(&Transaction{DoOperations: entry.DoOperationsForReplay(), isReplay: true}); err != nil {
					t.Fatal(err)
				}
				assertCreated()
			}
		})
	}
}

func TestRelationCellRejectsInvalidSourcesWithoutMutation(t *testing.T) {
	f := setupRelationCellTest(t)
	preview := PreviewAttributeViewRelationCellItem(f.target.ID, f.sourceBlockID, f.cellKeyID, "Rejected", f.context)
	if preview.Error != "" {
		t.Fatal(preview.Error)
	}
	for _, test := range []struct {
		name   string
		change func(*AttributeViewRelationCellContext, *[]*AttributeViewRelationItemCell, *string, *string, *string)
	}{
		{"no source rows", func(c *AttributeViewRelationCellContext, _ *[]*AttributeViewRelationItemCell, _, _, _ *string) {
			c.SourceItemIDs = nil
		}},
		{"duplicate source rows", func(c *AttributeViewRelationCellContext, _ *[]*AttributeViewRelationItemCell, _, _, _ *string) {
			c.SourceItemIDs[1] = c.SourceItemIDs[0]
		}},
		{"nonmember source row", func(c *AttributeViewRelationCellContext, cells *[]*AttributeViewRelationItemCell, _, _, _ *string) {
			c.SourceItemIDs[1] = f.memberIDs[2]
			(*cells)[1].ItemID = f.memberIDs[2]
		}},
		{"missing source row", func(c *AttributeViewRelationCellContext, cells *[]*AttributeViewRelationItemCell, _, _, _ *string) {
			c.SourceItemIDs[1] = ast.NewNodeID()
			(*cells)[1].ItemID = c.SourceItemIDs[1]
		}},
		{"wrong request table", func(_ *AttributeViewRelationCellContext, _ *[]*AttributeViewRelationItemCell, id, _, _ *string) {
			*id = f.source.ID
		}},
		{"nonrelation key", func(_ *AttributeViewRelationCellContext, _ *[]*AttributeViewRelationItemCell, _, key, _ *string) {
			*key = f.textKeyID
		}},
		{"foreign real carrier", func(_ *AttributeViewRelationCellContext, _ *[]*AttributeViewRelationItemCell, _, _, block *string) {
			*block = f.targetBlockID
		}},
		{"missing cell", func(_ *AttributeViewRelationCellContext, cells *[]*AttributeViewRelationItemCell, _, _, _ *string) {
			*cells = (*cells)[:1]
		}},
		{"duplicate cells", func(_ *AttributeViewRelationCellContext, cells *[]*AttributeViewRelationItemCell, _, _, _ *string) {
			(*cells)[1].ItemID = (*cells)[0].ItemID
		}},
		{"extra cell", func(_ *AttributeViewRelationCellContext, cells *[]*AttributeViewRelationItemCell, _, _, _ *string) {
			*cells = append(*cells, &AttributeViewRelationItemCell{ItemID: f.memberIDs[2]})
		}},
		{"nil cell", func(_ *AttributeViewRelationCellContext, cells *[]*AttributeViewRelationItemCell, _, _, _ *string) {
			(*cells)[1] = nil
		}},
	} {
		t.Run(test.name, func(t *testing.T) {
			context := *f.context
			context.SourceItemIDs = slices.Clone(f.context.SourceItemIDs)
			cells := f.cells()
			id, key, block := f.target.ID, f.cellKeyID, f.sourceBlockID
			test.change(&context, &cells, &id, &key, &block)
			before := relationCellSnapshot(t, f.source.ID, f.target.ID, f.third.ID)
			if _, err := CreateAttributeViewRelationCellItem(id, block, key, "Rejected", cells, preview, false, &context); err == nil {
				t.Fatal("invalid cell context was accepted")
			}
			requireRelationCellUnchanged(t, before)
		})
	}
	if err := PerformTxSync(&Transaction{DoOperations: []*Operation{detailChange(f.relationItemTestFixture, &f.context.RelationContext, nil, f.memberIDs[1:2])}}); err != nil {
		t.Fatal(err)
	}
	before := relationCellSnapshot(t, f.source.ID, f.target.ID, f.third.ID)
	if _, err := CreateAttributeViewRelationCellItem(f.target.ID, f.sourceBlockID, f.cellKeyID, "Rejected", f.cells(), preview, false, f.context); err == nil {
		t.Fatal("membership removed after preview was accepted")
	}
	if _, _, _, _, _, _, _, err := GetAttributeViewRelationCellCandidates(f.target.ID, f.cellKeyID, f.sourceBlockID, "", nil, 1, -1, nil, nil, f.context); err == nil {
		t.Fatal("candidate read accepted removed source membership")
	}
	requireRelationCellUnchanged(t, before)
}

func TestRelationCellReplayRechecksRootMembership(t *testing.T) {
	f := setupRelationCellTest(t)
	preview := PreviewAttributeViewRelationCellItem(f.target.ID, f.sourceBlockID, f.cellKeyID, "Replay scope", f.context)
	created, err := CreateAttributeViewRelationCellItem(f.target.ID, f.sourceBlockID, f.cellKeyID, "Replay scope", f.cells(), preview, false, f.context)
	if err != nil {
		t.Fatal(err)
	}
	if err = PerformTxSync(&Transaction{DoOperations: cloneOperations(created.Transaction.UndoOperations), isReplay: true}); err != nil {
		t.Fatal(err)
	}
	if err = PerformTxSync(&Transaction{DoOperations: []*Operation{detailChange(f.relationItemTestFixture, &f.context.RelationContext, nil, f.memberIDs[1:2])}}); err != nil {
		t.Fatal(err)
	}
	before := relationCellSnapshot(t, f.source.ID, f.target.ID, f.third.ID)
	if err = PerformTxSync(&Transaction{DoOperations: cloneOperations(created.Transaction.DoOperations), isReplay: true}); err == nil {
		t.Fatal("redo used membership captured before removal")
	}
	requireRelationCellUnchanged(t, before)
}

func TestRelationCellDeltaRechecksMembershipDuringTransaction(t *testing.T) {
	f := setupRelationCellTest(t)
	rowContext := &AttributeViewRelationContext{SourceAvID: f.target.ID, SourceItemID: f.memberIDs[0], RelationKeyID: f.cellKeyID}
	op := &Operation{Action: "updateAttrViewRelationItems", AvID: f.target.ID, BlockID: f.sourceBlockID,
		KeyID: f.cellKeyID, RowID: f.memberIDs[0], relationCellContext: f.context, relationDetailContext: rowContext,
		Data: AttributeViewRelationItemsChange{AddItemIDs: []string{f.candidateIDs[1]}}}
	before := relationCellSnapshot(t, f.source.ID, f.target.ID, f.third.ID)
	remove := detailChange(f.relationItemTestFixture, &f.context.RelationContext, nil, f.memberIDs[:1])
	if err := PerformTxSync(&Transaction{DoOperations: []*Operation{remove, op}}); err == nil {
		t.Fatal("cell delta used membership validated before another operation removed it")
	}
	requireRelationCellUnchanged(t, before)
	rowContext.SourceItemID, op.RowID = f.memberIDs[2], f.memberIDs[2]
	if err := PerformTxSync(&Transaction{DoOperations: []*Operation{op}}); err == nil {
		t.Fatal("private cell scope authorized a different row")
	}
	requireRelationCellUnchanged(t, before)
}

func TestRelationCellParentCreateReplacesCurrentParent(t *testing.T) {
	f := setupRelationCellTest(t)
	target := readAttributeViewItemsTest(t, f.target.ID)
	parentKey, childrenKey := ast.NewNodeID(), ast.NewNodeID()
	target.SubItems = &av.SubItemsConfig{Enabled: true, ParentKeyID: parentKey, ChildrenKeyID: childrenKey}
	target.KeyValues = append(target.KeyValues,
		&av.KeyValues{Key: &av.Key{ID: parentKey, Type: av.KeyTypeRelation, Relation: &av.Relation{AvID: target.ID, IsTwoWay: true, BackKeyID: childrenKey}}},
		&av.KeyValues{Key: &av.Key{ID: childrenKey, Type: av.KeyTypeRelation, Relation: &av.Relation{AvID: target.ID, IsTwoWay: true, BackKeyID: parentKey}}})
	if err := target.SetSubItemsParents(map[string]string{f.memberIDs[0]: f.memberIDs[2], f.memberIDs[1]: f.memberIDs[2]}); err != nil {
		t.Fatal(err)
	}
	if err := av.SaveAttributeView(target); err != nil {
		t.Fatal(err)
	}
	preview := PreviewAttributeViewRelationCellItem(target.ID, f.sourceBlockID, parentKey, "New shared parent", f.context)
	created, err := CreateAttributeViewRelationCellItem(target.ID, f.sourceBlockID, parentKey, "New shared parent", f.cells(), preview, false, f.context)
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range f.context.SourceItemIDs {
		assertSubItemsParent(t, target.ID, id, created.ItemID)
		assertContextFilterRelationIDs(t, readAttributeViewItemsTest(t, target.ID).GetValue(parentKey, id), created.ItemID)
	}
	if err = PerformTxSync(&Transaction{DoOperations: cloneOperations(created.Transaction.UndoOperations), isReplay: true}); err != nil {
		t.Fatal(err)
	}
	for _, id := range f.context.SourceItemIDs {
		assertSubItemsParent(t, target.ID, id, f.memberIDs[2])
	}
	if readAttributeViewItemsTest(t, target.ID).GetBlockValue(created.ItemID) != nil {
		t.Fatal("parent creation undo retained the newly created parent")
	}
}

func TestRelationCellChildrenBatchCreateMatchesNativeRejection(t *testing.T) {
	f := setupRelationCellTest(t)
	target := readAttributeViewItemsTest(t, f.target.ID)
	parentKey, childrenKey := ast.NewNodeID(), ast.NewNodeID()
	target.SubItems = &av.SubItemsConfig{Enabled: true, ParentKeyID: parentKey, ChildrenKeyID: childrenKey}
	target.KeyValues = append(target.KeyValues,
		&av.KeyValues{Key: &av.Key{ID: parentKey, Type: av.KeyTypeRelation, Relation: &av.Relation{AvID: target.ID, IsTwoWay: true, BackKeyID: childrenKey}}},
		&av.KeyValues{Key: &av.Key{ID: childrenKey, Type: av.KeyTypeRelation, Relation: &av.Relation{AvID: target.ID, IsTwoWay: true, BackKeyID: parentKey}}})
	if err := av.SaveAttributeView(target); err != nil {
		t.Fatal(err)
	}
	before := relationCellSnapshot(t, f.source.ID, target.ID, f.third.ID)
	preview := PreviewAttributeViewRelationItem(target.ID, f.targetBlockID, childrenKey, "Shared child")
	if preview.Error != "" {
		t.Fatal(preview.Error)
	}
	if _, err := CreateAttributeViewRelationItem(target.ID, f.targetBlockID, childrenKey, "Shared child", f.cells(), preview, false); err == nil {
		t.Fatal("native children batch assigned the new child to multiple parents")
	}
	requireRelationCellUnchanged(t, before)
	if scoped := PreviewAttributeViewRelationCellItem(target.ID, f.sourceBlockID, childrenKey, "Shared child", f.context); scoped.Error == "" {
		t.Fatal("cell preview offered a new child with multiple parents")
	}
	if _, err := CreateAttributeViewRelationCellItem(target.ID, f.sourceBlockID, childrenKey, "Shared child", f.cells(), preview, false, f.context); err == nil {
		t.Fatal("cell batch sequentially reparented one new child between selected parents")
	}
	requireRelationCellUnchanged(t, before)
	if _, _, _, _, _, _, _, err := GetAttributeViewRelationCellCandidates(target.ID, childrenKey, f.sourceBlockID, "", nil, 1, -1, nil, nil, f.context); err != nil {
		t.Fatalf("children batch guard unnecessarily blocked candidate reads: %v", err)
	}
}

func TestRelationCellDocumentTargetContextAndCleanup(t *testing.T) {
	for _, mode := range []string{"real-carrier", "carrierless-explicit-notebook", "carrierless-no-notebook", "link-failure"} {
		t.Run(mode, func(t *testing.T) {
			f := setupRelationCellTest(t)
			template := &av.NewItemTemplate{ID: ast.NewNodeID(), Name: "Third-table default", TargetType: av.NewItemTargetDocument,
				PrimaryKeyTemplate: "Third-table document"}
			if mode == "real-carrier" {
				tree, err := LoadTreeByBlockID(f.targetBlockID)
				if err != nil {
					t.Fatal(err)
				}
				carrier := &ast.Node{ID: ast.NewNodeID(), Type: ast.NodeAttributeView, AttributeViewID: f.third.ID, AttributeViewType: "table"}
				carrier.SetIALAttr("id", carrier.ID)
				tree.Root.AppendChild(carrier)
				if _, err = filesys.WriteTree(tree); err != nil {
					t.Fatal(err)
				}
				treenode.UpsertBlockTree(tree)
				av.BatchUpsertBlockRel([]*ast.Node{carrier})
			} else if mode != "carrierless-no-notebook" {
				template.SaveLocation = &av.NewItemSaveLocation{BoxID: f.files.box.ID, PathTemplate: "/Cell-owned parent/"}
			}
			if err := f.third.SetNewItemTemplates(&av.NewItemTemplatesConfig{Templates: []*av.NewItemTemplate{template}, DefaultTemplateID: template.ID}); err != nil {
				t.Fatal(err)
			}
			if err := av.SaveAttributeView(f.third); err != nil {
				t.Fatal(err)
			}
			preview := PreviewAttributeViewRelationCellItem(f.target.ID, f.sourceBlockID, f.cellKeyID, "Input", f.context)
			if mode == "carrierless-no-notebook" {
				if preview.Error == "" {
					t.Fatal("carrierless U borrowed the root source notebook")
				}
				return
			}
			if preview.Error != "" || preview.TemplateID != template.ID || preview.PrimaryKey != template.PrimaryKeyTemplate {
				t.Fatalf("preview did not use U's default template: %+v", preview)
			}
			if mode == "link-failure" {
				key, _ := f.target.GetKey(f.cellKeyID)
				key.Relation.CandidateFilters = []*av.ViewFilter{{Column: f.third.GetBlockKey().ID, Operator: av.FilterOperatorContains,
					Value: &av.Value{Type: av.KeyTypeBlock, Block: &av.ValueBlock{Content: "Not eligible"}}}}
				if err := av.SaveAttributeView(f.target); err != nil {
					t.Fatal(err)
				}
			}
			countDocs := func() int {
				count := 0
				if err := filepath.WalkDir(filepath.Join(util.DataDir, f.files.box.ID), func(path string, entry os.DirEntry, err error) error {
					if err == nil && !entry.IsDir() && filepath.Ext(path) == ".sy" {
						count++
					}
					return err
				}); err != nil {
					t.Fatal(err)
				}
				return count
			}
			beforeDocs := countDocs()
			before := relationCellSnapshot(t, f.source.ID, f.target.ID, f.third.ID)
			created, err := CreateAttributeViewRelationCellItem(f.target.ID, f.sourceBlockID, f.cellKeyID, "Input", f.cells(), preview, false, f.context)
			if mode == "link-failure" {
				if err == nil || countDocs() != beforeDocs {
					t.Fatalf("rejected cell link retained its document or parent: %v", err)
				}
				requireRelationCellUnchanged(t, before)
				return
			}
			if err != nil || created == nil || created.IsDetached {
				t.Fatalf("document creation failed: %+v %v", created, err)
			}
			block := treenode.GetBlockTree(created.BlockID)
			prefix := "/Cell-owned parent/"
			if mode == "real-carrier" {
				prefix = "/Target/"
			}
			if block == nil || block.BoxID != f.files.box.ID || block.HPath != prefix+template.PrimaryKeyTemplate {
				t.Fatalf("U document inherited the wrong carrier location: %+v", block)
			}
			if entry := GlobalUndoLog.Peek(f.files.sourceID); entry == nil {
				t.Fatal("document creation omitted root authority undo log")
			}
		})
	}
}
