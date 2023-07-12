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
	"strings"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func RenderAttributeView(avID string) (viewable av.Viewable, attrView *av.AttributeView, err error) {
	waitForSyncingStorages()

	attrView, err = av.ParseAttributeView(avID)
	if nil != err {
		logging.LogErrorf("parse attribute view [%s] failed: %s", avID, err)
		return
	}

	if 1 > len(attrView.Views) {
		err = av.ErrViewNotFound
		return
	}

	var view *av.View
	if "" != attrView.CurrentViewID {
		for _, v := range attrView.Views {
			if v.ID == attrView.CurrentViewID {
				view = v
				break
			}
		}
	} else {
		view = attrView.Views[0]
	}

	switch view.CurrentLayoutType {
	case av.LayoutTypeTable:
		viewable, err = renderAttributeViewTable(attrView, view)
	}

	viewable.FilterRows()
	viewable.SortRows()
	viewable.CalcCols()
	return
}

func renderAttributeViewTable(attrView *av.AttributeView, view *av.View) (ret *av.Table, err error) {
	ret = &av.Table{
		ID:      view.Table.ID,
		Name:    view.Name,
		Filters: view.Table.Filters,
		Sorts:   view.Table.Sorts,
	}

	for _, col := range view.Table.Columns {
		key, getErr := attrView.GetKey(col.ID)
		if nil != getErr {
			err = getErr
			return
		}

		ret.Columns = append(ret.Columns, &av.TableColumn{
			ID:     key.ID,
			Name:   key.Name,
			Type:   key.Type,
			Icon:   key.Icon,
			Wrap:   col.Wrap,
			Hidden: col.Hidden,
			Width:  col.Width,
		})
	}

	rows := map[string][]*av.Value{}
	for _, keyValues := range attrView.KeyValues {
		for _, val := range keyValues.Values {
			rows[val.BlockID] = append(rows[val.BlockID], val)
		}
	}

	for _, row := range rows {
		var tableRow av.TableRow
		for _, col := range ret.Columns {
			var tableCell *av.TableCell
			for _, val := range row {
				if val.KeyID == col.ID {
					tableCell = &av.TableCell{
						ID:        val.ID,
						Value:     val,
						ValueType: col.Type,
					}
					break
				}
			}
			if nil == tableCell {
				tableCell = &av.TableCell{
					ID:        ast.NewNodeID(),
					ValueType: col.Type,
				}
			}
			tableRow.Cells = append(tableRow.Cells, tableCell)
		}
		ret.Rows = append(ret.Rows, &tableRow)
	}
	return
}

