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

package api

import (
	"errors"
	"fmt"

	"github.com/88250/gulu"
	"github.com/88250/lute"
	"github.com/88250/lute/ast"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func buildUpdatedTaskListItemBlockDOM(id, marker string, luteEngine *lute.Lute) (data string, err error) {
	block, err := model.GetBlock(id, nil)
	if err != nil {
		return "", errors.New("get block failed: " + err.Error())
	}

	if "NodeListItem" != block.Type {
		return "", errors.New("block is not a list item")
	}

	tree, err := filesys.LoadTree(block.Box, block.Path, luteEngine)
	if err != nil {
		return "", errors.New("load tree failed: " + err.Error())
	}

	li := treenode.GetNodeInTree(tree, id)
	if li == nil {
		return "", errors.New("block not found")
	}

	if 3 != li.ListData.Typ {
		return "", errors.New("block is not a task list item")
	}

	if 1 != len(marker) {
		return "", errors.New("task list item marker length should be 1")
	}

	liMarker := marker[0]
	if '[' == liMarker || ']' == liMarker {
		return "", errors.New("task list item marker can not be [ or ]")
	}

	markerNode := li.ChildByType(ast.NodeTaskListItemMarker)
	if nil == markerNode {
		return "", errors.New("task list item marker not found")
	}

	markerNode.TaskListItemMarker = liMarker
	markerNode.TaskListItemChecked = ' ' != markerNode.TaskListItemMarker

	treenode.RefreshUpdated(li)

	return luteEngine.RenderNodeBlockDOM(li), nil
}

var updateTaskListItemMarker = contractHandler(apicontract.UpdateTaskListItemMarker, func(c *gin.Context, request apicontract.TaskListMarkerRequest) apicontract.Response[[]*apicontract.BlockTransaction] {
	ret := gulu.Ret.NewResult()

	id, marker := request.ID, request.Marker
	if util.InvalidIDPattern(id, ret) {
		return contractFailure[[]*apicontract.BlockTransaction](ret)
	}

	luteEngine := util.NewLute()
	data, err := buildUpdatedTaskListItemBlockDOM(id, marker, luteEngine)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return contractFailure[[]*apicontract.BlockTransaction](ret)
	}

	transactions := []*model.Transaction{
		{
			DoOperations: []*model.Operation{
				{Action: "update", ID: id, Data: data},
			},
		},
	}

	model.PerformTransactions(&transactions)
	model.FlushTxQueue()

	broadcastTransactions(transactions)
	return blockTransactionsResponse(transactions)
})

var batchUpdateTaskListItemMarker = contractHandler(apicontract.BatchUpdateTaskListItemMarker, func(c *gin.Context, request apicontract.BatchTaskListMarkerRequest) apicontract.Response[[]*apicontract.BlockTransaction] {
	ret := gulu.Ret.NewResult()

	itemsArg := request.Items
	if len(itemsArg) == 0 {
		return apicontract.Failure[[]*apicontract.BlockTransaction](-1, "Field [items] must not be empty")
	}
	luteEngine := util.NewLute()
	idToMarker := make(map[string]string, len(itemsArg))
	idsInOrder := make([]string, 0, len(itemsArg))
	for _, itemArg := range itemsArg {
		id, marker := itemArg.ID, itemArg.Marker
		if util.InvalidIDPattern(id, ret) {
			return contractFailure[[]*apicontract.BlockTransaction](ret)
		}
		// 相同 id 保留最后一个 marker
		idToMarker[id] = marker
		idsInOrder = append(idsInOrder, id)
	}

	ids := gulu.Str.RemoveDuplicatedElem(idsInOrder)
	ops := make([]*model.Operation, 0, len(ids))
	for _, id := range ids {
		data, err := buildUpdatedTaskListItemBlockDOM(id, idToMarker[id], luteEngine)
		if err != nil {
			ret.Code = -1
			ret.Msg = err.Error()
			return contractFailure[[]*apicontract.BlockTransaction](ret)
		}

		ops = append(ops, &model.Operation{Action: "update", ID: id, Data: data})
	}

	tx := &model.Transaction{DoOperations: ops}
	transactions := []*model.Transaction{tx}

	model.PerformTransactions(&transactions)
	model.FlushTxQueue()

	broadcastTransactions(transactions)
	return blockTransactionsResponse(transactions)
})

