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
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/88250/gulu"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/agent"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/mcp/tools"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type agentChatReq struct {
	SessionID            string                     `json:"sessionID"`
	UserEntryID          string                     `json:"userEntryID"`
	ContentRevision      *int64                     `json:"contentRevision"`
	Message              string                     `json:"message"`
	BlockHTML            *string                    `json:"blockHTML"`
	Language             string                     `json:"language"`
	References           []agent.Reference          `json:"references"`
	EditorContext        agent.EditorContext        `json:"editorContext"`
	FrontendCapabilities []agent.FrontendCapability `json:"frontendCapabilities"`
	Model                string                     `json:"model,omitempty"`
	Regenerate           bool                       `json:"regenerate"`
	ReasoningEffort      string                     `json:"reasoningEffort,omitempty"`
}

type runningSession struct {
	app       string
	turnID    string
	committed bool
	terminal  bool
}

var sessionsMu sync.Mutex
var runningSessions = map[string]*runningSession{}

var agentChat = contractHandler(apicontract.AIAgentChat, agentChatContract, aiProviderAdmission)

func agentChatContract(c *gin.Context, request apicontract.AIAgentChatRequest) apicontract.Response[apicontract.Null] {
	req, err := aiAgentRequest(request)
	if err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
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
		return contractFailure[apicontract.Null](ret)
	}
	client := util.NewAIClientWithModel(selectedProvider.APIKey, selectedProvider.BaseURL, selectedModel.Name, model.ResolveAIProviderHeaders(selectedProvider))

	confirmTimeout := resolveAgentConfirmTimeout(model.Conf.AI.Agent.ConfirmTimeout)
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
		return apicontract.AIAgentChat.WithHTTPStatus(contractFailure[apicontract.Null](ret), http.StatusConflict)
	}
	ctx, cancel := context.WithCancel(c.Request.Context())
	ctx = util.ContextWithOpenAIResponsesBaseURL(ctx, selectedProvider.BaseURL)
	running := &runningSession{app: app}
	runningSessions[req.SessionID] = running
	sessionsMu.Unlock()
	return apicontract.StreamSSE[apicontract.Null](func(_ http.ResponseWriter, _ *http.Request) {

		contentRevision := int64(-1)
		if req.ContentRevision != nil {
			contentRevision = *req.ContentRevision
		}
		contextLimit := agent.ResolveModelContextLimit(selectedProvider.BaseURL, selectedModel.Name, selectedModel.ContextLength)
		imageCapabilityKey := fmt.Sprintf("%s\x00%s\x00%s\x00%s\x00%s",
			selectedProvider.ID, selectedModel.ID, selectedProvider.BaseURL, selectedProvider.Protocol, selectedModel.Name)
		eventCh := agent.AgentChat(ctx, client, selectedProvider.Protocol, selectedModel.Name, imageCapabilityKey,
			contextLimit, req.SessionID, req.UserEntryID, contentRevision, req.Message, req.BlockHTML, req.Language,
			req.References, req.EditorContext, req.FrontendCapabilities, req.Regenerate, confirmTimeout, maxRetries,
			req.ReasoningEffort, requestTimeout, streamIdleTimeout)
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
				writeSSEInterrupted(c, model.Conf.Language(379))
				flusher.Flush()
				return
			}
		}
	})
}

// sessionDeadlineTimeoutSeconds 解析会话总超时秒数：小于等于 0 表示不限制，超过上限时按上限截断。
func sessionDeadlineTimeoutSeconds(timeoutSeconds int) (seconds int, unlimited bool) {
	if timeoutSeconds <= 0 {
		return 0, true
	}
	if timeoutSeconds > conf.MaxAgentSessionTimeout {
		timeoutSeconds = conf.MaxAgentSessionTimeout
	}
	return timeoutSeconds, false
}

