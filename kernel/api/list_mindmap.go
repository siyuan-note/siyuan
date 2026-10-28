// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/model"
)

var migrateLegacyMindmaps = contractHandler(apicontract.MigrateLegacyMindmaps, func(c *gin.Context, request apicontract.MigrateLegacyMindmapsRequest) apicontract.Response[apicontract.MigrateLegacyMindmapsData] {
	if _, err := holdContractBlockRequest(c, request.Notebook, request.ID, nil, false); err != nil {
		return apicontract.Failure[apicontract.MigrateLegacyMindmapsData](-1, err.Error())
	}
	tx, visible, err := model.MigrateLegacyMindmaps(request.ID)
	if tx != nil && len(tx.DoOperations) > 0 {
		broadcastTransactions([]*model.Transaction{tx})
	}
	if err != nil {
		return apicontract.Failure[apicontract.MigrateLegacyMindmapsData](-1, err.Error())
	}
	data := apicontract.MigrateLegacyMindmapsData{Converted: len(tx.DoOperations), Blocks: []apicontract.BlockDOMData{}}
	for id, dom := range visible {
		data.Blocks = append(data.Blocks, apicontract.BlockDOMData{ID: id, DOM: dom})
	}
	return apicontract.Success(data)
})
