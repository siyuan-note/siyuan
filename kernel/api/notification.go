// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"github.com/siyuan-note/siyuan/kernel/apicontract"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var pushMsg = contractHandler(apicontract.PushMsg, func(c *gin.Context, request apicontract.NotificationRequest) apicontract.Response[apicontract.NotificationData] {

	msg := request.Msg
	timeout := 7000
	if request.Timeout != nil {
		timeout = int(*request.Timeout)
	}

	msg = util.SanitizeHTML(msg)
	msgId := util.PushMsg(msg, timeout)

	return apicontract.Success(apicontract.NotificationData{ID: msgId})
})

var pushErrMsg = contractHandler(apicontract.PushErrMsg, func(c *gin.Context, request apicontract.NotificationRequest) apicontract.Response[apicontract.NotificationData] {

	msg := request.Msg
	timeout := 7000
	if request.Timeout != nil {
		timeout = int(*request.Timeout)
	}

	msg = util.SanitizeHTML(msg)
	msgId := util.PushErrMsg(msg, timeout)

	return apicontract.Success(apicontract.NotificationData{ID: msgId})
})
