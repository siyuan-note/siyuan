// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package cmd

import (
	"net/http/httptest"
	"testing"

	"github.com/olahol/melody"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestReadyIsScopedToCurrentMainConnection(t *testing.T) {
	connect := func(query string) *melody.Session {
		session := &melody.Session{Request: httptest.NewRequest("GET", "/ws?app=ready-test&"+query, nil)}
		util.AddPushChan(session)
		t.Cleanup(func() { util.RemovePushChan(session) })
		return session
	}
	first := connect("id=first&type=main&ready=false")
	second := connect("id=second&type=main&ready=false")
	legacy := connect("id=legacy&type=main")
	if util.IsSessionReady(first) || util.IsSessionReady(second) || !util.IsSessionReady(legacy) {
		t.Fatal("new and legacy readiness defaults are incorrect")
	}
	command := NewCommand("ready", 1, map[string]any{}, first)
	if command == nil || !command.IsRead() {
		t.Fatal("readiness must be available to every main window")
	}
	command.Exec()
	command.Exec()
	if !util.IsSessionReady(first) || util.IsSessionReady(second) {
		t.Fatal("readiness was not idempotent or leaked across windows")
	}
	util.RemovePushChan(first)
	reloaded := connect("id=first&type=main&ready=false")
	if util.IsSessionReady(reloaded) {
		t.Fatal("reload reused the previous connection's readiness")
	}
	dock := connect("id=dock&type=filetree")
	NewCommand("ready", 1, map[string]any{}, dock).Exec()
	if _, exists := dock.Get("uiReady"); exists {
		t.Fatal("a non-main connection changed UI readiness")
	}
}