func newAgentSessionDeadline(timeoutSeconds int) (*time.Timer, <-chan time.Time) {
	seconds, unlimited := sessionDeadlineTimeoutSeconds(timeoutSeconds)
	if unlimited {
		return nil, nil
	}
	timer := time.NewTimer(time.Duration(seconds) * time.Second)
	return timer, timer.C
}

func resolveAgentConfirmTimeout(timeoutSeconds int) time.Duration {
	if timeoutSeconds < 0 {
		return conf.DefaultAgentConfirmTimeout * time.Second
	}
	return time.Duration(timeoutSeconds) * time.Second
}

func recordRunningEvent(sessionID string, running *runningSession, event agent.AgentEvent) {
	sessionsMu.Lock()
	if runningSessions[sessionID] != running {
		sessionsMu.Unlock()
		return
	}
	if event.Type == "turn" {
		running.turnID = event.TurnID
	}
	if event.Type == "done" || event.Type == "error" {
		running.terminal = true
	}
	sessionsMu.Unlock()
	if event.Type == agent.AgentEventPermission {
		broadcastAgentSessionChanged(running.app, sessionID, "permission")
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

var agentChatConfirm = contractHandler(apicontract.AIAgentConfirm, agentChatConfirmContract)

func agentChatConfirmContract(c *gin.Context, req apicontract.AIConfirmRequest) apicontract.Response[apicontract.Null] {
	ret := gulu.Ret.NewResult()
	accepted, err := agent.ConfirmSession(req.ConfirmID, req.Approved, req.Always)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return contractFailure[apicontract.Null](ret)
	}
	if !accepted {
		ret.Code = -1
		ret.Msg = "agent confirmation expired"
		return apicontract.AIAgentConfirm.WithHTTPStatus(contractFailure[apicontract.Null](ret), http.StatusConflict)
	}
	return contractFailure[apicontract.Null](ret)
}

var setAgentSessionPermission = contractHandler(apicontract.AIAgentSetPermission, setAgentSessionPermissionContract)

func setAgentSessionPermissionContract(c *gin.Context, req apicontract.AIPermissionRequest) apicontract.Response[apicontract.AIPermissionData] {
	ret := gulu.Ret.NewResult()
	if err := agent.SetSessionPermissionMode(req.SessionID, req.PermissionMode); err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return contractFailure[apicontract.AIPermissionData](ret)
	}
	return apicontract.WithAfterWrite(apicontract.Success(apicontract.AIPermissionData{PermissionMode: req.PermissionMode}), func() {
		broadcastAgentSessionChanged(c.GetHeader("X-SiYuan-App-ID"), req.SessionID, "permission")
	})
}

var agentChatQuestion = contractHandler(apicontract.AIAgentQuestion, agentChatQuestionContract)

func agentChatQuestionContract(c *gin.Context, req apicontract.AIQuestionRequest) apicontract.Response[apicontract.Null] {
	ret := gulu.Ret.NewResult()
	if !agent.AnswerQuestion(req.QuestionID, req.Answers) {
		ret.Code = -1
		ret.Msg = "agent question expired"
		return apicontract.AIAgentQuestion.WithHTTPStatus(contractFailure[apicontract.Null](ret), http.StatusConflict)
	}
	return contractFailure[apicontract.Null](ret)
}

var agentChatBrowserCapabilityResult = contractHandler(apicontract.AIAgentBrowserCapabilityResult, agentChatBrowserCapabilityResultContract)

func agentChatBrowserCapabilityResultContract(c *gin.Context, req apicontract.AIBrowserCapabilityResultRequest) apicontract.Response[apicontract.Null] {
	ret := gulu.Ret.NewResult()
	if !agent.BrowserCapabilityResult(req.CallID, req.Result, req.StructuredContent, req.StructuredContentSet, req.IsError) {
		ret.Code = -1
		ret.Msg = "agent browser capability call expired"
		return apicontract.AIAgentBrowserCapabilityResult.WithHTTPStatus(contractFailure[apicontract.Null](ret), http.StatusConflict)
	}
	return contractFailure[apicontract.Null](ret)
}

