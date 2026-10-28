// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

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

	id, marker := request.ID, request.Marker
	if err := util.ValidateID(id); err != nil {
		return apicontract.FailureFrom[[]*apicontract.BlockTransaction](err)
	}

	luteEngine := util.NewLute()
	data, err := buildUpdatedTaskListItemBlockDOM(id, marker, luteEngine)
	if err != nil {
		return apicontract.Failure[[]*apicontract.BlockTransaction](-1, err.Error())
	}

	transactions := []*model.Transaction{
		{
			DoOperations: []*model.Operation{
				{Action: "update", ID: id, Data: data},
			},
		},
	}

	if err := model.PerformBlockTransactions(transactions); err != nil {
		return apicontract.Failure[[]*apicontract.BlockTransaction](-1, err.Error())
	}

	broadcastTransactions(transactions)
	return blockTransactionsResponse(transactions)
})

var batchUpdateTaskListItemMarker = contractHandler(apicontract.BatchUpdateTaskListItemMarker, func(c *gin.Context, request apicontract.BatchTaskListMarkerRequest) apicontract.Response[[]*apicontract.BlockTransaction] {

	itemsArg := request.Items
	if len(itemsArg) == 0 {
		return apicontract.Failure[[]*apicontract.BlockTransaction](-1, "Field [items] must not be empty")
	}
	luteEngine := util.NewLute()
	idToMarker := make(map[string]string, len(itemsArg))
	idsInOrder := make([]string, 0, len(itemsArg))
	for _, itemArg := range itemsArg {
		id, marker := itemArg.ID, itemArg.Marker
		if err := util.ValidateID(id); err != nil {
			return apicontract.FailureFrom[[]*apicontract.BlockTransaction](err)
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
			return apicontract.Failure[[]*apicontract.BlockTransaction](-1, err.Error())
		}

		ops = append(ops, &model.Operation{Action: "update", ID: id, Data: data})
	}

	tx := &model.Transaction{DoOperations: ops}
	transactions := []*model.Transaction{tx}

	if err := model.PerformBlockTransactions(transactions); err != nil {
		return apicontract.Failure[[]*apicontract.BlockTransaction](-1, err.Error())
	}

	broadcastTransactions(transactions)
	return blockTransactionsResponse(transactions)
})

