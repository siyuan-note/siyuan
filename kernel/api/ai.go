// SiYuan - From thought to insight, with agents
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
	"errors"
	"net/http"
	"strings"

	"github.com/88250/gulu"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	mcpclient "github.com/siyuan-note/siyuan/kernel/mcp/client"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type aiEditorChatReq struct {
	TaskID  string                  `json:"taskID"`
	IDs     []string                `json:"ids"`
	Input   string                  `json:"input"`
	Action  string                  `json:"action"`
	History []model.AIEditorMessage `json:"history"`
}

func validateAIProviderHeaders(ai *conf.AI) error {
	if ai != nil {
		for _, provider := range ai.Providers {
			if provider != nil {
				if err := util.ValidateAIProviderHeaders(provider.Headers); err != nil {
					return err
				}
			}
		}
	}
	return nil
}

func resolveAIProvider(request apicontract.AIProviderRequest) (*conf.Provider, error) {
	if err := request.ProviderError(); err != nil {
		return nil, err
	}
	if providerConfig := request.ProviderConfig; providerConfig != nil {
		data, err := gulu.JSON.MarshalJSON(providerConfig)
		if err != nil {
			return nil, err
		}
		provider := &conf.Provider{}
		if err = gulu.JSON.UnmarshalJSON(data, provider); err != nil {
			return nil, err
		}
		if strings.TrimSpace(provider.BaseURL) == "" {
			return nil, errors.New("provider base URL is required")
		}
		if err = util.ValidateAIProviderHeaders(provider.Headers); err != nil {
			return nil, err
		}
		ai := &conf.AI{Providers: []*conf.Provider{provider}}
		ai.Normalize()
		if len(ai.Providers) != 1 {
			return nil, errors.New("invalid provider config")
		}
		return ai.Providers[0], nil
	}

	providerID := request.Provider
	for _, provider := range model.Conf.AI.Providers {
		if provider != nil && provider.ID == providerID {
			return provider, nil
		}
	}
	return nil, errors.New("provider not found")
}

var chatGPT = contractHandler(apicontract.AIChatGPT, chatGPTContract)

func chatGPTContract(c *gin.Context, req apicontract.AIMessageRequest) apicontract.Response[string] {

	return apicontract.Success(model.ChatGPT(req.Msg))
}

var chatGPTWithAction = contractHandler(apicontract.AIChatGPTWithAction, chatGPTWithActionContract)

func chatGPTWithActionContract(c *gin.Context, req apicontract.AIActionRequest) apicontract.Response[string] {

	return apicontract.Success(model.ChatGPTWithAction(req.IDs, req.Action))
}

var aiEditorChat = contractHandler(apicontract.AIEditorChat, aiEditorChatContract, aiProviderAdmission)

func aiEditorChatContract(c *gin.Context, request apicontract.AIEditorChatRequest) apicontract.Response[apicontract.Null] {
	req := aiEditorRequest(request)
	stream, err := model.NewAIEditorChatStream(c.Request.Context(), req.IDs, req.Input, req.Action, req.History)
	if nil != err {
		ret := gulu.Ret.NewResult()
		ret.Code = -1
		ret.Msg = err.Error()
		return contractFailure[apicontract.Null](ret)
	}
	return apicontract.StreamSSE[apicontract.Null](func(_ http.ResponseWriter, _ *http.Request) {
		defer stream.Close()

		flusher, ok := c.Writer.(http.Flusher)
		if !ok {
			return
		}
		c.Header("Content-Type", "text/event-stream")
		c.Header("Cache-Control", "no-cache")
		c.Header("Connection", "keep-alive")
		c.Header("X-Accel-Buffering", "no")
		if err = writeSSEEvent(c, "start", apicontract.AISSEStart{TaskID: req.TaskID}); nil != err {
			return
		}
		flusher.Flush()

		finishReason := "stop"
		for {
			response, recvErr := stream.Recv()
			if nil != recvErr {
				if model.IsAIEditorStreamDone(recvErr) {
					writeSSEEvent(c, "done", apicontract.AISSEFinish{FinishReason: finishReason})
					flusher.Flush()
					return
				}
				if nil != c.Request.Context().Err() {
					return
				}
				logging.LogErrorf("receive AI editor stream failed: %s", recvErr)
				writeSSEError(c, recvErr.Error())
				flusher.Flush()
				return
			}
			for _, choice := range response.Choices {
				if "" != choice.Delta.ReasoningContent {
					if err = writeSSEEvent(c, "reasoning", apicontract.AISSEToken{Token: choice.Delta.ReasoningContent}); nil != err {
						return
					}
					flusher.Flush()
				}
				if "" != choice.Delta.Content {
					if err = writeSSEEvent(c, "content", apicontract.AISSEToken{Token: choice.Delta.Content}); nil != err {
						return
					}
					flusher.Flush()
				}
				if "" == choice.FinishReason {
					continue
				}
				finishReason = string(choice.FinishReason)
				if "length" == finishReason {
					writeSSEEvent(c, "truncated", apicontract.AISSEMessage{Message: model.Conf.Language(297)})
					flusher.Flush()
				}
				writeSSEEvent(c, "done", apicontract.AISSEFinish{FinishReason: finishReason})
				flusher.Flush()
				return
			}
		}
	})
}

