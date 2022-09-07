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

package api

import (
	"net/http"

	"github.com/88250/gulu"
	"github.com/88250/lute"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

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
	if "markdown" == dataType {
		luteEngine := model.NewLute()
		data = dataBlockDOM(data, luteEngine)
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

	err := model.PerformTransactions(&transactions)
	if nil != err {
		ret.Code = 1
		ret.Msg = err.Error()
		return
	}

	model.WaitForWritingFiles()

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
	if "markdown" == dataType {
		luteEngine := model.NewLute()
		data = dataBlockDOM(data, luteEngine)
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

	err := model.PerformTransactions(&transactions)
	if nil != err {
		ret.Code = 1
		ret.Msg = err.Error()
		return
	}

	model.WaitForWritingFiles()

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
	var parentID, previousID string
	if nil != arg["parentID"] {
		parentID = arg["parentID"].(string)
	}
	if nil != arg["previousID"] {
		previousID = arg["previousID"].(string)
	}

	if "markdown" == dataType {
		luteEngine := model.NewLute()
		data = dataBlockDOM(data, luteEngine)
	}

	transactions := []*model.Transaction{
		{
			DoOperations: []*model.Operation{
				{
					Action:     "insert",
					Data:       data,
					ParentID:   parentID,
					PreviousID: previousID,
				},
			},
		},
	}

	err := model.PerformTransactions(&transactions)
	if nil != err {
		ret.Code = 1
		ret.Msg = err.Error()
		return
	}

	model.WaitForWritingFiles()

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

	luteEngine := model.NewLute()
	if "markdown" == dataType {
		data = dataBlockDOM(data, luteEngine)
	}
	tree := luteEngine.BlockDOM2Tree(data)
	if nil == tree || nil == tree.Root || nil == tree.Root.FirstChild {
		ret.Code = -1
		ret.Msg = "parse tree failed"
		return
	}

	block, err := model.GetBlock(id)
	if nil != err {
		ret.Code = -1
		ret.Msg = "get block failed: " + err.Error()
		return
	}

	var transactions []*model.Transaction
	if "NodeDocument" == block.Type {
		oldTree, err := model.LoadTree(block.Box, block.Path)
		if nil != err {
			ret.Code = -1
			ret.Msg = "load tree failed: " + err.Error()
			return
		}
		var toRemoves []*ast.Node
		var ops []*model.Operation
		for n := oldTree.Root.FirstChild; nil != n; n = n.Next {
			toRemoves = append(toRemoves, n)
			ops = append(ops, &model.Operation{Action: "delete", ID: n.ID})
		}
		for _, n := range toRemoves {
			n.Unlink()
		}
		ops = append(ops, &model.Operation{Action: "appendInsert", Data: data, ParentID: id})
		transactions = append(transactions, &model.Transaction{
			DoOperations: ops,
		})
	} else {
		if "NodeListItem" == block.Type {
			// 使用 API `api/block/updateBlock` 更新列表项时渲染错误 https://github.com/siyuan-note/siyuan/issues/4658

			tree.Root.AppendChild(tree.Root.FirstChild.FirstChild) // 将列表下的第一个列表项移到文档结尾，移动以后根下面直接挂列表项，渲染器可以正常工作
			tree.Root.FirstChild.Unlink()                          // 删除列表
			tree.Root.FirstChild.Unlink()                          // 继续删除列表 IAL
		}
		tree.Root.FirstChild.SetIALAttr("id", id)

		data = luteEngine.Tree2BlockDOM(tree, luteEngine.RenderOptions)
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

	err = model.PerformTransactions(&transactions)
	if nil != err {
		ret.Code = 1
		ret.Msg = err.Error()
		return
	}

	model.WaitForWritingFiles()

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

	err := model.PerformTransactions(&transactions)
	if nil != err {
		ret.Code = 1
		ret.Msg = err.Error()
		return
	}

	ret.Data = transactions
	broadcastTransactions(transactions)
}

func broadcastTransactions(transactions []*model.Transaction) {
	evt := util.NewCmdResult("transactions", 0, util.PushModeBroadcast, util.PushModeBroadcast)
	evt.Data = transactions
	util.PushEvent(evt)
}

func dataBlockDOM(data string, luteEngine *lute.Lute) (ret string) {
	ret = luteEngine.Md2BlockDOM(data)
	if "" == ret {
		// 使用 API 插入空字符串出现错误 https://github.com/siyuan-note/siyuan/issues/3931
		blankParagraph := parse.NewParagraph()
		ret = lute.RenderNodeBlockDOM(blankParagraph, luteEngine.ParseOptions, luteEngine.RenderOptions)
	}
	return
}