var moveOutlineHeading = contractHandler(apicontract.MoveOutlineHeading, func(c *gin.Context, request apicontract.MoveBlockRequest) apicontract.Response[[]*apicontract.BlockTransaction] {
	id := request.ID
	if err := util.ValidateID(id); err != nil {
		return apicontract.FailureFrom[[]*apicontract.BlockTransaction](err)
	}

	var parentID, previousID string
	if request.ParentID != nil {
		parentID = *request.ParentID
		if err := util.ValidateOptionalID(parentID); err != nil {
			return apicontract.FailureFrom[[]*apicontract.BlockTransaction](err)
		}
	}
	if request.PreviousID != nil {
		previousID = *request.PreviousID
		if err := util.ValidateOptionalID(previousID); err != nil {
			return apicontract.FailureFrom[[]*apicontract.BlockTransaction](err)
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

	if err := model.PerformBlockTransactions(transactions); err != nil {
		return apicontract.Failure[[]*apicontract.BlockTransaction](-1, err.Error())
	}

	broadcastTransactions(transactions)
	return blockTransactionsResponse(transactions)
})

var appendDailyNoteBlock = contractHandler(apicontract.AppendDailyNoteBlock, func(c *gin.Context, request apicontract.DailyNoteBlockRequest) apicontract.Response[[]*apicontract.BlockTransaction] {

	data, dataType, boxID := request.Data, request.DataType, request.Notebook
	if err := util.ValidateID(boxID); err != nil {
		return apicontract.FailureFrom[[]*apicontract.BlockTransaction](err)
	}
	if "markdown" == dataType {
		luteEngine := util.NewLute()
		var err error
		data, err = dataBlockDOM(data, luteEngine)
		if err != nil {
			return apicontract.Failure[[]*apicontract.BlockTransaction](-1, "data block DOM failed: "+err.Error())
		}
	}

	p, _, err := model.CreateDailyNote(boxID)
	if err != nil {
		return apicontract.Failure[[]*apicontract.BlockTransaction](-1, "create daily note failed: "+err.Error())
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

	if err := model.PerformBlockTransactions(transactions); err != nil {
		return apicontract.Failure[[]*apicontract.BlockTransaction](-1, err.Error())
	}

	broadcastTransactions(transactions)
	return blockTransactionsResponse(transactions)
})

var prependDailyNoteBlock = contractHandler(apicontract.PrependDailyNoteBlock, func(c *gin.Context, request apicontract.DailyNoteBlockRequest) apicontract.Response[[]*apicontract.BlockTransaction] {

	data, dataType, boxID := request.Data, request.DataType, request.Notebook
	if err := util.ValidateID(boxID); err != nil {
		return apicontract.FailureFrom[[]*apicontract.BlockTransaction](err)
	}
	if "markdown" == dataType {
		luteEngine := util.NewLute()
		var err error
		data, err = dataBlockDOM(data, luteEngine)
		if err != nil {
			return apicontract.Failure[[]*apicontract.BlockTransaction](-1, "data block DOM failed: "+err.Error())
		}
	}

	p, _, err := model.CreateDailyNote(boxID)
	if err != nil {
		return apicontract.Failure[[]*apicontract.BlockTransaction](-1, "create daily note failed: "+err.Error())
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

	if err := model.PerformBlockTransactions(transactions); err != nil {
		return apicontract.Failure[[]*apicontract.BlockTransaction](-1, err.Error())
	}

	broadcastTransactions(transactions)
	return blockTransactionsResponse(transactions)
})

var unfoldBlock = contractHandler(apicontract.UnfoldBlock, func(c *gin.Context, request apicontract.BlockIDRequest) apicontract.Response[apicontract.Null] {

	id := request.ID
	if err := util.ValidateID(id); err != nil {
		return apicontract.FailureFrom[apicontract.Null](err)
	}

	bt := treenode.GetBlockTree(id)
	if nil == bt {
		return apicontract.Failure[apicontract.Null](-1, "block tree not found [id="+id+"]")
	}

	if bt.Type == "d" {
		return apicontract.Failure[apicontract.Null](-1, "document can not be unfolded")
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

	if err := model.PerformBlockTransactions(transactions); err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}

	broadcastTransactions(transactions)
	return apicontract.Success(apicontract.Null{})
})

var foldBlock = contractHandler(apicontract.FoldBlock, func(c *gin.Context, request apicontract.BlockIDRequest) apicontract.Response[apicontract.Null] {

	id := request.ID
	if err := util.ValidateID(id); err != nil {
		return apicontract.FailureFrom[apicontract.Null](err)
	}

	bt := treenode.GetBlockTree(id)
	if nil == bt {
		return apicontract.Failure[apicontract.Null](-1, "block tree not found [id="+id+"]")
	}

	if bt.Type == "d" {
		return apicontract.Failure[apicontract.Null](-1, "document can not be folded")
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

	if err := model.PerformBlockTransactions(transactions); err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}

	broadcastTransactions(transactions)
	return apicontract.Success(apicontract.Null{})
})

var moveBlock = contractHandler(apicontract.MoveBlock, func(c *gin.Context, request apicontract.MoveBlockRequest) apicontract.Response[apicontract.Null] {

	id := request.ID
	if err := util.ValidateID(id); err != nil {
		return apicontract.FailureFrom[apicontract.Null](err)
	}

	currentBt := treenode.GetBlockTree(id)
	if nil == currentBt {
		return apicontract.Failure[apicontract.Null](-1, "block not found [id="+id+"]")
	}

	var parentID, previousID string
	if request.ParentID != nil {
		parentID = *request.ParentID
		if err := util.ValidateOptionalID(parentID); err != nil {
			return apicontract.FailureFrom[apicontract.Null](err)
		}
	}
	if request.PreviousID != nil {
		previousID = *request.PreviousID
		if err := util.ValidateOptionalID(previousID); err != nil {
			return apicontract.FailureFrom[apicontract.Null](err)
		}

		// Check the validity of the API `moveBlock` parameter `previousID` https://github.com/siyuan-note/siyuan/issues/8007
		// 文档与不存在的块需要分别提示：文档 ID 格式合法但不是同级锚点，块不存在则是调用方传了失效 ID。
		if bt := treenode.GetBlockTree(previousID); nil == bt {
			return apicontract.Failure[apicontract.Null](-1, "`previousID` block not found")
		} else if "d" == bt.Type {
			return apicontract.Failure[apicontract.Null](-1, "`previousID` can not be the ID of a document")
		}
	}

	var targetBt *treenode.BlockTree
	if "" != previousID {
		targetBt = treenode.GetBlockTree(previousID)
	} else if "" != parentID {
		targetBt = treenode.GetBlockTree(parentID)
	}

	if nil == targetBt {
		return apicontract.Failure[apicontract.Null](-1, "target block not found [id="+parentID+"]")
	}

	// 仅靠 parentID 定位目标时（无 previousID），目标必须是容器块，否则非法嵌套
	if "" == previousID && "" != parentID {
		if err := treenode.CheckListItemNesting(parentID, id); err != nil {
			return apicontract.Failure[apicontract.Null](-1, err.Error())
		}
		if err := treenode.CheckContainerParent(parentID); err != nil {
			return apicontract.Failure[apicontract.Null](-1, err.Error())
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

	if err := model.PerformTransactionSync(transactions[0]); err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}

	model.ReloadProtyle(currentBt.RootID)
	if currentBt.RootID != targetBt.RootID {
		model.ReloadProtyle(targetBt.RootID)
	}
	return apicontract.Success(apicontract.Null{})
})

var appendBlock = contractHandler(apicontract.AppendBlock, func(c *gin.Context, request apicontract.AppendBlockRequest) apicontract.Response[[]*apicontract.BlockTransaction] {

	data, dataType, parentID := request.Data, request.DataType, request.ParentID
	if dataType != "markdown" && dataType != "dom" {
		return apicontract.Failure[[]*apicontract.BlockTransaction](-1, "dataType must be markdown or dom")
	}
	if err := util.ValidateID(parentID); err != nil {
		return apicontract.FailureFrom[[]*apicontract.BlockTransaction](err)
	}
	if "markdown" == dataType {
		luteEngine := util.NewLute()
		var err error
		data, err = dataBlockDOM(data, luteEngine)
		if err != nil {
			return apicontract.Failure[[]*apicontract.BlockTransaction](-1, "data block DOM failed: "+err.Error())
		}
	}

	transactions, err := model.PerformBlockOperation(&model.Operation{
		Action:   "appendInsert",
		Data:     data,
		ParentID: parentID,
	})
	if err != nil {
		return apicontract.Failure[[]*apicontract.BlockTransaction](-1, err.Error())
	}

	broadcastTransactions(transactions)
	return blockTransactionsResponse(transactions)
})

var batchAppendBlock = contractHandler(apicontract.BatchAppendBlock, func(c *gin.Context, request apicontract.BatchParentBlockRequest) apicontract.Response[[]*apicontract.BlockTransaction] {

	blocksArg := request.Blocks
	var transactions []*model.Transaction
	luteEngine := util.NewLute()
	for _, blockArg := range blocksArg {
		data := blockArg.Data
		dataType := blockArg.DataType
		parentID := blockArg.ParentID
		if err := util.ValidateID(parentID); err != nil {
			return apicontract.FailureFrom[[]*apicontract.BlockTransaction](err)
		}
		// append 只用 parentID 定位目标，目标必须是容器块，否则非法嵌套
		if err := treenode.CheckContainerParent(parentID); err != nil {
			return apicontract.Failure[[]*apicontract.BlockTransaction](-1, err.Error())
		}
		if "markdown" == dataType {
			var err error
			data, err = dataBlockDOM(data, luteEngine)
			if err != nil {
				return apicontract.Failure[[]*apicontract.BlockTransaction](-1, "data block DOM failed: "+err.Error())
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

	if err := model.PerformBlockTransactions(transactions); err != nil {
		return apicontract.Failure[[]*apicontract.BlockTransaction](-1, err.Error())
	}

	broadcastTransactions(transactions)
	return blockTransactionsResponse(transactions)
})

var prependBlock = contractHandler(apicontract.PrependBlock, func(c *gin.Context, request apicontract.PrependBlockRequest) apicontract.Response[[]*apicontract.BlockTransaction] {

	data, dataType, parentID := request.Data, request.DataType, request.ParentID
	if err := util.ValidateID(parentID); err != nil {
		return apicontract.FailureFrom[[]*apicontract.BlockTransaction](err)
	}
	// prepend 只用 parentID 定位目标，目标必须是容器块，否则非法嵌套
	if err := treenode.CheckContainerParent(parentID); err != nil {
		return apicontract.Failure[[]*apicontract.BlockTransaction](-1, err.Error())
	}
	if "markdown" == dataType {
		luteEngine := util.NewLute()
		var err error
		data, err = dataBlockDOM(data, luteEngine)
		if err != nil {
			return apicontract.Failure[[]*apicontract.BlockTransaction](-1, "data block DOM failed: "+err.Error())
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

	if err := model.PerformBlockTransactions(transactions); err != nil {
		return apicontract.Failure[[]*apicontract.BlockTransaction](-1, err.Error())
	}

	broadcastTransactions(transactions)
	return blockTransactionsResponse(transactions)
})

var batchPrependBlock = contractHandler(apicontract.BatchPrependBlock, func(c *gin.Context, request apicontract.BatchParentBlockRequest) apicontract.Response[[]*apicontract.BlockTransaction] {

	blocksArg := request.Blocks
	var transactions []*model.Transaction
	luteEngine := util.NewLute()
	for _, blockArg := range blocksArg {
		data := blockArg.Data
		dataType := blockArg.DataType
		parentID := blockArg.ParentID
		if err := util.ValidateID(parentID); err != nil {
			return apicontract.FailureFrom[[]*apicontract.BlockTransaction](err)
		}
		// prepend 只用 parentID 定位目标，目标必须是容器块，否则非法嵌套
		if err := treenode.CheckContainerParent(parentID); err != nil {
			return apicontract.Failure[[]*apicontract.BlockTransaction](-1, err.Error())
		}
		if "markdown" == dataType {
			var err error
			data, err = dataBlockDOM(data, luteEngine)
			if err != nil {
				return apicontract.Failure[[]*apicontract.BlockTransaction](-1, "data block DOM failed: "+err.Error())
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

	if err := model.PerformBlockTransactions(transactions); err != nil {
		return apicontract.Failure[[]*apicontract.BlockTransaction](-1, err.Error())
	}

	broadcastTransactions(transactions)
	return blockTransactionsResponse(transactions)
})

var insertBlock = contractHandler(apicontract.InsertBlock, func(c *gin.Context, request apicontract.InsertBlockRequest) apicontract.Response[[]*apicontract.BlockTransaction] {

	data, dataType, parentID, previousID, nextID := request.Data, request.DataType, request.ParentID, request.PreviousID, request.NextID
	if dataType != "markdown" && dataType != "dom" {
		return apicontract.Failure[[]*apicontract.BlockTransaction](-1, "dataType must be markdown or dom")
	}
	if parentID == "" && previousID == "" && nextID == "" {
		return apicontract.Failure[[]*apicontract.BlockTransaction](-1, "at least one of parentID, previousID or nextID is required")
	}
	for _, id := range []string{parentID, previousID, nextID} {
		if err := util.ValidateOptionalID(id); err != nil {
			return apicontract.FailureFrom[[]*apicontract.BlockTransaction](err)
		}
	}
	if "markdown" == dataType {
		luteEngine := util.NewLute()
		var err error
		data, err = dataBlockDOM(data, luteEngine)
		if err != nil {
			return apicontract.Failure[[]*apicontract.BlockTransaction](-1, "data block DOM failed: "+err.Error())
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
		return apicontract.Failure[[]*apicontract.BlockTransaction](-1, err.Error())
	}

	broadcastTransactions(transactions)
	return blockTransactionsResponse(transactions)
})

var updateBlock = contractHandler(apicontract.UpdateBlock, func(c *gin.Context, request apicontract.UpdateBlockRequest) apicontract.Response[[]*apicontract.BlockTransaction] {

	input := blockUpdateInput(request)
	if err := util.ValidateID(input.ID); err != nil {
		return apicontract.FailureFrom[[]*apicontract.BlockTransaction](err)
	}
	transactions, _, err := model.PerformBlockUpdates([]model.BlockUpdateInput{input})
	if err != nil {
		return apicontract.Failure[[]*apicontract.BlockTransaction](-1, err.Error())
	}

	broadcastTransactions(transactions)
	return blockTransactionsResponse(transactions)
})

var batchInsertBlock = contractHandler(apicontract.BatchInsertBlock, func(c *gin.Context, request apicontract.BatchInsertBlockRequest) apicontract.Response[[]*apicontract.BlockTransaction] {

	blocksArg := request.Blocks
	var transactions []*model.Transaction
	luteEngine := util.NewLute()
	for _, blockArg := range blocksArg {
		data, dataType := blockArg.Data, blockArg.DataType
		parentID, previousID, nextID := blockArg.ParentID, blockArg.PreviousID, blockArg.NextID
		for _, id := range []string{parentID, previousID, nextID} {
			if err := util.ValidateOptionalID(id); err != nil {
				return apicontract.FailureFrom[[]*apicontract.BlockTransaction](err)
			}
		}
		// 仅靠 parentID 定位目标时（无 previousID/nextID），目标必须是容器块，否则非法嵌套
		if "" != parentID && "" == previousID && "" == nextID {
			if err := treenode.CheckContainerParent(parentID); err != nil {
				return apicontract.Failure[[]*apicontract.BlockTransaction](-1, err.Error())
			}
		}

		if "markdown" == dataType {
			var err error
			data, err = dataBlockDOM(data, luteEngine)
			if err != nil {
				return apicontract.Failure[[]*apicontract.BlockTransaction](-1, "data block DOM failed: "+err.Error())
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

	if err := model.PerformBlockTransactions(transactions); err != nil {
		return apicontract.Failure[[]*apicontract.BlockTransaction](-1, err.Error())
	}

	broadcastTransactions(transactions)
	return blockTransactionsResponse(transactions)
})

var batchUpdateBlock = contractHandler(apicontract.BatchUpdateBlock, func(c *gin.Context, request apicontract.BatchUpdateBlockRequest) apicontract.Response[[]*apicontract.BlockTransaction] {

	if len(request.Blocks) == 0 {
		return apicontract.Failure[[]*apicontract.BlockTransaction](-1, "Field [blocks] must not be empty")
	}
	inputs := make([]model.BlockUpdateInput, 0, len(request.Blocks))
	for i, block := range request.Blocks {
		input := blockUpdateInput(block)
		if err := util.ValidateID(input.ID); err != nil {
			return apicontract.FailureFrom[[]*apicontract.BlockTransaction](
				apicontract.Reject(fmt.Sprintf("blocks[%d]: %s", i, err.Error())))
		}
		inputs = append(inputs, input)
	}
	transactions, _, err := model.PerformBlockUpdates(inputs)
	if err != nil {
		return apicontract.Failure[[]*apicontract.BlockTransaction](-1, err.Error())
	}

	broadcastTransactions(transactions)
	return blockTransactionsResponse(transactions)
})

var deleteBlock = contractHandler(apicontract.DeleteBlock, func(c *gin.Context, request apicontract.DeleteBlockRequest) apicontract.Response[[]*apicontract.BlockTransaction] {

	id := request.ID
	if err := util.ValidateID(id); err != nil {
		return apicontract.FailureFrom[[]*apicontract.BlockTransaction](err)
	}

	transactions, err := model.PerformBlockOperation(&model.Operation{
		Action: "delete",
		ID:     id,
	})
	if err != nil {
		return apicontract.Failure[[]*apicontract.BlockTransaction](-1, err.Error())
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
