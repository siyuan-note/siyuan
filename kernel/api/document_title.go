// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/model"
)

var getDocTitle = contractHandler(apicontract.GetDocTitle, func(c *gin.Context, request apicontract.DocumentTitleRequest) apicontract.Response[apicontract.DocumentTitleData] {
	boxID, err := holdContractBlockRequest(c, request.Notebook, request.ID, nil, false)
	if err != nil {
		return apicontract.Failure[apicontract.DocumentTitleData](-1, err.Error())
	}
	if err := checkBlockPublishAccessInBox(c, request.ID, boxID); err != nil {
		return apicontract.FailureFrom[apicontract.DocumentTitleData](err)
	}
	title, err := model.GetDocTitle(request.ID, boxID)
	if err != nil {
		return apicontract.Failure[apicontract.DocumentTitleData](-1, err.Error())
	}
	data := apicontract.DocumentTitleData{ID: title.ID, Notebook: title.Notebook, Format: title.Format,
		Text: title.Text, Empty: title.Empty, BlockDOM: title.BlockDOM, Revision: title.Revision}
	if title.Source != nil {
		data.Source = &apicontract.DocumentTitleSource{Spec: title.Source.Spec, Format: title.Source.Format, Content: title.Source.Content}
	}
	return apicontract.Success(data)
})
