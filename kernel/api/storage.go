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

	var sortBy string
	arg := map[string]any{}
	// 兼容旧版接口，不能直接使用 util.JsonArg()
	if err := c.ShouldBindJSON(&arg); err == nil {
		if !util.ParseJsonArgs(arg, ret, util.BindJsonArg("sortBy", &sortBy, false, false)) {
			return
		}
	}

	data, err := model.GetRecentDocs(sortBy)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
	if model.IsReadOnlyRoleContext(c) {
		publishAccess := model.GetPublishAccess()
		data = model.FilterRecentDocsByPublishAccess(c, publishAccess, data)
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

	var name string
	if !util.ParseJsonArgs(arg, ret, util.BindJsonArg("name", &name, true, true)) {
		return
	}

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

	var criterionRaw any
	if !util.ParseJsonArgs(arg, ret, util.BindJsonArg("criterion", &criterionRaw, true, false)) {
		return
	}

	param, err := gulu.JSON.MarshalJSON(criterionRaw)
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

	var keysArg []any
	var app string
	if !util.ParseJsonArgs(arg, ret,
		util.BindJsonArg("keys", &keysArg, true, true),
		util.BindJsonArg("app", &app, false, false),
	) {
		return
	}

	var keys []string
	for _, key := range keysArg {
		ks, elemOk := key.(string)
		if !elemOk {
			ret.Code = -1
			ret.Msg = "Field [keys]: each element should be of type [String]"
			return
		}
		if ks == "" {
			ret.Code = -1
			ret.Msg = "Field [keys]: each element must not be empty"
			return
		}
		keys = append(keys, ks)
	}

	err := model.RemoveLocalStorageVals(keys)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	evt := util.NewCmdResult("removeLocalStorageVals", 0, util.PushModeBroadcastMainExcludeSelfApp)
	evt.AppId = app
	evt.Data = map[string]any{"keys": keys}
	util.PushEvent(evt)
}

func removeLocalStorageVal(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var key string
	var app string
	if !util.ParseJsonArgs(arg, ret,
		util.BindJsonArg("key", &key, true, true),
		util.BindJsonArg("app", &app, false, false),
	) {
		return
	}

	err := model.RemoveLocalStorageVals([]string{key})
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	evt := util.NewCmdResult("removeLocalStorageVal", 0, util.PushModeBroadcastMainExcludeSelfApp)
	evt.AppId = app
	evt.Data = map[string]any{"key": key}
	util.PushEvent(evt)
}

func setLocalStorageVal(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var key string
	var app string
	if !util.ParseJsonArgs(arg, ret,
		util.BindJsonArg("key", &key, true, true),
		util.BindJsonArg("app", &app, false, false),
	) {
		return
	}
	val := arg["val"]

	removedKeys, setKeyVals, err := model.SetLocalStorageVals(map[string]any{key: val})
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	if len(removedKeys) > 0 {
		evt := util.NewCmdResult("removeLocalStorageVal", 0, util.PushModeBroadcastMainExcludeSelfApp)
		evt.AppId = app
		evt.Data = map[string]any{"key": removedKeys[0]}
		util.PushEvent(evt)
		return
	}

	evt := util.NewCmdResult("setLocalStorageVal", 0, util.PushModeBroadcastMainExcludeSelfApp)
	evt.AppId = app
	evt.Data = map[string]any{"key": key, "val": setKeyVals[key]}
	util.PushEvent(evt)
}

func setLocalStorageVals(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var keyVals map[string]any
	var app string
	if !util.ParseJsonArgs(arg, ret,
		util.BindJsonArg("keyVals", &keyVals, true, true),
		util.BindJsonArg("app", &app, false, false),
	) {
		return
	}

	removedKeys, setKeyVals, err := model.SetLocalStorageVals(keyVals)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	if len(removedKeys) > 0 {
		evtRm := util.NewCmdResult("removeLocalStorageVals", 0, util.PushModeBroadcastMainExcludeSelfApp)
		evtRm.AppId = app
		evtRm.Data = map[string]any{"keys": removedKeys}
		util.PushEvent(evtRm)
	}
	if len(setKeyVals) > 0 {
		evtSet := util.NewCmdResult("setLocalStorageVals", 0, util.PushModeBroadcastMainExcludeSelfApp)
		evtSet.AppId = app
		evtSet.Data = map[string]any{"keyVals": setKeyVals}
		util.PushEvent(evtSet)
	}
}