var moveOutlineHeading = contractHandler(apicontract.MoveOutlineHeading, func(c *gin.Context, request apicontract.MoveBlockRequest) apicontract.Response[[]*apicontract.BlockTransaction] {
	ret := gulu.Ret.NewResult()

	id := request.ID
	if util.InvalidIDPattern(id, ret) {
		return contractFailure[[]*apicontract.BlockTransaction](ret)
	}

	var parentID, previousID string
	if request.ParentID != nil {
		parentID = *request.ParentID
		if "" != parentID && util.InvalidIDPattern(parentID, ret) {
			return contractFailure[[]*apicontract.BlockTransaction](ret)
		}
	}
	if request.PreviousID != nil {
		previousID = *request.PreviousID
		if "" != previousID && util.InvalidIDPattern(previousID, ret) {
			return contractFailure[[]*apicontract.BlockTransaction](ret)
		}
	}

	transactions := []*model.Transaction{
		{
			DoOperations: []*model.Operation{
				{
					Action:     "moveOutlineHeading",
					ID:         id,
					PreviousID: previousID,
					ParentID:   parentID,
				},
			},
		},
	}

	model.PerformTransactions(&transactions)
	model.FlushTxQueue()

	broadcastTransactions(transactions)
	return blockTransactionsResponse(transactions)
})

var appendDailyNoteBlock = contractHandler(apicontract.AppendDailyNoteBlock, func(c *gin.Context, request apicontract.DailyNoteBlockRequest) apicontract.Response[[]*apicontract.BlockTransaction] {
	ret := gulu.Ret.NewResult()

	data, dataType, boxID := request.Data, request.DataType, request.Notebook
	if util.InvalidIDPattern(boxID, ret) {
		return contractFailure[[]*apicontract.BlockTransaction](ret)
	}
	if "markdown" == dataType {
		luteEngine := util.NewLute()
		var err error
		data, err = dataBlockDOM(data, luteEngine)
		if err != nil {
			ret.Code = -1
			ret.Msg = "data block DOM failed: " + err.Error()
			return contractFailure[[]*apicontract.BlockTransaction](ret)
		}
	}

	p, _, err := model.CreateDailyNote(boxID)
	if err != nil {
		ret.Code = -1
		ret.Msg = "create daily note failed: " + err.Error()
		return contractFailure[[]*apicontract.BlockTransaction](ret)
	}

	parentID := util.GetTreeID(p)
	transactions := []*model.Transaction{
		{
			DoOperations: []*model.Operation{
				{
					Action:   "appendInsert",
					Data:     data,
					ParentID: parentID,
				},
			},
		},
	}

	model.PerformTransactions(&transactions)
	model.FlushTxQueue()

	broadcastTransactions(transactions)
	return blockTransactionsResponse(transactions)
})

var prependDailyNoteBlock = contractHandler(apicontract.PrependDailyNoteBlock, func(c *gin.Context, request apicontract.DailyNoteBlockRequest) apicontract.Response[[]*apicontract.BlockTransaction] {
	ret := gulu.Ret.NewResult()

	data, dataType, boxID := request.Data, request.DataType, request.Notebook
	if util.InvalidIDPattern(boxID, ret) {
		return contractFailure[[]*apicontract.BlockTransaction](ret)
	}
	if "markdown" == dataType {
		luteEngine := util.NewLute()
		var err error
		data, err = dataBlockDOM(data, luteEngine)
		if err != nil {
			ret.Code = -1
			ret.Msg = "data block DOM failed: " + err.Error()
			return contractFailure[[]*apicontract.BlockTransaction](ret)
		}
	}

	p, _, err := model.CreateDailyNote(boxID)
	if err != nil {
		ret.Code = -1
		ret.Msg = "create daily note failed: " + err.Error()
		return contractFailure[[]*apicontract.BlockTransaction](ret)
	}

	parentID := util.GetTreeID(p)
	transactions := []*model.Transaction{
		{
			DoOperations: []*model.Operation{
				{
					Action:   "prependInsert",
					Data:     data,
					ParentID: parentID,
				},
			},
		},
	}

	model.PerformTransactions(&transactions)
	model.FlushTxQueue()

	broadcastTransactions(transactions)
	return blockTransactionsResponse(transactions)
})

