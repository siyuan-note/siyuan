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

	"github.com/88250/lute/parse"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

func AddAttributeViewColumn(name string, typ string, columnIndex int, avID string) (err error) {
	attrView, err := av.ParseAttributeView(avID)
	if nil != err {
		return
	}

	switch av.ColumnType(typ) {
	case av.ColumnTypeText:
		attrView.InsertColumn(columnIndex, av.NewColumnText(name))
	default:
		msg := fmt.Sprintf("invalid column type [%s]", typ)
		logging.LogErrorf(msg)
		err = errors.New(msg)
		return
	}

	err = av.SaveAttributeView(attrView)
	return
}

func AddAttributeViewBlock(blockID, avID string) (err error) {
	tree, err := loadTreeByBlockID(blockID)
	if nil != err {
		return
	}

	node := treenode.GetNodeInTree(tree, blockID)
	if nil == node {
		err = ErrBlockNotFound
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

	var row []av.Cell
	row = append(row, av.NewCellBlock(block.ID))
	if 1 < len(attrView.Columns) {
		attrs := parse.IAL2Map(node.KramdownIAL)

		for _, col := range attrView.Columns[1:] {
			colName := col.Name()
			attrs[colName] = ""
		}

		if err = setNodeAttrs(node, tree, attrs); nil != err {
			return
		}
	}

	attrView.Rows = append(attrView.Rows, row)

	err = av.SaveAttributeView(attrView)
	return
}