var lsCapabilities = contractHandler(apicontract.AIListCapabilities, lsCapabilitiesContract)

func lsCapabilitiesContract(c *gin.Context, req apicontract.EmptyRequest) apicontract.Response[[]apicontract.AICapabilityManifest] {
	return apicontract.Success(aiCapabilityManifestsContract(tools.ListCapabilityManifests()))
}

var agentChatTitle = contractHandler(apicontract.AIAgentTitle, agentChatTitleContract)

func agentChatTitleContract(c *gin.Context, req apicontract.AITitleRequest) apicontract.Response[string] {

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
		return contractFailure[string](ret)
	}
	client := util.NewAIClientWithModel(selectedProvider.APIKey, selectedProvider.BaseURL, selectedModel.Name, model.ResolveAIProviderHeaders(selectedProvider))

	title := agent.GenerateTitle(client, selectedProvider.BaseURL, selectedProvider.Protocol, selectedModel.Name,
		req.Message, req.Language)
	return apicontract.Success(title)
}

var lsSessions = contractHandler(apicontract.AIListSessions, lsSessionsContract)

func lsSessionsContract(c *gin.Context, req apicontract.AISessionsRequest) apicontract.Response[apicontract.AISessionList] {

	result := agent.ListSessions(req.Page, req.PageSize, req.Keyword)
	sessionsMu.Lock()
	for _, session := range result.Sessions {
		_, session.AgentRunning = runningSessions[session.ID]
	}
	sessionsMu.Unlock()
	return apicontract.Success(aiSessionListContract(result))
}

var getSession = contractHandler(apicontract.AIGetSession, getSessionContract)