var unfoldBlock = contractHandler(apicontract.UnfoldBlock, func(c *gin.Context, request apicontract.BlockIDRequest) apicontract.Response[apicontract.Null] {
	ret := gulu.Ret.NewResult()

	id := request.ID
	if util.InvalidIDPattern(id, ret) {
		return contractFailure[apicontract.Null](ret)
	}

	bt := treenode.GetBlockTree(id)
	if nil == bt {
		ret.Code = -1
		ret.Msg = "block tree not found [id=" + id + "]"
		return contractFailure[apicontract.Null](ret)
	}

	if bt.Type == "d" {
		ret.Code = -1
		ret.Msg = "document can not be unfolded"
		return contractFailure[apicontract.Null](ret)
	}

	var transactions []*model.Transaction
	if "h" == bt.Type {
		transactions = []*model.Transaction{
			{
				DoOperations: []*model.Operation{
					{
						Action: "unfoldHeading",
						ID:     id,
					},
				},
			},
		}
	} else {
		data, _ := gulu.JSON.MarshalJSON(map[string]any{"fold": ""})
		transactions = []*model.Transaction{
			{
				DoOperations: []*model.Operation{
					{
						Action: "setAttrs",
						ID:     id,
						Data:   string(data),
					},
				},
			},
		}
	}

	model.PerformTransactions(&transactions)
	model.FlushTxQueue()

	broadcastTransactions(transactions)
	return apicontract.Success(apicontract.Null{})
})

var foldBlock = contractHandler(apicontract.FoldBlock, func(c *gin.Context, request apicontract.BlockIDRequest) apicontract.Response[apicontract.Null] {
	ret := gulu.Ret.NewResult()

	id := request.ID
	if util.InvalidIDPattern(id, ret) {
		return contractFailure[apicontract.Null](ret)
	}

	bt := treenode.GetBlockTree(id)
	if nil == bt {
		ret.Code = -1
		ret.Msg = "block tree not found [id=" + id + "]"
		return contractFailure[apicontract.Null](ret)
	}

	if bt.Type == "d" {
		ret.Code = -1
		ret.Msg = "document can not be folded"
		return contractFailure[apicontract.Null](ret)
	}

	var transactions []*model.Transaction
	if "h" == bt.Type {
		transactions = []*model.Transaction{
			{
				DoOperations: []*model.Operation{
					{
						Action: "foldHeading",
						ID:     id,
					},
				},
			},
		}
	} else {
		data, _ := gulu.JSON.MarshalJSON(map[string]any{"fold": "1"})
		transactions = []*model.Transaction{
			{
				DoOperations: []*model.Operation{
					{
						Action: "setAttrs",
						ID:     id,
						Data:   string(data),
					},
				},
			},
		}
	}

	model.PerformTransactions(&transactions)
	model.FlushTxQueue()

	broadcastTransactions(transactions)
	return apicontract.Success(apicontract.Null{})
})

var moveBlock = contractHandler(apicontract.MoveBlock, func(c *gin.Context, request apicontract.MoveBlockRequest) apicontract.Response[apicontract.Null] {
	ret := gulu.Ret.NewResult()

	id := request.ID
	if util.InvalidIDPattern(id, ret) {
		return contractFailure[apicontract.Null](ret)
	}

	currentBt := treenode.GetBlockTree(id)
	if nil == currentBt {
		ret.Code = -1
		ret.Msg = "block not found [id=" + id + "]"
		return contractFailure[apicontract.Null](ret)
	}

	var parentID, previousID string
	if request.ParentID != nil {
		parentID = *request.ParentID
		if "" != parentID && util.InvalidIDPattern(parentID, ret) {
			return contractFailure[apicontract.Null](ret)
		}
	}
	if request.PreviousID != nil {
		previousID = *request.PreviousID
		if "" != previousID && util.InvalidIDPattern(previousID, ret) {
			return contractFailure[apicontract.Null](ret)
		}

		// Check the validity of the API `moveBlock` parameter `previousID` https://github.com/siyuan-note/siyuan/issues/8007
		if bt := treenode.GetBlockTree(previousID); nil == bt || "d" == bt.Type {
			ret.Code = -1
			ret.Msg = "`previousID` can not be the ID of a document"
			return contractFailure[apicontract.Null](ret)
		}
	}

	var targetBt *treenode.BlockTree
	if "" != previousID {
		targetBt = treenode.GetBlockTree(previousID)
	} else if "" != parentID {
		targetBt = treenode.GetBlockTree(parentID)
	}

	if nil == targetBt {
		ret.Code = -1
		ret.Msg = "target block not found [id=" + parentID + "]"
		return contractFailure[apicontract.Null](ret)
	}

	// 仅靠 parentID 定位目标时（无 previousID），目标必须是容器块，否则非法嵌套
	if "" == previousID && "" != parentID {
		if err := treenode.CheckListItemNesting(parentID, id); err != nil {
			ret.Code = -1
			ret.Msg = err.Error()
			return contractFailure[apicontract.Null](ret)
		}
		if err := treenode.CheckContainerParent(parentID); err != nil {
			ret.Code = -1
			ret.Msg = err.Error()
			return contractFailure[apicontract.Null](ret)
		}
	}

	transactions := []*model.Transaction{
		{
			DoOperations: []*model.Operation{
				{
					Action:     "move",
					ID:         id,
					PreviousID: previousID,
					ParentID:   parentID,
				},
			},
		},
	}

	model.PerformTransactions(&transactions)
	model.FlushTxQueue()

	model.ReloadProtyle(currentBt.RootID)
	if currentBt.RootID != targetBt.RootID {
		model.ReloadProtyle(targetBt.RootID)
	}
	return apicontract.Success(apicontract.Null{})
})

