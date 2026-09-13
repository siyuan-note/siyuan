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
	"encoding/json"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"strings"

	"github.com/88250/gulu"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var getLocalStorage = contractHandler(apicontract.GetLocalStorage, func(c *gin.Context, request apicontract.EmptyRequest) apicontract.Response[map[string]apicontract.JSONValue] {

	data := model.GetLocalStorage()
	if model.IsReadOnlyRoleContext(c) {
		data = model.FilterLocalStorageByPublishAccess(data)
	}
	return storageContract(data)
})

var getLocalStorageVal = contractHandler(apicontract.GetLocalStorageVal, func(c *gin.Context, request apicontract.StorageKeyRequest) apicontract.Response[apicontract.JSONValue] {

	key := request.Key
	data := model.GetLocalStorage()
	if model.IsReadOnlyRoleContext(c) {
		data = model.FilterLocalStorageByPublishAccess(data)
	}
	serialized, err := json.Marshal(data[key])
	if err != nil {
		return apicontract.Failure[apicontract.JSONValue](-1, err.Error())
	}
	var value apicontract.JSONValue
	if err = json.Unmarshal(serialized, &value); err != nil {
		return apicontract.Failure[apicontract.JSONValue](-1, err.Error())
	}
	return apicontract.Success(value)
})

var getLocalStorageVals = contractHandler(apicontract.GetLocalStorageVals, func(c *gin.Context, request apicontract.StorageKeysRequest) apicontract.Response[map[string]apicontract.JSONValue] {

	keys := request.Keys
	if len(keys) == 0 {
		return apicontract.Failure[map[string]apicontract.JSONValue](-1, "Field [keys] must not be empty")
	}
	for _, key := range keys {
		if key == "" {
			return apicontract.Failure[map[string]apicontract.JSONValue](-1, "Field [keys]: each element must not be empty")
		}
	}
	data := model.GetLocalStorage()
	if model.IsReadOnlyRoleContext(c) {
		data = model.FilterLocalStorageByPublishAccess(data)
	}
	out := map[string]any{}
	for _, k := range keys {
		out[k] = data[k]
	}
	return storageContract(out)
})

var setLocalStorageVal = contractHandler(apicontract.SetLocalStorageVal, func(c *gin.Context, request apicontract.StorageSetRequest) apicontract.Response[apicontract.Null] {
	ret := gulu.Ret.NewResult()

	key, app := request.Key, request.App
	input, err := storageModelValues(map[string]apicontract.JSONValue{key: request.Val})
	if err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}
	val := input[key]
	setKeyVals, err := model.SetLocalStorageVals(map[string]any{key: val})
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return contractFailure[apicontract.Null](ret)
	}

	evt := util.NewCmdResult("setLocalStorageVal", 0, util.PushModeBroadcastMainExcludeSelfApp)
	evt.AppId = app
	evt.Data = map[string]any{"key": key, "val": setKeyVals[key]}
	util.PushEvent(evt)

	return apicontract.Success(apicontract.Null{})
})

var setLocalStorageVals = contractHandler(apicontract.SetLocalStorageVals, func(c *gin.Context, request apicontract.StorageSetKeysRequest) apicontract.Response[apicontract.Null] {
	ret := gulu.Ret.NewResult()

	app := request.App
	if len(request.KeyVals) == 0 {
		return apicontract.Failure[apicontract.Null](-1, "Field [keyVals] must not be empty")
	}
	keyVals, err := storageModelValues(request.KeyVals)
	if err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}
	setKeyVals, err := model.SetLocalStorageVals(keyVals)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return contractFailure[apicontract.Null](ret)
	}

	evtSet := util.NewCmdResult("setLocalStorageVals", 0, util.PushModeBroadcastMainExcludeSelfApp)
	evtSet.AppId = app
	evtSet.Data = map[string]any{"keyVals": setKeyVals}
	util.PushEvent(evtSet)

	return apicontract.Success(apicontract.Null{})
})

var removeLocalStorageVal = contractHandler(apicontract.RemoveLocalStorageVal, func(c *gin.Context, request apicontract.StorageRemoveRequest) apicontract.Response[apicontract.Null] {
	ret := gulu.Ret.NewResult()

	key, app := request.Key, request.App
	err := model.RemoveLocalStorageVals([]string{key})
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return contractFailure[apicontract.Null](ret)
	}

	evt := util.NewCmdResult("removeLocalStorageVal", 0, util.PushModeBroadcastMainExcludeSelfApp)
	evt.AppId = app
	evt.Data = map[string]any{"key": key}
	util.PushEvent(evt)

	return apicontract.Success(apicontract.Null{})
})

