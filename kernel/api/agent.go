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
	"errors"
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
	UserEntryID     string               `json:"userEntryID"`
	ContentRevision *int64               `json:"contentRevision"`
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
	app       string
	turnID    string
	committed bool
	terminal  bool
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
	if maxRetries < 0 {
		maxRetries = 0
	}
	// Provider 请求超时只限制建立上游流；流建立后由可重置的空闲超时检测连续无输出，
	// 避免持续正常输出的长回答被固定截止时间中断。
	requestTimeout := time.Duration(selectedProvider.RequestTimeout) * time.Second
	if requestTimeout <= 0 {
		requestTimeout = 30 * time.Second
	}
	streamIdleTimeout := time.Duration(model.Conf.AI.Agent.StreamIdleTimeout) * time.Second
	if streamIdleTimeout <= 0 {
		streamIdleTimeout = 120 * time.Second
	}

	app := c.GetHeader("X-SiYuan-App-ID")

	// 实例级互斥：同一 session 同时只允许一个活跃流。
	// 检查和占用在同一把锁内完成，成功占用后才启动 Agent goroutine。
	sessionsMu.Lock()
	if _, ok := runningSessions[req.SessionID]; ok {
		sessionsMu.Unlock()
		ret := gulu.Ret.NewResult()
		ret.Code = -1
		ret.Msg = "session is busy in another instance"
		c.JSON(http.StatusConflict, ret)
		return
	}
	ctx, cancel := context.WithCancel(c.Request.Context())
	running := &runningSession{app: app}
	runningSessions[req.SessionID] = running
	sessionsMu.Unlock()

	contentRevision := int64(-1)
	if req.ContentRevision != nil {
		contentRevision = *req.ContentRevision
	}
	eventCh := agent.AgentChat(ctx, client, selectedModel.Name, req.SessionID, req.UserEntryID, contentRevision, req.Message, req.Language, req.References, req.EditorContext, req.PluginActions, req.Regenerate, confirmTimeout, maxRetries, req.ReasoningEffort, requestTimeout, streamIdleTimeout)
	defer cancel()
	streamClosed := false
	defer func() {
		if streamClosed {
			return
		}
		go func() {
			for event := range eventCh {
				recordRunningEvent(req.SessionID, running, event)
			}
			finishRunningSession(req.SessionID, running)
		}()
	}()

	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")

	flusher, ok := c.Writer.(http.Flusher)
	if !ok {
		return
	}

	deadlineTimer, deadline := newAgentSessionDeadline(model.Conf.AI.Agent.SessionTimeout)
	if deadlineTimer != nil {
		defer deadlineTimer.Stop()
	}

	// 通知其他实例：该会话的流已开始，镜像端可显示"对话进行中"占位。
	broadcastAgentSessionChanged(app, req.SessionID, "streamStart")

	for {
		select {
		case event, ok := <-eventCh:
			if !ok {
				streamClosed = true
				finishRunningSession(req.SessionID, running)
				return
			}
			recordRunningEvent(req.SessionID, running, event)
			if err := writeSSE(c, event); err != nil {
				return
			}
			flusher.Flush()
		case <-c.Request.Context().Done():
			return
		case <-deadline:
			writeSSEInterrupted(c, model.Conf.Language(24))
			flusher.Flush()
			return
		}
	}
}

func newAgentSessionDeadline(timeoutSeconds int) (*time.Timer, <-chan time.Time) {
	if timeoutSeconds <= 0 {
		return nil, nil
	}
	if timeoutSeconds > 3600 {
		timeoutSeconds = 3600
	}
	timer := time.NewTimer(time.Duration(timeoutSeconds) * time.Second)
	return timer, timer.C
}

func recordRunningEvent(sessionID string, running *runningSession, event agent.AgentEvent) {
	sessionsMu.Lock()
	defer sessionsMu.Unlock()
	if runningSessions[sessionID] != running {
		return
	}
	if event.Type == "turn" {
		running.turnID = event.TurnID
	}
	if event.Type == "done" || event.Type == "error" {
		running.terminal = true
	}
}

