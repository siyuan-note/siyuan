// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func setupTransactionSourceMirrorTest(t *testing.T, count int) (*fileOperationTestFixture, *av.AttributeView, []string) {
	t.Helper()
	fixture, view, _, _ := setupAttributeViewItemsTest(t, true)
	tree, err := LoadTreeByBlockID(fixture.sourceID)
	if err != nil {
		t.Fatal(err)
	}
	var ids []string
	for range count {
		node := &ast.Node{Type: ast.NodeAttributeView, ID: ast.NewNodeID(), AttributeViewID: view.ID, AttributeViewType: "table"}
		node.SetIALAttr("id", node.ID)
		tree.Root.AppendChild(node)
		ids = append(ids, node.ID)
	}
	if _, err = filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	treenode.UpsertBlockTree(tree)
	sql.IndexTreeQueue(tree)
	sql.FlushQueue()
	for _, id := range ids {
		av.UpsertBlockRel(view.ID, id)
	}
	return fixture, view, ids
}

func TestTransactionSourceMirrorDeletionStagesBindings(t *testing.T) {
	for _, count := range []int{1, 2} {
		t.Run(map[int]string{1: "single", 2: "all-mirrors"}[count], func(t *testing.T) {
			fixture, view, ids := setupTransactionSourceMirrorTest(t, count)
			before, err := os.ReadFile(filepath.Join(util.DataDir, fixture.box.ID, fixture.targetPath))
			if err != nil {
				t.Fatal(err)
			}
			tx := &Transaction{fromAPI: true}
			for _, id := range ids {
				tx.DoOperations = append(tx.DoOperations, &Operation{Action: "delete", ID: id})
			}
			tx.writeTransactionTree = func(tree *parse.Tree) error {
				if tree.ID == fixture.targetID {
					current, err := os.ReadFile(filepath.Join(util.DataDir, tree.Box, tree.Path))
					if err != nil || !bytes.Equal(current, before) {
						t.Fatal("binding was saved before transaction commit", err)
					}
				}
				return writeTreeUpsertQueue(tree)
			}
			if err = PerformTxSync(tx); err != nil {
				t.Fatal(err)
			}
			tree, _, err := filesys.ReadTreeSnapshot(fixture.box.ID, fixture.targetPath)
			if err != nil || tree.Root.IALAttr(av.NodeAttrNameAvs) != "" {
				t.Fatal("deletion retained binding", err)
			}
			updated := false
			for _, op := range tx.DoOperations {
				if op.Action == "updateAttrs" && op.ID == fixture.targetID {
					attrs := op.Data.(map[string]any)
					if attrs["old"].(map[string]string)[av.NodeAttrNameAvs] != view.ID || attrs["new"].(map[string]string)[av.NodeAttrNameAvs] != "" {
						t.Fatal("binding notification lost before/after attributes")
					}
					updated = true
				}
			}
			if !updated {
				t.Fatal("binding update was not published after commit")
			}
		})
	}
}

func TestTransactionSourceMirrorFailureRestoresRelations(t *testing.T) {
	for _, count := range []int{1, 2} {
		t.Run(map[int]string{1: "single", 2: "all-mirrors"}[count], func(t *testing.T) {
			fixture, view, ids := setupTransactionSourceMirrorTest(t, count)
			before, err := os.ReadFile(filepath.Join(util.DataDir, fixture.box.ID, fixture.targetPath))
			if err != nil {
				t.Fatal(err)
			}
			tx := &Transaction{fromAPI: true}
			for _, id := range ids {
				tx.DoOperations = append(tx.DoOperations, &Operation{Action: "delete", ID: id})
			}
			tx.writeTransactionTree = func(*parse.Tree) error { return errors.New("injected source save failure") }
			if err = PerformTxSync(tx); err == nil {
				t.Fatal("expected source save failure")
			}
			if tx.sourceRollbackErr != nil {
				t.Fatal(tx.sourceRollbackErr)
			}
			current, err := os.ReadFile(filepath.Join(util.DataDir, fixture.box.ID, fixture.targetPath))
			if err != nil || !bytes.Equal(before, current) {
				t.Fatal("binding was not restored", err)
			}
			source, _, err := filesys.ReadTreeSnapshot(fixture.box.ID, fixture.sourcePath)
			if err != nil {
				t.Fatal(err)
			}
			rels, err := av.GetBlockRelsByAVIDs([]string{view.ID})
			if err != nil {
				t.Fatal(err)
			}
			for _, id := range ids {
				if treenode.GetNodeInTree(source, id) == nil || !slices.Contains(rels[view.ID], id) {
					t.Fatal("rollback lost carrier or mirror relation", id)
				}
			}
			for _, op := range tx.DoOperations {
				if op.Action == "updateAttrs" {
					t.Fatal("failed transaction published binding update")
				}
			}
		})
	}
}

