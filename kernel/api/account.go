// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/model"
)

var startFreeTrial = contractHandler(apicontract.StartFreeTrial, func(c *gin.Context, request apicontract.EmptyRequest) apicontract.Response[apicontract.Null] {
	if err := model.StartFreeTrial(); err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}
	return apicontract.Success(apicontract.Null{})
})
var useActivationcode = contractHandler(apicontract.UseActivationCode, func(c *gin.Context, request apicontract.ActivationCodeRequest) apicontract.Response[apicontract.Null] {
	if err := model.UseActivationcode(request.Data); err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}
	return apicontract.Success(apicontract.Null{})
})
var checkActivationcode = contractHandler(apicontract.CheckActivationCode, func(c *gin.Context, request apicontract.CheckActivationCodeRequest) apicontract.Response[apicontract.Null] {
	code, msg := model.CheckActivationcode(request.Data)
	return apicontract.CheckActivationCode.FailureWithData(code, msg, apicontract.Null{})
})
var deactivateUser = contractHandler(apicontract.DeactivateUser, func(c *gin.Context, request apicontract.EmptyRequest) apicontract.Response[apicontract.Null] {
	if err := model.DeactivateUser(); err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}
	return apicontract.Success(apicontract.Null{})
})
var login = contractHandler(apicontract.AccountLogin, func(c *gin.Context, request apicontract.AccountLoginRequest) apicontract.Response[*apicontract.AccountLoginData] {
	data, code, msg := model.Login(request.UserName, request.UserPassword, request.Captcha, int(request.CloudRegion))
	return apicontract.AccountLogin.FailureWithData(code, msg, data)
})
