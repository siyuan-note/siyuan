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
	"sort"
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

type BlockAttributeViewKeys struct {
	AvID      string          `json:"avID"`
	AvName    string          `json:"avName"`
	KeyValues []*av.KeyValues `json:"keyValues"`
}

func GetBlockAttributeViewKeys(blockID string) (ret []*BlockAttributeViewKeys) {
	waitForSyncingStorages()

	ret = []*BlockAttributeViewKeys{}
	attrs := GetBlockAttrs(blockID)
	avs := attrs[NodeAttrNameAvs]
	if "" == avs {
		return
	}

	avIDs := strings.Split(avs, ",")
	for _, avID := range avIDs {
		attrView, err := av.ParseAttributeView(avID)
		if nil != err {
			logging.LogErrorf("parse attribute view [%s] failed: %s", avID, err)
			return
		}

		if 1 > len(attrView.Views) {
			err = av.ErrViewNotFound
			return
		}

		var keyValues []*av.KeyValues
		for _, kv := range attrView.KeyValues {
			if av.KeyTypeBlock == kv.Key.Type {
				continue
			}

			kValues := &av.KeyValues{Key: kv.Key}
			for _, v := range kv.Values {
				if v.BlockID == blockID {
					kValues.Values = append(kValues.Values, v)
				}
			}

			if 0 < len(kValues.Values) {
				keyValues = append(keyValues, kValues)
			}
		}

		ret = append(ret, &BlockAttributeViewKeys{
			AvID:      avID,
			AvName:    attrView.Name,
			KeyValues: keyValues,
		})
	}
	return
}

func RenderAttributeView(avID, nodeID string) (viewable av.Viewable, attrView *av.AttributeView, err error) {
	waitForSyncingStorages()

	if avJSONPath := av.GetAttributeViewDataPath(avID); !gulu.File.IsExist(avJSONPath) {
		attrView = av.NewAttributeView(avID, nodeID)
		if err = av.SaveAttributeView(attrView); nil != err {
			logging.LogErrorf("save attribute view [%s] failed: %s", avID, err)
			return
		}
	}

	attrView, err = av.ParseAttributeView(avID)
	if nil != err {
		logging.LogErrorf("parse attribute view [%s] failed: %s", avID, err)
		return
	}

	if "" == attrView.NodeID {
		attrView.NodeID = nodeID
		if err = av.SaveAttributeView(attrView); nil != err {
			logging.LogErrorf("save attribute view [%s] failed: %s", avID, err)
			return
		}
	}

	if 1 > len(attrView.Views) {
		err = av.ErrViewNotFound
		return
	}

	var view *av.View
	if "" != attrView.ViewID {
		for _, v := range attrView.Views {
			if v.ID == attrView.ViewID {
				view = v
				break
			}
		}
	} else {
		view = attrView.Views[0]
	}

	switch view.LayoutType {
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
		ID:      view.ID,
		Name:    view.Name,
		Columns: []*av.TableColumn{},
		Rows:    []*av.TableRow{},
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
			ID:      key.ID,
			Name:    key.Name,
			Type:    key.Type,
			Icon:    key.Icon,
			Options: key.Options,
			Wrap:    col.Wrap,
			Hidden:  col.Hidden,
			Width:   col.Width,
			Calc:    col.Calc,
		})
	}

	rows := map[string][]*av.Value{}
	for _, keyValues := range attrView.KeyValues {
		for _, val := range keyValues.Values {
			rows[val.BlockID] = append(rows[val.BlockID], val)
		}
	}

	notFound := []string{}
	for blockID, _ := range rows {
		if treenode.GetBlockTree(blockID) == nil {
			notFound = append(notFound, blockID)
		}
	}
	for _, blockID := range notFound {
		delete(rows, blockID)
	}

	for rowID, row := range rows {
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
			tableRow.ID = rowID
			tableRow.Cells = append(tableRow.Cells, tableCell)
		}
		ret.Rows = append(ret.Rows, &tableRow)
	}

	sortRowIDs := map[string]int{}
	if 0 < len(view.Table.RowIDs) {
		for i, rowID := range view.Table.RowIDs {
			sortRowIDs[rowID] = i
		}
	}

	sort.Slice(ret.Rows, func(i, j int) bool {
		iv := sortRowIDs[ret.Rows[i].ID]
		jv := sortRowIDs[ret.Rows[j].ID]
		if iv == jv {
			return ret.Rows[i].ID < ret.Rows[j].ID
		}
		return iv < jv
	})
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
	attrView, err := av.ParseAttributeView(operation.ID)
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
	attrView, err := av.ParseAttributeView(operation.AvID)
	if nil != err {
		return
	}

	view, err := attrView.GetView()
	if nil != err {
		return
	}

	operationData := operation.Data.([]interface{})
	data, err := gulu.JSON.MarshalJSON(operationData)
	if nil != err {
		return
	}

	switch view.LayoutType {
	case av.LayoutTypeTable:
		if err = gulu.JSON.UnmarshalJSON(data, &view.Table.Filters); nil != err {
			return
		}
	}

	for _, filter := range view.Table.Filters {
		var key *av.Key
		key, err = attrView.GetKey(filter.Column)
		if nil != err {
			return
		}

		filter.Value.Type = key.Type
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
	attrView, err := av.ParseAttributeView(operation.AvID)
	if nil != err {
		return
	}

	view, err := attrView.GetView()
	if nil != err {
		return
	}

	operationData := operation.Data.([]interface{})
	data, err := gulu.JSON.MarshalJSON(operationData)
	if nil != err {
		return
	}

	switch view.LayoutType {
	case av.LayoutTypeTable:
		if err = gulu.JSON.UnmarshalJSON(data, &view.Table.Sorts); nil != err {
			return
		}
	}

	err = av.SaveAttributeView(attrView)
	return
}

