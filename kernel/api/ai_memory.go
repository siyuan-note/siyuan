// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func memoryResponse[T any](value T, err error) apicontract.Response[T] {
	if err != nil {
		return apicontract.Failure[T](-1, util.EscapeHTML(err.Error()))
	}
	return apicontract.Success(value)
}

var listAIMemory = contractHandler(apicontract.AIMemoryList, listAIMemoryContract)

func listAIMemoryContract(c *gin.Context, q apicontract.AIMemoryListRequest) apicontract.Response[apicontract.AIMemoryListData] {
	return memoryResponse(model.ListAIMemory(c.Request.Context(), q))
}

var getAIMemory = contractHandler(apicontract.AIMemoryGet, getAIMemoryContract)

func getAIMemoryContract(c *gin.Context, q apicontract.AIMemoryGetRequest) apicontract.Response[apicontract.AIMemoryGetData] {
	return memoryResponse(model.GetAIMemory(c.Request.Context(), q.ID))
}

var saveAIMemory = contractHandler(apicontract.AIMemorySave, saveAIMemoryContract)

func saveAIMemoryContract(c *gin.Context, q apicontract.AIMemorySaveRequest) apicontract.Response[apicontract.AIMemorySaveData] {
	r, err := model.SaveAIMemory(c.Request.Context(), q)
	if err == nil {
		model.ScheduleAIMemoryOverview()
	}
	return memoryResponse(r, err)
}

var forgetAIMemory = contractHandler(apicontract.AIMemoryForget, forgetAIMemoryContract)

var clearAIMemory = contractHandler(apicontract.AIMemoryClear, clearAIMemoryContract)

func clearAIMemoryContract(c *gin.Context, q apicontract.EmptyRequest) apicontract.Response[apicontract.AIMemoryClearData] {
	return withSettingLock("ai", func() apicontract.Response[apicontract.AIMemoryClearData] {
		return memoryResponse(model.ClearAIMemory(c.Request.Context()))
	})
}

func forgetAIMemoryContract(c *gin.Context, q apicontract.AIMemoryForgetRequest) apicontract.Response[apicontract.AIMemoryForgetData] {
	r, err := model.ForgetAIMemory(c.Request.Context(), q)
	if err == nil {
		model.ScheduleAIMemoryOverview()
	}
	return memoryResponse(r, err)
}

var overviewAIMemory = contractHandler(apicontract.AIMemoryOverview, overviewAIMemoryContract)

func overviewAIMemoryContract(c *gin.Context, q apicontract.EmptyRequest) apicontract.Response[apicontract.AIMemoryOverviewData] {
	return memoryResponse(model.ReadAIMemoryOverview(c.Request.Context()))
}

var translateAIMemory = contractHandler(apicontract.AIMemoryTranslate, translateAIMemoryContract)

func translateAIMemoryContract(c *gin.Context, q apicontract.AIMemoryTranslateRequest) apicontract.Response[apicontract.AIMemoryTranslateData] {
	return memoryResponse(model.TranslateAIMemoryOverview(c.Request.Context(), q))
}

var maintainAIMemory = contractHandler(apicontract.AIMemoryMaintain, maintainAIMemoryContract)

func maintainAIMemoryContract(c *gin.Context, q apicontract.AIMemoryMaintainRequest) apicontract.Response[apicontract.AIMemoryTaskStarted] {
	return memoryResponse(model.StartAIMemory(c.Request.Context(), q, false))
}

var taskAIMemory = contractHandler(apicontract.AIMemoryTask, taskAIMemoryContract)

func taskAIMemoryContract(c *gin.Context, q apicontract.AIMemoryTaskRequest) apicontract.Response[apicontract.AIMemoryTaskData] {
	return memoryResponse(model.GetAIMemoryTask(q.TaskID))
}

var cancelAIMemory = contractHandler(apicontract.AIMemoryCancel, cancelAIMemoryContract)

func cancelAIMemoryContract(c *gin.Context, q apicontract.AIMemoryTaskRequest) apicontract.Response[apicontract.EmptyRequest] {
	return memoryResponse(apicontract.EmptyRequest{}, model.CancelAIMemory(q.TaskID))
}

var capabilitiesAIMemory = contractHandler(apicontract.AIMemoryCapabilities, capabilitiesAIMemoryContract)

func capabilitiesAIMemoryContract(c *gin.Context, q apicontract.EmptyRequest) apicontract.Response[apicontract.AIMemoryCapabilitiesData] {
	efforts := []string{}
	cfg := model.Conf.LoadAI()
	if cfg != nil {
		p, m, err := cfg.GetMemoryModel()
		if err == nil {
			efforts = append(efforts, conf.MemoryReasoningEfforts(p, m)...)
		}
	}
	return apicontract.Success(apicontract.AIMemoryCapabilitiesData{Efforts: efforts})
}
