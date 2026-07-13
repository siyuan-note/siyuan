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

package util

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"maps"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/sashabaranov/go-openai"
	"github.com/siyuan-note/httpclient"
	"github.com/siyuan-note/logging"
)

func ChatGPT(msg string, contextMsgs []string, c *openai.Client, model string, maxTokens int, temperature float64, timeout int) (ret string, stop bool, err error) {
	var reqMsgs []openai.ChatCompletionMessage

	for _, ctxMsg := range contextMsgs {
		if "" == ctxMsg {
			continue
		}

		reqMsgs = append(reqMsgs, openai.ChatCompletionMessage{
			Role:    "user",
			Content: ctxMsg,
		})
	}

	if "" != msg {
		reqMsgs = append(reqMsgs, openai.ChatCompletionMessage{
			Role:    "user",
			Content: msg,
		})
	}

	if 1 > len(reqMsgs) {
		stop = true
		return
	}

	req := openai.ChatCompletionRequest{
		Model:               model,
		MaxCompletionTokens: maxTokens,
		Temperature:         float32(temperature),
		Messages:            reqMsgs,
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(timeout)*time.Second)
	defer cancel()
	resp, err := c.CreateChatCompletion(ctx, req)
	if err != nil {
		PushErrMsg("Requesting failed, please check kernel log for more details", 3000)
		logging.LogErrorf("create chat completion failed: %s", err)
		stop = true
		return
	}

	if 1 > len(resp.Choices) {
		stop = true
		return
	}

	buf := &strings.Builder{}
	choice := resp.Choices[0]
	buf.WriteString(choice.Message.Content)
	if "length" == choice.FinishReason {
		stop = false
	} else {
		stop = true
	}

	ret = buf.String()
	ret = strings.TrimSpace(ret)
	return
}

func NewOpenAIClient(apiKey, apiBaseURL string) *openai.Client {
	config := openai.DefaultConfig(apiKey)
	config.BaseURL = apiBaseURL
	config.HTTPClient = httpclient.NewUserAgentClient(nil)
	return openai.NewClientWithConfig(config)
}

// builtinExtraBody 是「模型名前缀 → 额外请求参数」的内置适配清单。
// 仅收录参数语义为「纯输出格式开关」的模型（不改变思考行为、无副作用），
// 让这类模型从源头把推理内容拆到 reasoning_content 字段，而非以 <think> 标签混在 content 中。
// 其他模型由 agent.thinkSplitter 兜底解析 <think> 标签。
var builtinExtraBody = map[string]map[string]any{
	// MiniMax：开启 reasoning_split 后，thinking 内容拆到 reasoning_content 字段，
	// 不改变是否思考、无流式要求。覆盖 MiniMax-M* 和 abab* 两个命名族。
	"minimax-m": {"reasoning_split": true},
	"abab-":     {"reasoning_split": true},
}

// ExtraBodyForModel 按模型名大小写不敏感匹配内置清单，返回需注入的额外请求参数；无匹配返回 nil。
func ExtraBodyForModel(model string) map[string]any {
	lower := strings.ToLower(model)
	for prefix, extra := range builtinExtraBody {
		if strings.HasPrefix(lower, prefix) {
			return extra
		}
	}
	return nil
}

// extraBodyTransport 包装一个 HTTPDoer，在 chat/completions 请求体中注入额外字段。
// 利用 go-openai 在 client 层暴露的 HTTPDoer 扩展点（Chat 路径不支持 withExtraBody），
// 对流式与非流式 chat 请求都生效；非 chat 请求原样透传。
type extraBodyTransport struct {
	base      openai.HTTPDoer
	extraBody map[string]any
}

