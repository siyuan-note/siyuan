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
	"strings"

	"github.com/88250/gulu"
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

	// TODO: render value
	//trees := map[string]*parse.Tree{}
	//luteEngine := util.NewLute()
	//for _, r := range ret.Rows {
	//	blockID := r.Cells[0].Value
	//
	//	bt := treenode.GetBlockTree(blockID)
	//	if nil == bt {
	//		err = ErrBlockNotFound
	//		return
	//	}
	//
	//	var tree *parse.Tree
	//	if tree = trees[bt.RootID]; nil == tree {
	//		tree, _ = filesys.LoadTree(bt.BoxID, bt.Path, luteEngine)
	//		if nil == tree {
	//			err = ErrTreeNotFound
	//			return
	//		}
	//
	//		trees[bt.RootID] = tree
	//	}
	//
	//	node := treenode.GetNodeInTree(tree, blockID)
	//	if nil == node {
	//		err = ErrBlockNotFound
	//		return
	//	}
	//
	//	r.Cells[0].RenderValue = getNodeRefText(node)
	//}

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

		blockID = row.Cells[0].Value.Block.ID
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

	data, err := gulu.JSON.MarshalJSON(operation.Data)
	if nil != err {
		return
	}
	if err = gulu.JSON.UnmarshalJSON(data, &c.Value); nil != err {
		return
	}

	attrs := parse.IAL2Map(node.KramdownIAL)
	attrs[NodeAttrNamePrefixAvCol+avID+"-"+c.ID] = c.Value.ToJSONString()
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
	previousID := operation.PreviousID
	for _, id := range operation.SrcIDs {
		var av *av.AttributeView
		var avErr error
		if av, avErr = addAttributeViewBlock(id, previousID, avID, tree, tx); nil != avErr {
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
	var avs []*av.AttributeView
	avID := operation.ParentID
	for _, id := range operation.SrcIDs {
		var av *av.AttributeView
		var avErr error
		if av, avErr = removeAttributeViewBlock(id, avID); nil != avErr {
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

func (tx *Transaction) doUpdateAttrViewColumn(operation *Operation) (ret *TxErr) {
	err := updateAttributeViewColumn(operation.ID, operation.Name, operation.Typ, operation.ParentID)
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

func (tx *Transaction) doSortAttrViewColumn(operation *Operation) (ret *TxErr) {
	err := sortAttributeViewColumn(operation.ID, operation.PreviousID, operation.ParentID)
	if nil != err {
		return &TxErr{code: TxErrWriteAttributeView, id: operation.ParentID, msg: err.Error()}
	}
	return
}

func (tx *Transaction) doSortAttrViewRow(operation *Operation) (ret *TxErr) {
	err := sortAttributeViewRow(operation.ID, operation.PreviousID, operation.ParentID)
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

func updateAttributeViewColumn(id, name string, typ string, avID string) (err error) {
	attrView, err := av.ParseAttributeView(avID)
	if nil != err {
		return
	}

	colType := av.ColumnType(typ)
	switch colType {
	case av.ColumnTypeText:
		for _, col := range attrView.Columns {
			if col.ID == id {
				col.Name = name
				col.Type = colType
				break
			}
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

func sortAttributeViewColumn(columnID, previousColumnID, avID string) (err error) {
	attrView, err := av.ParseAttributeView(avID)
	if nil != err {
		return
	}

	var col *av.Column
	var index, previousIndex int
	for i, column := range attrView.Columns {
		if column.ID == columnID {
			col = column
			index = i
			break
		}
		if column.ID == previousColumnID {
			previousIndex = i
		}
	}
	if nil == col {
		return
	}

	attrView.Columns = append(attrView.Columns[:index], attrView.Columns[index+1:]...)
	attrView.Columns = append(attrView.Columns[:previousIndex], append([]*av.Column{col}, attrView.Columns[previousIndex:]...)...)

	for _, row := range attrView.Rows {
		cel := row.Cells[index]
		row.Cells = append(row.Cells[:index], row.Cells[index+1:]...)
		row.Cells = append(row.Cells[:previousIndex], append([]*av.Cell{cel}, row.Cells[previousIndex:]...)...)
	}

	err = av.SaveAttributeView(attrView)
	return
}

func sortAttributeViewRow(rowID, previousRowID, avID string) (err error) {
	attrView, err := av.ParseAttributeView(avID)
	if nil != err {
		return
	}

	var row *av.Row
	var index, previousIndex int
	for i, r := range attrView.Rows {
		if r.ID == rowID {
			row = r
			index = i
			break
		}
		if r.ID == previousRowID {
			previousIndex = i
		}
	}
	if nil == row {
		return
	}

	attrView.Rows = append(attrView.Rows[:index], attrView.Rows[index+1:]...)
	attrView.Rows = append(attrView.Rows[:previousIndex], append([]*av.Row{row}, attrView.Rows[previousIndex:]...)...)

	err = av.SaveAttributeView(attrView)
	return
}

func removeAttributeViewBlock(blockID, avID string) (ret *av.AttributeView, err error) {
	ret, err = av.ParseAttributeView(avID)
	if nil != err {
		return
	}

	for i, row := range ret.Rows {
		if row.Cells[0].Value.Block.ID == blockID {
			// 从行中移除，但是不移除属性
			ret.Rows = append(ret.Rows[:i], ret.Rows[i+1:]...)
			break
		}
	}

	err = av.SaveAttributeView(ret)
	return
}

func addAttributeViewBlock(blockID, previousRowID, avID string, tree *parse.Tree, tx *Transaction) (ret *av.AttributeView, err error) {
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
		if row.Cells[0].Value.Block.ID == blockID {
			return
		}
	}

	row := av.NewRow()
	row.Cells = append(row.Cells, av.NewCellBlock(blockID, getNodeRefText(node)))
	if 1 < len(ret.Columns) {
		attrs := parse.IAL2Map(node.KramdownIAL)
		for _, col := range ret.Columns[1:] {
			attrs[NodeAttrNamePrefixAvCol+avID+"-"+col.ID] = "" // 将列作为属性添加到块中
			row.Cells = append(row.Cells, av.NewCell(col.Type))
		}

		if "" == attrs[NodeAttrNameAVs] {
			attrs[NodeAttrNameAVs] = avID
		} else {
			avIDs := strings.Split(attrs[NodeAttrNameAVs], ",")
			avIDs = append(avIDs, avID)
			avIDs = gulu.Str.RemoveDuplicatedElem(avIDs)
			attrs[NodeAttrNameAVs] = strings.Join(avIDs, ",")
		}

		if err = setNodeAttrsWithTx(tx, node, tree, attrs); nil != err {
			return
		}
	}

	if "" == previousRowID {
		ret.Rows = append([]*av.Row{row}, ret.Rows...)
	} else {
		for i, r := range ret.Rows {
			if r.ID == previousRowID {
				ret.Rows = append(ret.Rows[:i+1], append([]*av.Row{row}, ret.Rows[i+1:]...)...)
				break
			}
		}
	}

	err = av.SaveAttributeView(ret)
	return
}

const (
	NodeAttrNameAVs         = "avs"
	NodeAttrNamePrefixAvCol = "av-col-"
)
