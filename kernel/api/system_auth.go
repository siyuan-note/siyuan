// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/model"
)

var loginAuth = contractHandler(apicontract.SystemLoginAuth, model.LoginAuth)
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
