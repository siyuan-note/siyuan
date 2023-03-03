// SiYuan - Build Your Eternal Digital Garden
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
	"errors"
	"github.com/88250/lute/html"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	gogpt "github.com/sashabaranov/go-gpt3"
	"github.com/siyuan-note/logging"
)

var (
	OpenAIAPIKey       = ""
	OpenAIAPITimeout   = 15 * time.Second
	OpenAIAPIProxy     = ""
	OpenAIAPIMaxTokens = 0
)

func ChatGPT(msg string) (ret string) {
	if "" == OpenAIAPIKey {
		return
	}

	PushEndlessProgress("Requesting...")
	defer ClearPushProgress(100)

	config := gogpt.DefaultConfig(OpenAIAPIKey)
	if "" != OpenAIAPIProxy {
		proxyUrl, err := url.Parse(OpenAIAPIProxy)
		if nil != err {
			logging.LogErrorf("OpenAI API proxy error: %v", err)
		} else {
			config.HTTPClient = &http.Client{Transport: &http.Transport{Proxy: http.ProxyURL(proxyUrl)}}
		}
	}

	c := gogpt.NewClientWithConfig(config)
	ctx, cancel := context.WithTimeout(context.Background(), OpenAIAPITimeout)
	defer cancel()
	req := gogpt.ChatCompletionRequest{
		Model:     gogpt.GPT3Dot5Turbo,
		MaxTokens: OpenAIAPIMaxTokens,
		Messages: []gogpt.ChatCompletionMessage{
			{
				Role:    "user",
				Content: msg,
			},
		},
	}

	stream, err := c.CreateChatCompletionStream(ctx, req)
	if nil != err {
		logging.LogErrorf("create chat completion stream failed: %s", err)
		return
	}
	defer stream.Close()

	buf := bytes.Buffer{}
	for {
		resp, recvErr := stream.Recv()
		if errors.Is(recvErr, io.EOF) {
			break
		}

		if nil != recvErr {
			logging.LogErrorf("create chat completion stream recv failed: %s", recvErr)
			break
		}

		for _, choice := range resp.Choices {
			content := choice.Delta.Content
			buf.WriteString(content)
			PushEndlessProgress(html.EscapeHTMLStr(buf.String()))
		}
	}

	ret = buf.String()
	ret = strings.TrimSpace(ret)
	return
}

func initOpenAI() {
	OpenAIAPIKey = os.Getenv("SIYUAN_OPENAI_API_KEY")
	if "" == OpenAIAPIKey {
		return
	}

	timeout := os.Getenv("SIYUAN_OPENAI_API_TIMEOUT")
	if "" != timeout {
		timeoutInt, err := strconv.Atoi(timeout)
		if nil == err {
			OpenAIAPITimeout = time.Duration(timeoutInt) * time.Second
		}
	}

	proxy := os.Getenv("SIYUAN_OPENAI_API_PROXY")
	if "" != proxy {
		OpenAIAPIProxy = proxy
	}

	maxTokens := os.Getenv("SIYUAN_OPENAI_API_MAX_TOKENS")
	if "" != maxTokens {
		maxTokensInt, err := strconv.Atoi(maxTokens)
		if nil == err {
			OpenAIAPIMaxTokens = maxTokensInt
		}
	}

	logging.LogInfof("OpenAI API enabled [maxTokens=%d, timeout=%ds, proxy=%s]", OpenAIAPIMaxTokens, int(OpenAIAPITimeout.Seconds()), OpenAIAPIProxy)
}
