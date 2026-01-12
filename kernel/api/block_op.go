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

package api

import (
	"errors"
	"net/http"

	"github.com/88250/gulu"
	"github.com/88250/lute"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func moveOutlineHeading(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	id := arg["id"].(string)
	if util.InvalidIDPattern(id, ret) {
		return
	}

	var parentID, previousID string
	if nil != arg["parentID"] {
		parentID = arg["parentID"].(string)
		if "" != parentID && util.InvalidIDPattern(parentID, ret) {
			return
		}
	}
	if nil != arg["previousID"] {
		previousID = arg["previousID"].(string)
		if "" != previousID && util.InvalidIDPattern(previousID, ret) {
			return
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

	ret.Data = transactions
	broadcastTransactions(transactions)
}

func appendDailyNoteBlock(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	data := arg["data"].(string)
	dataType := arg["dataType"].(string)
	boxID := arg["notebook"].(string)
	if util.InvalidIDPattern(boxID, ret) {
		return
	}
	if "markdown" == dataType {
		luteEngine := util.NewLute()
		var err error
		data, err = dataBlockDOM(data, luteEngine)
		if err != nil {
			ret.Code = -1
			ret.Msg = "data block DOM failed: " + err.Error()
			return
		}
	}

	p, _, err := model.CreateDailyNote(boxID)
	if err != nil {
		ret.Code = -1
		ret.Msg = "create daily note failed: " + err.Error()
		return
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

	ret.Data = transactions
	broadcastTransactions(transactions)
}

func prependDailyNoteBlock(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	data := arg["data"].(string)
	dataType := arg["dataType"].(string)
	boxID := arg["notebook"].(string)
	if util.InvalidIDPattern(boxID, ret) {
		return
	}
	if "markdown" == dataType {
		luteEngine := util.NewLute()
		var err error
		data, err = dataBlockDOM(data, luteEngine)
		if err != nil {
			ret.Code = -1
			ret.Msg = "data block DOM failed: " + err.Error()
			return
		}
	}

	p, _, err := model.CreateDailyNote(boxID)
	if err != nil {
		ret.Code = -1
		ret.Msg = "create daily note failed: " + err.Error()
		return
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

	ret.Data = transactions
	broadcastTransactions(transactions)
}

func unfoldBlock(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	id := arg["id"].(string)
	if util.InvalidIDPattern(id, ret) {
		return
	}

	bt := treenode.GetBlockTree(id)
	if nil == bt {
		ret.Code = -1
		ret.Msg = "block tree not found [id=" + id + "]"
		return
	}

	if bt.Type == "d" {
		ret.Code = -1
		ret.Msg = "document can not be unfolded"
		return
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
		data, _ := gulu.JSON.MarshalJSON(map[string]interface{}{"fold": ""})
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
}

func foldBlock(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	id := arg["id"].(string)
	if util.InvalidIDPattern(id, ret) {
		return
	}

	bt := treenode.GetBlockTree(id)
	if nil == bt {
		ret.Code = -1
		ret.Msg = "block tree not found [id=" + id + "]"
		return
	}

	if bt.Type == "d" {
		ret.Code = -1
		ret.Msg = "document can not be folded"
		return
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
		data, _ := gulu.JSON.MarshalJSON(map[string]interface{}{"fold": "1"})
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
}

func moveBlock(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	id := arg["id"].(string)
	if util.InvalidIDPattern(id, ret) {
		return
	}

	currentBt := treenode.GetBlockTree(id)
	if nil == currentBt {
		ret.Code = -1
		ret.Msg = "block not found [id=" + id + "]"
		return
	}

	var parentID, previousID string
	if nil != arg["parentID"] {
		parentID = arg["parentID"].(string)
		if "" != parentID && util.InvalidIDPattern(parentID, ret) {
			return
		}
	}
	if nil != arg["previousID"] {
		previousID = arg["previousID"].(string)
		if "" != previousID && util.InvalidIDPattern(previousID, ret) {
			return
		}

		// Check the validity of the API `moveBlock` parameter `previousID` https://github.com/siyuan-note/siyuan/issues/8007
		if bt := treenode.GetBlockTree(previousID); nil == bt || "d" == bt.Type {
			ret.Code = -1
			ret.Msg = "`previousID` can not be the ID of a document"
			return
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
		return
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
}

func appendBlock(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	data := arg["data"].(string)
	dataType := arg["dataType"].(string)
	parentID := arg["parentID"].(string)
	if util.InvalidIDPattern(parentID, ret) {
		return
	}
	if "markdown" == dataType {
		luteEngine := util.NewLute()
		var err error
		data, err = dataBlockDOM(data, luteEngine)
		if err != nil {
			ret.Code = -1
			ret.Msg = "data block DOM failed: " + err.Error()
			return
		}
	}

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

	ret.Data = transactions
	broadcastTransactions(transactions)
}

func batchAppendBlock(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	blocksArg := arg["blocks"].([]interface{})
	var transactions []*model.Transaction
	luteEngine := util.NewLute()
	for _, blockArg := range blocksArg {
		blockMap := blockArg.(map[string]interface{})
		data := blockMap["data"].(string)
		dataType := blockMap["dataType"].(string)
		parentID := blockMap["parentID"].(string)
		if util.InvalidIDPattern(parentID, ret) {
			return
		}
		if "markdown" == dataType {
			var err error
			data, err = dataBlockDOM(data, luteEngine)
			if err != nil {
				ret.Code = -1
				ret.Msg = "data block DOM failed: " + err.Error()
				return
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

	ret.Data = transactions
	broadcastTransactions(transactions)
}

func prependBlock(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	data := arg["data"].(string)
	dataType := arg["dataType"].(string)
	parentID := arg["parentID"].(string)
	if util.InvalidIDPattern(parentID, ret) {
		return
	}
	if "markdown" == dataType {
		luteEngine := util.NewLute()
		var err error
		data, err = dataBlockDOM(data, luteEngine)
		if err != nil {
			ret.Code = -1
			ret.Msg = "data block DOM failed: " + err.Error()
			return
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

	ret.Data = transactions
	broadcastTransactions(transactions)
}

func batchPrependBlock(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	blocksArg := arg["blocks"].([]interface{})
	var transactions []*model.Transaction
	luteEngine := util.NewLute()
	for _, blockArg := range blocksArg {
		blockMap := blockArg.(map[string]interface{})
		data := blockMap["data"].(string)
		dataType := blockMap["dataType"].(string)
		parentID := blockMap["parentID"].(string)
		if util.InvalidIDPattern(parentID, ret) {
			return
		}
		if "markdown" == dataType {
			var err error
			data, err = dataBlockDOM(data, luteEngine)
			if err != nil {
				ret.Code = -1
				ret.Msg = "data block DOM failed: " + err.Error()
				return
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

	ret.Data = transactions
	broadcastTransactions(transactions)
}

func insertBlock(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	data := arg["data"].(string)
	dataType := arg["dataType"].(string)
	var parentID, previousID, nextID string
	if nil != arg["parentID"] {
		parentID = arg["parentID"].(string)
		if "" != parentID && util.InvalidIDPattern(parentID, ret) {
			return
		}
	}
	if nil != arg["previousID"] {
		previousID = arg["previousID"].(string)
		if "" != previousID && util.InvalidIDPattern(previousID, ret) {
			return
		}
	}
	if nil != arg["nextID"] {
		nextID = arg["nextID"].(string)
		if "" != nextID && util.InvalidIDPattern(nextID, ret) {
			return
		}
	}

	if "markdown" == dataType {
		luteEngine := util.NewLute()
		var err error
		data, err = dataBlockDOM(data, luteEngine)
		if err != nil {
			ret.Code = -1
			ret.Msg = "data block DOM failed: " + err.Error()
			return
		}
	}

	transactions := []*model.Transaction{
		{
			DoOperations: []*model.Operation{
				{
					Action:     "insert",
					Data:       data,
					ParentID:   parentID,
					PreviousID: previousID,
					NextID:     nextID,
				},
			},
		},
	}

	model.PerformTransactions(&transactions)
	model.FlushTxQueue()

	ret.Data = transactions
	broadcastTransactions(transactions)
}

func updateBlock(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	data := arg["data"].(string)
	dataType := arg["dataType"].(string)
	id := arg["id"].(string)
	if util.InvalidIDPattern(id, ret) {
		return
	}

	luteEngine := util.NewLute()
	if "markdown" == dataType {
		var err error
		data, err = dataBlockDOM(data, luteEngine)
		if err != nil {
			ret.Code = -1
			ret.Msg = "data block DOM failed: " + err.Error()
			return
		}
	}
	tree := luteEngine.BlockDOM2Tree(data)
	if nil == tree || nil == tree.Root || nil == tree.Root.FirstChild {
		ret.Code = -1
		ret.Msg = "parse tree failed"
		return
	}

	block, err := model.GetBlock(id, nil)
	if err != nil {
		ret.Code = -1
		ret.Msg = "get block failed: " + err.Error()
		return
	}

	var transactions []*model.Transaction
	if "NodeDocument" == block.Type {
		oldTree, err := filesys.LoadTree(block.Box, block.Path, luteEngine)
		if err != nil {
			ret.Code = -1
			ret.Msg = "load tree failed: " + err.Error()
			return
		}
		var toRemoves []*ast.Node
		var ops []*model.Operation
		for n := oldTree.Root.FirstChild; nil != n; n = n.Next {
			toRemoves = append(toRemoves, n)
			ops = append(ops, &model.Operation{Action: "delete", ID: n.ID, Data: map[string]interface{}{
				"createEmptyParagraph": false, // 清空文档后前端不要创建空段落
			}})
		}
		for _, n := range toRemoves {
			n.Unlink()
		}
		ops = append(ops, &model.Operation{Action: "appendInsert", Data: data, ParentID: id})
		transactions = append(transactions, &model.Transaction{
			DoOperations: ops,
		})
	} else {
		if "NodeListItem" == block.Type && ast.NodeList == tree.Root.FirstChild.Type {
			// 使用 API `api/block/updateBlock` 更新列表项时渲染错误 https://github.com/siyuan-note/siyuan/issues/4658
			tree.Root.AppendChild(tree.Root.FirstChild.FirstChild) // 将列表下的第一个列表项移到文档结尾，移动以后根下面直接挂列表项，渲染器可以正常工作
			tree.Root.FirstChild.Unlink()                          // 删除列表
			tree.Root.FirstChild.Unlink()                          // 继续删除列表 IAL
		}

		if nil != tree.Root.FirstChild {
			tree.Root.FirstChild.SetIALAttr("id", id)
		} else {
			logging.LogWarnf("tree root has no child node, append empty paragraph node")
			tree.Root.AppendChild(treenode.NewParagraph(id))
		}

		data = luteEngine.Tree2BlockDOM(tree, luteEngine.RenderOptions, luteEngine.ParseOptions)
		transactions = []*model.Transaction{
			{
				DoOperations: []*model.Operation{
					{
						Action: "update",
						ID:     id,
						Data:   data,
					},
				},
			},
		}
	}

	model.PerformTransactions(&transactions)
	model.FlushTxQueue()

	ret.Data = transactions
	broadcastTransactions(transactions)
}

func batchInsertBlock(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	blocksArg := arg["blocks"].([]interface{})
	var transactions []*model.Transaction
	luteEngine := util.NewLute()
	for _, blockArg := range blocksArg {
		blockMap := blockArg.(map[string]interface{})
		data := blockMap["data"].(string)
		dataType := blockMap["dataType"].(string)
		var parentID, previousID, nextID string
		if nil != blockMap["parentID"] {
			parentID = blockMap["parentID"].(string)
			if "" != parentID && util.InvalidIDPattern(parentID, ret) {
				return
			}
		}
		if nil != blockMap["previousID"] {
			previousID = blockMap["previousID"].(string)
			if "" != previousID && util.InvalidIDPattern(previousID, ret) {
				return
			}
		}
		if nil != blockMap["nextID"] {
			nextID = blockMap["nextID"].(string)
			if "" != nextID && util.InvalidIDPattern(nextID, ret) {
				return
			}
		}

		if "markdown" == dataType {
			var err error
			data, err = dataBlockDOM(data, luteEngine)
			if err != nil {
				ret.Code = -1
				ret.Msg = "data block DOM failed: " + err.Error()
				return
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

	ret.Data = transactions
	broadcastTransactions(transactions)
}

func batchUpdateBlock(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	blocksArg := arg["blocks"].([]interface{})

	type updateBlockArg struct {
		ID       string
		Data     string
		DataType string
		Block    *model.Block
		Tree     *parse.Tree
	}

	var blocks []*updateBlockArg
	luteEngine := util.NewLute()
	for _, blockArg := range blocksArg {
		blockMap := blockArg.(map[string]interface{})
		id := blockMap["id"].(string)
		if util.InvalidIDPattern(id, ret) {
			return
		}

		data := blockMap["data"].(string)
		dataType := blockMap["dataType"].(string)
		if "markdown" == dataType {
			var err error
			data, err = dataBlockDOM(data, luteEngine)
			if err != nil {
				ret.Code = -1
				ret.Msg = "data block DOM failed: " + err.Error()
				return
			}
		}
		tree := luteEngine.BlockDOM2Tree(data)
		if nil == tree || nil == tree.Root || nil == tree.Root.FirstChild {
			ret.Code = -1
			ret.Msg = "parse tree failed"
			return
		}

		block, err := model.GetBlock(id, nil)
		if err != nil {
			ret.Code = -1
			ret.Msg = "get block failed: " + err.Error()
			return
		}

		blocks = append(blocks, &updateBlockArg{
			ID:       id,
			Data:     data,
			DataType: dataType,
			Block:    block,
			Tree:     tree,
		})
	}

	var ops []*model.Operation
	tx := &model.Transaction{}
	transactions := []*model.Transaction{tx}
	for _, upBlock := range blocks {
		block := upBlock.Block
		data := upBlock.Data
		tree := upBlock.Tree
		id := upBlock.ID
		if "NodeDocument" == block.Type {
			oldTree, err := filesys.LoadTree(block.Box, block.Path, luteEngine)
			if err != nil {
				ret.Code = -1
				ret.Msg = "load tree failed: " + err.Error()
				return
			}
			var toRemoves []*ast.Node

			for n := oldTree.Root.FirstChild; nil != n; n = n.Next {
				toRemoves = append(toRemoves, n)
				ops = append(ops, &model.Operation{Action: "delete", ID: n.ID, Data: map[string]interface{}{
					"createEmptyParagraph": false, // 清空文档后前端不要创建空段落
				}})
			}
			for _, n := range toRemoves {
				n.Unlink()
			}
			ops = append(ops, &model.Operation{Action: "appendInsert", Data: data, ParentID: id})
		} else {
			if "NodeListItem" == block.Type && ast.NodeList == tree.Root.FirstChild.Type {
				// 使用 API `api/block/updateBlock` 更新列表项时渲染错误 https://github.com/siyuan-note/siyuan/issues/4658
				tree.Root.AppendChild(tree.Root.FirstChild.FirstChild) // 将列表下的第一个列表项移到文档结尾，移动以后根下面直接挂列表项，渲染器可以正常工作
				tree.Root.FirstChild.Unlink()                          // 删除列表
				tree.Root.FirstChild.Unlink()                          // 继续删除列表 IAL
			}
			tree.Root.FirstChild.SetIALAttr("id", id)

			data = luteEngine.Tree2BlockDOM(tree, luteEngine.RenderOptions, luteEngine.ParseOptions)
			ops = append(ops, &model.Operation{
				Action: "update",
				ID:     id,
				Data:   data,
			})
		}
	}

	tx.DoOperations = ops
	model.PerformTransactions(&transactions)
	model.FlushTxQueue()

	ret.Data = transactions
	broadcastTransactions(transactions)
}

func deleteBlock(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	id := arg["id"].(string)
	if util.InvalidIDPattern(id, ret) {
		return
	}

	transactions := []*model.Transaction{
		{
			DoOperations: []*model.Operation{
				{
					Action: "delete",
					ID:     id,
				},
			},
		},
	}

	model.PerformTransactions(&transactions)

	ret.Data = transactions
	broadcastTransactions(transactions)
}

func broadcastTransactions(transactions []*model.Transaction) {
	evt := util.NewCmdResult("transactions", 0, util.PushModeBroadcast)
	evt.Data = transactions
	util.PushEvent(evt)
}

func dataBlockDOM(data string, luteEngine *lute.Lute) (ret string, err error) {
	luteEngine.SetHTMLTag2TextMark(true) // API `/api/block/**` 无法使用 `<u>foo</u>` 与 `<kbd>bar</kbd>` 插入/更新行内元素 https://github.com/siyuan-note/siyuan/issues/6039

	ret, tree := luteEngine.Md2BlockDOMTree(data, true)
	if "" == ret {
		// 使用 API 插入空字符串出现错误 https://github.com/siyuan-note/siyuan/issues/3931
		blankParagraph := treenode.NewParagraph("")
		ret = luteEngine.RenderNodeBlockDOM(blankParagraph)
	}

	invalidID := ""
	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}

		if "" != n.ID {
			if !ast.IsNodeIDPattern(n.ID) {
				invalidID = n.ID
				return ast.WalkStop
			}
		}
		return ast.WalkContinue
	})

	if "" != invalidID {
		err = errors.New("found invalid ID [" + invalidID + "]")
		ret = ""
		return
	}
	return
}
