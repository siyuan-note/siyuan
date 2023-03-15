// SiYuan - Build Your Eternal Digital Garden
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
	"fmt"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

func RenderAttributeView(avID string) (dom string) {
	attrView, err := av.ParseAttributeView(avID)
	if nil != err {
		logging.LogErrorf("parse attribute view [%s] failed: %s", avID, err)
		return
	}

	_ = attrView
	return
}

func (tx *Transaction) doInsertAttrViewBlock(operation *Operation) (ret *TxErr) {
	firstSrcID := operation.SrcIDs[0]
	tree, err := tx.loadTree(firstSrcID)
	if nil != err {
		logging.LogErrorf("load tree [%s] failed: %s", firstSrcID, err)
		return &TxErr{code: TxErrCodeBlockNotFound, id: firstSrcID, msg: err.Error()}
	}

	avID := operation.ParentID
	for _, id := range operation.SrcIDs {
		if err = addAttributeViewBlock(id, avID, tree, tx); nil != err {
			return &TxErr{code: TxErrWriteAttributeView, id: avID, msg: err.Error()}
		}
	}
	return
}

func (tx *Transaction) doRemoveAttrViewBlock(operation *Operation) (ret *TxErr) {
	firstSrcID := operation.SrcIDs[0]
	tree, err := tx.loadTree(firstSrcID)
	if nil != err {
		logging.LogErrorf("load tree [%s] failed: %s", firstSrcID, err)
		return &TxErr{code: TxErrCodeBlockNotFound, id: firstSrcID}
	}

	avID := operation.ParentID
	for _, id := range operation.SrcIDs {
		if err = removeAttributeViewBlock(id, avID, tree, tx); nil != err {
			return &TxErr{code: TxErrWriteAttributeView, id: avID}
		}
	}
	return
}

func AddAttributeViewColumn(name string, typ string, columnIndex int, avID string) (err error) {
	attrView, err := av.ParseAttributeView(avID)
	if nil != err {
		return
	}

	switch av.ColumnType(typ) {
	case av.ColumnTypeText:
		attrView.InsertColumn(columnIndex, &av.Column{ID: "av" + ast.NewNodeID(), Name: name, Type: av.ColumnTypeText})
	default:
		msg := fmt.Sprintf("invalid column type [%s]", typ)
		logging.LogErrorf(msg)
		err = errors.New(msg)
		return
	}

	err = av.SaveAttributeView(attrView)
	return
}

func RemoveAttributeViewColumn(columnID string, avID string) (err error) {
	attrView, err := av.ParseAttributeView(avID)
	if nil != err {
		return
	}

	for i, column := range attrView.Columns[1:] {
		if column.ID == columnID {
			attrView.Columns = append(attrView.Columns[:i], attrView.Columns[i+1:]...)
			break
		}
	}

	err = av.SaveAttributeView(attrView)
	return
}

func removeAttributeViewBlock(blockID, avID string, tree *parse.Tree, tx *Transaction) (err error) {
	node := treenode.GetNodeInTree(tree, blockID)
	if nil == node {
		err = ErrBlockNotFound
		return
	}

	attrView, err := av.ParseAttributeView(avID)
	if nil != err {
		return
	}

	for i, row := range attrView.Rows {
		if row.Cells[0].Value == blockID {
			// 从行中移除，但是不移除属性
			attrView.Rows = append(attrView.Rows[:i], attrView.Rows[i+1:]...)
			break
		}
	}

	err = av.SaveAttributeView(attrView)
	return
}

func addAttributeViewBlock(blockID, avID string, tree *parse.Tree, tx *Transaction) (err error) {
	node := treenode.GetNodeInTree(tree, blockID)
	if nil == node {
		err = ErrBlockNotFound
		return
	}

	if ast.NodeAttributeView == node.Type {
		// 不能将一个属性视图拖拽到另一个属性视图中
		return
	}

	block := sql.BuildBlockFromNode(node, tree)
	if nil == block {
		err = ErrBlockNotFound
		return
	}

	attrView, err := av.ParseAttributeView(avID)
	if nil != err {
		return
	}

	// 不允许重复添加相同的块到属性视图中
	for _, row := range attrView.Rows {
		if row.Cells[0].Value == blockID {
			return
		}
	}

	row := av.NewRow()
	row.Cells = append(row.Cells, &av.Cell{ID: ast.NewNodeID(), Value: blockID})
	if 1 < len(attrView.Columns) {
		// 将列作为属性添加到块中
		attrs := parse.IAL2Map(node.KramdownIAL)
		for _, col := range attrView.Columns[1:] {
			attrs["av"+col.ID] = ""
		}

		if err = setNodeAttrsWithTx(tx, node, tree, attrs); nil != err {
			return
		}
	}

	attrView.Rows = append(attrView.Rows, row)
	err = av.SaveAttributeView(attrView)
	return
}