func (t *extraBodyTransport) Do(req *http.Request) (*http.Response, error) {
	if len(t.extraBody) == 0 || req.Method != http.MethodPost || !strings.Contains(req.URL.Path, "chat/completions") {
		return t.base.Do(req)
	}

	body, err := io.ReadAll(req.Body)
	if err != nil {
		return t.base.Do(req)
	}
	if err = req.Body.Close(); err != nil {
		return t.base.Do(req)
	}

	var payload map[string]any
	if err = json.Unmarshal(body, &payload); err != nil {
		// 请求体解析失败，用原始 body 透传，绝不破坏请求。
		req.Body = io.NopCloser(bytes.NewReader(body))
		req.ContentLength = int64(len(body))
		return t.base.Do(req)
	}

	maps.Copy(payload, t.extraBody)

	merged, err := json.Marshal(payload)
	if err != nil {
		req.Body = io.NopCloser(bytes.NewReader(body))
		req.ContentLength = int64(len(body))
		return t.base.Do(req)
	}

	req.Body = io.NopCloser(bytes.NewReader(merged))
	req.ContentLength = int64(len(merged))
	return t.base.Do(req)
}

// NewOpenAIClientWithModel 创建 OpenAI client，并按模型名匹配内置清单注入额外请求参数。
// 绝大多数模型无匹配，走 NewOpenAIClient 老路径（不包中间件，零开销）；
// 命中清单的模型（如 MiniMax）会注入厂商专属参数（如 reasoning_split）。
func NewOpenAIClientWithModel(apiKey, apiBaseURL, model string) *openai.Client {
	extra := ExtraBodyForModel(model)
	if len(extra) == 0 {
		return NewOpenAIClient(apiKey, apiBaseURL)
	}
	config := openai.DefaultConfig(apiKey)
	config.BaseURL = apiBaseURL
	config.HTTPClient = &extraBodyTransport{base: httpclient.NewUserAgentClient(nil), extraBody: extra}
	return openai.NewClientWithConfig(config)
}

// TestModel 测试模型可用性。优先调用 ListModels（GET /v1/models）拉取可用模型清单，
// 校验 model 是否在其中；若该端点不可用（部分 OpenAI 兼容服务未实现），则回退到极简 Chat Completion。
// 返回值：available 为可用模型清单（仅 ListModels 成功时填充），matched 表示 model 是否可用，
// err 为请求错误（鉴权失败、网络异常、模型不存在等，原样返回便于调用方展示原因）。
func TestModel(apiKey, apiBaseURL, model string, timeout int) (available []string, matched bool, err error) {
	if 1 > timeout {
		timeout = 30
	}
	client := NewOpenAIClient(apiKey, apiBaseURL)
	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(timeout)*time.Second)
	defer cancel()

	// 优先校验模型是否在可用清单中
	list, listErr := client.ListModels(ctx)
	if nil == listErr {
		model = strings.TrimSpace(model)
		target := strings.ToLower(model)
		for _, m := range list.Models {
			available = append(available, m.ID)
			if strings.ToLower(m.ID) == target {
				matched = true
			}
		}
		return
	}

	// ListModels 不可用时回退到极简 Chat Completion 验证连通性与鉴权
	logging.LogInfof("list models failed [%s], fallback to chat completion: %s", apiBaseURL, listErr)
	_, err = client.CreateChatCompletion(ctx, openai.ChatCompletionRequest{
		Model: model,
		Messages: []openai.ChatCompletionMessage{{
			Role:    "user",
			Content: "1",
		}},
		MaxCompletionTokens: 1,
	})
	if nil != err {
		logging.LogErrorf("test model [%s] failed: %s", model, err)
		return
	}
	matched = true
	available = nil
	return
}

// TestEmbeddingModel 测试嵌入模型可用性，发送极简文本并返回首个向量维度。
// 返回值：matched 表示是否连通成功，dimensions 为返回的向量维度（便于核对配置），
// err 为请求错误（鉴权失败、网络异常、模型不存在等，原样返回便于调用方展示原因）。
func TestEmbeddingModel(apiKey, apiBaseURL, model string, dimensions, timeout int) (matched bool, dims int, err error) {
	if 1 > timeout {
		timeout = 30
	}
	client := NewOpenAIClient(apiKey, apiBaseURL)
	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(timeout)*time.Second)
	defer cancel()

	// 用极简文本发一次 embedding 请求，验证连通性、鉴权与模型可用性
	resp, err := client.CreateEmbeddings(ctx, openai.EmbeddingRequestStrings{
		Input:      []string{"1"},
		Model:      openai.EmbeddingModel(model),
		Dimensions: dimensions, // 0 时因 omitempty 不发送，等同于用模型默认维度
	})
	if nil != err {
		logging.LogErrorf("test embedding model [%s] failed: %s", model, err)
		return
	}
	matched = true
	if 0 < len(resp.Data) {
		dims = len(resp.Data[0].Embedding)
	}
	return
}

