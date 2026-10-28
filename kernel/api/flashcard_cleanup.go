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

var inspectInvalidFlashcardSources = contractHandler(apicontract.InspectInvalidFlashcardSources, func(c *gin.Context, input apicontract.EmptyRequest) apicontract.Response[apicontract.FlashcardV2InvalidSourcesReport] {
	report, err := model.InspectInvalidFlashcardV2Sources(c.Request.Context())
	if err != nil {
		return apicontract.Failure[apicontract.FlashcardV2InvalidSourcesReport](-1, err.Error())
	}
	return flashcardPayloadResponse[apicontract.FlashcardV2InvalidSourcesReport](report)
})

var deleteInvalidFlashcardSources = contractHandler(apicontract.DeleteInvalidFlashcardSources, func(c *gin.Context, input apicontract.FlashcardV2DeleteInvalidSourcesRequest) apicontract.Response[apicontract.FlashcardV2DeleteInvalidSourcesResult] {
	request, err := convertFlashcardPayload[flashcardv2.DeleteInvalidSourcesRequest](input)
	if err != nil {
		return apicontract.Failure[apicontract.FlashcardV2DeleteInvalidSourcesResult](-1, err.Error())
	}
	result, err := model.DeleteInvalidFlashcardV2Sources(c.Request.Context(), request)
	if err != nil {
		return apicontract.Failure[apicontract.FlashcardV2DeleteInvalidSourcesResult](-1, err.Error())
	}
	return flashcardPayloadResponse[apicontract.FlashcardV2DeleteInvalidSourcesResult](result)
})
