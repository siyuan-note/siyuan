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
	"time"

	"github.com/88250/gulu"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func getNotebookHistory(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	histories, err := model.GetNotebookHistory()
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	ret.Data = map[string]interface{}{
		"histories": histories,
	}
}

func getAssetsHistory(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	histories, err := model.GetAssetsHistory()
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	ret.Data = map[string]interface{}{
		"histories": histories,
	}
}

func clearWorkspaceHistory(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	msgId := util.PushMsg(model.Conf.Language(100), 1000*60*15)
	time.Sleep(3 * time.Second)
	err := model.ClearWorkspaceHistory()
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	util.PushClearMsg(msgId)
	util.PushMsg(model.Conf.Language(99), 1000*5)
}

func getDocHistory(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	notebook := arg["notebook"].(string)
	histories, err := model.GetDocHistory(notebook)
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	ret.Data = map[string]interface{}{
		"box":       notebook,
		"histories": histories,
	}
}

func getDocHistoryContent(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	historyPath := arg["historyPath"].(string)
	content, err := model.GetDocHistoryContent(historyPath)
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	ret.Data = map[string]interface{}{
		"content": content,
	}
}

func rollbackDocHistory(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	notebook := arg["notebook"].(string)
	historyPath := arg["historyPath"].(string)
	err := model.RollbackDocHistory(notebook, historyPath)
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	ret.Data = map[string]interface{}{
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

	historyPath := arg["historyPath"].(string)
	err := model.RollbackAssetsHistory(historyPath)
	if nil != err {
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

	historyPath := arg["historyPath"].(string)
	err := model.RollbackNotebookHistory(historyPath)
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
}