func getSessionContract(c *gin.Context, req apicontract.AISessionIDRequest) apicontract.Response[*apicontract.AISession] {

	sessionsMu.Lock()
	_, running := runningSessions[req.ID]
	if !running {
		if err := agent.FinalizeOrphanedTurn(req.ID); err != nil {
			sessionsMu.Unlock()
			ret := gulu.Ret.NewResult()
			ret.Code = -1
			ret.Msg = err.Error()
			return apicontract.AIGetSession.WithHTTPStatus(contractFailure[*apicontract.AISession](ret), http.StatusInternalServerError)
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
		return contractFailure[*apicontract.AISession](ret)
	}

	payload, err := aiSessionContract(session)
	if err != nil {
		return apicontract.Failure[*apicontract.AISession](-1, err.Error())
	}
	return apicontract.Success(payload)
}

var removeSession = contractHandler(apicontract.AIRemoveSession, removeSessionContract)

func removeSessionContract(c *gin.Context, req apicontract.AISessionIDRequest) apicontract.Response[apicontract.Null] {

	sessionsMu.Lock()
	_, running := runningSessions[req.ID]
	if running {
		sessionsMu.Unlock()
		ret := gulu.Ret.NewResult()
		ret.Code = -1
		ret.Msg = "session is running"
		return apicontract.AIRemoveSession.WithHTTPStatus(contractFailure[apicontract.Null](ret), http.StatusConflict)
	}
	err := agent.DeleteSession(req.ID)
	sessionsMu.Unlock()
	if err != nil {
		ret := gulu.Ret.NewResult()
		ret.Code = -1
		ret.Msg = err.Error()
		return apicontract.AIRemoveSession.WithHTTPStatus(contractFailure[apicontract.Null](ret), http.StatusInternalServerError)
	}
	// 通知其他实例：会话已删除，刷新列表；若为当前会话则清空视图。
	broadcastAgentSessionChanged(c.GetHeader("X-SiYuan-App-ID"), req.ID, "delete")
	ret := gulu.Ret.NewResult()
	return contractFailure[apicontract.Null](ret)
}

var saveSession = contractHandler(apicontract.AISaveSession, saveSessionContract)

func saveSessionContract(c *gin.Context, req apicontract.AISession) apicontract.Response[apicontract.AISessionSaveData] {
	body := req.Bytes()
	var err error
	var meta sessionMeta
	if gulu.JSON.UnmarshalJSON(body, &meta) != nil || meta.ID == "" {
		ret := gulu.Ret.NewResult()
		ret.Code = -1
		ret.Msg = "invalid session data"
		return apicontract.AISaveSession.WithHTTPStatus(contractFailure[apicontract.AISessionSaveData](ret), http.StatusBadRequest)
	}
	sessionsMu.Lock()
	running := runningSessions[meta.ID]
	if running != nil && running.app != c.GetHeader("X-SiYuan-App-ID") {
		sessionsMu.Unlock()
		ret := gulu.Ret.NewResult()
		ret.Code = -1
		ret.Msg = "session is running in another instance"
		return apicontract.AISaveSession.WithHTTPStatus(contractFailure[apicontract.AISessionSaveData](ret), http.StatusConflict)
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
			return apicontract.AISaveSession.WithHTTPStatus(contractFailure[apicontract.AISessionSaveData](ret), http.StatusBadRequest)
		}
		payload["commitTurnID"] = running.turnID
		body, err = gulu.JSON.MarshalJSON(payload)
		if err != nil {
			sessionsMu.Unlock()
			ret := gulu.Ret.NewResult()
			ret.Code = -1
			ret.Msg = err.Error()
			return apicontract.AISaveSession.WithHTTPStatus(contractFailure[apicontract.AISessionSaveData](ret), http.StatusInternalServerError)
		}
		commitTurnID = running.turnID
	}
	if running == nil {
		if runtimeErr := agent.FinalizeOrphanedTurn(meta.ID); runtimeErr != nil {
			sessionsMu.Unlock()
			ret := gulu.Ret.NewResult()
			ret.Code = -1
			ret.Msg = runtimeErr.Error()
			return apicontract.AISaveSession.WithHTTPStatus(contractFailure[apicontract.AISessionSaveData](ret), http.StatusInternalServerError)
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
				return apicontract.AISaveSession.WithHTTPStatus(contractFailure[apicontract.AISessionSaveData](ret), http.StatusInternalServerError)
			}
			if recoverableTurnID != "" {
				var payload map[string]any
				if err := gulu.JSON.UnmarshalJSON(body, &payload); err != nil {
					sessionsMu.Unlock()
					ret := gulu.Ret.NewResult()
					ret.Code = -1
					ret.Msg = err.Error()
					return apicontract.AISaveSession.WithHTTPStatus(contractFailure[apicontract.AISessionSaveData](ret), http.StatusBadRequest)
				}
				payload["commitTurnID"] = recoverableTurnID
				body, err = gulu.JSON.MarshalJSON(payload)
				if err != nil {
					sessionsMu.Unlock()
					ret := gulu.Ret.NewResult()
					ret.Code = -1
					ret.Msg = err.Error()
					return apicontract.AISaveSession.WithHTTPStatus(contractFailure[apicontract.AISessionSaveData](ret), http.StatusInternalServerError)
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
			return apicontract.AISaveSession.WithHTTPStatus(contractFailure[apicontract.AISessionSaveData](ret), http.StatusInternalServerError)
		}
		if uncommitted {
			sessionsMu.Unlock()
			ret := gulu.Ret.NewResult()
			ret.Code = -1
			ret.Msg = "session has an uncommitted turn"
			return apicontract.AISaveSession.WithHTTPStatus(contractFailure[apicontract.AISessionSaveData](ret), http.StatusConflict)
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
			return apicontract.AISaveSession.WithHTTPStatus(apicontract.AISaveSession.FailureWithData(-1, ret.Msg, apicontract.AISessionSaveData{Revision: revision}), http.StatusConflict)
		}
		return apicontract.AISaveSession.WithHTTPStatus(contractFailure[apicontract.AISessionSaveData](ret), http.StatusInternalServerError)
	}
	// 从 body 解出 sessionID 用于广播。update 仅触发其他实例刷新会话列表元数据，
	// 不触发当前视图重绘（重绘由 streamEnd 负责），回避流式中途半截数据的时序问题。
	broadcastAgentSessionChanged(c.GetHeader("X-SiYuan-App-ID"), meta.ID, "update")
	payload, err := aiSessionContract(canonicalSession)
	if err != nil {
		return apicontract.AISaveSession.WithHTTPStatus(apicontract.Failure[apicontract.AISessionSaveData](-1, err.Error()), http.StatusInternalServerError)
	}
	return apicontract.Success(apicontract.AISessionSaveData{Revision: revision, Session: payload})
}

// broadcastAgentSessionChanged 向除发起者 app 外、所有打开了 agentChat dock 的实例推送会话变更通知。
// action: streamStart / streamEnd / update / permission / delete。
// 排除发起者 app，它已通过 SSE 自渲染或在本地持有最新状态。
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
	var arguments map[string]apicontract.JSONValue
	switch event.Type {
	case "confirm", "tool_call", "question", "browser_capability_call":
		encoded, err := json.Marshal(event.Arguments)
		if err != nil {
			return err
		}
		if err = json.Unmarshal(encoded, &arguments); err != nil {
			return err
		}
	}
	switch event.Type {
	case "turn":
		return writeSSEEvent(c, "turn", apicontract.AISSETurn{TurnID: event.TurnID})
	case "content":
		return writeSSEEvent(c, "content", apicontract.AISSEToken{Token: event.Token})
	case "thinking":
		return writeSSEEvent(c, "thinking", apicontract.AISSEThinking{
			Reasoning: event.Reasoning,
			RoundID:   event.RoundID,
		})
	case "reasoning":
		return writeSSEEvent(c, "reasoning", apicontract.AISSEToken{Token: event.Token})
	case "confirm":
		return writeSSEEvent(c, "confirm", apicontract.AISSEConfirm{
			Name:      event.Name,
			Arguments: arguments,
			ConfirmID: event.ConfirmID,
			Effects:   apicontract.AIToolEffects(event.Effects),
			Forced:    event.ForcedConfirm,
		})
	case agent.AgentEventPermission:
		return writeSSEEvent(c, agent.AgentEventPermission, apicontract.AIPermissionData{
			PermissionMode: event.PermissionMode,
		})
	case "tool_call":
		return writeSSEEvent(c, "tool_call", apicontract.AISSEToolCall{
			Name:      event.Name,
			CallID:    event.ToolCallID,
			RoundID:   event.RoundID,
			Arguments: arguments,
		})
	case "tool_result":
		return writeSSEEvent(c, "tool_result", apicontract.AISSEToolResult{
			Name:    event.Name,
			CallID:  event.ToolCallID,
			RoundID: event.RoundID,
			Result:  event.Result,
		})
	case "error":
		return writeSSEEvent(c, "error", apicontract.AISSEMessage{Message: event.Error})
	case "usage":
		return writeSSEEvent(c, "usage", apicontract.AISSEUsage{
			PromptTokens:     event.PromptTokens,
			CompletionTokens: event.CompletionTokens,
			LastPromptTokens: event.LastPromptTokens,
			TokenBreakdown:   event.TokenBreakdown,
			CachedTokens:     event.CachedTokens,
			ContextLimit:     event.ContextLimit,
		})
	case "done":
		return writeSSEEvent(c, "done", apicontract.AISSETurn{TurnID: event.TurnID})
	case "retry":
		return writeSSEEvent(c, "retry", apicontract.AISSERetry{
			Attempt:    event.RetryAttempt,
			MaxRetries: event.RetryMax,
		})
	case "question":
		return writeSSEEvent(c, "question", apicontract.AISSEQuestion{
			QuestionID: event.QuestionID,
			RoundID:    event.RoundID,
			Arguments:  arguments,
		})
	case "browser_capability_call":
		return writeSSEEvent(c, "browser_capability_call", apicontract.AISSEBrowserCapabilityCall{
			CallID:       event.CallID,
			Name:         event.Name,
			CapabilityID: event.CapabilityID,
			Generation:   event.Generation,
			Arguments:    arguments,
		})
	case "snapshot":
		return writeSSEEvent(c, "snapshot", apicontract.AISSESnapshot{
			SnapshotID: event.SnapshotID,
			RoundID:    event.RoundID,
		})
	}
	return nil
}

