// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/olahol/melody"
	"github.com/siyuan-note/siyuan/kernel/templatehttp"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func templateHTTPTestWindow(t *testing.T, unready ...bool) (*websocket.Conn, string) {
	t.Helper()
	app := strings.ReplaceAll(t.Name(), "/", "-")
	hub := melody.New()
	connected := make(chan struct{}, 1)
	hub.HandleConnect(func(session *melody.Session) { util.AddPushChan(session); connected <- struct{}{} })
	hub.HandleDisconnect(util.RemovePushChan)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _ = hub.HandleRequest(w, r) }))
	query := ""
	if len(unready) > 0 && unready[0] {
		query = "&ready=false"
	}
	connection, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http")+"/ws?app="+app+"&id=main&type=main"+query, nil)
	if err != nil {
		server.Close()
		t.Fatal(err)
	}
	<-connected
	t.Cleanup(func() { connection.Close(); hub.Close(); server.Close() })
	return connection, app
}

func TestTemplateHTTPExecutionConfirmationOwnershipAndCancellation(t *testing.T) {
	connection, app := templateHTTPTestWindow(t)
	execution, err := StartTemplateHTTPExecution(context.Background(), "template-execution-test", app, "main", "scope")
	if err != nil {
		t.Fatal(err)
	}
	defer execution.Close()
	if _, err = StartTemplateHTTPExecution(context.Background(), "template-execution-test", app, "main", "scope"); err == nil {
		t.Fatal("duplicate execution accepted")
	}
	result := make(chan bool, 1)
	go func() {
		result <- execution.confirm(context.Background(), templatehttp.Request{Method: "GET", URL: "https://example.com/"})
	}()
	var event struct {
		Cmd  string
		Data struct{ ConfirmID string }
	}
	connection.SetReadDeadline(time.Now().Add(5 * time.Second))
	for event.Cmd != "templateHTTPConfirm" {
		if err = connection.ReadJSON(&event); err != nil {
			t.Fatal(err)
		}
	}
	if RespondTemplateHTTP(execution.id, event.Data.ConfirmID, "other", "main", true) {
		t.Fatal("wrong window accepted")
	}
	if RespondTemplateHTTP(execution.id, "stale", app, "main", true) {
		t.Fatal("stale confirmation accepted")
	}
	if !RespondTemplateHTTP(execution.id, event.Data.ConfirmID, app, "main", false) {
		t.Fatal("valid denial ignored")
	}
	if RespondTemplateHTTP(execution.id, event.Data.ConfirmID, app, "main", true) {
		t.Fatal("duplicate answer accepted")
	}
	select {
	case approved := <-result:
		if approved {
			t.Fatal("denial authorized request")
		}
	case <-time.After(time.Second):
		t.Fatal("confirmation did not resume")
	}
	CancelTemplateHTTP(execution.id, "other", "main")
	if execution.Runtime.Err() != nil {
		t.Fatal("wrong window canceled request")
	}
	CancelTemplateHTTP(execution.id, app, "main")
	if execution.Runtime.Err() == nil {
		t.Fatal("cancel did not terminate runtime")
	}
	if RespondTemplateHTTP(execution.id, event.Data.ConfirmID, app, "main", true) {
		t.Fatal("ended execution accepted answer")
	}
}

func TestTemplateHTTPExecutionWindowDisconnect(t *testing.T) {
	connection, app := templateHTTPTestWindow(t)
	execution, err := StartTemplateHTTPExecution(context.Background(), "template-disconnect-test", app, "main", "scope")
	if err != nil {
		t.Fatal(err)
	}
	defer execution.Close()
	connection.Close()
	select {
	case <-execution.ctx.Done():
	case <-time.After(5 * time.Second):
		t.Fatal("window close left execution alive")
	}
}

func TestTemplateHTTPExecutionRejectsMissingWindow(t *testing.T) {
	execution, err := StartTemplateHTTPExecution(context.Background(), "", "", "", "scope")
	if execution != nil || err != nil {
		t.Fatal("background request should remain noninteractive")
	}
	if _, err = StartTemplateHTTPExecution(context.Background(), "template-windowless-test", "absent", "main", "scope"); err == nil {
		t.Fatal("windowless request accepted")
	}
}

func TestTemplateHTTPAccessRejectsLockingAndClosedScope(t *testing.T) {
	box := "template-http-lease-test"
	defer removeEncryptedBoxLifecycle(box)
	scope := &encryptedBoxOperationScope{boxIDs: []string{box}}
	ctx := context.WithValue(context.Background(), encryptedBoxOperationScopeKey{}, scope)
	setEncryptedBoxState(box, EncryptedBoxStateUnlocked)
	if !templateHTTPAccessValid(ctx) {
		t.Fatal("unlocked lease rejected")
	}
	setEncryptedBoxState(box, EncryptedBoxStateLocking)
	if templateHTTPAccessValid(ctx) {
		t.Fatal("locking lease accepted")
	}
	setEncryptedBoxState(box, EncryptedBoxStateUnlocked)
	scope.closed = true
	if templateHTTPAccessValid(ctx) {
		t.Fatal("closed lease accepted")
	}
}

