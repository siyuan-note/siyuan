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