func setLocalStorage(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	val, hasVal := arg["val"]
	if !hasVal {
		ret.Code = -1
		ret.Msg = "Field [val] is required"
		return
	}

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
	if model.IsReadOnlyRoleContext(c) {
		publishAccess := model.GetPublishAccess()
		data = model.FilterLocalStorageByPublishAccess(publishAccess, data)
	}
	ret.Data = data
}

func getLocalStorageVal(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var key string
	if !util.ParseJsonArgs(arg, ret, util.BindJsonArg("key", &key, true, true)) {
		return
	}

	data := model.GetLocalStorage()
	if model.IsReadOnlyRoleContext(c) {
		publishAccess := model.GetPublishAccess()
		data = model.FilterLocalStorageByPublishAccess(publishAccess, data)
	}
	ret.Data = data[key]
}

func getLocalStorageVals(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var keysArg []any
	if !util.ParseJsonArgs(arg, ret, util.BindJsonArg("keys", &keysArg, true, true)) {
		return
	}

	var keys []string
	for _, key := range keysArg {
		ks, elemOk := key.(string)
		if !elemOk {
			ret.Code = -1
			ret.Msg = "Field [keys]: each element should be of type [String]"
			return
		}
		if ks == "" {
			ret.Code = -1
			ret.Msg = "Field [keys]: each element must not be empty"
			return
		}
		keys = append(keys, ks)
	}

	data := model.GetLocalStorage()
	if model.IsReadOnlyRoleContext(c) {
		publishAccess := model.GetPublishAccess()
		data = model.FilterLocalStorageByPublishAccess(publishAccess, data)
	}
	out := map[string]any{}
	for _, k := range keys {
		out[k] = data[k]
	}
	ret.Data = out
}

func getOutlineStorage(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var docID string
	if !util.ParseJsonArgs(arg, ret, util.BindJsonArg("docID", &docID, true, true)) {
		return
	}

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

	var docID string
	if !util.ParseJsonArgs(arg, ret, util.BindJsonArg("docID", &docID, true, true)) {
		return
	}
	val, hasVal := arg["val"]
	if !hasVal {
		ret.Code = -1
		ret.Msg = "Field [val] is required"
		return
	}

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

	var docID string
	if !util.ParseJsonArgs(arg, ret, util.BindJsonArg("docID", &docID, true, true)) {
		return
	}

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

	var rootID string
	if !util.ParseJsonArgs(arg, ret, util.BindJsonArg("rootID", &rootID, true, true)) {
		return
	}

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

	var rootID string
	if !util.ParseJsonArgs(arg, ret, util.BindJsonArg("rootID", &rootID, true, true)) {
		return
	}

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

	var rootID string
	if !util.ParseJsonArgs(arg, ret, util.BindJsonArg("rootID", &rootID, true, true)) {
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

	var rootIDsArg []any
	if !util.ParseJsonArgs(arg, ret, util.BindJsonArg("rootIDs", &rootIDsArg, true, true)) {
		return
	}

	var rootIDs []string
	for _, id := range rootIDsArg {
		str, elemOk := id.(string)
		if !elemOk {
			ret.Code = -1
			ret.Msg = "Field [rootIDs]: each element should be of type [String]"
			return
		}
		if str == "" {
			ret.Code = -1
			ret.Msg = "Field [rootIDs]: each element must not be empty"
			return
		}
		rootIDs = append(rootIDs, str)
	}

	err := model.BatchUpdateRecentDocCloseTime(rootIDs)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
}