var appendBlock = contractHandler(apicontract.AppendBlock, func(c *gin.Context, request apicontract.AppendBlockRequest) apicontract.Response[[]*apicontract.BlockTransaction] {
	ret := gulu.Ret.NewResult()

	data, dataType, parentID := request.Data, request.DataType, request.ParentID
	if dataType != "markdown" && dataType != "dom" {
		ret.Code = -1
		ret.Msg = "dataType must be markdown or dom"
		return contractFailure[[]*apicontract.BlockTransaction](ret)
	}
	if util.InvalidIDPattern(parentID, ret) {
		return contractFailure[[]*apicontract.BlockTransaction](ret)
	}
	if "markdown" == dataType {
		luteEngine := util.NewLute()
		var err error
		data, err = dataBlockDOM(data, luteEngine)
		if err != nil {
			ret.Code = -1
			ret.Msg = "data block DOM failed: " + err.Error()
			return contractFailure[[]*apicontract.BlockTransaction](ret)
		}
	}

	transactions, err := model.PerformBlockOperation(&model.Operation{
		Action:   "appendInsert",
		Data:     data,
		ParentID: parentID,
	})
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return contractFailure[[]*apicontract.BlockTransaction](ret)
	}

	broadcastTransactions(transactions)
	return blockTransactionsResponse(transactions)
})

var batchAppendBlock = contractHandler(apicontract.BatchAppendBlock, func(c *gin.Context, request apicontract.BatchParentBlockRequest) apicontract.Response[[]*apicontract.BlockTransaction] {
	ret := gulu.Ret.NewResult()

	blocksArg := request.Blocks
	var transactions []*model.Transaction
	luteEngine := util.NewLute()
	for _, blockArg := range blocksArg {
		data := blockArg.Data
		dataType := blockArg.DataType
		parentID := blockArg.ParentID
		if util.InvalidIDPattern(parentID, ret) {
			return contractFailure[[]*apicontract.BlockTransaction](ret)
		}
		// append 只用 parentID 定位目标，目标必须是容器块，否则非法嵌套
		if err := treenode.CheckContainerParent(parentID); err != nil {
			ret.Code = -1
			ret.Msg = err.Error()
			return contractFailure[[]*apicontract.BlockTransaction](ret)
		}
		if "markdown" == dataType {
			var err error
			data, err = dataBlockDOM(data, luteEngine)
			if err != nil {
				ret.Code = -1
				ret.Msg = "data block DOM failed: " + err.Error()
				return contractFailure[[]*apicontract.BlockTransaction](ret)
			}
		}

		transactions = append(transactions, &model.Transaction{
			DoOperations: []*model.Operation{
				{
					Action:   "appendInsert",
					Data:     data,
					ParentID: parentID,
				},
			},
		})
	}

	model.PerformTransactions(&transactions)
	model.FlushTxQueue()

	broadcastTransactions(transactions)
	return blockTransactionsResponse(transactions)
})

var prependBlock = contractHandler(apicontract.PrependBlock, func(c *gin.Context, request apicontract.PrependBlockRequest) apicontract.Response[[]*apicontract.BlockTransaction] {
	ret := gulu.Ret.NewResult()

	data, dataType, parentID := request.Data, request.DataType, request.ParentID
	if util.InvalidIDPattern(parentID, ret) {
		return contractFailure[[]*apicontract.BlockTransaction](ret)
	}
	// prepend 只用 parentID 定位目标，目标必须是容器块，否则非法嵌套
	if err := treenode.CheckContainerParent(parentID); err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return contractFailure[[]*apicontract.BlockTransaction](ret)
	}
	if "markdown" == dataType {
		luteEngine := util.NewLute()
		var err error
		data, err = dataBlockDOM(data, luteEngine)
		if err != nil {
			ret.Code = -1
			ret.Msg = "data block DOM failed: " + err.Error()
			return contractFailure[[]*apicontract.BlockTransaction](ret)
		}
	}

	transactions := []*model.Transaction{
		{
			DoOperations: []*model.Operation{
				{
					Action:   "prependInsert",
					Data:     data,
					ParentID: parentID,
				},
			},
		},
	}

	model.PerformTransactions(&transactions)
	model.FlushTxQueue()

	broadcastTransactions(transactions)
	return blockTransactionsResponse(transactions)
})