// ListAvailableModels 拉取 Provider 的可用模型清单（GET /v1/models），仅返回模型 ID 列表。
// 用于填充前端模型名称下拉框。不支持该端点的服务会返回错误，由调用方回退为手动输入。
func ListAvailableModels(apiKey, apiBaseURL string, timeout int) (models []string, err error) {
	if 1 > timeout {
		timeout = 30
	}
	client := NewOpenAIClient(apiKey, apiBaseURL)
	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(timeout)*time.Second)
	defer cancel()

	list, err := client.ListModels(ctx)
	if nil != err {
		logging.LogErrorf("list models [%s] failed: %s", apiBaseURL, err)
		return
	}
	for _, m := range list.Models {
		models = append(models, m.ID)
	}
	return
}

func IsNetworkError(err error) bool {
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "actively refused") ||
		strings.Contains(msg, "connection refused") ||
		strings.Contains(msg, "no such host") ||
		strings.Contains(msg, "connection failed") ||
		strings.Contains(msg, "hostname resolution") ||
		strings.Contains(msg, "no address associated with hostname") ||
		strings.Contains(msg, "request canceled while waiting for connection") ||
		strings.Contains(msg, "exceeded while awaiting") ||
		strings.Contains(msg, "context deadline exceeded") ||
		strings.Contains(msg, "timeout") ||
		strings.Contains(msg, "connection") ||
		strings.Contains(msg, "refused") ||
		strings.Contains(msg, "socket") ||
		strings.Contains(msg, "eof") ||
		strings.Contains(msg, "closed") ||
		strings.Contains(msg, "network")
}

// embeddingHTTPClient 单例 HTTP 客户端，复用连接池并限制每主机最大连接数，
// 避免 embedding 索引器在 API 不可用时新建大量连接形成连接风暴。
// 单次请求超时由调用方用 context.WithTimeout 控制，client 本身不设全局 Timeout。
var (
	embeddingHTTPClientOnce sync.Once
	embeddingHTTPClient     *http.Client
)

func getEmbeddingHTTPClient() *http.Client {
	embeddingHTTPClientOnce.Do(func() {
		transport := &http.Transport{
			MaxConnsPerHost:     4, // 同一 embedding endpoint 的并发连接上限
			MaxIdleConns:        8,
			MaxIdleConnsPerHost: 4,
			IdleConnTimeout:     90 * time.Second,
		}
		embeddingHTTPClient = httpclient.NewUserAgentClient(transport)
	})
	return embeddingHTTPClient
}

func BatchGetEmbeddings(texts []string, apiKey, baseURL, model string, dimensions, timeout int) (ret [][]float32, err error) {
	if 1 > len(texts) {
		return
	}

	config := openai.DefaultConfig(apiKey)
	config.BaseURL = baseURL
	config.HTTPClient = getEmbeddingHTTPClient()
	client := openai.NewClientWithConfig(config)

	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(timeout)*time.Second)
	defer cancel()

	resp, err := client.CreateEmbeddings(ctx, openai.EmbeddingRequestStrings{
		Input:      texts,
		Model:      openai.EmbeddingModel(model),
		Dimensions: dimensions, // 0 时因 omitempty 不发送，等同于用模型默认维度
	})
	if err != nil {
		logging.LogErrorf("create embeddings failed: %s", err)
		return
	}

	for _, data := range resp.Data {
		ret = append(ret, data.Embedding)
	}
	return
}

// rerankDocTextMaxLen 限制单篇文档送入重排服务的最大字符数，避免超出服务端 token 上限。
const rerankDocTextMaxLen = 2000

// rerankHTTPClient 单例 HTTP 客户端，复用连接池并限制每主机最大连接数，避免重排请求打满连接。
var (
	rerankHTTPClientOnce sync.Once
	rerankHTTPClient     *http.Client
)

