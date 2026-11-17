// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	flashcardv2 "github.com/siyuan-note/siyuan/kernel/flashcard"
	"github.com/siyuan-note/siyuan/kernel/model"
)

var previewAdvancedFlashcardSource = contractHandler(apicontract.PreviewAdvancedFlashcardSource,
	func(c *gin.Context, input apicontract.FlashcardV2AdvancedPreviewRequest) apicontract.Response[apicontract.FlashcardV2AdvancedPreviewData] {
		request, err := convertFlashcardPayload[flashcardv2.AdvancedSourceRequest](input)
		if err != nil {
			return apicontract.Failure[apicontract.FlashcardV2AdvancedPreviewData](-1, err.Error())
		}
		result, err := model.PreviewFlashcardV2AdvancedSource(c.Request.Context(), request)
		if err != nil {
			return apicontract.Failure[apicontract.FlashcardV2AdvancedPreviewData](-1, err.Error())
		}
		return flashcardPayloadResponse[apicontract.FlashcardV2AdvancedPreviewData](result)
	})