var removeLocalStorageVals = contractHandler(apicontract.RemoveLocalStorageVals, func(c *gin.Context, request apicontract.StorageRemoveKeysRequest) apicontract.Response[apicontract.Null] {
	ret := gulu.Ret.NewResult()

	keys := request.Keys
	if len(keys) == 0 {
		return apicontract.Failure[apicontract.Null](-1, "Field [keys] must not be empty")
	}
	for _, key := range keys {
		if key == "" {
			return apicontract.Failure[apicontract.Null](-1, "Field [keys]: each element must not be empty")
		}
	}
	app := request.App
	err := model.RemoveLocalStorageVals(keys)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return contractFailure[apicontract.Null](ret)
	}

	evt := util.NewCmdResult("removeLocalStorageVals", 0, util.PushModeBroadcastMainExcludeSelfApp)
	evt.AppId = app
	evt.Data = map[string]any{"keys": keys}
	util.PushEvent(evt)

	return apicontract.Success(apicontract.Null{})
})

var getCriteria = contractHandler(apicontract.GetCriteria, func(c *gin.Context, request apicontract.EmptyRequest) apicontract.Response[[]*apicontract.Criterion] {

	data := model.GetCriteria()
	if model.IsReadOnlyRoleContext(c) {
		publishAccess := model.GetPublishAccess()
		data = model.FilterCriteriaByPublishAccess(c, publishAccess, data)
	}
	return apicontract.Success(criterionContracts(data))
})

var setCriterion = contractHandler(apicontract.SetCriterion, func(c *gin.Context, request apicontract.SetCriterionRequest) apicontract.Response[apicontract.Null] {
	ret := gulu.Ret.NewResult()

	if request.Criterion == nil {
		return apicontract.Failure[apicontract.Null](-1, "Field [criterion] is required")
	}
	criterion := criterionModel(*request.Criterion)
	err := model.SetCriterion(criterion)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return contractFailure[apicontract.Null](ret)
	}

	return apicontract.Success(apicontract.Null{})
})

var removeCriterion = contractHandler(apicontract.RemoveCriterion, func(c *gin.Context, request apicontract.RemoveCriterionRequest) apicontract.Response[apicontract.Null] {
	ret := gulu.Ret.NewResult()

	name := request.Name
	err := model.RemoveCriterion(name)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return contractFailure[apicontract.Null](ret)
	}

	return apicontract.Success(apicontract.Null{})
})

var getRecentDocs = contractHandler(apicontract.GetRecentDocs, func(c *gin.Context, request apicontract.RecentDocsRequest) apicontract.Response[[]*apicontract.RecentDoc] {
	ret := gulu.Ret.NewResult()

	sortBy := request.SortBy
	data, err := model.GetRecentDocs(sortBy)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return contractFailure[[]*apicontract.RecentDoc](ret)
	}
	if model.IsReadOnlyRoleContext(c) {
		publishAccess := model.GetPublishAccess()
		data = model.FilterRecentDocsByPublishAccess(c, publishAccess, data)
	}
	return apicontract.Success(recentDocContracts(data))
})

var updateRecentDocOpenTime = contractHandler(apicontract.UpdateRecentDocOpenTime, func(c *gin.Context, request apicontract.RecentDocUpdateRequest) apicontract.Response[apicontract.Null] {
	ret := gulu.Ret.NewResult()

	rootID := request.RootID
	if "" == rootID {
		return contractFailure[apicontract.Null](ret)
	}

	err := model.UpdateRecentDocOpenTime(rootID)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return contractFailure[apicontract.Null](ret)
	}

	return apicontract.Success(apicontract.Null{})
}, skipReadonlyStorageMutation)

var updateRecentDocViewTime = contractHandler(apicontract.UpdateRecentDocViewTime, func(c *gin.Context, request apicontract.RecentDocUpdateRequest) apicontract.Response[apicontract.Null] {
	ret := gulu.Ret.NewResult()

	rootID := request.RootID
	if "" == rootID {
		return contractFailure[apicontract.Null](ret)
	}

	err := model.UpdateRecentDocViewTime(rootID)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return contractFailure[apicontract.Null](ret)
	}

	return apicontract.Success(apicontract.Null{})
}, skipReadonlyStorageMutation)

