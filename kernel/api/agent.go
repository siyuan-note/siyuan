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
	"time"

	"github.com/88250/gulu"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/agent"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type agentChatReq struct {
	Messages []agent.UserMessage `json:"messages"`
}

func agentChat(c *gin.Context) {
	if "" == model.Conf.AI.OpenAI.APIKey {
		ret := gulu.Ret.NewResult()
		ret.Code = -1
		ret.Msg = model.Conf.Language(193)
		c.JSON(http.StatusOK, ret)
		return
	}

	req := &agentChatReq{}
	if err := c.ShouldBindJSON(req); err != nil {
		ret := gulu.Ret.NewResult()
		ret.Code = -1
		ret.Msg = "invalid request: " + err.Error()
		c.JSON(http.StatusOK, ret)
		return
	}

	client := util.NewOpenAIClient(
		model.Conf.AI.OpenAI.APIKey,
		model.Conf.AI.OpenAI.APIProxy,
		model.Conf.AI.OpenAI.APIBaseURL,
		model.Conf.AI.OpenAI.APIUserAgent,
		model.Conf.AI.OpenAI.APIVersion,
		model.Conf.AI.OpenAI.APIProvider,
	)

	timeout := model.Conf.AI.OpenAI.APITimeout
	if timeout <= 0 {
		timeout = 30
	}
	ctx := c.Request.Context()

	eventCh := agent.AgentChat(ctx, client, model.Conf.AI.OpenAI.APIModel, req.Messages)

	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")

	flusher, ok := c.Writer.(http.Flusher)
	if !ok {
		return
	}

	totalTimeout := time.Duration(timeout) * time.Second * 10
	if totalTimeout > 300*time.Second {
		totalTimeout = 300 * time.Second
	}
	deadline := time.After(totalTimeout)
	for {
		select {
		case event, ok := <-eventCh:
			if !ok {
				return
			}
			switch event.Type {
			case "content":
				c.SSEvent("content", map[string]string{"token": event.Token})
			case "tool_call":
				c.SSEvent("tool_call", map[string]interface{}{
					"name":      event.Name,
					"arguments": event.Arguments,
				})
			case "tool_result":
				c.SSEvent("tool_result", map[string]string{
					"name":   event.Name,
					"result": event.Result,
				})
			case "error":
				c.SSEvent("error", map[string]string{"message": event.Error})
			case "done":
				c.SSEvent("done", map[string]interface{}{})
				return
			}
			flusher.Flush()
		case <-deadline:
			c.SSEvent("error", map[string]string{"message": "request timeout"})
			flusher.Flush()
			return
		case <-ctx.Done():
			return
		}
	}
}
