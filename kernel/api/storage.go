// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"encoding/json"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"slices"
	"strings"

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
	if slices.Contains(keys, "") {
		return apicontract.Failure[map[string]apicontract.JSONValue](-1, "Field [keys]: each element must not be empty")
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

	key, app := request.Key, request.App
	input, err := storageModelValues(map[string]apicontract.JSONValue{key: request.Val})
	if err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}
	val := input[key]
	setKeyVals, err := model.SetLocalStorageVals(map[string]any{key: val})
	if err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}

	evt := util.NewCmdResult("setLocalStorageVal", 0, util.PushModeBroadcastMainExcludeSelfApp)
	evt.AppId = app
	evt.Data = map[string]any{"key": key, "val": setKeyVals[key]}
	util.PushEvent(evt)

	return apicontract.Success(apicontract.Null{})
})

var setLocalStorageVals = contractHandler(apicontract.SetLocalStorageVals, func(c *gin.Context, request apicontract.StorageSetKeysRequest) apicontract.Response[apicontract.Null] {

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
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}

	evtSet := util.NewCmdResult("setLocalStorageVals", 0, util.PushModeBroadcastMainExcludeSelfApp)
	evtSet.AppId = app
	evtSet.Data = map[string]any{"keyVals": setKeyVals}
	util.PushEvent(evtSet)

	return apicontract.Success(apicontract.Null{})
})

var removeLocalStorageVal = contractHandler(apicontract.RemoveLocalStorageVal, func(c *gin.Context, request apicontract.StorageRemoveRequest) apicontract.Response[apicontract.Null] {

	key, app := request.Key, request.App
	err := model.RemoveLocalStorageVals([]string{key})
	if err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}

	evt := util.NewCmdResult("removeLocalStorageVal", 0, util.PushModeBroadcastMainExcludeSelfApp)
	evt.AppId = app
	evt.Data = map[string]any{"key": key}
	util.PushEvent(evt)

	return apicontract.Success(apicontract.Null{})
})

var removeLocalStorageVals = contractHandler(apicontract.RemoveLocalStorageVals, func(c *gin.Context, request apicontract.StorageRemoveKeysRequest) apicontract.Response[apicontract.Null] {

	keys := request.Keys
	if len(keys) == 0 {
		return apicontract.Failure[apicontract.Null](-1, "Field [keys] must not be empty")
	}
	if slices.Contains(keys, "") {
		return apicontract.Failure[apicontract.Null](-1, "Field [keys]: each element must not be empty")
	}
	app := request.App
	err := model.RemoveLocalStorageVals(keys)
	if err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
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

	if request.Criterion == nil {
		return apicontract.Failure[apicontract.Null](-1, "Field [criterion] is required")
	}
	criterion := criterionModel(*request.Criterion)
	err := model.SetCriterion(criterion)
	if err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}

	return apicontract.Success(apicontract.Null{})
})

var removeCriterion = contractHandler(apicontract.RemoveCriterion, func(c *gin.Context, request apicontract.RemoveCriterionRequest) apicontract.Response[apicontract.Null] {

	name := request.Name
	err := model.RemoveCriterion(name)
	if err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}

	return apicontract.Success(apicontract.Null{})
})

var getRecentDocs = contractHandler(apicontract.GetRecentDocs, func(c *gin.Context, request apicontract.RecentDocsRequest) apicontract.Response[[]*apicontract.RecentDoc] {

	sortBy := request.SortBy
	data, err := model.GetRecentDocs(sortBy)
	if err != nil {
		return apicontract.Failure[[]*apicontract.RecentDoc](-1, err.Error())
	}
	if model.IsReadOnlyRoleContext(c) {
		publishAccess := model.GetPublishAccess()
		data = model.FilterRecentDocsByPublishAccess(c, publishAccess, data)
	}
	return apicontract.Success(recentDocContracts(data))
})

var clearRecentDocs = contractHandler(apicontract.ClearRecentDocs, func(c *gin.Context, request apicontract.EmptyRequest) apicontract.Response[apicontract.Null] {
	if err := model.ClearRecentDocs(); err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}
	return apicontract.Success(apicontract.Null{})
})