func (tx *Transaction) doSetAttrViewName(operation *Operation) (ret *TxErr) {
	err := setAttributeViewName(operation)
	if nil != err {
		return &TxErr{code: TxErrWriteAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

func setAttributeViewName(operation *Operation) (err error) {
	avID := operation.ID
	attrView, err := av.ParseAttributeView(avID)
	if nil != err {
		return
	}

	attrView.Name = operation.Data.(string)

	data, err := gulu.JSON.MarshalJSON(attrView)
	if nil != err {
		return
	}

	if err = gulu.JSON.UnmarshalJSON(data, attrView); nil != err {
		return
	}

	err = av.SaveAttributeView(attrView)
	return
}

func (tx *Transaction) doSetAttrViewFilters(operation *Operation) (ret *TxErr) {
	err := setAttributeViewFilters(operation)
	if nil != err {
		return &TxErr{code: TxErrWriteAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

func setAttributeViewFilters(operation *Operation) (err error) {
	avID := operation.ID
	attrView, err := av.ParseAttributeView(avID)
	if nil != err {
		return
	}

	view, err := attrView.GetView(operation.ViewID)
	if nil != err {
		return
	}

	operationData := operation.Data.([]interface{})
	data, err := gulu.JSON.MarshalJSON(operationData)
	if nil != err {
		return
	}

	switch view.CurrentLayoutType {
	case av.LayoutTypeTable:
		if err = gulu.JSON.UnmarshalJSON(data, &view.Table.Filters); nil != err {
			return
		}
	}

	err = av.SaveAttributeView(attrView)
	return
}

func (tx *Transaction) doSetAttrViewSorts(operation *Operation) (ret *TxErr) {
	err := setAttributeViewSorts(operation)
	if nil != err {
		return &TxErr{code: TxErrWriteAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

func setAttributeViewSorts(operation *Operation) (err error) {
	avID := operation.ID
	attrView, err := av.ParseAttributeView(avID)
	if nil != err {
		return
	}

	view, err := attrView.GetView(operation.ViewID)
	if nil != err {
		return
	}

	operationData := operation.Data.([]interface{})
	data, err := gulu.JSON.MarshalJSON(operationData)
	if nil != err {
		return
	}

	switch view.CurrentLayoutType {
	case av.LayoutTypeTable:
		if err = gulu.JSON.UnmarshalJSON(data, &view.Table.Sorts); nil != err {
			return
		}
	}

	err = av.SaveAttributeView(attrView)
	return
}

func (tx *Transaction) doInsertAttrViewBlock(operation *Operation) (ret *TxErr) {
	firstSrcID := operation.SrcIDs[0]
	tree, err := tx.loadTree(firstSrcID)
	if nil != err {
		logging.LogErrorf("load tree [%s] failed: %s", firstSrcID, err)
		return &TxErr{code: TxErrCodeBlockNotFound, id: firstSrcID, msg: err.Error()}
	}

	for _, id := range operation.SrcIDs {
		var avErr error
		if avErr = addAttributeViewBlock(id, operation, tree, tx); nil != avErr {
			return &TxErr{code: TxErrWriteAttributeView, id: operation.AvID, msg: avErr.Error()}
		}
	}
	return
}

func addAttributeViewBlock(blockID string, operation *Operation, tree *parse.Tree, tx *Transaction) (err error) {
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

	attrView, err := av.ParseAttributeView(operation.AvID)
	if nil != err {
		return
	}

	view, err := attrView.GetView(operation.ViewID)
	if nil != err {
		return
	}

	// 不允许重复添加相同的块到属性视图中
	blockValues := attrView.GetBlockKeyValues()
	for _, blockValue := range blockValues.Values {
		if blockValue.Block.ID == blockID {
			return
		}
	}

	for _, keyValues := range attrView.KeyValues {
		value := &av.Value{KeyID: keyValues.Key.ID, BlockID: blockID}
		blockValues.Values = append(blockValues.Values, value)

		if av.KeyTypeBlock == keyValues.Key.Type {
			value.Block = &av.ValueBlock{ID: blockID, Content: getNodeRefText(node)}
			break
		}
	}

	attrs := parse.IAL2Map(node.KramdownIAL)
	attrs[NodeAttrNamePrefixAvKey+operation.AvID+"-"+blockValues.Key.ID] = "" // 将列作为属性添加到块中

	if "" == attrs[NodeAttrNameAVs] {
		attrs[NodeAttrNameAVs] = operation.AvID
	} else {
		avIDs := strings.Split(attrs[NodeAttrNameAVs], ",")
		avIDs = append(avIDs, operation.AvID)
		avIDs = gulu.Str.RemoveDuplicatedElem(avIDs)
		attrs[NodeAttrNameAVs] = strings.Join(avIDs, ",")
	}

	if err = setNodeAttrsWithTx(tx, node, tree, attrs); nil != err {
		return
	}

	switch view.CurrentLayoutType {
	case av.LayoutTypeTable:
		if "" != operation.PreviousID {
			for i, id := range view.Table.RowIDs {
				if id == operation.PreviousID {
					view.Table.RowIDs = append(view.Table.RowIDs[:i+1], append([]string{blockID}, view.Table.RowIDs[i+1:]...)...)
					break
				}
			}
		}
	}

	err = av.SaveAttributeView(attrView)
	return
}

func (tx *Transaction) doRemoveAttrViewBlock(operation *Operation) (ret *TxErr) {
	for _, id := range operation.SrcIDs {
		var avErr error
		if avErr = removeAttributeViewBlock(id, operation); nil != avErr {
			return &TxErr{code: TxErrWriteAttributeView, id: operation.AvID}
		}
	}
	return
}

func removeAttributeViewBlock(blockID string, operation *Operation) (err error) {
	attrView, err := av.ParseAttributeView(operation.AvID)
	if nil != err {
		return
	}

	for _, keyValues := range attrView.KeyValues {
		for i, values := range keyValues.Values {
			if values.BlockID == blockID {
				keyValues.Values = append(keyValues.Values[:i], keyValues.Values[i+1:]...)
				break
			}
		}
	}

	err = av.SaveAttributeView(attrView)
	return
}

func (tx *Transaction) doSetAttrViewColumnWidth(operation *Operation) (ret *TxErr) {
	err := setAttributeViewColWidth(operation)
	if nil != err {
		return &TxErr{code: TxErrWriteAttributeView, id: operation.ParentID, msg: err.Error()}
	}
	return
}

func setAttributeViewColWidth(operation *Operation) (err error) {
	attrView, err := av.ParseAttributeView(operation.AvID)
	if nil != err {
		return
	}

	view, err := attrView.GetView(operation.ViewID)
	if nil != err {
		return
	}

	switch view.CurrentLayoutType {
	case av.LayoutTypeTable:
		for _, column := range view.Table.Columns {
			if column.ID == operation.ID {
				column.Width = operation.Data.(string)
				break
			}
		}
	}

	err = av.SaveAttributeView(attrView)
	return
}

func (tx *Transaction) doSetAttrViewColumnWrap(operation *Operation) (ret *TxErr) {
	err := setAttributeViewColWrap(operation)
	if nil != err {
		return &TxErr{code: TxErrWriteAttributeView, id: operation.ParentID, msg: err.Error()}
	}
	return
}

func setAttributeViewColWrap(operation *Operation) (err error) {
	attrView, err := av.ParseAttributeView(operation.AvID)
	if nil != err {
		return
	}

	view, err := attrView.GetView(operation.ViewID)
	if nil != err {
		return
	}

	switch view.CurrentLayoutType {
	case av.LayoutTypeTable:
		for _, column := range view.Table.Columns {
			if column.ID == operation.ID {
				column.Wrap = operation.Data.(bool)
				break
			}
		}
	}

	err = av.SaveAttributeView(attrView)
	return
}

func (tx *Transaction) doSetAttrViewColumnHidden(operation *Operation) (ret *TxErr) {
	err := setAttributeViewColHidden(operation)
	if nil != err {
		return &TxErr{code: TxErrWriteAttributeView, id: operation.ParentID, msg: err.Error()}
	}
	return
}

func setAttributeViewColHidden(operation *Operation) (err error) {
	attrView, err := av.ParseAttributeView(operation.AvID)
	if nil != err {
		return
	}

	view, err := attrView.GetView(operation.ViewID)
	if nil != err {
		return
	}

	switch view.CurrentLayoutType {
	case av.LayoutTypeTable:
		for _, column := range view.Table.Columns {
			if column.ID == operation.ID {
				column.Hidden = operation.Data.(bool)
				break
			}
		}
	}

	err = av.SaveAttributeView(attrView)
	return
}

func (tx *Transaction) doSortAttrViewRow(operation *Operation) (ret *TxErr) {
	err := sortAttributeViewRow(operation)
	if nil != err {
		return &TxErr{code: TxErrWriteAttributeView, id: operation.ParentID, msg: err.Error()}
	}
	return
}

func sortAttributeViewRow(operation *Operation) (err error) {
	attrView, err := av.ParseAttributeView(operation.AvID)
	if nil != err {
		return
	}

	view, err := attrView.GetView(operation.ViewID)
	if nil != err {
		return
	}

	var rowID string
	var index, previousIndex int
	for i, r := range view.Table.RowIDs {
		if r == operation.ID {
			rowID = r
			index = i
			break
		}
	}
	if "" == rowID {
		return
	}

	switch view.CurrentLayoutType {
	case av.LayoutTypeTable:
		view.Table.RowIDs = append(view.Table.RowIDs[:index], view.Table.RowIDs[index+1:]...)
		for i, r := range view.Table.RowIDs {
			if r == operation.PreviousID {
				previousIndex = i + 1
				break
			}
		}
		view.Table.RowIDs = util.InsertElem(view.Table.RowIDs, previousIndex, rowID)
	}

	err = av.SaveAttributeView(attrView)
	return
}

func (tx *Transaction) doSortAttrViewColumn(operation *Operation) (ret *TxErr) {
	err := sortAttributeViewColumn(operation)
	if nil != err {
		return &TxErr{code: TxErrWriteAttributeView, id: operation.ParentID, msg: err.Error()}
	}
	return
}

func sortAttributeViewColumn(operation *Operation) (err error) {
	attrView, err := av.ParseAttributeView(operation.AvID)
	if nil != err {
		return
	}

	view, err := attrView.GetView(operation.ViewID)
	if nil != err {
		return
	}

	switch view.CurrentLayoutType {
	case av.LayoutTypeTable:
		var col *av.ViewTableColumn
		var index, previousIndex int
		for i, column := range view.Table.Columns {
			if column.ID == operation.ID {
				col = column
				index = i
				break
			}
		}
		if nil == col {
			return
		}

		view.Table.Columns = append(view.Table.Columns[:index], view.Table.Columns[index+1:]...)
		for i, column := range view.Table.Columns {
			if column.ID == operation.PreviousID {
				previousIndex = i + 1
				break
			}
		}
		view.Table.Columns = util.InsertElem(view.Table.Columns, previousIndex, col)
	}

	err = av.SaveAttributeView(attrView)
	return
}

func (tx *Transaction) doAddAttrViewColumn(operation *Operation) (ret *TxErr) {
	err := addAttributeViewColumn(operation)
	if nil != err {
		return &TxErr{code: TxErrWriteAttributeView, id: operation.ParentID, msg: err.Error()}
	}
	return
}

func addAttributeViewColumn(operation *Operation) (err error) {
	attrView, err := av.ParseAttributeView(operation.AvID)
	if nil != err {
		return
	}

	view, err := attrView.GetView(operation.ViewID)
	if nil != err {
		return
	}

	keyType := av.KeyType(operation.Typ)
	switch keyType {
	case av.KeyTypeText, av.KeyTypeNumber, av.KeyTypeDate, av.KeyTypeSelect, av.KeyTypeMSelect:
		key := av.NewKey(operation.Name, keyType)
		attrView.KeyValues = append(attrView.KeyValues, &av.KeyValues{Key: key})

		switch view.CurrentLayoutType {
		case av.LayoutTypeTable:
			view.Table.Columns = append(view.Table.Columns, &av.ViewTableColumn{ID: key.ID})
		}
	}

	err = av.SaveAttributeView(attrView)
	return
}

func (tx *Transaction) doUpdateAttrViewColumn(operation *Operation) (ret *TxErr) {
	err := updateAttributeViewColumn(operation)
	if nil != err {
		return &TxErr{code: TxErrWriteAttributeView, id: operation.ParentID, msg: err.Error()}
	}
	return
}

func updateAttributeViewColumn(operation *Operation) (err error) {
	attrView, err := av.ParseAttributeView(operation.AvID)
	if nil != err {
		return
	}

	colType := av.KeyType(operation.Typ)
	switch colType {
	case av.KeyTypeText, av.KeyTypeNumber, av.KeyTypeDate, av.KeyTypeSelect, av.KeyTypeMSelect:
		for _, keyValues := range attrView.KeyValues {
			if keyValues.Key.ID == operation.ID {
				keyValues.Key.Name = operation.Name
				keyValues.Key.Type = colType
				break
			}
		}
	}

	err = av.SaveAttributeView(attrView)
	return
}

func (tx *Transaction) doRemoveAttrViewColumn(operation *Operation) (ret *TxErr) {
	err := removeAttributeViewColumn(operation)
	if nil != err {
		return &TxErr{code: TxErrWriteAttributeView, id: operation.ParentID, msg: err.Error()}
	}
	return
}

func removeAttributeViewColumn(operation *Operation) (err error) {
	attrView, err := av.ParseAttributeView(operation.AvID)
	if nil != err {
		return
	}

	for i, keyValues := range attrView.KeyValues {
		if keyValues.Key.ID == operation.ID {
			attrView.KeyValues = append(attrView.KeyValues[:i], attrView.KeyValues[i+1:]...)
			break
		}
	}

	for _, view := range attrView.Views {
		switch view.CurrentLayoutType {
		case av.LayoutTypeTable:
			for i, column := range view.Table.Columns {
				if column.ID == operation.ID {
					view.Table.Columns = append(view.Table.Columns[:i], view.Table.Columns[i+1:]...)
					break
				}
			}
		}
	}

	err = av.SaveAttributeView(attrView)
	return
}

func (tx *Transaction) doUpdateAttrViewCell(operation *Operation) (ret *TxErr) {
	err := updateAttributeViewCell(operation, tx)
	if nil != err {
		return &TxErr{code: TxErrWriteAttributeView, id: operation.ParentID, msg: err.Error()}
	}
	return
}

func updateAttributeViewCell(operation *Operation, tx *Transaction) (err error) {
	avID := operation.ParentID
	attrView, err := av.ParseAttributeView(avID)
	if nil != err {
		return
	}

	var val *av.Value
	for _, keyValues := range attrView.KeyValues {
		if operation.KeyID == keyValues.Key.ID {
			for _, value := range keyValues.Values {
				if operation.ID == value.ID {
					val = value
					break
				}
			}
			break
		}
	}

	if nil == val {
		return
	}

	tree, err := tx.loadTree(val.BlockID)
	if nil != err {
		return
	}

	node := treenode.GetNodeInTree(tree, val.BlockID)
	if nil == node {
		return
	}

	data, err := gulu.JSON.MarshalJSON(operation.Data)
	if nil != err {
		return
	}
	if err = gulu.JSON.UnmarshalJSON(data, &val); nil != err {
		return
	}

	attrs := parse.IAL2Map(node.KramdownIAL)
	attrs[NodeAttrNamePrefixAvKey+avID+"-"+val.KeyID] = val.ToJSONString()
	if err = setNodeAttrsWithTx(tx, node, tree, attrs); nil != err {
		return
	}

	if err = av.SaveAttributeView(attrView); nil != err {
		return
	}
	return
}

// TODO 下面的方法要重写

//func (tx *Transaction) doUpdateAttrViewColOption(operation *Operation) (ret *TxErr) {
//	err := updateAttributeViewColumnOption(operation)
//	if nil != err {
//		return &TxErr{code: TxErrWriteAttributeView, id: operation.ParentID, msg: err.Error()}
//	}
//	return
//}
//
//func (tx *Transaction) doRemoveAttrViewColOption(operation *Operation) (ret *TxErr) {
//	err := removeAttributeViewColumnOption(operation)
//	if nil != err {
//		return &TxErr{code: TxErrWriteAttributeView, id: operation.ParentID, msg: err.Error()}
//	}
//	return
//}
//
//func (tx *Transaction) doUpdateAttrViewColOptions(operation *Operation) (ret *TxErr) {
//	err := updateAttributeViewColumnOptions(operation.Data, operation.ID, operation.ParentID)
//	if nil != err {
//		return &TxErr{code: TxErrWriteAttributeView, id: operation.ParentID, msg: err.Error()}
//	}
//	return
//}
//
//func updateAttributeViewColumnOption(operation *Operation) (err error) {
//	avID := operation.ParentID
//	attrView, err := av.ParseAttributeView(avID)
//	if nil != err {
//		return
//	}
//
//	colID := operation.ID
//	data := operation.Data.(map[string]interface{})
//
//	oldName := data["oldName"].(string)
//	newName := data["newName"].(string)
//	newColor := data["newColor"].(string)
//
//	var colIndex int
//	for i, col := range attrView.Columns {
//		if col.ID != colID {
//			continue
//		}
//
//		colIndex = i
//		existOpt := false
//		for j, opt := range col.Options {
//			if opt.Name == newName {
//				existOpt = true
//				col.Options = append(col.Options[:j], col.Options[j+1:]...)
//				break
//			}
//		}
//		if !existOpt {
//			for _, opt := range col.Options {
//				if opt.Name != oldName {
//					continue
//				}
//
//				opt.Name = newName
//				opt.Color = newColor
//				break
//			}
//		}
//		break
//	}
//
//	for _, row := range attrView.Rows {
//		for i, cell := range row.Cells {
//			if colIndex != i || nil == cell.Value {
//				continue
//			}
//
//			if nil != cell.Value.MSelect && 0 < len(cell.Value.MSelect) && nil != cell.Value.MSelect[0] {
//				if oldName == cell.Value.MSelect[0].Content {
//					cell.Value.MSelect[0].Content = newName
//					cell.Value.MSelect[0].Color = newColor
//					break
//				}
//			} else if nil != cell.Value.MSelect {
//				existInMSelect := false
//				for j, opt := range cell.Value.MSelect {
//					if opt.Content == newName {
//						existInMSelect = true
//						cell.Value.MSelect = append(cell.Value.MSelect[:j], cell.Value.MSelect[j+1:]...)
//						break
//					}
//				}
//				if !existInMSelect {
//					for j, opt := range cell.Value.MSelect {
//						if oldName == opt.Content {
//							cell.Value.MSelect[j].Content = newName
//							cell.Value.MSelect[j].Color = newColor
//							break
//						}
//					}
//				}
//			}
//			break
//		}
//	}
//
//	err = av.SaveAttributeView(attrView)
//	return
//}
//
//func removeAttributeViewColumnOption(operation *Operation) (err error) {
//	avID := operation.ParentID
//	attrView, err := av.ParseAttributeView(avID)
//	if nil != err {
//		return
//	}
//
//	colID := operation.ID
//	optName := operation.Data.(string)
//
//	var colIndex int
//	for i, col := range attrView.Columns {
//		if col.ID != colID {
//			continue
//		}
//
//		colIndex = i
//
//		for j, opt := range col.Options {
//			if opt.Name != optName {
//				continue
//			}
//
//			col.Options = append(col.Options[:j], col.Options[j+1:]...)
//			break
//		}
//		break
//	}
//
//	for _, row := range attrView.Rows {
//		for i, cell := range row.Cells {
//			if colIndex != i {
//				continue
//			}
//
//			if nil != cell.Value {
//				if nil != cell.Value.MSelect && 0 < len(cell.Value.MSelect) && nil != cell.Value.MSelect[0] {
//					if optName == cell.Value.MSelect[0].Content {
//						cell.Value = nil
//						break
//					}
//				} else if nil != cell.Value.MSelect {
//					for j, opt := range cell.Value.MSelect {
//						if optName == opt.Content {
//							cell.Value.MSelect = append(cell.Value.MSelect[:j], cell.Value.MSelect[j+1:]...)
//							break
//						}
//					}
//				}
//			}
//			break
//		}
//	}
//
//	err = av.SaveAttributeView(attrView)
//	return
//}
//
//func updateAttributeViewColumnOptions(data interface{}, id, avID string) (err error) {
//	attrView, err := av.ParseAttributeView(avID)
//	if nil != err {
//		return
//	}
//
//	jsonData, err := gulu.JSON.MarshalJSON(data)
//	if nil != err {
//		return
//	}
//
//	options := []*av.ColumnSelectOption{}
//	if err = gulu.JSON.UnmarshalJSON(jsonData, &options); nil != err {
//		return
//	}
//
//	for _, col := range attrView.Columns {
//		if col.ID == id {
//			col.Options = options
//			err = av.SaveAttributeView(attrView)
//			return
//		}
//	}
//	return
//}

const (
	NodeAttrNameAVs         = "custom-avs"
	NodeAttrNamePrefixAvKey = "custom-av-key-"
)