func TestTransactionSourceMirrorDeleteUndoRestoresBindings(t *testing.T) {
	fixture, view, ids := setupTransactionSourceMirrorTest(t, 1)
	tree, err := LoadTreeByBlockID(fixture.sourceID)
	if err != nil {
		t.Fatal(err)
	}
	node := treenode.GetNodeInTree(tree, ids[0])
	undo := &Operation{Action: "insert", ID: node.ID, PreviousID: node.Previous.ID, Data: GetBlockDOM(node.ID)}
	tx := &Transaction{fromAPI: true, DoOperations: []*Operation{{Action: "delete", ID: node.ID}}, UndoOperations: []*Operation{undo}}
	if err = PerformTxSync(tx); err != nil {
		t.Fatal(err)
	}
	if err = PerformTxSync(&Transaction{isReplay: true, DoOperations: []*Operation{undo}}); err != nil {
		t.Fatal(err)
	}
	bound, _, err := filesys.ReadTreeSnapshot(fixture.box.ID, fixture.targetPath)
	if err != nil || bound.Root.IALAttr(av.NodeAttrNameAvs) != view.ID {
		t.Fatal("undo lost the bound document attribute", err)
	}
	rels, err := av.GetBlockRelsByAVIDs([]string{view.ID})
	if err != nil || !slices.Contains(rels[view.ID], ids[0]) {
		t.Fatal("undo lost the database mirror", err)
	}
}

func TestTransactionSourceMirrorDeletionPreservesMissingBindingCompatibility(t *testing.T) {
	_, view, ids := setupTransactionSourceMirrorTest(t, 1)
	value := view.GetBlockKeyValues().Values[0]
	value.IsDetached, value.Block.ID = false, ast.NewNodeID()
	if err := av.SaveAttributeView(view); err != nil {
		t.Fatal(err)
	}
	if err := PerformTxSync(&Transaction{fromAPI: true, DoOperations: []*Operation{{Action: "delete", ID: ids[0]}}}); err != nil {
		t.Fatal("missing bound block prevented deleting database carrier", err)
	}
}

func TestTransactionSourceMirrorDeletionRejectsUnreadableBinding(t *testing.T) {
	f, view, ids := setupTransactionSourceMirrorTest(t, 1)
	name := filepath.Join(util.DataDir, f.box.ID, f.targetPath)
	corrupt := []byte("invalid document source")
	if err := os.WriteFile(name, corrupt, 0600); err != nil {
		t.Fatal(err)
	}
	tx := &Transaction{fromAPI: true, DoOperations: []*Operation{{Action: "delete", ID: ids[0]}}}
	if err := PerformTxSync(tx); err == nil {
		t.Fatal("invalid bound source was ignored")
	}
	actual, err := os.ReadFile(name)
	if err != nil || !bytes.Equal(actual, corrupt) {
		t.Fatal("invalid source was overwritten", err)
	}
	rels, err := av.GetBlockRelsByAVIDs([]string{view.ID})
	if err != nil || !slices.Contains(rels[view.ID], ids[0]) {
		t.Fatal("failed deletion lost mirror relation", err)
	}
}
