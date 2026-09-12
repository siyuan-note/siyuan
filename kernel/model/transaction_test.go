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
	"encoding/json"
	"errors"
	"path/filepath"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestDoUpdateRejectsInvalidData(t *testing.T) {
	tests := []any{nil, 1, ""}
	for _, data := range tests {
		tx := &Transaction{}
		err := tx.doUpdate(&Operation{ID: "20260718000000-abcdefg", Data: data})
		if nil == err {
			t.Fatalf("expected invalid update data [%v] to be rejected", data)
		}
		if TxErrCodePushMsg != err.Code() {
			t.Fatalf("expected invalid update data [%v] to return code [%d], got [%d]", data, TxErrCodePushMsg, err.Code())
		}
	}
}

func TestTxErrFromPanic(t *testing.T) {
	if err := txErrFromPanic(1, "test"); nil == err {
		t.Fatal("expected an active transaction panic to return an error")
	}
	if err := txErrFromPanic(2, "test"); nil != err {
		t.Fatal("expected a committed transaction panic to preserve the committed result")
	}
}

func TestRecordCrossTreeMoveRefRefreshIncludesHeadingChildren(t *testing.T) {
	const (
		boxID       = "20260818000000-box0001"
		oldRootID   = "20260818000001-root001"
		newRootID   = "20260818000002-root001"
		headingID   = "20260818000003-heading"
		paragraphID = "20260818000004-parag01"
		listID      = "20260818000005-list001"
		listItemID  = "20260818000006-listitm"
		listParaID  = "20260818000007-parag02"
	)

	heading := &ast.Node{Type: ast.NodeHeading, ID: headingID}
	paragraph := &ast.Node{Type: ast.NodeParagraph, ID: paragraphID}
	list := &ast.Node{Type: ast.NodeList, ID: listID, ListData: &ast.ListData{Typ: 0}}
	listItem := &ast.Node{Type: ast.NodeListItem, ID: listItemID, ListData: &ast.ListData{Typ: 0}}
	listParagraph := &ast.Node{Type: ast.NodeParagraph, ID: listParaID}
	listItem.AppendChild(listParagraph)
	list.AppendChild(listItem)

	tx := &Transaction{}
	srcTree := &parse.Tree{ID: oldRootID, Box: boxID}
	targetTree := &parse.Tree{ID: newRootID, Box: boxID}
	tx.recordCrossTreeMoveRefRefresh(srcTree, targetTree, heading, []*ast.Node{paragraph, list})
	// 同一跨文档移动记录再次追加时应合并并去重。
	tx.recordCrossTreeMoveRefRefresh(srcTree, targetTree, heading, []*ast.Node{list})

	if 1 != len(tx.crossTreeMoveRefRefreshes) {
		t.Fatalf("unexpected refresh count: %d", len(tx.crossTreeMoveRefRefreshes))
	}
	refresh := tx.crossTreeMoveRefRefreshes[0]
	if boxID != refresh.BoxID || oldRootID != refresh.OldRootID || newRootID != refresh.NewRootID {
		t.Fatalf("unexpected refresh roots: %+v", refresh)
	}
	actual := map[string]bool{}
	for _, id := range refresh.MovedBlockIDs {
		actual[id] = true
	}
	wantIDs := []string{headingID, paragraphID, listID, listItemID, listParaID}
	if len(wantIDs) != len(refresh.MovedBlockIDs) {
		t.Fatalf("unexpected moved block IDs: %v", refresh.MovedBlockIDs)
	}
	for _, id := range wantIDs {
		if !actual[id] {
			t.Fatalf("moved block ID [%s] was not recorded: %v", id, refresh.MovedBlockIDs)
		}
	}
}

func TestCreateOperationTreeNotExposedInJSON(t *testing.T) {
	tree := &parse.Tree{
		ID:  "20260912000000-doc0001",
		Box: "20260912000000-box0001",
		Root: &ast.Node{
			ID:   "20260912000000-doc0001",
			Type: ast.NodeDocument,
		},
	}
	op := &Operation{
		Action: "create",
		Tree:   tree,
	}
	bytes, err := json.Marshal(op)
	if nil != err {
		t.Fatalf("marshal operation failed: %v", err)
	}
	if strings.Contains(string(bytes), "doc0001") {
		t.Fatalf("tree internal AST leaked into operation JSON: %s", string(bytes))
	}
}

func TestCommitSanitizesOperationTreesBeforeWrite(t *testing.T) {
	tree := &parse.Tree{ID: "20260912000000-doc0001", Root: &ast.Node{Type: ast.NodeDocument}}
	preservedTree := &parse.Tree{ID: "20260912000001-doc0002"}
	newOperations := func() []*Operation {
		return []*Operation{
			{Action: "create", Data: tree},
			{Action: "create", Data: tree, Tree: preservedTree},
			{Action: "create", Tree: tree},
			{Action: "update", Data: "block content"},
		}
	}
	tx := &Transaction{
		trees:          map[string]*parse.Tree{tree.ID: tree},
		DoOperations:   newOperations(),
		UndoOperations: newOperations(),
	}
	stop := errors.New("stop before persistence and broadcast")
	called := false
	// 在真实提交路径的写入边界检查，随后停止，避免落盘和广播。
	tx.writeTransactionTree = func(actual *parse.Tree) error {
		called = true
		if actual != tree {
			t.Fatal("unexpected transaction tree")
		}
		for _, operations := range [][]*Operation{tx.DoOperations, tx.UndoOperations} {
			for i, want := range []*parse.Tree{tree, preservedTree, tree} {
				if operations[i].Tree != want || nil != operations[i].Data {
					t.Fatalf("operation %d did not preserve Tree and clear Data", i)
				}
			}
			if operations[3].Data != "block content" {
				t.Fatal("non-tree data was changed")
			}
		}
		data, err := json.Marshal(tx)
		if nil != err {
			t.Fatal(err)
		}
		if strings.Contains(string(data), "doc000") {
			t.Fatalf("AST leaked into transaction JSON: %s", data)
		}
		return stop
	}
	if err := tx.commit(); !errors.Is(err, stop) || !called {
		t.Fatalf("expected commit to reach write boundary, got %v", err)
	}
}

func TestDoCreateAcceptsTreeAndLegacyData(t *testing.T) {
	previousPath := util.BlockTreeDBPath
	util.BlockTreeDBPath = filepath.Join(t.TempDir(), "blocktree.db")
	treenode.InitBlockTree(true)
	t.Cleanup(func() {
		treenode.CloseDatabase()
		util.BlockTreeDBPath = previousPath
		if "" != previousPath {
			treenode.InitBlockTree(false)
		}
	})
	tree := treenode.NewTree("20260912000000-box0001", "/20260912000000-doc0001.sy", "/Document", "Document")
	for _, legacy := range []bool{false, true} {
		op := &Operation{Action: "create", Tree: tree}
		if legacy {
			op.Tree, op.Data = nil, tree
		}
		tx := &Transaction{trees: map[string]*parse.Tree{}}
		if err := tx.doCreate(op); nil != err {
			t.Fatalf("create failed (legacy=%v): %v", legacy, err)
		}
		if tx.trees[tree.ID] != tree {
			t.Fatalf("create did not register tree (legacy=%v)", legacy)
		}
	}
}
