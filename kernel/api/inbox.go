// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/model"
)

var removeShorthands = contractHandler(apicontract.RemoveShorthands, func(c *gin.Context, request apicontract.RemoveShorthandsRequest) apicontract.Response[apicontract.Null] {
	var ids []string
	ids = append(ids, request.IDs...)
	if err := model.RemoveCloudShorthands(ids); err != nil {
		return apicontract.Failure[apicontract.Null](1, err.Error())
	}
	return apicontract.Success(apicontract.Null{})
})

var getShorthand = contractHandler(apicontract.GetShorthand, func(c *gin.Context, request apicontract.TrimmedIDRequest) apicontract.Response[*apicontract.Shorthand] {
	data, err := model.GetCloudShorthand(request.ID)
	if err != nil {
		return apicontract.Failure[*apicontract.Shorthand](1, err.Error())
	}
	result, err := decodeCloudInbox[apicontract.Shorthand](data)
	if err != nil {
		return apicontract.Failure[*apicontract.Shorthand](1, err.Error())
	}
	return apicontract.Success(result)
})

var getShorthands = contractHandler(apicontract.GetShorthands, func(c *gin.Context, request apicontract.ShorthandsRequest) apicontract.Response[*apicontract.ShorthandsData] {
	data, err := model.GetCloudShorthands(int(request.Page))
	if err != nil {
		return apicontract.Failure[*apicontract.ShorthandsData](1, err.Error())
	}
	result, err := decodeCloudInbox[apicontract.ShorthandsData](data)
	if err != nil {
		return apicontract.Failure[*apicontract.ShorthandsData](1, err.Error())
	}
	return apicontract.Success(result)
})