var lsAIEditorActions = contractHandler(apicontract.AIListEditorActions, lsAIEditorActionsContract)

func lsAIEditorActionsContract(c *gin.Context, req apicontract.EmptyRequest) apicontract.Response[[]*apicontract.AIEditorAction] {
	ret := gulu.Ret.NewResult()

	actions, err := model.GetAIEditorActions()
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return contractFailure[[]*apicontract.AIEditorAction](ret)
	}
	return apicontract.Success(aiEditorActionsContract(actions))
}

var saveAIEditorAction = contractHandler(apicontract.AISaveEditorAction, saveAIEditorActionContract)

func saveAIEditorActionContract(c *gin.Context, req apicontract.AIEditorActionSaveRequest) apicontract.Response[*apicontract.AIEditorAction] {
	ret := gulu.Ret.NewResult()

	saved, err := model.SaveAIEditorAction(&model.AIEditorAction{
		ID:     req.ID,
		Name:   req.Name,
		Action: req.Action,
	})
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return contractFailure[*apicontract.AIEditorAction](ret)
	}
	return apicontract.Success((*apicontract.AIEditorAction)(saved))
}

var removeAIEditorAction = contractHandler(apicontract.AIRemoveEditorAction, removeAIEditorActionContract)

func removeAIEditorActionContract(c *gin.Context, req apicontract.AIEditorActionIDRequest) apicontract.Response[apicontract.Null] {
	ret := gulu.Ret.NewResult()

	if err := model.RemoveAIEditorAction(req.ID); err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
	}
	return contractFailure[apicontract.Null](ret)
}

// testModel 测试 AI 模型可用性。使用已保存的 Provider 或详情页草稿中的 baseURL/APIKey/超时，
// 校验指定模型是否可用。先通过 ListModels 拉取可用模型清单，再按 Provider 协议发送极简生成请求。
var testModel = contractHandler(apicontract.AITestModel, testModelContract)

func testModelContract(c *gin.Context, req apicontract.AIModelRequest) apicontract.Response[apicontract.AIModelTestData] {
	ret := gulu.Ret.NewResult()

	// 支持已保存的 Provider ID 和详情页尚未保存的草稿配置。
	provider, err := resolveAIProvider(req.AIProviderRequest)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return contractFailure[apicontract.AIModelTestData](ret)
	}

	available, matched, err := util.TestModel(
		provider.APIKey, provider.BaseURL, provider.Protocol, req.Model, provider.RequestTimeout, model.ResolveAIProviderHeaders(provider))
	// 可用模型清单裁剪到前 50 条，避免响应体过大
	if 50 < len(available) {
		available = available[:50]
	}
	// 测试结果统一以 code=0 返回，具体成败信息放在 data 中由前端控制展示，
	// 避免触发统一的错误消息提示导致按钮状态无法恢复
	result := apicontract.AIModelTestData{Available: available, Matched: matched}
	if nil != err {
		message := err.Error()
		result.Msg = &message
		logging.LogErrorf("test model [%s] failed: %s", req.Model, err)
	} else if !matched {
		message := "model not in available list"
		result.Msg = &message
	}
	return apicontract.Success(result)
}

// testEmbeddingModel 测试嵌入模型可用性。直接读取已保存的 Embedding 配置，
// 发送极简文本 embedding 请求验证连通性与鉴权，并返回向量维度便于核对。
var testEmbeddingModel = contractHandler(apicontract.AITestEmbeddingModel, testEmbeddingModelContract)