func finishRunningSession(sessionID string, running *runningSession) {
	sessionsMu.Lock()
	current := runningSessions[sessionID]
	if current != running {
		sessionsMu.Unlock()
		return
	}
	uncommitted := running.turnID != "" && !running.committed
	delete(runningSessions, sessionID)
	sessionsMu.Unlock()
	broadcastAgentSessionChanged(running.app, sessionID, "streamEnd")
	if uncommitted {
		util.BroadcastByType("agentChat", "agentSessionChanged", 0, "", map[string]string{
			"sessionID": sessionID,
			"action":    "update",
		})
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
	ret := gulu.Ret.NewResult()
	if !agent.ConfirmSession(req.ConfirmID, req.Approved, req.Always) {
		ret.Code = -1
		ret.Msg = "agent confirmation expired"
		c.JSON(http.StatusConflict, ret)
		return
	}
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
	ret := gulu.Ret.NewResult()
	if !agent.AnswerQuestion(req.QuestionID, req.Answers) {
		ret.Code = -1
		ret.Msg = "agent question expired"
		c.JSON(http.StatusConflict, ret)
		return
	}
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
	ret := gulu.Ret.NewResult()
	if !agent.FrontendToolResult(req.CallID, req.Result, req.IsError) {
		ret.Code = -1
		ret.Msg = "agent frontend tool call expired"
		c.JSON(http.StatusConflict, ret)
		return
	}
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

	sessionsMu.Lock()
	_, running := runningSessions[req.ID]
	if !running {
		if err := agent.FinalizeOrphanedTurn(req.ID); err != nil {
			sessionsMu.Unlock()
			ret := gulu.Ret.NewResult()
			ret.Code = -1
			ret.Msg = err.Error()
			c.JSON(http.StatusInternalServerError, ret)
			return
		}
	}
	session, err := agent.GetSessionState(req.ID, !running)
	if err == nil && running {
		session["agentRunning"] = true
	}
	sessionsMu.Unlock()
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

	sessionsMu.Lock()
	_, running := runningSessions[req.ID]
	if running {
		sessionsMu.Unlock()
		ret := gulu.Ret.NewResult()
		ret.Code = -1
		ret.Msg = "session is running"
		c.JSON(http.StatusConflict, ret)
		return
	}
	err := agent.DeleteSession(req.ID)
	sessionsMu.Unlock()
	if err != nil {
		ret := gulu.Ret.NewResult()
		ret.Code = -1
		ret.Msg = err.Error()
		c.JSON(http.StatusInternalServerError, ret)
		return
	}
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
	var meta sessionMeta
	if gulu.JSON.UnmarshalJSON(body, &meta) != nil || meta.ID == "" {
		ret := gulu.Ret.NewResult()
		ret.Code = -1
		ret.Msg = "invalid session data"
		c.JSON(http.StatusBadRequest, ret)
		return
	}
	sessionsMu.Lock()
	running := runningSessions[meta.ID]
	if running != nil && running.app != c.GetHeader("X-SiYuan-App-ID") {
		sessionsMu.Unlock()
		ret := gulu.Ret.NewResult()
		ret.Code = -1
		ret.Msg = "session is running in another instance"
		c.JSON(http.StatusConflict, ret)
		return
	}
	commitTurnID := meta.CommitTurnID
	if commitTurnID == "" {
		commitTurnID = meta.RecoveryTurnID
	}
	if running != nil && commitTurnID == "" && c.GetHeader("X-SiYuan-Agent-Checkpoint") != "2" && running.terminal && running.turnID != "" {
		var payload map[string]any
		if err := gulu.JSON.UnmarshalJSON(body, &payload); err != nil {
			sessionsMu.Unlock()
			ret := gulu.Ret.NewResult()
			ret.Code = -1
			ret.Msg = err.Error()
			c.JSON(http.StatusBadRequest, ret)
			return
		}
		payload["commitTurnID"] = running.turnID
		body, err = gulu.JSON.MarshalJSON(payload)
		if err != nil {
			sessionsMu.Unlock()
			ret := gulu.Ret.NewResult()
			ret.Code = -1
			ret.Msg = err.Error()
			c.JSON(http.StatusInternalServerError, ret)
			return
		}
		commitTurnID = running.turnID
	}
	if running == nil {
		if runtimeErr := agent.FinalizeOrphanedTurn(meta.ID); runtimeErr != nil {
			sessionsMu.Unlock()
			ret := gulu.Ret.NewResult()
			ret.Code = -1
			ret.Msg = runtimeErr.Error()
			c.JSON(http.StatusInternalServerError, ret)
			return
		}
		// 旧前端没有 commitTurnID。流已真正结束后，从终止检查点补出提交标识；SaveSession 仍会
		// 用 runtime 重建权威内容，因此不会信任旧前端可能不完整的流式快照。
		if commitTurnID == "" && c.GetHeader("X-SiYuan-Agent-Checkpoint") != "2" {
			recoverableTurnID, runtimeErr := agent.RecoverableTurnID(meta.ID)
			if runtimeErr != nil {
				sessionsMu.Unlock()
				ret := gulu.Ret.NewResult()
				ret.Code = -1
				ret.Msg = runtimeErr.Error()
				c.JSON(http.StatusInternalServerError, ret)
				return
			}
			if recoverableTurnID != "" {
				var payload map[string]any
				if err := gulu.JSON.UnmarshalJSON(body, &payload); err != nil {
					sessionsMu.Unlock()
					ret := gulu.Ret.NewResult()
					ret.Code = -1
					ret.Msg = err.Error()
					c.JSON(http.StatusBadRequest, ret)
					return
				}
				payload["commitTurnID"] = recoverableTurnID
				body, err = gulu.JSON.MarshalJSON(payload)
				if err != nil {
					sessionsMu.Unlock()
					ret := gulu.Ret.NewResult()
					ret.Code = -1
					ret.Msg = err.Error()
					c.JSON(http.StatusInternalServerError, ret)
					return
				}
				commitTurnID = recoverableTurnID
			}
		}
	}
	// 已占用会话但尚未收到本轮 turn 事件，通常表示 Agent 初始化失败。此时若磁盘上仍有旧的
	// 未提交 turn，不能让无 commitTurnID 的普通保存绕过恢复协议并覆盖它。
	if commitTurnID == "" && (running == nil || running.turnID == "") {
		uncommitted, runtimeErr := agent.HasUncommittedTurn(meta.ID)
		if runtimeErr != nil {
			sessionsMu.Unlock()
			ret := gulu.Ret.NewResult()
			ret.Code = -1
			ret.Msg = runtimeErr.Error()
			c.JSON(http.StatusInternalServerError, ret)
			return
		}
		if uncommitted {
			sessionsMu.Unlock()
			ret := gulu.Ret.NewResult()
			ret.Code = -1
			ret.Msg = "session has an uncommitted turn"
			c.JSON(http.StatusConflict, ret)
			return
		}
	}

	revision, canonicalSession, err := agent.SaveSessionState(body)
	if commitTurnID == "" {
		canonicalSession = nil
	}
	if err == nil && running != nil {
		if commitTurnID != "" && commitTurnID == running.turnID {
			running.committed = true
		}
	}
	sessionsMu.Unlock()
	if err != nil {
		ret := gulu.Ret.NewResult()
		ret.Code = -1
		ret.Msg = err.Error()
		if errors.Is(err, agent.ErrSessionConflict) || errors.Is(err, agent.ErrRuntimeNotFinalized) {
			ret.Data = map[string]int64{"revision": revision}
			c.JSON(http.StatusConflict, ret)
			return
		}
		c.JSON(http.StatusInternalServerError, ret)
		return
	}
	// 从 body 解出 sessionID 用于广播。update 仅触发其他实例刷新会话列表元数据，
	// 不触发当前视图重绘（重绘由 streamEnd 负责），回避流式中途半截数据的时序问题。
	broadcastAgentSessionChanged(c.GetHeader("X-SiYuan-App-ID"), meta.ID, "update")
	ret := gulu.Ret.NewResult()
	data := map[string]any{"revision": revision}
	if canonicalSession != nil {
		data["session"] = canonicalSession
	}
	ret.Data = data
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
	ID             string `json:"id"`
	CommitTurnID   string `json:"commitTurnID"`
	RecoveryTurnID string `json:"recoveryTurnID"`
}

func writeSSE(c *gin.Context, event agent.AgentEvent) error {
	switch event.Type {
	case "turn":
		return writeSSEEvent(c, "turn", map[string]string{"turnID": event.TurnID})
	case "content":
		return writeSSEEvent(c, "content", map[string]string{"token": event.Token})
	case "thinking":
		return writeSSEEvent(c, "thinking", map[string]string{"reasoning": event.Reasoning})
	case "reasoning":
		return writeSSEEvent(c, "reasoning", map[string]string{"token": event.Token})
	case "confirm":
		return writeSSEEvent(c, "confirm", map[string]any{
			"name":      event.Name,
			"arguments": event.Arguments,
			"confirmID": event.ConfirmID,
			"effects":   event.Effects,
		})
	case "tool_call":
		return writeSSEEvent(c, "tool_call", map[string]any{
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
		return writeSSEEvent(c, "usage", map[string]any{
			"promptTokens":     event.PromptTokens,
			"completionTokens": event.CompletionTokens,
			"lastPromptTokens": event.LastPromptTokens,
			"tokenBreakdown":   event.TokenBreakdown,
			"cachedTokens":     event.CachedTokens,
			"contextLimit":     event.ContextLimit,
		})
	case "done":
		return writeSSEEvent(c, "done", map[string]string{"turnID": event.TurnID})
	case "retry":
		return writeSSEEvent(c, "retry", map[string]any{
			"attempt":    event.RetryAttempt,
			"maxRetries": event.RetryMax,
		})
	case "question":
		return writeSSEEvent(c, "question", map[string]any{
			"questionID": event.QuestionID,
			"arguments":  event.Arguments,
		})
	case "frontend_tool_call":
		return writeSSEEvent(c, "frontend_tool_call", map[string]any{
			"callID":    event.CallID,
			"name":      event.Name,
			"arguments": event.Arguments,
		})
	case "snapshot":
		return writeSSEEvent(c, "snapshot", map[string]string{"snapshotID": event.SnapshotID})
	}
	return nil
}

func writeSSEEvent(c *gin.Context, eventType string, data any) error {
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

func writeSSEInterrupted(c *gin.Context, message string) error {
	return writeSSEEvent(c, "interrupted", map[string]string{"message": message})
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
