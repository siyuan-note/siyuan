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

	"github.com/88250/gulu"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func getRecentDocs(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	// 获取排序参数
	sortBy := "viewedAt" // 默认按浏览时间排序，openAt：按打开时间排序，closedAt：按关闭时间排序

	// 兼容旧版接口，不能直接使用 util.JsonArg()
	arg := map[string]interface{}{}
	if err := c.ShouldBindJSON(&arg); err == nil {
		if arg["sortBy"] != nil {
			sortBy = arg["sortBy"].(string)
		}
	}

	data, err := model.GetRecentDocs(sortBy)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	ret.Data = data
}

func removeCriterion(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	name := arg["name"].(string)
	err := model.RemoveCriterion(name)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
}

func setCriterion(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	param, err := gulu.JSON.MarshalJSON(arg["criterion"])
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	criterion := &model.Criterion{}
	if err = gulu.JSON.UnmarshalJSON(param, criterion); err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	err = model.SetCriterion(criterion)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
}

func getCriteria(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	data := model.GetCriteria()
	ret.Data = data
}

func removeLocalStorageVals(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var keys []string
	keysArg := arg["keys"].([]interface{})
	for _, key := range keysArg {
		keys = append(keys, key.(string))
	}

	err := model.RemoveLocalStorageVals(keys)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	app := arg["app"].(string)
	evt := util.NewCmdResult("removeLocalStorageVals", 0, util.PushModeBroadcastMainExcludeSelfApp)
	evt.AppId = app
	evt.Data = map[string]interface{}{"keys": keys}
	util.PushEvent(evt)
}

func setLocalStorageVal(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	key := arg["key"].(string)
	val := arg["val"].(interface{})
	err := model.SetLocalStorageVal(key, val)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	app := arg["app"].(string)
	evt := util.NewCmdResult("setLocalStorageVal", 0, util.PushModeBroadcastMainExcludeSelfApp)
	evt.AppId = app
	evt.Data = map[string]interface{}{"key": key, "val": val}
	util.PushEvent(evt)
}

func setLocalStorage(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	val := arg["val"].(interface{})
	err := model.SetLocalStorage(val)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
}

func getLocalStorage(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	data := model.GetLocalStorage()
	ret.Data = data
}

func getOutlineStorage(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	docID := arg["docID"].(string)
	data, err := model.GetOutlineStorage(docID)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	ret.Data = data
}

func setOutlineStorage(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	docID := arg["docID"].(string)
	val := arg["val"].(interface{})
	err := model.SetOutlineStorage(docID, val)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
}

func removeOutlineStorage(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	docID := arg["docID"].(string)
	err := model.RemoveOutlineStorage(docID)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
}

func updateRecentDocViewTime(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	if nil == arg["rootID"] {
		return
	}

	rootID := arg["rootID"].(string)
	err := model.UpdateRecentDocViewTime(rootID)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
}

func updateRecentDocOpenTime(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	if nil == arg["rootID"] {
		return
	}

	rootID := arg["rootID"].(string)
	err := model.UpdateRecentDocOpenTime(rootID)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
}

func updateRecentDocCloseTime(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	rootID, ok := arg["rootID"].(string)
	if !ok || rootID == "" {
		return
	}

	err := model.UpdateRecentDocCloseTime(rootID)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
}

func batchUpdateRecentDocCloseTime(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	rootIDsArg := arg["rootIDs"].([]interface{})
	var rootIDs []string
	for _, id := range rootIDsArg {
		rootIDs = append(rootIDs, id.(string))
	}

	err := model.BatchUpdateRecentDocCloseTime(rootIDs)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
}
