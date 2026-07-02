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
	"io"
	"net/http"
	"sync"
	"time"

	"github.com/88250/gulu"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/agent"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type agentChatReq struct {
	SessionID       string               `json:"sessionID"`
	Message         string               `json:"message"`
	Language        string               `json:"language"`
	References      []agent.Reference    `json:"references"`
	EditorContext   agent.EditorContext  `json:"editorContext"`
	PluginActions   []agent.PluginAction `json:"pluginActions"`
	Model           string               `json:"model,omitempty"`
	Regenerate      bool                 `json:"regenerate"`
	ReasoningEffort string               `json:"reasoningEffort,omitempty"`
}

type runningSession struct {
	eventCh <-chan agent.AgentEvent
}

var sessionsMu sync.Mutex
var runningSessions = map[string]*runningSession{}

func agentChat(c *gin.Context) {
	if !model.Conf.AI.HasAnyProvider() {
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

	modelID := req.Model
	var selectedProvider *conf.Provider
	var selectedModel *conf.Model
	if modelID != "" {
		selectedProvider, selectedModel = model.Conf.AI.GetModel(modelID)
	} else {
		selectedProvider, selectedModel = model.Conf.AI.GetAgentModel()
	}
	if nil == selectedProvider || nil == selectedModel {
		ret := gulu.Ret.NewResult()
		ret.Code = -1
		ret.Msg = model.Conf.Language(193)
		c.JSON(http.StatusOK, ret)
		return
	}
	client := util.NewOpenAIClientWithModel(selectedProvider.APIKey, selectedProvider.BaseURL, selectedModel.Name)

	confirmTimeout := time.Duration(model.Conf.AI.Agent.ConfirmTimeout) * time.Second
	if confirmTimeout <= 0 {
		confirmTimeout = 120 * time.Second
	}
	maxRetries := model.Conf.AI.Agent.MaxRetries
	if maxRetries <= 0 {
		maxRetries = 3
	}

	app := c.GetHeader("X-SiYuan-App-ID")

	ctx, cancel := context.WithCancel(c.Request.Context())
	eventCh := agent.AgentChat(ctx, client, selectedModel.Name, req.SessionID, req.Message, req.Language, req.References, req.EditorContext, req.PluginActions, req.Regenerate, confirmTimeout, maxRetries, req.ReasoningEffort)

	// 实例级互斥：同一 session 同时只允许一个活跃流。
	// 检查+占用在同一把锁内（compare-and-set），失败时 cancel 释放刚启动的 goroutine 防泄漏。
	sessionsMu.Lock()
	if _, ok := runningSessions[req.SessionID]; ok {
		sessionsMu.Unlock()
		cancel()
		ret := gulu.Ret.NewResult()
		ret.Code = -1
		ret.Msg = "session is busy in another instance"
		c.JSON(http.StatusConflict, ret)
		return
	}
	runningSessions[req.SessionID] = &runningSession{eventCh: eventCh}
	sessionsMu.Unlock()
	defer cancel()
	defer func() {
		sessionsMu.Lock()
		delete(runningSessions, req.SessionID)
		sessionsMu.Unlock()
	}()

	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")

	flusher, ok := c.Writer.(http.Flusher)
	if !ok {
		return
	}

	timeout := selectedProvider.RequestTimeout
	if timeout <= 0 {
		timeout = 30
	}
	totalTimeout := time.Duration(model.Conf.AI.Agent.SessionTimeout) * time.Second
	if totalTimeout <= 0 {
		totalTimeout = time.Duration(timeout) * time.Second * 10
	}
	if totalTimeout > 3600*time.Second {
		totalTimeout = 3600 * time.Second
	}
	deadline := time.After(totalTimeout)

	// 通知其他实例：该会话的流已开始，镜像端可显示"对话进行中"占位。
	broadcastAgentSessionChanged(app, req.SessionID, "streamStart")

	for {
		select {
		case event, ok := <-eventCh:
			if !ok {
				// 流正常结束（done 已写入 SSE）。通知镜像端解除占位锁定；
				// 实际内容重绘由发起者前端随后的 saveSession 广播（update）驱动，确保读到落盘后的完整数据。
				broadcastAgentSessionChanged(app, req.SessionID, "streamEnd")
				sessionsMu.Lock()
				delete(runningSessions, req.SessionID)
				sessionsMu.Unlock()
				return
			}
			if err := writeSSE(c, event); err != nil {
				// 客户端断开导致写失败，同样通知镜像端解除锁定，避免占位条悬挂。
				broadcastAgentSessionChanged(app, req.SessionID, "streamEnd")
				return
			}
			flusher.Flush()
		case <-c.Request.Context().Done():
			broadcastAgentSessionChanged(app, req.SessionID, "streamEnd")
			return
		case <-deadline:
			broadcastAgentSessionChanged(app, req.SessionID, "streamEnd")
			writeSSEError(c, model.Conf.Language(24))
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

type agentFrontendResultReq struct {
	CallID  string `json:"callID"`
	Result  string `json:"result"`
	IsError bool   `json:"isError"`
}

func agentChatFrontendResult(c *gin.Context) {
	req := &agentFrontendResultReq{}
	if err := c.ShouldBindJSON(req); err != nil {
		ret := gulu.Ret.NewResult()
		ret.Code = -1
		ret.Msg = "invalid request: " + err.Error()
		c.JSON(http.StatusOK, ret)
		return
	}
	agent.FrontendToolResult(req.CallID, req.Result, req.IsError)
	ret := gulu.Ret.NewResult()
	c.JSON(http.StatusOK, ret)
}

type agentTitleReq struct {
	Message  string `json:"message"`
	Model    string `json:"model"`
	Language string `json:"language"`
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

	modelID := req.Model
	var selectedProvider *conf.Provider
	var selectedModel *conf.Model
	if modelID != "" {
		selectedProvider, selectedModel = model.Conf.AI.GetModel(modelID)
	} else {
		selectedProvider, selectedModel = model.Conf.AI.GetAgentModel()
	}
	if nil == selectedProvider || nil == selectedModel {
		ret := gulu.Ret.NewResult()
		ret.Code = -1
		ret.Msg = "no AI provider configured"
		c.JSON(http.StatusOK, ret)
		return
	}
	client := util.NewOpenAIClientWithModel(selectedProvider.APIKey, selectedProvider.BaseURL, selectedModel.Name)

	title := agent.GenerateTitle(client, selectedModel.Name, req.Message, req.Language)
	ret := gulu.Ret.NewResult()
	ret.Data = title
	c.JSON(http.StatusOK, ret)
}

type agentSessionsReq struct {
	Page     int    `json:"page"`
	PageSize int    `json:"pageSize"`
	Keyword  string `json:"keyword"`
}

func lsSessions(c *gin.Context) {
	req := &agentSessionsReq{}
	if err := c.ShouldBindJSON(req); err != nil {
		ret := gulu.Ret.NewResult()
		ret.Code = -1
		ret.Msg = "invalid request: " + err.Error()
		c.JSON(http.StatusOK, ret)
		return
	}

	result := agent.ListSessions(req.Page, req.PageSize, req.Keyword)
	ret := gulu.Ret.NewResult()
	ret.Data = result
	c.JSON(http.StatusOK, ret)
}

type agentSessionGetReq struct {
	ID string `json:"id"`
}

func getSession(c *gin.Context) {
	req := &agentSessionGetReq{}
	if err := c.ShouldBindJSON(req); err != nil {
		ret := gulu.Ret.NewResult()
		ret.Code = -1
		ret.Msg = "invalid request: " + err.Error()
		c.JSON(http.StatusOK, ret)
		return
	}

	session, err := agent.GetSession(req.ID)
	if err != nil {
		ret := gulu.Ret.NewResult()
		ret.Code = -1
		ret.Msg = err.Error()
		c.JSON(http.StatusOK, ret)
		return
	}

	ret := gulu.Ret.NewResult()
	ret.Data = session
	c.JSON(http.StatusOK, ret)
}

type agentSessionDeleteReq struct {
	ID string `json:"id"`
}

func removeSession(c *gin.Context) {
	req := &agentSessionDeleteReq{}
	if err := c.ShouldBindJSON(req); err != nil {
		ret := gulu.Ret.NewResult()
		ret.Code = -1
		ret.Msg = "invalid request: " + err.Error()
		c.JSON(http.StatusOK, ret)
		return
	}

	_ = agent.DeleteSession(req.ID)
	// 通知其他实例：会话已删除，刷新列表；若为当前会话则清空视图。
	broadcastAgentSessionChanged(c.GetHeader("X-SiYuan-App-ID"), req.ID, "delete")
	ret := gulu.Ret.NewResult()
	c.JSON(http.StatusOK, ret)
}

func saveSession(c *gin.Context) {
	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		ret := gulu.Ret.NewResult()
		ret.Code = -1
		ret.Msg = "failed to read body: " + err.Error()
		c.JSON(http.StatusOK, ret)
		return
	}

	_ = agent.SaveSession(body)
	// 从 body 解出 sessionID 用于广播。update 仅触发其他实例刷新会话列表元数据，
	// 不触发当前视图重绘（重绘由 streamEnd 负责），回避流式中途半截数据的时序问题。
	var meta sessionMeta
	if gulu.JSON.UnmarshalJSON(body, &meta) == nil && meta.ID != "" {
		broadcastAgentSessionChanged(c.GetHeader("X-SiYuan-App-ID"), meta.ID, "update")
	}
	ret := gulu.Ret.NewResult()
	c.JSON(http.StatusOK, ret)
}

// broadcastAgentSessionChanged 向除发起者 app 外、所有打开了 agentChat dock 的实例推送会话变更通知。
// action: streamStart / streamEnd / update / delete。排除发起者 app（它已通过 SSE 自渲染或本地持有最新状态）。
func broadcastAgentSessionChanged(app, sessionID, action string) {
	if "" == app || "" == sessionID {
		return
	}
	data := map[string]string{"sessionID": sessionID, "action": action}
	util.BroadcastByTypeAndExcludeApp(app, "agentChat", "agentSessionChanged", 0, "", data)
}

// sessionMeta 用于从 saveSession 的 body 中解析出会话 ID，agent 包内也有同名字段，此处独立定义避免循环依赖。
type sessionMeta struct {
	ID string `json:"id"`
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
			"lastPromptTokens": event.LastPromptTokens,
			"tokenBreakdown":   event.TokenBreakdown,
			"cachedTokens":     event.CachedTokens,
			"contextLimit":     event.ContextLimit,
		})
	case "done":
		return writeSSEEvent(c, "done", map[string]interface{}{})
	case "retry":
		return writeSSEEvent(c, "retry", map[string]interface{}{
			"attempt":    event.RetryAttempt,
			"maxRetries": event.RetryMax,
		})
	case "question":
		return writeSSEEvent(c, "question", map[string]interface{}{
			"questionID": event.QuestionID,
			"arguments":  event.Arguments,
		})
	case "frontend_tool_call":
		return writeSSEEvent(c, "frontend_tool_call", map[string]interface{}{
			"callID":    event.CallID,
			"name":      event.Name,
			"arguments": event.Arguments,
		})
	case "snapshot":
		return writeSSEEvent(c, "snapshot", map[string]string{"snapshotID": event.SnapshotID})
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

func lsSkills(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)
	skills := util.DiscoverSkills()
	ret.Data = skills
}

type skillGetReq struct {
	Name string `json:"name"`
}

func getSkill(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	req := &skillGetReq{}
	if err := c.ShouldBindJSON(req); err != nil {
		ret.Code = -1
		ret.Msg = "invalid request: " + err.Error()
		return
	}

	content, err := util.ReadSkill(req.Name)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	ret.Data = map[string]string{
		"name":    req.Name,
		"content": content,
	}
}

type skillSaveReq struct {
	Name    string `json:"name"`
	Content string `json:"content"`
}

func saveSkill(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	req := &skillSaveReq{}
	if err := c.ShouldBindJSON(req); err != nil {
		ret.Code = -1
		ret.Msg = "invalid request: " + err.Error()
		return
	}

	if err := util.SaveSkill(req.Name, req.Content); err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
}

type skillRemoveReq struct {
	Name string `json:"name"`
}

func removeSkill(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	req := &skillRemoveReq{}
	if err := c.ShouldBindJSON(req); err != nil {
		ret.Code = -1
		ret.Msg = "invalid request: " + err.Error()
		return
	}

	if err := util.RemoveSkill(req.Name); err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
}

type skillRenameReq struct {
	OldName string `json:"oldName"`
	NewName string `json:"newName"`
}

func renameSkill(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	req := &skillRenameReq{}
	if err := c.ShouldBindJSON(req); err != nil {
		ret.Code = -1
		ret.Msg = "invalid request: " + err.Error()
		return
	}

	if err := util.RenameSkill(req.OldName, req.NewName); err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}
}
