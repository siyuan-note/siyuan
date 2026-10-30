// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package util

import "testing"

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