func getRerankHTTPClient() *http.Client {
	rerankHTTPClientOnce.Do(func() {
		transport := &http.Transport{
			MaxConnsPerHost:     4,
			MaxIdleConns:        8,
			MaxIdleConnsPerHost: 4,
			IdleConnTimeout:     90 * time.Second,
		}
		rerankHTTPClient = &http.Client{Transport: transport}
	})
	return rerankHTTPClient
}

// rerankRequest 对应主流重排服务的 /rerank 请求体（Jina/Cohere/阿里云 compatible-api 等）。
type rerankRequest struct {
	Model     string   `json:"model"`
	Query     string   `json:"query"`
	Documents []string `json:"documents"`
	TopN      int      `json:"top_n,omitempty"`
}

// rerankResult 为响应 results 数组中的单项，index 指向 documents 下标。
type rerankResult struct {
	Index          int     `json:"index"`
	RelevanceScore float64 `json:"relevance_score"`
}

// rerankResponse 对应 /v1/rerank 响应体。
type rerankResponse struct {
	Results []rerankResult `json:"results"`
}

// Rerank 调用重排服务对 query 与候选文档逐对精排。endpoint 为完整重排端点地址，不同服务商路径无统一标准
// （Jina /v1/rerank、阿里云 compatible-api/v1/reranks、Cohere /v1/rerank 等），由用户照文档填写。
// 返回的 indices 与 scores 均按 relevance_score 降序，indices 指向传入 documents 的下标。
// 对每条 document 文本按 rerankDocTextMaxLen 截断，防超服务端 token 限制。
// topN 语义：topN <= 0 时不传 top_n（服务端默认返回全部文档评分，搜索场景用此避免被服务端 top_n 上限截断）；
// topN > 0 时透传给服务端，仅用于测试连通性等只需少量结果的场景。
func Rerank(query string, documents []string, apiKey, endpoint, model string, topN, timeout int) (indices []int, scores []float64, err error) {
	if 1 > timeout {
		timeout = 30
	}
	if 1 > len(documents) {
		return
	}
	if 0 < topN && topN > len(documents) {
		topN = len(documents)
	}

	trimmed := make([]string, len(documents))
	for i, doc := range documents {
		if len(doc) > rerankDocTextMaxLen {
			trimmed[i] = doc[:rerankDocTextMaxLen]
		} else {
			trimmed[i] = doc
		}
	}

	body, err := json.Marshal(rerankRequest{
		Model:     model,
		Query:     query,
		Documents: trimmed,
		TopN:      topN,
	})
	if nil != err {
		return
	}

	// endpoint 为完整重排端点地址，不做路径追加——不同服务商端点路径无统一标准，用户照文档填写。
	req, err := http.NewRequest(http.MethodPost, strings.TrimRight(endpoint, "/"), bytes.NewReader(body))
	if nil != err {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+apiKey)

	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(timeout)*time.Second)
	defer cancel()
	req = req.WithContext(ctx)

	resp, err := getRerankHTTPClient().Do(req)
	if nil != err {
		logging.LogErrorf("rerank request failed: %s", err)
		return
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if nil != err {
		return
	}
	if http.StatusOK != resp.StatusCode {
		err = fmt.Errorf("rerank HTTP %d: %s", resp.StatusCode, string(respBody))
		logging.LogErrorf("rerank failed: %s", err)
		return
	}

	var rr rerankResponse
	if err = json.Unmarshal(respBody, &rr); nil != err {
		return
	}

	for _, r := range rr.Results {
		if r.Index < 0 || r.Index >= len(documents) {
			continue
		}
		indices = append(indices, r.Index)
		scores = append(scores, r.RelevanceScore)
	}
	return
}

// TestRerankModel 测试重排模型可用性，用极简 query+documents 发一次重排请求验证连通性与鉴权。
// 返回值：matched 表示是否连通成功，err 为请求错误（鉴权失败、网络异常、模型不存在等，原样返回便于调用方展示原因）。
func TestRerankModel(apiKey, apiBaseURL, model string, timeout int) (matched bool, err error) {
	_, _, err = Rerank("1", []string{"a", "b"}, apiKey, apiBaseURL, model, 2, timeout)
	if nil != err {
		return
	}
	matched = true
	return
}
