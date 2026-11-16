// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"errors"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/model"
)

var getAssetCleanupIgnore = contractHandler(apicontract.GetAssetCleanupIgnore, func(c *gin.Context, request apicontract.EmptyRequest) apicontract.Response[apicontract.AssetCleanupIgnoreData] {
	data, err := model.GetAssetCleanupIgnore()
	return assetCleanupIgnoreResponse(data, err)
})

var setAssetCleanupIgnore = contractHandler(apicontract.SetAssetCleanupIgnore, func(c *gin.Context, request apicontract.SetAssetCleanupIgnoreRequest) apicontract.Response[apicontract.AssetCleanupIgnoreData] {
	data, err := model.SetAssetCleanupIgnore(request.Content, request.ExpectedRevision)
	return assetCleanupIgnoreResponse(data, err)
})

var addAssetCleanupIgnore = contractHandler(apicontract.AddAssetCleanupIgnore, func(c *gin.Context, request apicontract.AddAssetCleanupIgnoreRequest) apicontract.Response[apicontract.AssetCleanupIgnoreData] {
	data, err := model.AddAssetCleanupIgnore(request.Paths)
	return assetCleanupIgnoreResponse(data, err)
})

func assetCleanupIgnoreResponse(data *model.AssetCleanupIgnoreData, err error) apicontract.Response[apicontract.AssetCleanupIgnoreData] {
	if errors.Is(err, model.ErrAssetCleanupIgnoreConflict) {
		return apicontract.Failure[apicontract.AssetCleanupIgnoreData](409, err.Error())
	}
	if err != nil {
		return apicontract.Failure[apicontract.AssetCleanupIgnoreData](-1, err.Error())
	}
	return apicontract.Success(apicontract.AssetCleanupIgnoreData{Content: data.Content, Revision: data.Revision})
}
