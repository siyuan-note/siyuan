// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/model"
)

var reorderAdvancedFlashcardSource = contractHandler(apicontract.ReorderAdvancedFlashcardSource,
	func(c *gin.Context, input apicontract.FlashcardV2ReorderAdvancedSourceRequest) apicontract.Response[apicontract.FlashcardV2ReorderAdvancedSourceResult] {
		request, err := convertFlashcardPayload[model.FlashcardV2ReorderSourceRequest](input)
		if err != nil {
			return apicontract.Failure[apicontract.FlashcardV2ReorderAdvancedSourceResult](-1, err.Error())
		}
		result, err := model.ReorderFlashcardV2AdvancedSource(c.Request.Context(), request)
		if err != nil {
			return apicontract.Failure[apicontract.FlashcardV2ReorderAdvancedSourceResult](-1, err.Error())
		}
		return flashcardPayloadResponse[apicontract.FlashcardV2ReorderAdvancedSourceResult](result)
	})

var getOrderedFlashcardSourceDetails = contractHandler(apicontract.GetOrderedFlashcardSourceDetails,
	func(c *gin.Context, input apicontract.FlashcardV2OrderedSourceDetailsRequest) apicontract.Response[apicontract.FlashcardV2OrderedSourceDetails] {
		result, err := model.GetFlashcardV2OrderedSourceDetails(c.Request.Context(), input.SourceID)
		if err != nil {
			return apicontract.Failure[apicontract.FlashcardV2OrderedSourceDetails](-1, err.Error())
		}
		return flashcardPayloadResponse[apicontract.FlashcardV2OrderedSourceDetails](result)
	})
