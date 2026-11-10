// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/model"
)

var previewTagRemoval = contractHandler(apicontract.PreviewTagRemoval,
	func(c *gin.Context, request apicontract.TagRemovalPreviewRequest) apicontract.Response[[]*apicontract.TagRemovalCollection] {
		groups, err := model.PreviewTagRemoval(request)
		if err != nil {
			return apicontract.Failure[[]*apicontract.TagRemovalCollection](-1, err.Error())
		}
		return apicontract.Success(groups)
	})

var removeTagWithCollections = contractHandler(apicontract.RemoveTagWithCollections,
	func(c *gin.Context, request apicontract.RemoveTagWithCollectionsRequest) apicontract.Response[apicontract.Null] {
		tx, err := model.RemoveTagWithCollections(request)
		if err != nil {
			return apicontract.Failure[apicontract.Null](-1, err.Error())
		}
		if len(tx.DoOperations) > 0 {
			pushTransactions("", "", []*model.Transaction{tx})
		}
		return apicontract.Success(apicontract.Null{})
	})
