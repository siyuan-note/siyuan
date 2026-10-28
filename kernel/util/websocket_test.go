// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package util

import (
	"fmt"
	"io"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/gorilla/websocket"
	"github.com/olahol/melody"
	"github.com/siyuan-note/eventbus"
	"github.com/siyuan-note/logging"
)

func TestPushChanReconnectPreservesCurrentSession(t *testing.T) {
	for _, auth := range []bool{false, true} {
		t.Run(fmt.Sprintf("auth=%t", auth), func(t *testing.T) {
			registry := &sessions
			if auth {
				registry = &authSessions
			}
			connect := func() *melody.Session {
				session := &melody.Session{Request: httptest.NewRequest("GET", "/ws?app=reconnect-test&id=main&type=main&ready=false", nil)}
				session.Set("authSession", auth)
				AddPushChan(session)
				t.Cleanup(func() { RemovePushChan(session) })
				return session
			}
			old := connect()
			old.Set("uiReady", true)
			current := connect()
			RemovePushChan(old)
			RemovePushChan(old)
			appSessions, ok := registry.Load("reconnect-test")
			if !ok {
				t.Fatal("late disconnect removed the reconnected application")
			}
			if got, _ := appSessions.(*sync.Map).Load("main"); got != current || IsSessionReady(current) {
				t.Fatal("late disconnect lost the current connection or reused its predecessor's readiness")
			}
			RemovePushChan(current)
			if _, ok := registry.Load("reconnect-test"); ok {
				t.Fatal("last disconnect retained the empty application")
			}
		})
	}
}

func TestPushChanConcurrentReconnect(t *testing.T) {
	for _, auth := range []bool{false, true} {
		t.Run(fmt.Sprintf("auth=%t", auth), func(t *testing.T) {
			registry := &sessions
			if auth {
				registry = &authSessions
			}
			for round := range 50 {
				appID := fmt.Sprintf("concurrent-reconnect-%t-%d", auth, round)
				connect := func(id int) *melody.Session {
					session := &melody.Session{Request: httptest.NewRequest("GET", fmt.Sprintf("/ws?app=%s&id=%d&type=main&ready=false", appID, id), nil)}
					session.Set("authSession", auth)
					AddPushChan(session)
					return session
				}
				old := connect(0)
				const count = 16
				current := make([]*melody.Session, count)
				start := make(chan struct{})
				var workers sync.WaitGroup
				workers.Go(func() { <-start; RemovePushChan(old) })
				for i := range current {
					workers.Go(func() { <-start; current[i] = connect(i) })
				}
				close(start)
				workers.Wait()
				appSessions, ok := registry.Load(appID)
				for i, session := range current {
					if !ok {
						t.Error("concurrent registration lost the application")
					} else if got, _ := appSessions.(*sync.Map).Load(fmt.Sprint(i)); got != session {
						t.Errorf("concurrent registration lost session %d", i)
					}
					RemovePushChan(session)
				}
				if _, ok := registry.Load(appID); ok {
					t.Error("disconnects retained an empty application")
				}
				if t.Failed() {
					return
				}
			}
		})
	}
}

func TestLogWebSocketError(t *testing.T) {
	originalPath := logging.LogPath
	t.Cleanup(func() { logging.SetLogPath(originalPath) })
	session := &melody.Session{}
	session.Set("app", "test-app")
	session.Set("id", "test-id")
	session.Set("type", "main")
	for _, test := range []struct {
		name string
		err  error
		want string
	}{
		{name: "normal closure", err: &websocket.CloseError{Code: websocket.CloseNormalClosure}},
		{name: "going away", err: &websocket.CloseError{Code: websocket.CloseGoingAway}},
		{name: "wrapped going away", err: fmt.Errorf("read: %w", &websocket.CloseError{Code: websocket.CloseGoingAway})},
		{name: "abnormal closure", err: &websocket.CloseError{Code: websocket.CloseAbnormalClosure}, want: "D "},
		{name: "protocol error", err: &websocket.CloseError{Code: websocket.CloseProtocolError}, want: "D "},
		{name: "read error", err: io.ErrUnexpectedEOF, want: "D "},
		{name: "buffer full", err: melody.ErrMessageBufferFull, want: "W "},
		{name: "wrapped buffer full", err: fmt.Errorf("write: %w", melody.ErrMessageBufferFull), want: "W "},
	} {
		t.Run(test.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "websocket.log")
			logging.SetLogPath(path)
			LogWebSocketError(session, "test-channel", test.err)
			data, err := os.ReadFile(path)
			if os.IsNotExist(err) && test.want == "" {
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if test.want == "" {
				t.Fatalf("normal closure logged as a failure: %s", data)
			}
			for _, text := range []string{test.want, `channel="test-channel", app=test-app, id=test-id, type=main`, test.err.Error()} {
				if !strings.Contains(string(data), text) {
					t.Fatalf("missing diagnostic %q: %s", text, data)
				}
			}
		})
	}
}

func TestContextPushMsgIgnoresInvalidContext(t *testing.T) {
	contexts := []map[string]any{
		nil,
		{},
		{eventbus.CtxPushMsg: nil},
		{eventbus.CtxPushMsg: "invalid"},
		{eventbus.CtxPushMsg: eventbus.CtxPushMsgToNone},
	}
	for _, context := range contexts {
		ContextPushMsg(context, "test")
	}
}

func TestIsPublishSession(t *testing.T) {
	tests := []struct {
		name      string
		value     any
		setValue  bool
		isPublish bool
	}{
		{name: "unset"},
		{name: "false", value: false, setValue: true},
		{name: "true", value: true, setValue: true, isPublish: true},
		{name: "non-boolean", value: "true", setValue: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			session := &melody.Session{}
			if test.setValue {
				session.Set("isPublish", test.value)
			}
			if actual := isPublishSession(session); actual != test.isPublish {
				t.Fatalf("isPublishSession() = %v, want %v", actual, test.isPublish)
			}
		})
	}
}

func TestSessionsByTypeExcludesPublishSession(t *testing.T) {
	const (
		appID       = "test-publish-session-filter"
		sessionType = "test-publish-session-type"
	)

	regularSession := &melody.Session{}
	regularSession.Set("type", sessionType)
	publishSession := &melody.Session{}
	publishSession.Set("type", sessionType)
	publishSession.Set("isPublish", true)

	appSessions := &sync.Map{}
	appSessions.Store("regular", regularSession)
	appSessions.Store("publish", publishSession)
	sessions.Store(appID, appSessions)
	t.Cleanup(func() {
		sessions.Delete(appID)
	})

	actual := SessionsByType(sessionType)
	if len(actual) != 1 || actual[0] != regularSession {
		t.Fatalf("SessionsByType() returned %d sessions, want only the regular session", len(actual))
	}

	publishActual := publishSessionsByType(sessionType)
	if len(publishActual) != 1 || publishActual[0] != publishSession {
		t.Fatalf("publishSessionsByType() returned %d sessions, want only the publish session", len(publishActual))
	}
}
