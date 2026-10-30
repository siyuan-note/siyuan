// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/model"
)

func startTemplateHTTP(c *gin.Context, scope string) (*model.TemplateHTTPExecution, error) {
	if model.IsReadOnlyRoleContext(c) {
		return nil, nil
	}
	return model.StartTemplateHTTPExecution(c.Request.Context(), c.GetHeader("X-Siyuan-Template-Execution"),
		c.GetHeader("X-Siyuan-Template-App"), c.GetHeader("X-Siyuan-Template-Session"), scope, requestBoxLeases(c)...)
}

var respondTemplateHTTP = contractHandler(apicontract.RespondTemplateHTTP, func(c *gin.Context, request apicontract.TemplateHTTPReplyRequest) apicontract.Response[apicontract.Null] {
	model.RespondTemplateHTTP(request.ExecutionID, request.ConfirmID, request.App, request.Session, request.Approved)
	return apicontract.Success(apicontract.Null{})
})

var cancelTemplateHTTP = contractHandler(apicontract.CancelTemplateHTTP, func(c *gin.Context, request apicontract.TemplateHTTPCancelRequest) apicontract.Response[apicontract.Null] {
	model.CancelTemplateHTTP(request.ExecutionID, request.App, request.Session)
	return apicontract.Success(apicontract.Null{})
})
