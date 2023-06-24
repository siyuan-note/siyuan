// SiYuan - Refactor your thinking
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

func RenderAttributeView(avID string) (ret *av.AttributeView, err error) {
	waitForSyncingStorages()

	ret, err = av.ParseAttributeView(avID)
	if nil != err {
		logging.LogErrorf("parse attribute view [%s] failed: %s", avID, err)
		return
	}

	// TODO render value
	return
}

func (tx *Transaction) doUpdateAttrViewCell(operation *Operation) (ret *TxErr) {
	avID := operation.ParentID
	view, err := av.ParseAttributeView(avID)
	if nil != err {
		logging.LogErrorf("parse attribute view [%s] failed: %s", avID, err)
		return &TxErr{code: TxErrCodeBlockNotFound, id: avID, msg: err.Error()}
	}

	var c *av.Cell
	var blockID string
	for _, row := range view.Rows {
		if row.ID != operation.RowID {
			continue
		}

		blockID = row.Cells[0].Value
		for _, cell := range row.Cells[1:] {
			if cell.ID == operation.ID {
				c = cell
				break
			}
		}
		break
	}

	if nil == c {
		return
	}

	tree, err := tx.loadTree(blockID)
	if nil != err {
		return
	}

	node := treenode.GetNodeInTree(tree, blockID)
	if nil == node {
		return
	}

	c.Value = parseCellData(operation.Data, av.ColumnType(operation.Typ))
	attrs := parse.IAL2Map(node.KramdownIAL)
	attrs[NodeAttrNamePrefixAvCol+c.ID] = c.Value
	if err = setNodeAttrsWithTx(tx, node, tree, attrs); nil != err {
		return
	}

	if err = av.SaveAttributeView(view); nil != err {
		return
	}

	sql.RebuildAttributeViewQueue(view)
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
	var avs []*av.AttributeView
	for _, id := range operation.SrcIDs {
		var av *av.AttributeView
		var avErr error
		if av, avErr = addAttributeViewBlock(id, avID, tree, tx); nil != avErr {
			return &TxErr{code: TxErrWriteAttributeView, id: avID, msg: avErr.Error()}
		}

		if nil == av {
			continue
		}

		avs = append(avs, av)
	}

	for _, av := range avs {
		sql.RebuildAttributeViewQueue(av)
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

	var avs []*av.AttributeView
	avID := operation.ParentID
	for _, id := range operation.SrcIDs {
		var av *av.AttributeView
		var avErr error
		if av, avErr = removeAttributeViewBlock(id, avID, tree); nil != avErr {
			return &TxErr{code: TxErrWriteAttributeView, id: avID}
		}

		if nil == av {
			continue
		}

		avs = append(avs, av)
	}

	for _, av := range avs {
		sql.RebuildAttributeViewQueue(av)
	}
	return
}

func (tx *Transaction) doAddAttrViewColumn(operation *Operation) (ret *TxErr) {
	err := addAttributeViewColumn(operation.Name, operation.Typ, operation.ParentID)
	if nil != err {
		return &TxErr{code: TxErrWriteAttributeView, id: operation.ParentID, msg: err.Error()}
	}
	return
}

func (tx *Transaction) doRemoveAttrViewColumn(operation *Operation) (ret *TxErr) {
	err := removeAttributeViewColumn(operation.ID, operation.ParentID)
	if nil != err {
		return &TxErr{code: TxErrWriteAttributeView, id: operation.ParentID, msg: err.Error()}
	}
	return
}

func addAttributeViewColumn(name string, typ string, avID string) (err error) {
	attrView, err := av.ParseAttributeView(avID)
	if nil != err {
		return
	}

	colType := av.ColumnType(typ)
	switch colType {
	case av.ColumnTypeText:
		col := &av.Column{ID: ast.NewNodeID(), Name: name, Type: colType}
		attrView.Columns = append(attrView.Columns, col)
		for _, row := range attrView.Rows {
			row.Cells = append(row.Cells, av.NewCell(colType))
		}
	default:
		msg := fmt.Sprintf("invalid column type [%s]", typ)
		logging.LogErrorf(msg)
		err = errors.New(msg)
		return
	}

	err = av.SaveAttributeView(attrView)
	return
}

func removeAttributeViewColumn(columnID string, avID string) (err error) {
	attrView, err := av.ParseAttributeView(avID)
	if nil != err {
		return
	}

	for i, column := range attrView.Columns {
		if column.ID == columnID {
			attrView.Columns = append(attrView.Columns[:i], attrView.Columns[i+1:]...)
			for _, row := range attrView.Rows {
				if len(row.Cells) <= i {
					continue
				}

				row.Cells = append(row.Cells[:i], row.Cells[i+1:]...)
			}
			break
		}
	}

	err = av.SaveAttributeView(attrView)
	return
}

func removeAttributeViewBlock(blockID, avID string, tree *parse.Tree) (ret *av.AttributeView, err error) {
	node := treenode.GetNodeInTree(tree, blockID)
	if nil == node {
		err = ErrBlockNotFound
		return
	}

	ret, err = av.ParseAttributeView(avID)
	if nil != err {
		return
	}

	for i, row := range ret.Rows {
		if row.Cells[0].Value == blockID {
			// 从行中移除，但是不移除属性
			ret.Rows = append(ret.Rows[:i], ret.Rows[i+1:]...)
			break
		}
	}

	err = av.SaveAttributeView(ret)
	return
}

func addAttributeViewBlock(blockID, avID string, tree *parse.Tree, tx *Transaction) (ret *av.AttributeView, err error) {
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

	ret, err = av.ParseAttributeView(avID)
	if nil != err {
		return
	}

	// 不允许重复添加相同的块到属性视图中
	for _, row := range ret.Rows {
		if row.Cells[0].Value == blockID {
			return
		}
	}

	row := av.NewRow()
	row.Cells = append(row.Cells, av.NewCellBlock(blockID, getNodeRefText(node)))
	if 1 < len(ret.Columns) {
		attrs := parse.IAL2Map(node.KramdownIAL)
		for _, col := range ret.Columns[1:] {
			attrs[NodeAttrNamePrefixAvCol+col.ID] = "" // 将列作为属性添加到块中
			row.Cells = append(row.Cells, av.NewCell(col.Type))
		}

		if err = setNodeAttrsWithTx(tx, node, tree, attrs); nil != err {
			return
		}
	}

	ret.Rows = append(ret.Rows, row)
	err = av.SaveAttributeView(ret)
	return
}

func parseCellData(data interface{}, colType av.ColumnType) string {
	switch colType {
	case av.ColumnTypeText:
		return data.(string)
	}
	return ""
}

const NodeAttrNamePrefixAvCol = "av-col-"