func writeSSEEvent[Payload any](c *gin.Context, eventType string, data Payload) error {
	b, err := json.Marshal(data)
	if err != nil {
		return err
	}
	_, err = fmt.Fprintf(c.Writer, "event:%s\ndata:%s\n\n", eventType, string(b))
	return err
}

func writeSSEError(c *gin.Context, message string) error {
	return writeSSEEvent(c, "error", apicontract.AISSEMessage{Message: message})
}

func writeSSEInterrupted(c *gin.Context, message string) error {
	return writeSSEEvent(c, "interrupted", apicontract.AISSEMessage{Message: message})
}

var lsSkills = contractHandler(apicontract.AIListSkills, lsSkillsContract)

func lsSkillsContract(c *gin.Context, req apicontract.EmptyRequest) apicontract.Response[[]apicontract.AISkillInfo] {
	skills := util.DiscoverSkills(model.EnabledUserSkills())
	return apicontract.Success(aiSkillsContract(skills))
}

var lsUserSkills = contractHandler(apicontract.AIListUserSkills, lsUserSkillsContract)

func lsUserSkillsContract(c *gin.Context, req apicontract.EmptyRequest) apicontract.Response[[]apicontract.AIUserSkillInfo] {
	return apicontract.Success(aiUserSkillsContract(util.DiscoverUserSkills(model.EnabledUserSkills())))
}