func testEmbeddingModelContract(c *gin.Context, req apicontract.EmptyRequest) apicontract.Response[apicontract.AIEmbeddingTestData] {

	embedding := model.Conf.AI.Embedding
	if nil == embedding || "" == embedding.APIKey || "" == embedding.BaseURL || "" == embedding.Name {
		// 配置不完整时统一以 code=0 返回，把信息放在 data 中由前端控制展示，
		// 避免返回 code=-1 触发统一错误提示且令前端按钮无法恢复
		message := "embedding model not configured"
		return apicontract.Success(apicontract.AIEmbeddingTestData{Matched: false, Msg: &message})
	}

	matched, dims, err := util.TestEmbeddingModel(embedding.APIKey, embedding.BaseURL, embedding.Name, embedding.Dimensions, embedding.Timeout)
	// 测试结果统一以 code=0 返回，具体成败信息放在 data 中由前端控制展示，
	// 避免触发统一的错误消息提示导致按钮状态无法恢复
	result := apicontract.AIEmbeddingTestData{Matched: matched, Dimensions: &dims}
	if nil != err {
		message := err.Error()
		result.Msg = &message
		logging.LogErrorf("test embedding model [%s] failed: %s", embedding.Name, err)
	}
	return apicontract.Success(result)
}

// testRerankModel 测试重排模型可用性。直接读取已保存的 Rerank 配置，
// 用极简 query+documents 发一次重排请求验证连通性与鉴权。
var testRerankModel = contractHandler(apicontract.AITestRerankModel, testRerankModelContract)

func testRerankModelContract(c *gin.Context, req apicontract.EmptyRequest) apicontract.Response[apicontract.AIRerankTestData] {

	rerank := model.Conf.AI.Rerank
	if nil == rerank || "" == rerank.APIKey || "" == rerank.Endpoint || "" == rerank.Name {
		// 配置不完整时统一以 code=0 返回，把信息放在 data 中由前端控制展示，
		// 避免返回 code=-1 触发统一错误提示且令前端按钮无法恢复
		message := "rerank model not configured"
		return apicontract.Success(apicontract.AIRerankTestData{Matched: false, Msg: &message})
	}

	matched, err := util.TestRerankModel(util.RerankOptions{
		APIKey:        rerank.APIKey,
		Endpoint:      rerank.Endpoint,
		Model:         rerank.Name,
		RequestFormat: rerank.RequestFormat,
		Timeout:       rerank.Timeout,
	})
	// 测试结果统一以 code=0 返回，具体成败信息放在 data 中由前端控制展示
	result := apicontract.AIRerankTestData{Matched: matched}
	if nil != err {
		message := err.Error()
		result.Msg = &message
		logging.LogErrorf("test rerank model [%s] failed: %s", rerank.Name, err)
	}
	return apicontract.Success(result)
}

// listModels 拉取指定 Provider 的可用模型清单（GET /v1/models），用于填充前端模型名称下拉框。
// 不支持该端点的服务会返回错误，由前端回退为手动输入。
var listModels = contractHandler(apicontract.AIListModels, listModelsContract)

func listModelsContract(c *gin.Context, req apicontract.AIProviderRequest) apicontract.Response[apicontract.AIModelsData] {
	ret := gulu.Ret.NewResult()

	provider, err := resolveAIProvider(req)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return contractFailure[apicontract.AIModelsData](ret)
	}

	metadata, err := util.ListProviderModels(provider.APIKey, provider.BaseURL, provider.Protocol, provider.RequestTimeout, model.ResolveAIProviderHeaders(provider))
	models := make([]string, 0, len(metadata))
	contextLengths := map[string]int{}
	for _, item := range metadata {
		models = append(models, item.ID)
		if 0 < item.ContextLength {
			if current := contextLengths[item.ID]; current < item.ContextLength {
				contextLengths[item.ID] = item.ContextLength
			}
		}
	}
	result := apicontract.AIModelsData{Models: models, ContextLengths: contextLengths}
	if nil != err {
		message := err.Error()
		result.Msg = &message
	}
	return apicontract.Success(result)
}

// embeddingStat 返回嵌入索引进度统计，供设置页展示进度条与各项计数。
var embeddingStat = contractHandler(apicontract.AIGetEmbeddingStat, embeddingStatContract)

func embeddingStatContract(c *gin.Context, req apicontract.EmptyRequest) apicontract.Response[*apicontract.AIEmbeddingStat] {
	return apicontract.Success((*apicontract.AIEmbeddingStat)(model.GetEmbeddingStat()))
}

// mcpStatus 返回所有已配置 MCP server 的连接状态，供设置页轮询展示。
var mcpStatus = contractHandler(apicontract.AIGetMCPStatus, mcpStatusContract)

func mcpStatusContract(c *gin.Context, req apicontract.EmptyRequest) apicontract.Response[[]apicontract.AIMCPStatus] {
	return apicontract.Success(aiMCPStatusContract(mcpclient.MCPStatus()))
}

// mcpEnvironmentVariables 返回当前内核拥有的环境变量名称，供 stdio MCP 设置选择。
var mcpEnvironmentVariables = contractHandler(apicontract.AIGetMCPEnvironment, mcpEnvironmentVariablesContract)

