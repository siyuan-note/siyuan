// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package api

import (
	"net/http"

	"github.com/88250/gulu"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/conf"
	mcpclient "github.com/siyuan-note/siyuan/kernel/mcp/client"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func chatGPT(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var msg string
	if !util.ParseJsonArgs(arg, ret, util.BindJsonArg("msg", &msg, true, true)) {
		return
	}
	ret.Data = model.ChatGPT(msg)
}

func chatGPTWithAction(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	idsArg := arg["ids"].([]any)
	var ids []string
	for _, id := range idsArg {
		ids = append(ids, id.(string))
	}
	action := arg["action"].(string)
	ret.Data = model.ChatGPTWithAction(ids, action)
}

// testModel 测试 AI 模型可用性。用该 Provider 已保存的 baseURL/APIKey/超时，
// 校验指定模型是否可用。优先通过 ListModels 拉取可用模型清单精确匹配，
// 若该端点不可用则回退到极简 Chat Completion 验证连通性。
func testModel(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var providerID, modelName string
	if !util.ParseJsonArgs(arg, ret,
		util.BindJsonArg("provider", &providerID, true, true),
		util.BindJsonArg("model", &modelName, true, true),
	) {
		return
	}

	// 按 ID 查找 Provider（不限制启用状态，便于测试尚未启用的配置）
	var provider *conf.Provider
	for _, p := range model.Conf.AI.Providers {
		if p != nil && p.ID == providerID {
			provider = p
			break
		}
	}
	if nil == provider {
		ret.Code = -1
		ret.Msg = "provider not found"
		return
	}

	available, matched, err := util.TestModel(provider.APIKey, provider.BaseURL, modelName, provider.RequestTimeout)
	// 可用模型清单裁剪到前 50 条，避免响应体过大
	if 50 < len(available) {
		available = available[:50]
	}
	// 测试结果统一以 code=0 返回，具体成败信息放在 data 中由前端控制展示，
	// 避免触发统一的错误消息提示导致按钮状态无法恢复
	result := map[string]any{
		"available": available,
		"matched":   matched,
	}
	if nil != err {
		result["msg"] = err.Error()
		logging.LogErrorf("test model [%s] failed: %s", modelName, err)
	} else if !matched {
		result["msg"] = "model not in available list"
	}
	ret.Data = result
}

// listModels 拉取指定 Provider 的可用模型清单（GET /v1/models），用于填充前端模型名称下拉框。
// 不支持该端点的服务会返回错误，由前端回退为手动输入。
func listModels(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var providerID string
	if !util.ParseJsonArgs(arg, ret,
		util.BindJsonArg("provider", &providerID, true, true),
	) {
		return
	}

	var provider *conf.Provider
	for _, p := range model.Conf.AI.Providers {
		if p != nil && p.ID == providerID {
			provider = p
			break
		}
	}
	if nil == provider {
		ret.Code = -1
		ret.Msg = "provider not found"
		return
	}

	models, err := util.ListAvailableModels(provider.APIKey, provider.BaseURL, provider.RequestTimeout)
	result := map[string]any{
		"models": models,
	}
	if nil != err {
		result["msg"] = err.Error()
	}
	ret.Data = result
}

// embeddingStat 返回嵌入索引进度统计，供设置页展示进度条与各项计数。
func embeddingStat(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)
	ret.Data = model.GetEmbeddingStat()
}

// mcpStatus 返回所有已配置 MCP server 的连接状态，供设置页轮询展示。
func mcpStatus(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)
	ret.Data = mcpclient.MCPStatus()
}

// reindexEmbedding 清空嵌入向量表并触发后台索引器重新计算所有块，异步执行。
func reindexEmbedding(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)
	model.ReindexEmbedding()
}

// retryFailedEmbedding 删除失败块的行，使其立即回到主循环重嵌，已成功向量不动，异步执行。
func retryFailedEmbedding(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)
	model.RetryFailedEmbedding()
}