var batchPrependBlock = contractHandler(apicontract.BatchPrependBlock, func(c *gin.Context, request apicontract.BatchParentBlockRequest) apicontract.Response[[]*apicontract.BlockTransaction] {
	ret := gulu.Ret.NewResult()

	blocksArg := request.Blocks
	var transactions []*model.Transaction
	luteEngine := util.NewLute()
	for _, blockArg := range blocksArg {
		data := blockArg.Data
		dataType := blockArg.DataType
		parentID := blockArg.ParentID
		if util.InvalidIDPattern(parentID, ret) {
			return contractFailure[[]*apicontract.BlockTransaction](ret)
		}
		// prepend 只用 parentID 定位目标，目标必须是容器块，否则非法嵌套
		if err := treenode.CheckContainerParent(parentID); err != nil {
			ret.Code = -1
			ret.Msg = err.Error()
			return contractFailure[[]*apicontract.BlockTransaction](ret)
		}
		if "markdown" == dataType {
			var err error
			data, err = dataBlockDOM(data, luteEngine)
			if err != nil {
				ret.Code = -1
				ret.Msg = "data block DOM failed: " + err.Error()
				return contractFailure[[]*apicontract.BlockTransaction](ret)
			}
		}

		transactions = append(transactions, &model.Transaction{
			DoOperations: []*model.Operation{
				{
					Action:   "prependInsert",
					Data:     data,
					ParentID: parentID,
				},
			},
		})
	}

	model.PerformTransactions(&transactions)
	model.FlushTxQueue()

	broadcastTransactions(transactions)
	return blockTransactionsResponse(transactions)
})

var insertBlock = contractHandler(apicontract.InsertBlock, func(c *gin.Context, request apicontract.InsertBlockRequest) apicontract.Response[[]*apicontract.BlockTransaction] {
	ret := gulu.Ret.NewResult()

	data, dataType, parentID, previousID, nextID := request.Data, request.DataType, request.ParentID, request.PreviousID, request.NextID
	if dataType != "markdown" && dataType != "dom" {
		ret.Code = -1
		ret.Msg = "dataType must be markdown or dom"
		return contractFailure[[]*apicontract.BlockTransaction](ret)
	}
	if parentID == "" && previousID == "" && nextID == "" {
		ret.Code = -1
		ret.Msg = "at least one of parentID, previousID or nextID is required"
		return contractFailure[[]*apicontract.BlockTransaction](ret)
	}
	for _, id := range []string{parentID, previousID, nextID} {
		if id != "" && util.InvalidIDPattern(id, ret) {
			return contractFailure[[]*apicontract.BlockTransaction](ret)
		}
	}
	if "markdown" == dataType {
		luteEngine := util.NewLute()
		var err error
		data, err = dataBlockDOM(data, luteEngine)
		if err != nil {
			ret.Code = -1
			ret.Msg = "data block DOM failed: " + err.Error()
			return contractFailure[[]*apicontract.BlockTransaction](ret)
		}
	}

	transactions, err := model.PerformBlockOperation(&model.Operation{
		Action:     "insert",
		Data:       data,
		ParentID:   parentID,
		PreviousID: previousID,
		NextID:     nextID,
	})
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return contractFailure[[]*apicontract.BlockTransaction](ret)
	}

	broadcastTransactions(transactions)
	return blockTransactionsResponse(transactions)
})

var updateBlock = contractHandler(apicontract.UpdateBlock, func(c *gin.Context, request apicontract.UpdateBlockRequest) apicontract.Response[[]*apicontract.BlockTransaction] {
	ret := gulu.Ret.NewResult()

	input := blockUpdateInput(request)
	if util.InvalidIDPattern(input.ID, ret) {
		return contractFailure[[]*apicontract.BlockTransaction](ret)
	}
	transactions, _, err := model.PerformBlockUpdates([]model.BlockUpdateInput{input})
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return contractFailure[[]*apicontract.BlockTransaction](ret)
	}

	broadcastTransactions(transactions)
	return blockTransactionsResponse(transactions)
})