var updateRecentDocCloseTime = contractHandler(apicontract.UpdateRecentDocCloseTime, func(c *gin.Context, request apicontract.RecentDocUpdateRequest) apicontract.Response[apicontract.Null] {
	ret := gulu.Ret.NewResult()

	rootID := request.RootID
	if "" == rootID {
		return contractFailure[apicontract.Null](ret)
	}

	err := model.UpdateRecentDocCloseTime(rootID)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return contractFailure[apicontract.Null](ret)
	}

	return apicontract.Success(apicontract.Null{})
}, skipReadonlyStorageMutation)

var batchUpdateRecentDocCloseTime = contractHandler(apicontract.BatchUpdateRecentDocCloseTime, func(c *gin.Context, request apicontract.RecentDocsUpdateRequest) apicontract.Response[apicontract.Null] {
	ret := gulu.Ret.NewResult()

	rootIDs := request.RootIDs
	if 0 == len(rootIDs) {
		return contractFailure[apicontract.Null](ret)
	}

	err := model.BatchUpdateRecentDocCloseTime(rootIDs)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return contractFailure[apicontract.Null](ret)
	}

	return apicontract.Success(apicontract.Null{})
}, skipReadonlyStorageMutation)

var getOutlineStorage = contractHandler(apicontract.GetOutlineStorage, func(c *gin.Context, request apicontract.OutlineStorageRequest) apicontract.Response[map[string]apicontract.JSONValue] {
	ret := gulu.Ret.NewResult()

	docID := request.DocID

	data, err := model.GetOutlineStorage(docID)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return contractFailure[map[string]apicontract.JSONValue](ret)
	}
	return storageContract(data)
})

var setOutlineStorage = contractHandler(apicontract.SetOutlineStorage, func(c *gin.Context, request apicontract.OutlineStorageSetRequest) apicontract.Response[apicontract.Null] {
	ret := gulu.Ret.NewResult()

	docID := request.DocID
	val, err := storageModelValues(request.Val)
	if err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}
	err = model.SetOutlineStorage(docID, val)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return contractFailure[apicontract.Null](ret)
	}

	return apicontract.Success(apicontract.Null{})
})

var removeOutlineStorage = contractHandler(apicontract.RemoveOutlineStorage, func(c *gin.Context, request apicontract.OutlineStorageRequest) apicontract.Response[apicontract.Null] {
	ret := gulu.Ret.NewResult()

	docID := request.DocID

	err := model.RemoveOutlineStorage(docID)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return contractFailure[apicontract.Null](ret)
	}

	return apicontract.Success(apicontract.Null{})
})

var getViewState = contractHandler(apicontract.GetViewState, func(c *gin.Context, request apicontract.StorageKeyRequest) apicontract.Response[map[string]apicontract.JSONValue] {
	ret := gulu.Ret.NewResult()

	key := request.Key
	data, err := model.GetViewState(key)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return contractFailure[map[string]apicontract.JSONValue](ret)
	}
	return storageContract(data)
})

var patchViewState = contractHandler(apicontract.PatchViewState, func(c *gin.Context, request apicontract.ViewStatePatchRequest) apicontract.Response[map[string]apicontract.JSONValue] {
	ret := gulu.Ret.NewResult()

	key, removeKeys := request.Key, request.RemoveKeys
	for _, key := range removeKeys {
		if strings.TrimSpace(key) == "" {
			return apicontract.Failure[map[string]apicontract.JSONValue](-1, "Field [removeKeys]: each element should be a non-empty String")
		}
	}
	values, err := storageModelValues(request.Values)
	if err != nil {
		return apicontract.Failure[map[string]apicontract.JSONValue](-1, err.Error())
	}
	data, err := model.PatchViewState(key, values, removeKeys)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return contractFailure[map[string]apicontract.JSONValue](ret)
	}
	return storageContract(data)
})

var removeViewState = contractHandler(apicontract.RemoveViewState, func(c *gin.Context, request apicontract.StorageKeyRequest) apicontract.Response[apicontract.Null] {
	ret := gulu.Ret.NewResult()

	key := request.Key
	if err := model.RemoveViewState(key); err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
	}

	return contractFailure[apicontract.Null](ret)
})

func parseViewStateRemoveKeys(value any) (ret []string, valid bool) {
	if nil == value {
		return []string{}, true
	}
	values, ok := value.([]any)
	if !ok {
		return nil, false
	}
	for _, item := range values {
		key, ok := item.(string)
		if !ok || "" == strings.TrimSpace(key) {
			return nil, false
		}
		ret = append(ret, key)
	}
	return ret, true
}
