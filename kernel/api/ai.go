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
	"html"
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

// testEmbeddingModel 测试嵌入模型可用性。直接读取已保存的 Embedding 配置，
// 发送极简文本 embedding 请求验证连通性与鉴权，并返回向量维度便于核对。
func testEmbeddingModel(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	embedding := model.Conf.AI.Embedding
	if nil == embedding || "" == embedding.APIKey || "" == embedding.BaseURL || "" == embedding.Name {
		// 配置不完整时统一以 code=0 返回，把信息放在 data 中由前端控制展示，
		// 避免返回 code=-1 触发统一错误提示且令前端按钮无法恢复
		ret.Data = map[string]any{
			"matched": false,
			"msg":     "embedding model not configured",
		}
		return
	}

	matched, dims, err := util.TestEmbeddingModel(embedding.APIKey, embedding.BaseURL, embedding.Name, embedding.Dimensions, embedding.Timeout)
	// 测试结果统一以 code=0 返回，具体成败信息放在 data 中由前端控制展示，
	// 避免触发统一的错误消息提示导致按钮状态无法恢复
	result := map[string]any{
		"matched":    matched,
		"dimensions": dims,
	}
	if nil != err {
		result["msg"] = err.Error()
		logging.LogErrorf("test embedding model [%s] failed: %s", embedding.Name, err)
	}
	ret.Data = result
}

// testRerankModel 测试重排模型可用性。直接读取已保存的 Rerank 配置，
// 用极简 query+documents 发一次重排请求验证连通性与鉴权。
func testRerankModel(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	rerank := model.Conf.AI.Rerank
	if nil == rerank || "" == rerank.APIKey || "" == rerank.Endpoint || "" == rerank.Name {
		// 配置不完整时统一以 code=0 返回，把信息放在 data 中由前端控制展示，
		// 避免返回 code=-1 触发统一错误提示且令前端按钮无法恢复
		ret.Data = map[string]any{
			"matched": false,
			"msg":     "rerank model not configured",
		}
		return
	}

	matched, err := util.TestRerankModel(rerank.APIKey, rerank.Endpoint, rerank.Name, rerank.Timeout)
	// 测试结果统一以 code=0 返回，具体成败信息放在 data 中由前端控制展示
	result := map[string]any{
		"matched": matched,
	}
	if nil != err {
		result["msg"] = err.Error()
		logging.LogErrorf("test rerank model [%s] failed: %s", rerank.Name, err)
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

func mcpOAuthAuthorize(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}
	serverID, _ := arg["id"].(string)
	if model.Conf.AI == nil || model.Conf.AI.MCP == nil {
		ret.Code = -1
		ret.Msg = "MCP server not found"
		return
	}
	for _, server := range model.Conf.AI.MCP.Servers {
		if server.ID == serverID && server.Enabled && server.Type == "http" {
			mcpclient.ReconnectMCPAsync(model.Conf.AI.MCP.Servers, []string{serverID}, []string{serverID})
			return
		}
	}
	ret.Code = -1
	ret.Msg = "MCP server not found"
}

func mcpOAuthDisconnect(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}
	serverID, _ := arg["id"].(string)
	if err := mcpclient.DisconnectMCPOAuth(serverID); err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
	}
	if model.Conf.AI != nil && model.Conf.AI.MCP != nil {
		mcpclient.ReconnectMCPAsync(model.Conf.AI.MCP.Servers, []string{serverID}, nil)
	}
}

func mcpOAuthCallback(c *gin.Context) {
	if !mcpclient.IsLoopbackCallback(c.Request.RemoteAddr) {
		c.String(http.StatusForbidden, "Forbidden")
		return
	}
	c.Header("Cache-Control", "no-store")
	c.Header("Referrer-Policy", "no-referrer")
	c.Header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'")
	callbackError := c.Query("error")
	if err := mcpclient.CompleteMCPOAuth(c.Param("flowID"), c.Query("code"), c.Query("state"), callbackError); err != nil {
		c.Data(http.StatusBadRequest, "text/html; charset=utf-8", renderMCPOAuthCallbackPage(
			util.LangToBCP47(model.Conf.Lang), model.Conf.Language(327), model.Conf.Language(328), false))
		return
	}
	if callbackError != "" {
		c.Data(http.StatusOK, "text/html; charset=utf-8", renderMCPOAuthCallbackPage(
			util.LangToBCP47(model.Conf.Lang), model.Conf.Language(327), model.Conf.Language(328), false))
		return
	}
	c.Data(http.StatusOK, "text/html; charset=utf-8", renderMCPOAuthCallbackPage(
		util.LangToBCP47(model.Conf.Lang), model.Conf.Language(325), model.Conf.Language(326), true))
}

func renderMCPOAuthCallbackPage(lang, title, message string, success bool) []byte {
	markClass, mark := " mark--error", "!"
	if success {
		markClass, mark = "", "✓"
	}
	return []byte(`<!doctype html><html lang="` + html.EscapeString(lang) + `"><head><meta charset="utf-8">` +
		`<meta name="viewport" content="width=device-width,initial-scale=1"><title>` + html.EscapeString(title) + `</title>` +
		`<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f5f5f5;color:#202124;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}` +
		`main{box-sizing:border-box;width:min(480px,calc(100vw - 32px));padding:40px 32px;text-align:center;background:#fff;border:1px solid #ddd;border-radius:12px;box-shadow:0 8px 24px #00000014}` +
		`.mark{display:grid;place-items:center;width:56px;height:56px;margin:0 auto 24px;border-radius:50%;background:#2e7d32;color:#fff;font-size:32px}.mark--error{background:#c62828}` +
		`h1{margin:0 0 12px;font-size:24px;font-weight:600}p{margin:0;color:#5f6368;font-size:15px;line-height:1.7}` +
		`@media(prefers-color-scheme:dark){body{background:#171717;color:#eee}main{background:#242424;border-color:#3c3c3c;box-shadow:none}p{color:#bbb}}</style>` +
		`</head><body><main><div class="mark` + markClass + `" aria-hidden="true">` + mark + `</div><h1>` + html.EscapeString(title) +
		`</h1><p>` + html.EscapeString(message) + `</p></main></body></html>`)
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
