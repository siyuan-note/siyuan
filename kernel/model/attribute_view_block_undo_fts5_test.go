//go:build fts5

package model

import (
	"errors"
	"slices"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

func TestAttributeViewDeletedBlockUndoRedo(t *testing.T) {
	for _, mode := range []string{"block", "container", "batch"} {
		t.Run(mode, func(t *testing.T) {
			fixture, before, tx := setupAttributeViewDeletedBlockTest(t, mode)
			if err := PerformTxSync(tx); err != nil {
				t.Fatal(err)
			}
			entry := GlobalUndoLog.Peek(fixture.sourceID)
			if entry == nil || len(entry.undoOperations) <= len(tx.DoOperations) {
				t.Fatal("database restoration was not recorded after the block operations")
			}
			for cycle := 0; cycle < 3; cycle++ {
				deleted := readAttributeViewItemsTest(t, before.ID)
				for _, primary := range before.GetBlockKeyValues().Values {
					if !primary.IsDetached && deleted.GetBlockValue(primary.BlockID) != nil {
						t.Fatal("deleted block remains in the database")
					}
				}
				replayAttributeViewFieldsTest(t, entry.UndoOperationsForReplay())
				assertAttributeViewFieldsTest(t, before, readAttributeViewItemsTest(t, before.ID))
				tree, err := LoadTreeByBlockID(fixture.sourceID)
				if err != nil {
					t.Fatal(err)
				}
				for _, primary := range before.GetBlockKeyValues().Values {
					if primary.IsDetached {
						continue
					}
					node := treenode.GetNodeInTree(tree, primary.Block.ID)
					if node == nil || !strings.Contains(node.IALAttr(av.NodeAttrNameAvs), before.ID) {
						t.Fatal("restored block lost its database binding")
					}
				}
				replayAttributeViewFieldsTest(t, entry.DoOperationsForReplay())
			}
		})
	}
}

func TestAttributeViewDeletedBlockWriteFailure(t *testing.T) {
	fixture, before, tx := setupAttributeViewDeletedBlockTest(t, "container")
	tx.writeTransactionTree = func(*parse.Tree) error { return errors.New("injected block write failure") }
	if err := PerformTxSync(tx); err == nil {
		t.Fatal("failed deletion succeeded")
	}
	assertAttributeViewFieldsTest(t, before, readAttributeViewItemsTest(t, before.ID))
	tree, err := LoadTreeByBlockID(fixture.sourceID)
	if err != nil || treenode.GetNodeInTree(tree, tx.DoOperations[0].ID) == nil {
		t.Fatalf("failed deletion did not restore the document: %v", err)
	}
}

func TestAttributeViewDeletedBlockStaticText(t *testing.T) {
	fixture, before, tx := setupAttributeViewDeletedBlockTest(t, "block")
	primary := before.GetBlockKeyValues().Values[0]
	primary.Block.RefSubtype, primary.Block.Content = "s", "Static label"
	tree, err := LoadTreeByBlockID(fixture.sourceID)
	if err != nil {
		t.Fatal(err)
	}
	node := treenode.GetNodeInTree(tree, primary.Block.ID)
	node.SetIALAttr(av.NodeAttrViewStaticText+"-"+before.ID, primary.Block.Content)
	if _, err = filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	if err = av.SaveAttributeView(before); err != nil {
		t.Fatal(err)
	}
	if err := PerformTxSync(tx); err != nil {
		t.Fatal(err)
	}
	replayAttributeViewFieldsTest(t, GlobalUndoLog.Peek(fixture.sourceID).UndoOperationsForReplay())
	tree, err = LoadTreeByBlockID(fixture.sourceID)
	if err != nil {
		t.Fatal(err)
	}
	node = treenode.GetNodeInTree(tree, primary.Block.ID)
	if got := node.IALAttr(av.NodeAttrViewStaticText + "-" + before.ID); got != primary.Block.Content {
		t.Fatalf("block undo lost the static database text: %q", got)
	}
	assertAttributeViewFieldsTest(t, before, readAttributeViewItemsTest(t, before.ID))
}

func TestAttributeViewDeletedBlockPreservesLaterEdits(t *testing.T) {
	fixture, before, tx := setupAttributeViewDeletedBlockTest(t, "block")
	if err := PerformTxSync(tx); err != nil {
		t.Fatal(err)
	}
	current := readAttributeViewItemsTest(t, before.ID)
	added := before.GetBlockKeyValues().Values[1].Clone()
	added.ID, added.BlockID = ast.NewNodeID(), ast.NewNodeID()
	for _, view := range []*av.AttributeView{before, current} {
		view.Name = "Later database name"
		view.GetBlockKeyValues().Values = append(view.GetBlockKeyValues().Values, added.Clone())
		for _, layout := range view.Views {
			layout.ItemIDs = append(layout.ItemIDs, added.BlockID)
		}
	}
	if err := av.SaveAttributeView(current); err != nil {
		t.Fatal(err)
	}
	replayAttributeViewFieldsTest(t, GlobalUndoLog.Peek(fixture.sourceID).UndoOperationsForReplay())
	assertAttributeViewFieldsTest(t, before, readAttributeViewItemsTest(t, before.ID))
}

func TestAttributeViewDeletedBlockUndoConflict(t *testing.T) {
	fixture, before, tx := setupAttributeViewDeletedBlockTest(t, "block")
	if err := PerformTxSync(tx); err != nil {
		t.Fatal(err)
	}
	current := readAttributeViewItemsTest(t, before.ID)
	current.KeyValues[2].Key.Type = av.KeyTypeNumber
	if err := av.SaveAttributeView(current); err != nil {
		t.Fatal(err)
	}
	if err := PerformTxSync(&Transaction{DoOperations: GlobalUndoLog.Peek(fixture.sourceID).UndoOperationsForReplay(), isReplay: true}); err == nil {
		t.Fatal("undo overwrote a changed field type")
	}
	assertAttributeViewFieldsTest(t, current, readAttributeViewItemsTest(t, before.ID))
	tree, err := LoadTreeByBlockID(fixture.sourceID)
	if err != nil || treenode.GetNodeInTree(tree, tx.DoOperations[0].ID) != nil {
		t.Fatalf("failed undo left a partially restored block: %v", err)
	}
}

func TestAttributeViewDeletedBlockUndoRelations(t *testing.T) {
	for _, self := range []bool{false, true} {
		t.Run(map[bool]string{false: "other database", true: "same database"}[self], func(t *testing.T) {
			fixture, source, tx := setupAttributeViewDeletedBlockTest(t, "container")
			dest, backID, targetID := addDeletedBlockTestRelation(t, source, self)
			if err := PerformTxSync(tx); err != nil {
				t.Fatal(err)
			}
			entry := GlobalUndoLog.Peek(fixture.sourceID)
			for cycle := 0; cycle < 2; cycle++ {
				for _, id := range []string{source.ID, dest.ID} {
					rendered := readAttributeViewItemsTest(t, id)
					for _, view := range rendered.Views {
						sql.RenderView(rendered, view, "", false)
					}
					if err := av.SaveAttributeView(rendered); err != nil {
						t.Fatal(err)
					}
				}
				replayAttributeViewFieldsTest(t, entry.UndoOperationsForReplay())
				assertAttributeViewFieldsTest(t, source, readAttributeViewItemsTest(t, source.ID))
				back := readAttributeViewItemsTest(t, dest.ID).GetValue(backID, targetID)
				if !slices.Equal(back.Relation.BlockIDs, dest.GetValue(backID, targetID).Relation.BlockIDs) {
					t.Fatal("block undo did not restore the back relation")
				}
				replayAttributeViewFieldsTest(t, entry.DoOperationsForReplay())
			}
		})
	}
}

func addDeletedBlockTestRelation(t *testing.T, source *av.AttributeView, self bool) (*av.AttributeView, string, string) {
	t.Helper()
	dest := av.NewAttributeView(ast.NewNodeID())
	if self {
		dest = source
	} else {
		primary := source.GetBlockKeyValues().Values[3].Clone()
		primary.ID, primary.KeyID, primary.BlockID = ast.NewNodeID(), dest.GetBlockKeyValues().Key.ID, ast.NewNodeID()
		dest.GetBlockKeyValues().Values = []*av.Value{primary}
	}
	targetID := dest.GetBlockKeyValues().Values[len(dest.GetBlockKeyValues().Values)-1].BlockID
	keyID, backID := ast.NewNodeID(), ast.NewNodeID()
	relation := &av.KeyValues{Key: &av.Key{ID: keyID, Type: av.KeyTypeRelation,
		Relation: &av.Relation{AvID: dest.ID, IsTwoWay: true, BackKeyID: backID}}}
	var itemIDs []string
	for _, primary := range source.GetBlockKeyValues().Values[:2] {
		itemIDs = append(itemIDs, primary.BlockID)
		relation.Values = append(relation.Values, &av.Value{ID: ast.NewNodeID(), KeyID: keyID, BlockID: primary.BlockID,
			Type: av.KeyTypeRelation, Relation: &av.ValueRelation{BlockIDs: []string{targetID}}})
	}
	back := &av.KeyValues{Key: &av.Key{ID: backID, Type: av.KeyTypeRelation,
		Relation: &av.Relation{AvID: source.ID, IsTwoWay: true, BackKeyID: keyID}},
		Values: []*av.Value{{ID: ast.NewNodeID(), KeyID: backID, BlockID: targetID,
			Type: av.KeyTypeRelation, Relation: &av.ValueRelation{BlockIDs: itemIDs}}}}
	source.KeyValues = append(source.KeyValues, relation)
	dest.KeyValues = append(dest.KeyValues, back)
	for _, view := range []*av.AttributeView{source, dest} {
		if err := av.SaveAttributeView(view); err != nil {
			t.Fatal(err)
		}
	}
	av.UpsertAvBackRel(source.ID, dest.ID)
	av.UpsertAvBackRel(dest.ID, source.ID)
	return dest, backID, targetID
}

func setupAttributeViewDeletedBlockTest(t *testing.T, mode string) (*fileOperationTestFixture, *av.AttributeView, *Transaction) {
	t.Helper()
	fixture, source, _, _ := setupAttributeViewItemsTest(t, false)
	tree, err := LoadTreeByBlockID(fixture.sourceID)
	if err != nil {
		t.Fatal(err)
	}
	var nodes []*ast.Node
	count := 1
	if mode == "container" {
		count = 2
	} else if mode == "batch" {
		count = 32
	}
	for i := 0; i < count; i++ {
		node := treenode.NewParagraph(ast.NewNodeID())
		node.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("Bound paragraph")})
		if i < len(source.GetBlockKeyValues().Values) {
			primary := source.GetBlockKeyValues().Values[i]
			primary.IsDetached, primary.Block.ID = false, node.ID
			primary.Block.Content, primary.Block.RefSubtype = "Bound paragraph", "d"
			node.SetIALAttr(av.NodeAttrNameAvs, source.ID)
		}
		tree.Root.AppendChild(node)
		nodes = append(nodes, node)
	}
	if mode == "container" {
		container := &ast.Node{Type: ast.NodeBlockquote, ID: ast.NewNodeID()}
		container.SetIALAttr("id", container.ID)
		tree.Root.AppendChild(container)
		for _, node := range nodes {
			node.Unlink()
			container.AppendChild(node)
		}
		nodes = []*ast.Node{container}
	}
	if _, err = filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	treenode.UpsertBlockTree(tree)
	sql.IndexTreeQueue(tree)
	sql.FlushQueue()
	if err = av.SaveAttributeView(source); err != nil {
		t.Fatal(err)
	}
	tx := &Transaction{fromAPI: true}
	for _, node := range nodes {
		tx.DoOperations = append(tx.DoOperations, &Operation{Action: "delete", ID: node.ID})
		tx.UndoOperations = append(tx.UndoOperations, &Operation{Action: "insert", ID: node.ID,
			PreviousID: node.Previous.ID, Data: GetBlockDOM(node.ID)})
	}
	return fixture, readAttributeViewItemsTest(t, source.ID), tx
}
