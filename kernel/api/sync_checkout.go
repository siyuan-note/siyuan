// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/model"
)

var cancelSyncCheckout = contractHandler(apicontract.CancelSyncCheckout, cancelSyncCheckoutContract)

func cancelSyncCheckoutContract(_ *gin.Context, request apicontract.CancelSyncCheckoutRequest) apicontract.Response[apicontract.CancelSyncCheckoutData] {
	return apicontract.Success(apicontract.CancelSyncCheckoutData{Requested: model.CancelSyncCheckout(request.TaskID)})
}

var getSyncCheckout = contractHandler(apicontract.GetSyncCheckout,
	func(_ *gin.Context, request apicontract.SyncCheckoutClientRequest) apicontract.Response[apicontract.SyncCheckoutSnapshot] {
		return apicontract.Success(model.GetSyncCheckout(request.AppID, request.ClientID))
	})

var confirmSyncCheckout = contractHandler(apicontract.ConfirmSyncCheckout,
	func(_ *gin.Context, request apicontract.ConfirmSyncCheckoutRequest) apicontract.Response[apicontract.CancelSyncCheckoutData] {
		return apicontract.Success(apicontract.CancelSyncCheckoutData{
			Requested: model.ConfirmSyncCheckout(request.TaskID, request.Token, request.Saved),
		})
	})