func mcpEnvironmentVariablesContract(c *gin.Context, req apicontract.EmptyRequest) apicontract.Response[apicontract.AIMCPEnvironmentData] {
	names, defaults := mcpclient.MCPEnvironmentVariables()
	return apicontract.Success(apicontract.AIMCPEnvironmentData{Names: names, Defaults: defaults})
}

var mcpOAuthAuthorize = contractHandler(apicontract.AIMCPOAuthAuthorize, mcpOAuthAuthorizeContract)

func mcpOAuthAuthorizeContract(c *gin.Context, req apicontract.AIMCPIDRequest) apicontract.Response[apicontract.Null] {
	ret := gulu.Ret.NewResult()

	serverID := req.ID
	if model.Conf.AI == nil || model.Conf.AI.MCP == nil {
		ret.Code = -1
		ret.Msg = "MCP server not found"
		return contractFailure[apicontract.Null](ret)
	}
	for _, server := range model.Conf.AI.MCP.Servers {
		if server.ID == serverID && server.Enabled && server.Type == "http" {
			mcpclient.ReconnectMCPAsync(model.Conf.AI.MCP.Servers, []string{serverID}, []string{serverID})
			return contractFailure[apicontract.Null](ret)
		}
	}
	ret.Code = -1
	ret.Msg = "MCP server not found"
	return contractFailure[apicontract.Null](ret)
}

var mcpOAuthDisconnect = contractHandler(apicontract.AIMCPOAuthDisconnect, mcpOAuthDisconnectContract)

func mcpOAuthDisconnectContract(c *gin.Context, req apicontract.AIMCPIDRequest) apicontract.Response[apicontract.Null] {
	ret := gulu.Ret.NewResult()

	serverID := req.ID
	if err := mcpclient.DisconnectMCPOAuth(serverID); err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
	}
	if model.Conf.AI != nil && model.Conf.AI.MCP != nil {
		mcpclient.ReconnectMCPAsync(model.Conf.AI.MCP.Servers, []string{serverID}, nil)
	}
	return contractFailure[apicontract.Null](ret)
}

var mcpOAuthCallback = contractHandler(apicontract.AIMCPOAuthCallback, mcpOAuthCallbackContract)

func mcpOAuthCallbackContract(c *gin.Context, request apicontract.EmptyRequest) apicontract.Response[apicontract.BinaryContent] {
	if !model.IsLocalRequest(c) {
		return apicontract.SuccessHTTPContent(http.StatusForbidden, "text/plain; charset=utf-8", []byte("Forbidden"))
	}
	c.Header("Cache-Control", "no-store")
	c.Header("Referrer-Policy", "no-referrer")
	c.Header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'")
	callbackError := c.Query("error")
	if err := mcpclient.CompleteMCPOAuth(c.Param("flowID"), c.Query("code"), c.Query("state"), callbackError, c.Query("iss")); err != nil {
		return apicontract.SuccessHTTPContent(http.StatusBadRequest, "text/html; charset=utf-8", util.RenderOAuthCallbackPage(
			util.LangToBCP47(model.Conf.Lang), model.Conf.Language(327), model.Conf.Language(328), false))
	}
	if callbackError != "" {
		return apicontract.SuccessHTTPContent(http.StatusOK, "text/html; charset=utf-8", util.RenderOAuthCallbackPage(
			util.LangToBCP47(model.Conf.Lang), model.Conf.Language(327), model.Conf.Language(328), false))
	}
	return apicontract.SuccessHTTPContent(http.StatusOK, "text/html; charset=utf-8", util.RenderOAuthCallbackPage(
		util.LangToBCP47(model.Conf.Lang), model.Conf.Language(325), model.Conf.Language(326), true))
}

// reindexEmbedding 清空嵌入向量表并触发后台索引器重新计算所有块，异步执行。
var reindexEmbedding = contractHandler(apicontract.AIReindexEmbedding, reindexEmbeddingContract)

func reindexEmbeddingContract(c *gin.Context, req apicontract.EmptyRequest) apicontract.Response[apicontract.Null] {
	ret := gulu.Ret.NewResult()
	model.ReindexEmbedding()
	return contractFailure[apicontract.Null](ret)
}

// retryFailedEmbedding 删除失败块的行，使其立即回到主循环重嵌，已成功向量不动，异步执行。
var retryFailedEmbedding = contractHandler(apicontract.AIRetryFailedEmbedding, retryFailedEmbeddingContract)

func retryFailedEmbeddingContract(c *gin.Context, req apicontract.EmptyRequest) apicontract.Response[apicontract.Null] {
	ret := gulu.Ret.NewResult()
	model.RetryFailedEmbedding()
	return contractFailure[apicontract.Null](ret)
}