var getSkill = contractHandler(apicontract.AIGetSkill, getSkillContract)

func getSkillContract(c *gin.Context, req apicontract.AISkillNameRequest) apicontract.Response[apicontract.AISkillData] {
	ret := gulu.Ret.NewResult()

	content, err := util.ReadSkill(req.Name, model.EnabledUserSkills())
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return contractFailure[apicontract.AISkillData](ret)
	}

	return apicontract.Success(apicontract.AISkillData{Name: req.Name, Content: content})
}

var saveSkill = contractHandler(apicontract.AISaveSkill, saveSkillContract)

func saveSkillContract(c *gin.Context, req apicontract.AISkillSaveRequest) apicontract.Response[apicontract.Null] {
	ret := gulu.Ret.NewResult()

	if err := util.SaveSkill(req.Name, req.Content); err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return contractFailure[apicontract.Null](ret)
	}
	return contractFailure[apicontract.Null](ret)
}

var removeSkill = contractHandler(apicontract.AIRemoveSkill, removeSkillContract)

func removeSkillContract(c *gin.Context, req apicontract.AISkillNameRequest) apicontract.Response[apicontract.Null] {
	ret := gulu.Ret.NewResult()

	if err := util.RemoveSkill(req.Name); err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return contractFailure[apicontract.Null](ret)
	}
	return contractFailure[apicontract.Null](ret)
}

var renameSkill = contractHandler(apicontract.AIRenameSkill, renameSkillContract)

func renameSkillContract(c *gin.Context, req apicontract.AISkillRenameRequest) apicontract.Response[apicontract.Null] {
	ret := gulu.Ret.NewResult()

	if err := util.RenameSkill(req.OldName, req.NewName); err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return contractFailure[apicontract.Null](ret)
	}
	return contractFailure[apicontract.Null](ret)
}
