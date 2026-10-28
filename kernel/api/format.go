// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"github.com/siyuan-note/siyuan/kernel/apicontract"

	"github.com/88250/gulu"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/model"
)

var netAssets2LocalAssets = contractHandler(apicontract.NetAssets2LocalAssets, func(c *gin.Context, request apicontract.TrimmedIDRequest) apicontract.Response[apicontract.Null] {
	ret := gulu.Ret.NewResult()

	id := request.ID
	err := model.NetAssets2LocalAssets(id, false, "")
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return apicontract.FailureWithTimeout[apicontract.Null](ret.Code, ret.Msg, 5000)
	}

	return apicontract.Success(apicontract.Null{})
})

var netImg2LocalAssets = contractHandler(apicontract.NetImg2LocalAssets, func(c *gin.Context, request apicontract.NetImageAssetsRequest) apicontract.Response[apicontract.Null] {
	ret := gulu.Ret.NewResult()

	id := request.ID
	url := request.URL
	err := model.NetAssets2LocalAssets(id, true, url)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return apicontract.FailureWithTimeout[apicontract.Null](ret.Code, ret.Msg, 5000)
	}

	return apicontract.Success(apicontract.Null{})
})

var autoSpace = contractHandler(apicontract.AutoSpace, func(c *gin.Context, request apicontract.TrimmedIDRequest) apicontract.Response[apicontract.Null] {
	ret := gulu.Ret.NewResult()

	id := request.ID
	err := model.AutoSpace(id)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return apicontract.FailureWithTimeout[apicontract.Null](ret.Code, ret.Msg, 5000)
	}

	return apicontract.Success(apicontract.Null{})
})
