// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/model"
)

// maxLoginAuthBodyBytes 限制公开登录请求体，登录字段都远小于该上限。
const maxLoginAuthBodyBytes = 64 << 10

var loginAuth = contractHandler(apicontract.SystemLoginAuth, model.LoginAuth, limitLoginAuthBody)
var logoutAuth = contractHandler(apicontract.SystemLogoutAuth, model.LogoutAuth)
var getCaptcha = contractHandler(apicontract.SystemGetCaptcha, model.GetCaptcha)
var oidcStart = contractHandler(apicontract.SystemOIDCStart, model.OIDCStart, model.OIDCStartPreflight)
var oidcCallback = contractHandler(apicontract.SystemOIDCCallback, model.OIDCCallback)
var oidcMobileCallback = contractHandler(apicontract.SystemOIDCMobileCallback, model.OIDCMobileCallback)
var oidcPoll = contractHandler(apicontract.SystemOIDCPoll, model.OIDCPoll)
var oidcValidateStart = contractHandler(apicontract.SystemOIDCValidateStart, model.OIDCValidateStart)
var oidcValidatePoll = contractHandler(apicontract.SystemOIDCValidatePoll, model.OIDCValidatePoll)
var oidcValidateActivate = contractHandler(apicontract.SystemOIDCValidateActivate, model.OIDCValidateActivate)
var oidcValidateCancel = contractHandler(apicontract.SystemOIDCValidateCancel, model.OIDCValidateCancel)

// limitLoginAuthBody 在解码前收紧公开登录请求体上限，超限由契约入口返回请求体过大。
func limitLoginAuthBody(c *gin.Context) *apicontract.Response[apicontract.Null] {
	limitContractBody(c, maxLoginAuthBodyBytes)
	return nil
}