var updateRecentDocOpenTime = contractHandler(apicontract.UpdateRecentDocOpenTime, func(c *gin.Context, request apicontract.RecentDocUpdateRequest) apicontract.Response[apicontract.Null] {
	rootID := request.RootID
	if "" == rootID {
		return apicontract.SuccessWithoutData[apicontract.Null]()
	}

	err := model.UpdateRecentDocOpenTime(rootID)
	if err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}

	return apicontract.Success(apicontract.Null{})
}, skipReadonlyStorageMutation)

var updateRecentDocViewTime = contractHandler(apicontract.UpdateRecentDocViewTime, func(c *gin.Context, request apicontract.RecentDocUpdateRequest) apicontract.Response[apicontract.Null] {
	rootID := request.RootID
	if "" == rootID {
		return apicontract.SuccessWithoutData[apicontract.Null]()
	}

	err := model.UpdateRecentDocViewTime(rootID)
	if err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}

	return apicontract.Success(apicontract.Null{})
}, skipReadonlyStorageMutation)

var updateRecentDocCloseTime = contractHandler(apicontract.UpdateRecentDocCloseTime, func(c *gin.Context, request apicontract.RecentDocUpdateRequest) apicontract.Response[apicontract.Null] {
	rootID := request.RootID
	if "" == rootID {
		return apicontract.SuccessWithoutData[apicontract.Null]()
	}

	err := model.UpdateRecentDocCloseTime(rootID)
	if err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}

	return apicontract.Success(apicontract.Null{})
}, skipReadonlyStorageMutation)

var batchUpdateRecentDocCloseTime = contractHandler(apicontract.BatchUpdateRecentDocCloseTime, func(c *gin.Context, request apicontract.RecentDocsUpdateRequest) apicontract.Response[apicontract.Null] {
	rootIDs := request.RootIDs
	if 0 == len(rootIDs) {
		return apicontract.SuccessWithoutData[apicontract.Null]()
	}

	err := model.BatchUpdateRecentDocCloseTime(rootIDs)
	if err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}

	return apicontract.Success(apicontract.Null{})
}, skipReadonlyStorageMutation)

var getOutlineStorage = contractHandler(apicontract.GetOutlineStorage, func(c *gin.Context, request apicontract.OutlineStorageRequest) apicontract.Response[map[string]apicontract.JSONValue] {

	docID := request.DocID

	data, err := model.GetOutlineStorage(docID)
	if err != nil {
		return apicontract.Failure[map[string]apicontract.JSONValue](-1, err.Error())
	}
	return storageContract(data)
})

var setOutlineStorage = contractHandler(apicontract.SetOutlineStorage, func(c *gin.Context, request apicontract.OutlineStorageSetRequest) apicontract.Response[apicontract.Null] {

	docID := request.DocID
	val, err := storageModelValues(request.Val)
	if err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}
	err = model.SetOutlineStorage(docID, val)
	if err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}

	return apicontract.Success(apicontract.Null{})
})

var removeOutlineStorage = contractHandler(apicontract.RemoveOutlineStorage, func(c *gin.Context, request apicontract.OutlineStorageRequest) apicontract.Response[apicontract.Null] {

	docID := request.DocID

	err := model.RemoveOutlineStorage(docID)
	if err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}

	return apicontract.Success(apicontract.Null{})
})

var getViewState = contractHandler(apicontract.GetViewState, func(c *gin.Context, request apicontract.StorageKeyRequest) apicontract.Response[map[string]apicontract.JSONValue] {

	key := request.Key
	data, err := model.GetViewState(key)
	if err != nil {
		return apicontract.Failure[map[string]apicontract.JSONValue](-1, err.Error())
	}
	return storageContract(data)
})

var patchViewState = contractHandler(apicontract.PatchViewState, func(c *gin.Context, request apicontract.ViewStatePatchRequest) apicontract.Response[map[string]apicontract.JSONValue] {

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
		return apicontract.Failure[map[string]apicontract.JSONValue](-1, err.Error())
	}
	return storageContract(data)
})

var removeViewState = contractHandler(apicontract.RemoveViewState, func(c *gin.Context, request apicontract.StorageKeyRequest) apicontract.Response[apicontract.Null] {
	key := request.Key
	if err := model.RemoveViewState(key); err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}

	return apicontract.Success(apicontract.Null{})
})
