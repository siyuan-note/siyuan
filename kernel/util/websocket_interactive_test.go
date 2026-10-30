// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package util

import (
	"context"
	"sync"
	"testing"
	"time"

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
