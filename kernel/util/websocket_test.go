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

package util

import (
	"fmt"
	"io"
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
