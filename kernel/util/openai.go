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
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/sashabaranov/go-openai"
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

func BatchGetEmbeddings(texts []string, apiKey, baseURL, model string, timeout int) (ret [][]float32, err error) {
	if 1 > len(texts) {
		return
	}

	config := openai.DefaultConfig(apiKey)
	config.BaseURL = baseURL
	config.HTTPClient = &http.Client{
		Timeout:   time.Duration(timeout) * time.Second,
		Transport: &http.Transport{},
	}
	client := openai.NewClientWithConfig(config)

	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(timeout)*time.Second)
	defer cancel()

	resp, err := client.CreateEmbeddings(ctx, openai.EmbeddingRequestStrings{
		Input: texts,
		Model: openai.EmbeddingModel(model),
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
