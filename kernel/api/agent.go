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
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/88250/gulu"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/agent"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type agentChatReq struct {
	SessionID  string              `json:"sessionID"`
	Messages   []agent.UserMessage `json:"messages"`
	Language   string              `json:"language"`
	References []agent.Reference   `json:"references"`
}

type runningSession struct {
	eventCh <-chan agent.AgentEvent
}

var sessionsMu sync.Mutex
var runningSessions = map[string]*runningSession{}

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

	confirmTimeout := time.Duration(model.Conf.AI.OpenAI.AgentConfirmTimeout) * time.Second
	if confirmTimeout <= 0 {
		confirmTimeout = 120 * time.Second
	}
	maxRetries := model.Conf.AI.OpenAI.AgentMaxRetries
	if maxRetries <= 0 {
		maxRetries = 3
	}

	var eventCh <-chan agent.AgentEvent

	eventCh = agent.AgentChat(context.Background(), client, model.Conf.AI.OpenAI.APIModel, req.SessionID, req.Messages, req.Language, req.References, confirmTimeout, maxRetries)
	sessionsMu.Lock()
	runningSessions[req.SessionID] = &runningSession{eventCh: eventCh}
	sessionsMu.Unlock()

	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")

	flusher, ok := c.Writer.(http.Flusher)
	if !ok {
		return
	}

	timeout := model.Conf.AI.OpenAI.APITimeout
	if timeout <= 0 {
		timeout = 30
	}
	totalTimeout := time.Duration(model.Conf.AI.OpenAI.AgentTimeout) * time.Second
	if totalTimeout <= 0 {
		totalTimeout = time.Duration(timeout) * time.Second * 10
	}
	if totalTimeout > 3600*time.Second {
		totalTimeout = 3600 * time.Second
	}
	deadline := time.After(totalTimeout)

	for {
		select {
		case event, ok := <-eventCh:
			if !ok {
				sessionsMu.Lock()
				delete(runningSessions, req.SessionID)
				sessionsMu.Unlock()
				return
			}
			if err := writeSSE(c, event); err != nil {
				return
			}
			flusher.Flush()
		case <-deadline:
			writeSSEError(c, "request timeout")
			flusher.Flush()
			return
		}
	}
}

type agentConfirmReq struct {
	ConfirmID string `json:"confirmID"`
	Approved  bool   `json:"approved"`
	Always    bool   `json:"always"`
}

func agentChatConfirm(c *gin.Context) {
	req := &agentConfirmReq{}
	if err := c.ShouldBindJSON(req); err != nil {
		ret := gulu.Ret.NewResult()
		ret.Code = -1
		ret.Msg = "invalid request: " + err.Error()
		c.JSON(http.StatusOK, ret)
		return
	}
	agent.ConfirmSession(req.ConfirmID, req.Approved, req.Always)
	ret := gulu.Ret.NewResult()
	c.JSON(http.StatusOK, ret)
}

type agentQuestionReq struct {
	QuestionID string   `json:"questionID"`
	Answers    []string `json:"answers"`
}

func agentChatQuestion(c *gin.Context) {
	req := &agentQuestionReq{}
	if err := c.ShouldBindJSON(req); err != nil {
		ret := gulu.Ret.NewResult()
		ret.Code = -1
		ret.Msg = "invalid request: " + err.Error()
		c.JSON(http.StatusOK, ret)
		return
	}
	agent.AnswerQuestion(req.QuestionID, req.Answers)
	ret := gulu.Ret.NewResult()
	c.JSON(http.StatusOK, ret)
}

type agentTitleReq struct {
	Message string `json:"message"`
}

func agentChatTitle(c *gin.Context) {
	req := &agentTitleReq{}
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

	title := agent.GenerateTitle(client, model.Conf.AI.OpenAI.APIModel, req.Message)
	ret := gulu.Ret.NewResult()
	ret.Data = title
	c.JSON(http.StatusOK, ret)
}

func writeSSE(c *gin.Context, event agent.AgentEvent) error {
	switch event.Type {
	case "content":
		return writeSSEEvent(c, "content", map[string]string{"token": event.Token})
	case "thinking":
		return writeSSEEvent(c, "thinking", map[string]string{"reasoning": event.Reasoning})
	case "reasoning":
		return writeSSEEvent(c, "reasoning", map[string]string{"token": event.Token})
	case "confirm":
		return writeSSEEvent(c, "confirm", map[string]interface{}{
			"name":      event.Name,
			"arguments": event.Arguments,
			"confirmID": event.ConfirmID,
		})
	case "tool_call":
		return writeSSEEvent(c, "tool_call", map[string]interface{}{
			"name":      event.Name,
			"arguments": event.Arguments,
		})
	case "tool_result":
		return writeSSEEvent(c, "tool_result", map[string]string{
			"name":   event.Name,
			"result": event.Result,
		})
	case "error":
		return writeSSEEvent(c, "error", map[string]string{"message": event.Error})
	case "usage":
		return writeSSEEvent(c, "usage", map[string]interface{}{
			"promptTokens":     event.PromptTokens,
			"completionTokens": event.CompletionTokens,
		})
	case "done":
		return writeSSEEvent(c, "done", map[string]interface{}{})
	case "retry":
		return writeSSEEvent(c, "retry", map[string]interface{}{
			"attempt":   event.RetryAttempt,
			"maxRetries": event.RetryMax,
		})
	case "question":
		return writeSSEEvent(c, "question", map[string]interface{}{
			"questionID": event.QuestionID,
			"arguments":  event.Arguments,
		})
	}
	return nil
}

func writeSSEEvent(c *gin.Context, eventType string, data interface{}) error {
	b, err := json.Marshal(data)
	if err != nil {
		return err
	}
	_, err = fmt.Fprintf(c.Writer, "event:%s\ndata:%s\n\n", eventType, string(b))
	return err
}

func writeSSEError(c *gin.Context, message string) error {
	return writeSSEEvent(c, "error", map[string]string{"message": message})
}
