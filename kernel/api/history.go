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
	"net/http"
	"time"

	"github.com/88250/gulu"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func searchHistory(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var notebook, query, op string
	if !util.ParseJsonArgs(arg, ret,
		util.BindJsonArg("notebook", &notebook, false, false),
		util.BindJsonArg("query", &query, false, false),
		util.BindJsonArg("op", &op, false, false),
	) {
		return
	}
	typ := model.HistoryTypeDoc
	if nil != arg["type"] {
		typeVal, ok := util.ParseJsonArg[float64]("type", arg, ret, true, false)
		if !ok {
			return
		}
		typ = int(typeVal)
	}
	page := 1
	if nil != arg["page"] {
		pageVal, ok := util.ParseJsonArg[float64]("page", arg, ret, true, false)
		if !ok {
			return
		}
		page = int(pageVal)
	}
	histories, pageCount, totalCount := model.FullTextSearchHistory(query, notebook, op, typ, page)
	ret.Data = map[string]any{
		"histories":  histories,
		"pageCount":  pageCount,
		"totalCount": totalCount,
	}
}

func getHistoryItems(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var created, notebook, query, op string
	if !util.ParseJsonArgs(arg, ret,
		util.BindJsonArg("created", &created, true, true),
		util.BindJsonArg("notebook", &notebook, false, false),
		util.BindJsonArg("query", &query, false, false),
		util.BindJsonArg("op", &op, false, false),
	) {
		return
	}
	typ := model.HistoryTypeDoc
	if nil != arg["type"] {
		typeVal, ok := util.ParseJsonArg[float64]("type", arg, ret, true, false)
		if !ok {
			return
		}
		typ = int(typeVal)
	}
	histories := model.FullTextSearchHistoryItems(created, query, notebook, op, typ)
	ret.Data = map[string]any{
		"items": histories,
	}
}

func reindexHistory(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	model.ReindexHistory()
}

func getNotebookHistory(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	histories, err := model.GetNotebookHistory()
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	ret.Data = map[string]any{
		"histories": histories,
	}
}

func clearWorkspaceHistory(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	msgId := util.PushMsg(model.Conf.Language(100), 1000*60*15)
	time.Sleep(3 * time.Second)
	err := model.ClearWorkspaceHistory()
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	util.PushUpdateMsg(msgId, model.Conf.Language(99), 1000*5)
}

func getDocHistoryContent(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var historyPath, keyword string
	if !util.ParseJsonArgs(arg, ret,
		util.BindJsonArg("historyPath", &historyPath, true, true),
		util.BindJsonArg("k", &keyword, false, false),
	) {
		return
	}
	highlight := true
	if nil != arg["highlight"] {
		highlightVal, ok := util.ParseJsonArg[bool]("highlight", arg, ret, true, false)
		if !ok {
			return
		}
		highlight = highlightVal
	}
	id, rootID, content, isLargeDoc, err := model.GetDocHistoryContent(historyPath, keyword, highlight)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	ret.Data = map[string]any{
		"id":         id,
		"rootID":     rootID,
		"content":    content,
		"isLargeDoc": isLargeDoc,
	}
}

func rollbackDocHistory(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var notebook, historyPath string
	if !util.ParseJsonArgs(arg, ret,
		util.BindJsonArg("notebook", &notebook, true, true),
		util.BindJsonArg("historyPath", &historyPath, true, true),
	) {
		return
	}
	err := model.RollbackDocHistory(notebook, historyPath)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	ret.Data = map[string]any{
		"box": notebook,
	}
}

func rollbackAssetsHistory(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var historyPath string
	if !util.ParseJsonArgs(arg, ret, util.BindJsonArg("historyPath", &historyPath, true, true)) {
		return
	}
	err := model.RollbackAssetsHistory(historyPath)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
}

func rollbackNotebookHistory(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var historyPath string
	if !util.ParseJsonArgs(arg, ret, util.BindJsonArg("historyPath", &historyPath, true, true)) {
		return
	}
	err := model.RollbackNotebookHistory(historyPath)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
}

func rollbackAttributeViewHistory(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var historyPath string
	if !util.ParseJsonArgs(arg, ret, util.BindJsonArg("historyPath", &historyPath, true, true)) {
		return
	}
	err := model.RollbackAttributeViewHistory(historyPath)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
}
