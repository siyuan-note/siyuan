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
	"net/url"
	"strings"
	"time"

	"github.com/sashabaranov/go-openai"
	"github.com/siyuan-note/logging"
)

func ChatGPT(msg string, contextMsgs []string, c *openai.Client, model string, maxTokens int, temperature float64, timeout int) (ret string, stop bool, err error) {
	var reqMsgs []openai.ChatCompletionMessage

	for _, ctxMsg := range contextMsgs {
		reqMsgs = append(reqMsgs, openai.ChatCompletionMessage{
			Role:    "user",
			Content: ctxMsg,
		})
	}
	reqMsgs = append(reqMsgs, openai.ChatCompletionMessage{
		Role:    "user",
		Content: msg,
	})

	req := openai.ChatCompletionRequest{
		Model:       model,
		MaxTokens:   maxTokens,
		Temperature: float32(temperature),
		Messages:    reqMsgs,
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(timeout)*time.Second)
	defer cancel()
	resp, err := c.CreateChatCompletion(ctx, req)
	if nil != err {
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

func NewOpenAIClient(apiKey, apiProxy, apiBaseURL, apiUserAgent, apiVersion, apiProvider string) *openai.Client {
	config := openai.DefaultConfig(apiKey)
	if "Azure" == apiProvider {
		config = openai.DefaultAzureConfig(apiKey, apiBaseURL)
		config.APIVersion = apiVersion
	}

	transport := &http.Transport{}
	if "" != apiProxy {
		proxyUrl, err := url.Parse(apiProxy)
		if nil != err {
			logging.LogErrorf("OpenAI API proxy failed: %v", err)
		} else {
			transport.Proxy = http.ProxyURL(proxyUrl)
		}
	}
	config.HTTPClient = &http.Client{Transport: newAddHeaderTransport(transport, apiUserAgent)}
	config.BaseURL = apiBaseURL
	return openai.NewClientWithConfig(config)
}

type AddHeaderTransport struct {
	RoundTripper http.RoundTripper
	UserAgent    string
}

func (adt *AddHeaderTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	req.Header.Add("User-Agent", adt.UserAgent)
	return adt.RoundTripper.RoundTrip(req)
}

func newAddHeaderTransport(transport *http.Transport, userAgent string) *AddHeaderTransport {
	return &AddHeaderTransport{RoundTripper: transport, UserAgent: userAgent}
}
