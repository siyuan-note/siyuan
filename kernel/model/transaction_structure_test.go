// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package model

import (
	"errors"
	"path/filepath"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func setupStructureTransactionTest(t *testing.T) *fileOperationTestFixture {
	originalHistoryDir := util.HistoryDir
	util.HistoryDir = filepath.Join(t.TempDir(), "history")
	t.Cleanup(func() {
		util.HistoryDir = originalHistoryDir
	})
	return setupFileOperationTest(t)
}

func addOrderedListForStructureTest(t *testing.T, rootID string) (listID, itemID string) {
	tree, err := LoadTreeByBlockID(rootID)
	if nil != err {
		t.Fatalf("load test tree failed: %s", err)
	}

	listID = "20260808000000-list001"
	itemID = "20260808000000-item001"
	paragraphID := "20260808000000-block01"
	list := &ast.Node{Type: ast.NodeList, ID: listID, ListData: &ast.ListData{Typ: 1}}
	item := &ast.Node{Type: ast.NodeListItem, ID: itemID, ListData: &ast.ListData{Typ: 1}}
	paragraph := treenode.NewParagraph(paragraphID)
	list.SetIALAttr("id", listID)
	item.SetIALAttr("id", itemID)
	item.AppendChild(paragraph)
	list.AppendChild(item)
	tree.Root.AppendChild(list)
	if _, err = filesys.WriteTree(tree); nil != err {
		t.Fatalf("write test tree failed: %s", err)
	}
	treenode.UpsertBlockTree(tree)
	return
}

func requireStructureTransactionError(t *testing.T, err error) {
	t.Helper()
	if nil == err {
		t.Fatal("expected invalid structure transaction to be rejected")
	}
	var txErr *TxErr
	if !errors.As(err, &txErr) {
		t.Fatalf("expected transaction error, got [%T] %v", err, err)
	}
	if TxErrCodeReloadUI != txErr.Code() {
		t.Fatalf("unexpected transaction error code: got %d, want %d", txErr.Code(), TxErrCodeReloadUI)
	}
}

func TestInsertRejectsParagraphDirectlyUnderList(t *testing.T) {
	fixture := setupStructureTransactionTest(t)
	listID, _ := addOrderedListForStructureTest(t, fixture.sourceID)
	dom := util.NewLute().Md2BlockDOM("inserted", false)
	tx := &Transaction{DoOperations: []*Operation{{
		Action:   "insert",
		ParentID: listID,
		Data:     dom,
	}}}

	requireStructureTransactionError(t, PerformTxSync(tx))

	tree, err := LoadTreeByBlockID(listID)
	if nil != err {
		t.Fatalf("reload test tree failed: %s", err)
	}
	list := treenode.GetNodeInTree(tree, listID)
	if ast.NodeListItem != list.FirstChild.Type || nil != list.FirstChild.Next {
		t.Fatal("rejected insert changed the persisted list structure")
	}
}

func TestInsertMissingTargetReturnsTransactionError(t *testing.T) {
	setupStructureTransactionTest(t)
	dom := util.NewLute().Md2BlockDOM("inserted", false)
	tx := &Transaction{DoOperations: []*Operation{{
		Action:   "insert",
		ParentID: "20260816000000-missing",
		Data:     dom,
	}}}

	requireStructureTransactionError(t, PerformTxSync(tx))
}

func TestMoveRejectsParagraphDirectlyUnderList(t *testing.T) {
	tests := []struct {
		name      string
		operation func(sourceID, listID, itemID string) *Operation
	}{
		{
			name: "parent id",
			operation: func(sourceID, listID, itemID string) *Operation {
				return &Operation{Action: "move", ID: sourceID, ParentID: listID}
			},
		},
		{
			name: "previous id",
			operation: func(sourceID, listID, itemID string) *Operation {
				return &Operation{Action: "move", ID: sourceID, ParentID: listID, PreviousID: itemID}
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			fixture := setupStructureTransactionTest(t)
			listID, itemID := addOrderedListForStructureTest(t, fixture.sourceID)
			tx := &Transaction{DoOperations: []*Operation{
				test.operation(fixture.childID, listID, itemID),
			}}

			requireStructureTransactionError(t, PerformTxSync(tx))

			tree, err := LoadTreeByBlockID(fixture.childID)
			if nil != err {
				t.Fatalf("reload test tree failed: %s", err)
			}
			paragraph := treenode.GetNodeInTree(tree, fixture.childID)
			if nil == paragraph || ast.NodeDocument != paragraph.Parent.Type {
				t.Fatal("rejected move changed the persisted paragraph parent")
			}
		})
	}
}
