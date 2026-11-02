// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package util

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/olahol/melody"
)

func TestInteractiveSessionRequiresReadyPrivateMainWindow(t *testing.T) {
	hub := newNotificationTestHub(t)
	for _, id := range []string{"", "publish", "auth", "tree", "missing"} {
		if session, done := InteractiveSession(hub.first, id); session != nil || done != nil {
			t.Fatalf("accepted noninteractive %q", id)
		}
	}
	if session, _ := InteractiveSession("", "main"); session != nil {
		t.Fatal("accepted empty application")
	}
	session, done := InteractiveSession(hub.first, "main")
	if session != hub.clients[0].session || done == nil {
		t.Fatal("lost valid main window")
	}
	session.Set("uiReady", false)
	if found, _ := InteractiveSession(hub.first, "main"); found != nil {
		t.Fatal("accepted unready window")
	}
	session.Set("uiReady", true)
	RemovePushChan(session)
	select {
	case <-done:
	default:
		t.Fatal("disconnect did not terminate execution lifecycle")
	}
	RemovePushChan(session)
}

func TestBindableInteractiveSessionRejectsNoninteractiveWindows(t *testing.T) {
	hub := newNotificationTestHub(t)
	for _, id := range []string{"", "publish", "auth", "tree", "missing"} {
		if session, done := BindableInteractiveSession(hub.first, id); session != nil || done != nil {
			t.Fatalf("accepted noninteractive %q", id)
		}
	}
	if session, _ := BindableInteractiveSession("", "main"); session != nil {
		t.Fatal("accepted empty application")
	}
	session := hub.clients[0].session
	session.Set("uiReady", false)
	if found, done := BindableInteractiveSession(hub.first, "main"); found != session || done == nil {
		t.Fatal("could not bind initializing private main window")
	}
	if found, _ := InteractiveSession(hub.first, "main"); found != nil {
		t.Fatal("binding bypassed ready requirement")
	}
}

func TestWaitInteractiveSessionRequiresSameReadyConnection(t *testing.T) {
	for _, finish := range []string{"ready", "cancel", "disconnect", "replace", "deadline"} {
		t.Run(finish, func(t *testing.T) {
			hub := newNotificationTestHub(t)
			session := hub.clients[0].session
			session.Set("uiReady", false)
			ctx, cancel := context.WithTimeout(context.Background(), time.Second)
			defer cancel()
			result := make(chan bool, 1)
			go func() { result <- WaitInteractiveSession(ctx, hub.first, "main", session) }()
			select {
			case <-result:
				t.Fatal("returned before window ready or lifecycle ended")
			case <-time.After(30 * time.Millisecond):
			}
			switch finish {
			case "ready":
				session.Set("uiReady", true)
			case "cancel":
				cancel()
			case "disconnect":
				RemovePushChan(session)
			case "replace":
				apps, _ := sessions.Load(hub.first)
				apps.(*sync.Map).Store("main", hub.clients[1].session)
				t.Cleanup(func() { apps.(*sync.Map).Store("main", session) })
			case "deadline":
				// 请求期限结束时不能等待完整的界面就绪上限。
			}
			select {
			case ready := <-result:
				if ready != (finish == "ready") {
					t.Fatalf("unexpected result %v for %s", ready, finish)
				}
			case <-time.After(2 * time.Second):
				t.Fatal("did not end bounded readiness wait")
			}
		})
	}
}

func TestWaitInteractiveSessionRejectsInvalidExpectedConnection(t *testing.T) {
	hub := newNotificationTestHub(t)
	for _, expected := range []*melody.Session{nil, hub.clients[1].session} {
		if WaitInteractiveSession(context.Background(), hub.first, "main", expected) {
			t.Fatal("accepted a different or absent expected connection")
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if WaitInteractiveSession(ctx, hub.first, "main", hub.clients[0].session) {
		t.Fatal("accepted canceled request on ready connection")
	}
	if !WaitInteractiveSession(context.Background(), hub.first, "main", hub.clients[0].session) {
		t.Fatal("did not accept already ready connection")
	}
}

func TestWaitBindableInteractiveSessionCoversUpgradeBeforeRegistration(t *testing.T) {
	for _, cancelBeforeRegistration := range []bool{false, true} {
		t.Run(map[bool]string{false: "register", true: "cancel"}[cancelBeforeRegistration], func(t *testing.T) {
			app := strings.ReplaceAll(t.Name(), "/", "-")
			hub := melody.New()
			release := make(chan struct{})
			entered := make(chan struct{})
			registered := make(chan *melody.Session, 1)
			var releaseOnce sync.Once
			releaseConnect := func() { releaseOnce.Do(func() { close(release) }) }
			hub.HandleConnect(func(session *melody.Session) {
				close(entered)
				<-release
				AddPushChan(session)
				registered <- session
			})
			hub.HandleDisconnect(RemovePushChan)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _ = hub.HandleRequest(w, r) }))
			t.Cleanup(func() { releaseConnect(); hub.Close(); server.Close() })
			connection, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http")+"/ws?app="+app+"&id=main&type=main&ready=false", nil)
			if err != nil {
				t.Fatal(err)
			}
			defer connection.Close()
			<-entered
			if session, _ := BindableInteractiveSession(app, "main"); session != nil {
				t.Fatal("fixture registered before connect handler was released")
			}
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			results := make(chan *melody.Session, 1)
			go func() { session, _ := WaitBindableInteractiveSession(ctx, app, "main"); results <- session }()
			select {
			case <-results:
				t.Fatal("upgraded socket was rejected before registration")
			case <-time.After(30 * time.Millisecond):
			}
			if cancelBeforeRegistration {
				cancel()
				select {
				case session := <-results:
					if session != nil {
						t.Fatal("canceled request acquired a session")
					}
				case <-time.After(time.Second):
					t.Fatal("canceled registration wait blocked")
				}
				releaseConnect()
				<-registered
				if session, _ := WaitBindableInteractiveSession(ctx, app, "main"); session != nil {
					t.Fatal("later registration revived canceled request")
				}
			} else {
				releaseConnect()
				expected := <-registered
				select {
				case session := <-results:
					if session != expected {
						t.Fatal("did not bind the authenticated registered socket")
					}
				case <-time.After(time.Second):
					t.Fatal("registration did not resume binding")
				}
				if session, _ := InteractiveSession(app, "main"); session != nil {
					t.Fatal("registration bypassed UI readiness")
				}
			}
		})
	}
}

func TestWaitBindableInteractiveSessionRejectsRegisteredInvalidWindows(t *testing.T) {
	hub := newNotificationTestHub(t)
	for _, id := range []string{"publish", "auth", "tree"} {
		if session, done := WaitBindableInteractiveSession(context.Background(), hub.first, id); session != nil || done != nil {
			t.Fatalf("accepted invalid session %q", id)
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	if session, _ := WaitBindableInteractiveSession(ctx, hub.first, "missing"); session != nil {
		t.Fatal("accepted missing session")
	}
	if ctx.Err() == nil {
		t.Fatal("missing session was not bounded by request deadline")
	}
}