var batchInsertBlock = contractHandler(apicontract.BatchInsertBlock, func(c *gin.Context, request apicontract.BatchInsertBlockRequest) apicontract.Response[[]*apicontract.BlockTransaction] {
	ret := gulu.Ret.NewResult()

	blocksArg := request.Blocks
	var transactions []*model.Transaction
	luteEngine := util.NewLute()
	for _, blockArg := range blocksArg {
		data, dataType := blockArg.Data, blockArg.DataType
		parentID, previousID, nextID := blockArg.ParentID, blockArg.PreviousID, blockArg.NextID
		for _, id := range []string{parentID, previousID, nextID} {
			if id != "" && util.InvalidIDPattern(id, ret) {
				return contractFailure[[]*apicontract.BlockTransaction](ret)
			}
		}
		// 仅靠 parentID 定位目标时（无 previousID/nextID），目标必须是容器块，否则非法嵌套
		if "" != parentID && "" == previousID && "" == nextID {
			if err := treenode.CheckContainerParent(parentID); err != nil {
				ret.Code = -1
				ret.Msg = err.Error()
				return contractFailure[[]*apicontract.BlockTransaction](ret)
			}
		}

		if "markdown" == dataType {
			var err error
			data, err = dataBlockDOM(data, luteEngine)
			if err != nil {
				ret.Code = -1
				ret.Msg = "data block DOM failed: " + err.Error()
				return contractFailure[[]*apicontract.BlockTransaction](ret)
			}
		}

		transactions = append(transactions, &model.Transaction{
			DoOperations: []*model.Operation{
				{
					Action:     "insert",
					Data:       data,
					ParentID:   parentID,
					PreviousID: previousID,
					NextID:     nextID,
				},
			},
		})
	}

	model.PerformTransactions(&transactions)
	model.FlushTxQueue()

	broadcastTransactions(transactions)
	return blockTransactionsResponse(transactions)
})

var batchUpdateBlock = contractHandler(apicontract.BatchUpdateBlock, func(c *gin.Context, request apicontract.BatchUpdateBlockRequest) apicontract.Response[[]*apicontract.BlockTransaction] {
	ret := gulu.Ret.NewResult()

	if len(request.Blocks) == 0 {
		return apicontract.Failure[[]*apicontract.BlockTransaction](-1, "Field [blocks] must not be empty")
	}
	inputs := make([]model.BlockUpdateInput, 0, len(request.Blocks))
	for i, block := range request.Blocks {
		input := blockUpdateInput(block)
		if util.InvalidIDPattern(input.ID, ret) {
			ret.Msg = fmt.Sprintf("blocks[%d]: %s", i, ret.Msg)
			return contractFailure[[]*apicontract.BlockTransaction](ret)
		}
		inputs = append(inputs, input)
	}
	transactions, _, err := model.PerformBlockUpdates(inputs)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return contractFailure[[]*apicontract.BlockTransaction](ret)
	}

	broadcastTransactions(transactions)
	return blockTransactionsResponse(transactions)
})

var deleteBlock = contractHandler(apicontract.DeleteBlock, func(c *gin.Context, request apicontract.DeleteBlockRequest) apicontract.Response[[]*apicontract.BlockTransaction] {
	ret := gulu.Ret.NewResult()

	id := request.ID
	if util.InvalidIDPattern(id, ret) {
		return contractFailure[[]*apicontract.BlockTransaction](ret)
	}

	transactions, err := model.PerformBlockOperation(&model.Operation{
		Action: "delete",
		ID:     id,
	})
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return contractFailure[[]*apicontract.BlockTransaction](ret)
	}

	broadcastTransactions(transactions)
	return blockTransactionsResponse(transactions)
})

func broadcastTransactions(transactions []*model.Transaction) {
	evt := util.NewCmdResult("transactions", 0, util.PushModeBroadcast)
	evt.Data = transactions
	util.PushEvent(evt)
}

func dataBlockDOM(data string, luteEngine *lute.Lute) (ret string, err error) {
	return model.DataBlockDOM(data, luteEngine)
}

func blockUpdateInput(request apicontract.UpdateBlockRequest) model.BlockUpdateInput {
	return model.BlockUpdateInput{ID: request.ID, Data: request.Data, DataType: request.DataType, LockType: request.LockType}
}