func (tx *Transaction) doSetAttrViewColCalc(operation *Operation) (ret *TxErr) {
	err := setAttributeViewColumnCalc(operation)
	if nil != err {
		return &TxErr{code: TxErrWriteAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

func setAttributeViewColumnCalc(operation *Operation) (err error) {
	attrView, err := av.ParseAttributeView(operation.AvID)
	if nil != err {
		return
	}

	view, err := attrView.GetView()
	if nil != err {
		return
	}

	operationData := operation.Data.(interface{})
	data, err := gulu.JSON.MarshalJSON(operationData)
	if nil != err {
		return
	}

	calc := &av.ColumnCalc{}
	switch view.LayoutType {
	case av.LayoutTypeTable:
		if err = gulu.JSON.UnmarshalJSON(data, calc); nil != err {
			return
		}

		for _, column := range view.Table.Columns {
			if column.ID == operation.ID {
				column.Calc = calc
				break
			}
		}
	}

	err = av.SaveAttributeView(attrView)
	return
}

func (tx *Transaction) doInsertAttrViewBlock(operation *Operation) (ret *TxErr) {
	for _, id := range operation.SrcIDs {
		tree, err := tx.loadTree(id)
		if nil != err {
			logging.LogErrorf("load tree [%s] failed: %s", id, err)
			return &TxErr{code: TxErrCodeBlockNotFound, id: id, msg: err.Error()}
		}

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

	view, err := attrView.GetView()
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

	value := &av.Value{ID: ast.NewNodeID(), KeyID: blockValues.Key.ID, BlockID: blockID, Block: &av.ValueBlock{ID: blockID, Content: getNodeRefText(node)}}
	blockValues.Values = append(blockValues.Values, value)

	attrs := parse.IAL2Map(node.KramdownIAL)
	attrs[NodeAttrNamePrefixAvKey+operation.AvID+"-"+blockValues.Key.ID] = "" // 将列作为属性添加到块中

	if "" == attrs[NodeAttrNameAvs] {
		attrs[NodeAttrNameAvs] = operation.AvID
	} else {
		avIDs := strings.Split(attrs[NodeAttrNameAvs], ",")
		avIDs = append(avIDs, operation.AvID)
		avIDs = gulu.Str.RemoveDuplicatedElem(avIDs)
		attrs[NodeAttrNameAvs] = strings.Join(avIDs, ",")
	}

	if err = setNodeAttrsWithTx(tx, node, tree, attrs); nil != err {
		return
	}

	switch view.LayoutType {
	case av.LayoutTypeTable:
		if "" != operation.PreviousID {
			for i, id := range view.Table.RowIDs {
				if id == operation.PreviousID {
					view.Table.RowIDs = append(view.Table.RowIDs[:i+1], append([]string{blockID}, view.Table.RowIDs[i+1:]...)...)
					break
				}
			}
		} else {
			view.Table.RowIDs = append(view.Table.RowIDs, blockID)
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

	view, err := attrView.GetView()
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

	view.Table.RowIDs = gulu.Str.RemoveElem(view.Table.RowIDs, blockID)

	err = av.SaveAttributeView(attrView)
	return
}

func (tx *Transaction) doSetAttrViewColumnWidth(operation *Operation) (ret *TxErr) {
	err := setAttributeViewColWidth(operation)
	if nil != err {
		return &TxErr{code: TxErrWriteAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

func setAttributeViewColWidth(operation *Operation) (err error) {
	attrView, err := av.ParseAttributeView(operation.AvID)
	if nil != err {
		return
	}

	view, err := attrView.GetView()
	if nil != err {
		return
	}

	switch view.LayoutType {
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
		return &TxErr{code: TxErrWriteAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

func setAttributeViewColWrap(operation *Operation) (err error) {
	attrView, err := av.ParseAttributeView(operation.AvID)
	if nil != err {
		return
	}

	view, err := attrView.GetView()
	if nil != err {
		return
	}

	switch view.LayoutType {
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
		return &TxErr{code: TxErrWriteAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

func setAttributeViewColHidden(operation *Operation) (err error) {
	attrView, err := av.ParseAttributeView(operation.AvID)
	if nil != err {
		return
	}

	view, err := attrView.GetView()
	if nil != err {
		return
	}

	switch view.LayoutType {
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
		return &TxErr{code: TxErrWriteAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

func sortAttributeViewRow(operation *Operation) (err error) {
	attrView, err := av.ParseAttributeView(operation.AvID)
	if nil != err {
		return
	}

	view, err := attrView.GetView()
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

	switch view.LayoutType {
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
		return &TxErr{code: TxErrWriteAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

func sortAttributeViewColumn(operation *Operation) (err error) {
	attrView, err := av.ParseAttributeView(operation.AvID)
	if nil != err {
		return
	}

	view, err := attrView.GetView()
	if nil != err {
		return
	}

	switch view.LayoutType {
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
		return &TxErr{code: TxErrWriteAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

func addAttributeViewColumn(operation *Operation) (err error) {
	attrView, err := av.ParseAttributeView(operation.AvID)
	if nil != err {
		return
	}

	view, err := attrView.GetView()
	if nil != err {
		return
	}

	keyType := av.KeyType(operation.Typ)
	switch keyType {
	case av.KeyTypeText, av.KeyTypeNumber, av.KeyTypeDate, av.KeyTypeSelect, av.KeyTypeMSelect, av.KeyTypeURL:
		key := av.NewKey(operation.ID, operation.Name, keyType)
		attrView.KeyValues = append(attrView.KeyValues, &av.KeyValues{Key: key})

		switch view.LayoutType {
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
		return &TxErr{code: TxErrWriteAttributeView, id: operation.AvID, msg: err.Error()}
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
	case av.KeyTypeText, av.KeyTypeNumber, av.KeyTypeDate, av.KeyTypeSelect, av.KeyTypeMSelect, av.KeyTypeURL:
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
		return &TxErr{code: TxErrWriteAttributeView, id: operation.AvID, msg: err.Error()}
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
		switch view.LayoutType {
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
		return &TxErr{code: TxErrWriteAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

func updateAttributeViewCell(operation *Operation, tx *Transaction) (err error) {
	err = UpdateAttributeViewCell(operation.AvID, operation.KeyID, operation.RowID, operation.ID, operation.Data)
	return
}

func UpdateAttributeViewCell(avID, keyID, rowID, cellID string, valueData interface{}) (err error) {
	attrView, err := av.ParseAttributeView(avID)
	if nil != err {
		return
	}

	var val *av.Value
	for _, keyValues := range attrView.KeyValues {
		if keyID != keyValues.Key.ID {
			continue
		}

		for _, value := range keyValues.Values {
			if cellID == value.ID {
				val = value
				val.Type = keyValues.Key.Type
				break
			}
		}

		if nil == val {
			val = &av.Value{ID: cellID, KeyID: keyValues.Key.ID, BlockID: rowID, Type: keyValues.Key.Type}
			keyValues.Values = append(keyValues.Values, val)
		}
		break
	}

	tree, err := loadTreeByBlockID(val.BlockID)
	if nil != err {
		return
	}

	node := treenode.GetNodeInTree(tree, val.BlockID)
	if nil == node {
		return
	}

	data, err := gulu.JSON.MarshalJSON(valueData)
	if nil != err {
		return
	}
	if err = gulu.JSON.UnmarshalJSON(data, &val); nil != err {
		return
	}

	attrs := parse.IAL2Map(node.KramdownIAL)
	attrs[NodeAttrNamePrefixAvKey+avID+"-"+val.KeyID] = val.ToJSONString()

	if err = setNodeAttrs(node, tree, attrs); nil != err {
		return
	}

	if err = av.SaveAttributeView(attrView); nil != err {
		return
	}
	return
}

func (tx *Transaction) doUpdateAttrViewColOptions(operation *Operation) (ret *TxErr) {
	err := updateAttributeViewColumnOptions(operation)
	if nil != err {
		return &TxErr{code: TxErrWriteAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

func updateAttributeViewColumnOptions(operation *Operation) (err error) {
	attrView, err := av.ParseAttributeView(operation.AvID)
	if nil != err {
		return
	}

	jsonData, err := gulu.JSON.MarshalJSON(operation.Data)
	if nil != err {
		return
	}

	options := []*av.KeySelectOption{}
	if err = gulu.JSON.UnmarshalJSON(jsonData, &options); nil != err {
		return
	}

	for _, keyValues := range attrView.KeyValues {
		if keyValues.Key.ID == operation.ID {
			keyValues.Key.Options = options
			err = av.SaveAttributeView(attrView)
			return
		}
	}
	return
}

func (tx *Transaction) doRemoveAttrViewColOption(operation *Operation) (ret *TxErr) {
	err := removeAttributeViewColumnOption(operation)
	if nil != err {
		return &TxErr{code: TxErrWriteAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

func removeAttributeViewColumnOption(operation *Operation) (err error) {
	attrView, err := av.ParseAttributeView(operation.AvID)
	if nil != err {
		return
	}

	optName := operation.Data.(string)

	key, err := attrView.GetKey(operation.ID)
	if nil != err {
		return
	}

	for i, opt := range key.Options {
		if optName == opt.Name {
			key.Options = append(key.Options[:i], key.Options[i+1:]...)
			break
		}
	}

	for _, keyValues := range attrView.KeyValues {
		if keyValues.Key.ID != operation.ID {
			continue
		}

		for _, value := range keyValues.Values {
			if nil == value || nil == value.MSelect {
				continue
			}

			for i, opt := range value.MSelect {
				if optName == opt.Content {
					value.MSelect = append(value.MSelect[:i], value.MSelect[i+1:]...)
					break
				}
			}
		}
		break
	}

	err = av.SaveAttributeView(attrView)
	return
}

func (tx *Transaction) doUpdateAttrViewColOption(operation *Operation) (ret *TxErr) {
	err := updateAttributeViewColumnOption(operation)
	if nil != err {
		return &TxErr{code: TxErrWriteAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

func updateAttributeViewColumnOption(operation *Operation) (err error) {
	attrView, err := av.ParseAttributeView(operation.AvID)
	if nil != err {
		return
	}

	key, err := attrView.GetKey(operation.ID)
	if nil != err {
		return
	}

	data := operation.Data.(map[string]interface{})

	oldName := data["oldName"].(string)
	newName := data["newName"].(string)
	newColor := data["newColor"].(string)

	for i, opt := range key.Options {
		if oldName == opt.Name {
			key.Options[i].Name = newName
			key.Options[i].Color = newColor
			break
		}
	}

	for _, keyValues := range attrView.KeyValues {
		if keyValues.Key.ID != operation.ID {
			continue
		}

		for _, value := range keyValues.Values {
			if nil == value || nil == value.MSelect {
				continue
			}

			for i, opt := range value.MSelect {
				if oldName == opt.Content {
					value.MSelect[i].Content = newName
					value.MSelect[i].Color = newColor
					break
				}
			}
		}
		break
	}

	err = av.SaveAttributeView(attrView)
	return
}

const (
	NodeAttrNameAvs         = "custom-avs"     // 用于标记块所属的属性视图，逗号分隔 av id
	NodeAttrNamePrefixAvKey = "custom-av-key-" // 用于标记列
)