func TestTemplateHTTPRejectsRegistrationAfterNotebookStartsLocking(t *testing.T) {
	_, app := templateHTTPTestWindow(t)
	box := "template-http-registration-race"
	defer removeEncryptedBoxLifecycle(box)
	setEncryptedBoxState(box, EncryptedBoxStateLocking)
	execution, err := StartTemplateHTTPExecution(context.Background(), "template-locking-registration", app, "main", "document", box)
	if err != ErrEncryptedBoxNotUnlocked || execution != nil {
		t.Fatalf("locking notebook registered: %v %v", execution, err)
	}
	templateHTTPExecutions.Lock()
	_, retained := templateHTTPExecutions.values["template-locking-registration"]
	templateHTTPExecutions.Unlock()
	if retained {
		t.Fatal("rejected execution retained")
	}
}

func TestTemplateHTTPNotebookLockCancelsBeforeWaitingForLease(t *testing.T) {
	_, app := templateHTTPTestWindow(t)
	box := "template-http-active-lease"
	defer removeEncryptedBoxLifecycle(box)
	setEncryptedBoxState(box, EncryptedBoxStateUnlocked)
	lifecycle := getEncryptedBoxLifecycle(box)
	lifecycle.lock.Lock()
	lifecycle.activeOperations = 1
	lifecycle.lock.Unlock()
	execution, err := StartTemplateHTTPExecution(context.Background(), "template-lock-active-request", app, "main", "document", box)
	if err != nil {
		t.Fatal(err)
	}
	defer execution.Close()
	locked := make(chan struct{})
	go func() { beginEncryptedBoxLock(box); close(locked) }()
	select {
	case <-execution.ctx.Done():
	case <-time.After(time.Second):
		t.Fatal("lock waited for lease before canceling execution")
	}
	ReleaseEncryptedBoxOperation(box)
	select {
	case <-locked:
	case <-time.After(time.Second):
		t.Fatal("lock did not finish after canceled request released its lease")
	}
}

func TestTemplateHTTPRefreshWaitsOnlyForNetworkConfirmation(t *testing.T) {
	connection, app := templateHTTPTestWindow(t, true)
	execution, err := StartTemplateHTTPExecution(context.Background(), "template-refresh-not-ready", app, "main", "scope")
	if err != nil {
		t.Fatal(err)
	}
	defer execution.Close()
	session, _ := util.BindableInteractiveSession(app, "main")
	if session == nil || util.IsSessionReady(session) {
		t.Fatal("fixture must be connected but not ready")
	}
	events := make(chan string, 4)
	go func() {
		for {
			var event struct {
				Cmd  string
				Data struct{ ConfirmID string }
			}
			if err := connection.ReadJSON(&event); err != nil {
				return
			}
			if event.Cmd == "templateHTTPConfirm" {
				events <- event.Data.ConfirmID
			}
		}
	}()
	results := make(chan map[string]any, 1)
	go func() { results <- execution.Runtime.Get("https://example.com/data") }()
	select {
	case <-events:
		t.Fatal("confirmation sent before UI readiness")
	case <-results:
		t.Fatal("request failed instead of waiting for readiness")
	case <-time.After(50 * time.Millisecond):
	}
	session.Set("uiReady", true)
	select {
	case id := <-events:
		if !RespondTemplateHTTP(execution.id, id, app, "main", false) {
			t.Fatal("ready window could not deny")
		}
	case <-time.After(time.Second):
		t.Fatal("readiness did not resume pending confirmation")
	}
	select {
	case result := <-results:
		if result["error"] != "denied" {
			t.Fatalf("unexpected result: %v", result)
		}
	case <-time.After(time.Second):
		t.Fatal("denial did not resume the original request")
	}
}

func TestTemplateHTTPRefreshReadinessWaitIsCanceledOnNotebookLock(t *testing.T) {
	_, app := templateHTTPTestWindow(t, true)
	execution, err := StartTemplateHTTPExecution(context.Background(), "template-refresh-lock", app, "main", "scope")
	if err != nil {
		t.Fatal(err)
	}
	defer execution.Close()
	results := make(chan map[string]any, 1)
	go func() { results <- execution.Runtime.Get("https://example.com/data") }()
	select {
	case <-results:
		t.Fatal("request did not wait for readiness")
	case <-time.After(50 * time.Millisecond):
	}
	cancelTemplateHTTPExecutions()
	select {
	case result := <-results:
		if result["error"] != "execution_ended" {
			t.Fatalf("canceled readiness escaped: %v", result)
		}
	case <-time.After(time.Second):
		t.Fatal("lock cancellation blocked on readiness")
	}
}
