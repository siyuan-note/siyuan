// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"context"
	"crypto/rand"
	"errors"
	"strings"
	"sync"
	"time"

	"github.com/olahol/melody"
	"github.com/siyuan-note/siyuan/kernel/templatehttp"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// TemplateHTTPExecution 将联网权限限定于本次请求及发起窗口。
type TemplateHTTPExecution struct {
	boxes              []string
	Runtime            *templatehttp.Execution
	id, app, sessionID string
	session            *melody.Session
	ctx                context.Context
	cancel             context.CancelFunc
	once               sync.Once
	mu                 sync.Mutex
	confirmation       string
	answer             chan bool
}

var templateHTTPExecutions = struct {
	sync.Mutex
	values map[string]*TemplateHTTPExecution
}{values: map[string]*TemplateHTTPExecution{}}

func StartTemplateHTTPExecution(ctx context.Context, id, app, sessionID, scope string, boxIDs ...string) (*TemplateHTTPExecution, error) {
	if id == "" && app == "" && sessionID == "" {
		return nil, nil
	}
	if len(id) < 16 || len(id) > 128 {
		return nil, errors.New("invalid template execution")
	}
	session, done := util.WaitBindableInteractiveSession(ctx, app, sessionID)
	if session == nil {
		return nil, errors.New("template interaction requires an active window")
	}
	templateHTTPExecutions.Lock()
	if _, exists := templateHTTPExecutions.values[id]; exists {
		templateHTTPExecutions.Unlock()
		return nil, errors.New("template execution already exists")
	}
	if len(templateHTTPExecutions.values) >= 64 {
		templateHTTPExecutions.Unlock()
		return nil, errors.New("too many template executions")
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	execution := &TemplateHTTPExecution{boxes: append([]string(nil), boxIDs...), id: id, app: app, sessionID: sessionID, session: session, ctx: ctx, cancel: cancel}
	execution.Runtime = templatehttp.New(ctx, scope, execution.confirm)
	execution.Runtime.SetErrorHandler(func(code string) {
		if execution.ctx.Err() == nil {
			execution.push("templateHTTPStatus", map[string]string{"executionID": execution.id, "state": "error", "errorCode": code})
		}
	})
	templateHTTPExecutions.values[id] = execution
	templateHTTPExecutions.Unlock()
	if !execution.accessValid("") {
		execution.Close()
		return nil, ErrEncryptedBoxNotUnlocked
	}
	go func() {
		select {
		case <-ctx.Done():
		case <-done:
		}
		execution.Close()
	}()
	return execution, nil
}

func (execution *TemplateHTTPExecution) push(cmd string, data any) bool {
	if execution.session.IsClosed() {
		return false
	}
	result := util.NewResult()
	result.Cmd, result.Data = cmd, data
	return execution.session.Write(result.Bytes()) == nil
}

func (execution *TemplateHTTPExecution) status(state string) {
	execution.push("templateHTTPStatus", map[string]string{"executionID": execution.id, "state": state})
}

func (execution *TemplateHTTPExecution) confirm(ctx context.Context, request templatehttp.Request) bool {
	if ctx.Err() != nil || execution.ctx.Err() != nil || !execution.accessValid(request.Scope) {
		execution.cancel()
		return false
	}
	// 界面恢复期间先完成普通渲染，仅联网调用等待当前窗口就绪。
	if !util.WaitInteractiveSession(ctx, execution.app, execution.sessionID, execution.session) ||
		execution.ctx.Err() != nil || !execution.accessValid(request.Scope) {
		execution.cancel()
		return false
	}
	confirmation := rand.Text()
	answer := make(chan bool, 1)
	execution.mu.Lock()
	execution.confirmation, execution.answer = confirmation, answer
	execution.mu.Unlock()
	defer func() {
		execution.mu.Lock()
		execution.confirmation, execution.answer = "", nil
		execution.mu.Unlock()
	}()
	execution.status("waiting")
	if !execution.push("templateHTTPConfirm", map[string]any{
		"executionID": execution.id, "confirmID": confirmation, "method": request.Method,
		"url": request.URL, "headerNames": request.HeaderNames,
	}) {
		execution.cancel()
		return false
	}
	timer := time.NewTimer(time.Minute)
	defer timer.Stop()
	select {
	case approved := <-answer:
		if approved && ctx.Err() == nil && execution.ctx.Err() == nil && execution.accessValid(request.Scope) {
			execution.status("requesting")
			return true
		}
	case <-ctx.Done():
		if errors.Is(ctx.Err(), context.DeadlineExceeded) && execution.ctx.Err() == nil {
			execution.push("templateHTTPStatus", map[string]string{"executionID": execution.id, "state": "error", "errorCode": "confirmation_timeout"})
		}
		execution.cancel()
	case <-execution.ctx.Done():
	case <-timer.C:
		execution.push("templateHTTPStatus", map[string]string{"executionID": execution.id, "state": "error", "errorCode": "confirmation_timeout"})
		execution.cancel()
	}
	return false
}

// RespondTemplateHTTP 只消费当前等待的一次回答；旧确认及重复回答无副作用。
func RespondTemplateHTTP(id, confirmation, app, sessionID string, approved bool) bool {
	templateHTTPExecutions.Lock()
	execution := templateHTTPExecutions.values[id]
	templateHTTPExecutions.Unlock()
	if execution == nil || execution.app != app || execution.sessionID != sessionID || execution.ctx.Err() != nil {
		return false
	}
	session, _ := util.InteractiveSession(app, sessionID)
	if session != execution.session {
		return false
	}
	execution.mu.Lock()
	defer execution.mu.Unlock()
	if execution.confirmation != confirmation || execution.answer == nil {
		return false
	}
	select {
	case execution.answer <- approved:
		execution.confirmation = ""
		return true
	default:
		return false
	}
}

func CancelTemplateHTTP(id, app, sessionID string) {
	templateHTTPExecutions.Lock()
	execution := templateHTTPExecutions.values[id]
	templateHTTPExecutions.Unlock()
	if execution != nil && execution.app == app && execution.sessionID == sessionID {
		execution.Close()
	}
}

func (execution *TemplateHTTPExecution) Close() {
	if execution == nil {
		return
	}
	execution.once.Do(func() {
		execution.cancel()
		execution.Runtime.Close()
		execution.status("done")
		templateHTTPExecutions.Lock()
		delete(templateHTTPExecutions.values, execution.id)
		templateHTTPExecutions.Unlock()
	})
}

// 笔记本进入锁定流程时立即终止联网等待，随后响应级租约才能安全释放。
func cancelTemplateHTTPExecutions() {
	templateHTTPExecutions.Lock()
	executions := make([]*TemplateHTTPExecution, 0, len(templateHTTPExecutions.values))
	for _, execution := range templateHTTPExecutions.values {
		executions = append(executions, execution)
	}
	templateHTTPExecutions.Unlock()
	for _, execution := range executions {
		execution.Close()
	}
}

func templateHTTPAccessValid(ctx context.Context) bool {
	scope, ok := ctx.Value(encryptedBoxOperationScopeKey{}).(*encryptedBoxOperationScope)
	if !ok {
		return true
	}
	scope.lock.Lock()
	closed := scope.closed
	boxes := append([]string(nil), scope.boxIDs...)
	scope.lock.Unlock()
	if closed {
		return false
	}
	for _, box := range boxes {
		if GetEncryptedBoxState(box) != EncryptedBoxStateUnlocked {
			return false
		}
	}
	return true
}

func (execution *TemplateHTTPExecution) accessValid(scope string) bool {
	if !templateHTTPAccessValid(execution.ctx) {
		return false
	}
	for _, box := range execution.boxes {
		if GetEncryptedBoxState(box) != EncryptedBoxStateUnlocked {
			return false
		}
	}
	box := strings.SplitN(scope, "\x00", 2)[0]
	return box == "" || !IsEncryptedBox(box) || GetEncryptedBoxState(box) == EncryptedBoxStateUnlocked
}
