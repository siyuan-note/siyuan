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
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
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
