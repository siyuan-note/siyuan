// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/olahol/melody"
	"github.com/siyuan-note/dejavu"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAutoSyncPauseExcludesCancellationAndPreparationRetry(t *testing.T) {
	previous := autoSyncErrCount.Load()
	t.Cleanup(func() { autoSyncErrCount.Store(previous) })
	autoSyncErrCount.Store(7)
	for range 10 {
		recordAutoSyncFailure(errors.Join(errors.New("network request stopped"), context.Canceled))
		recordAutoSyncFailure(dejavu.ErrIndexFileChanged)
	}
	if autoSyncErrCount.Load() != 7 {
		t.Fatal("user cancellation or active editing triggered automatic backoff")
	}
	recordAutoSyncFailure(errors.New("cloud unavailable"))
	if autoSyncErrCount.Load() != 8 {
		t.Fatal("real failures no longer reach the existing backoff threshold")
	}
}

func TestAutoSyncPauseNotificationAndStatus(t *testing.T) {
	prepareSyncDirectoryTest(t)
	previousErrors, previousNotice := autoSyncErrCount.Load(), autoSyncPauseNotice.messageID
	previousRetry := autoSyncPauseNotice.retryAt
	previousLangs, previousStatus := util.Langs, util.StatusBarCfg.Load()
	syncPlanTimeLock.Lock()
	previousPlan := syncPlanTime
	syncPlanTimeLock.Unlock()
	t.Cleanup(func() {
		autoSyncErrCount.Store(previousErrors)
		autoSyncPauseNotice.messageID = previousNotice
		autoSyncPauseNotice.retryAt = previousRetry
		util.Langs = previousLangs
		util.StatusBarCfg.Store(previousStatus)
		syncPlanTimeLock.Lock()
		syncPlanTime = previousPlan
		syncPlanTimeLock.Unlock()
	})
	autoSyncPauseNotice.messageID = ""
	autoSyncPauseNotice.retryAt = time.Time{}
	Conf.Lang = "en"
	util.Langs = map[string]map[int]string{"en": {125: "Auto sync paused; sync manually", 431: "Retry at %s"}}
	status := &util.StatusBar{}
	if previousStatus != nil {
		*status = *previousStatus
	}
	status.MsgDataSyncDisabled = false
	util.StatusBarCfg.Store(status)
	Conf.Sync.Load().Enabled, Conf.Sync.Load().Mode = true, 1
	Conf.SetUser(&conf.User{UserId: "sync-test", UserSiYuanOneTimePayStatus: 1})

	push := melody.New()
	connected := make(chan *melody.Session, 1)
	push.HandleConnect(func(session *melody.Session) {
		util.AddPushChan(session)
		connected <- session
	})
	push.HandleDisconnect(util.RemovePushChan)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = push.HandleRequest(w, r)
	}))
	t.Cleanup(func() { _ = push.Close(); server.Close() })
	connection, response, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http")+
		"/?app="+url.QueryEscape(t.TempDir())+"&id=main&type=main", nil)
	if err != nil {
		t.Fatal(err)
	}
	_ = response.Body.Close()
	select {
	case session := <-connected:
		t.Cleanup(func() { _ = connection.Close(); util.RemovePushChan(session) })
	case <-time.After(5 * time.Second):
		t.Fatal("websocket registration timed out")
	}
	type event struct {
		Cmd  string
		Msg  string
		Data struct{ ID string }
	}
	readEvents := func() []event {
		t.Helper()
		if err := push.Broadcast([]byte(`{"cmd":"barrier"}`)); err != nil {
			t.Fatal(err)
		}
		_ = connection.SetReadDeadline(time.Now().Add(5 * time.Second))
		var events []event
		for {
			var envelope struct {
				Cmd  string
				Msg  string
				Data json.RawMessage
			}
			if err := connection.ReadJSON(&envelope); err != nil {
				t.Fatal(err)
			}
			if envelope.Cmd == "barrier" {
				return events
			}
			if envelope.Cmd == "msg" || envelope.Cmd == "statusbar" || envelope.Cmd == "cmsg" {
				item := event{Cmd: envelope.Cmd, Msg: envelope.Msg}
				if err := json.Unmarshal(envelope.Data, &item.Data); err != nil {
					t.Fatalf("decode %s notification: %v", envelope.Cmd, err)
				}
				events = append(events, item)
			}
		}
	}
	// 非通知事件可以携带标量或数组，过滤命令后才解析通知的对象载荷。
	for _, frame := range []string{`{"cmd":"syncing","data":true}`, `{"cmd":"progress","data":"waiting"}`, `{"cmd":"transactions","data":[]}`} {
		if err := push.Broadcast([]byte(frame)); err != nil {
			t.Fatal(err)
		}
	}
	autoSyncErrCount.Store(7)
	if !checkSync(false, false, false) || len(readEvents()) != 0 {
		t.Fatal("backoff began before the existing threshold")
	}
	autoSyncErrCount.Add(1)
	if checkSync(false, false, false) || !strings.HasPrefix(Conf.Sync.Load().Stat, Conf.Language(125)+" Retry at ") {
		t.Fatal("paused sync has no persistent status")
	}
	events := readEvents()
	if len(events) != 2 || events[0].Cmd != "statusbar" || events[1].Cmd != "msg" {
		t.Fatalf("first pause notifications: %+v", events)
	}
	messageID := events[1].Data.ID
	retryAt := autoSyncPauseNotice.retryAt
	if time.Until(retryAt) < 63*time.Minute || !strings.Contains(Conf.Sync.Load().Stat, retryAt.Format("15:04:05")) {
		t.Fatal("missing real retry time")
	}
	var group sync.WaitGroup
	for range 32 {
		group.Go(func() {
			if checkSync(false, false, false) {
				t.Error("concurrent automatic sync escaped backoff")
			}
		})
	}
	group.Wait()
	if autoSyncPauseNotice.retryAt != retryAt {
		t.Fatal("repeated checks extended the retry delay")
	}
	if events = readEvents(); len(events) != 0 {
		t.Fatalf("pause was announced repeatedly: %+v", events)
	}
	if !checkSync(false, false, true) || !checkSync(false, true, false) || autoSyncErrCount.Load() != 8 {
		t.Fatal("backoff changed manual/exit sync or failure accounting")
	}
	UpdateSyncConf(func(s *conf.Sync) { s.Stat = "DNS failed again" })
	checkSync(false, false, false)
	if events = readEvents(); len(events) != 1 || events[0].Cmd != "statusbar" {
		t.Fatalf("pause status after a failed manual attempt: %+v", events)
	}
	UpdateSyncConf(func(s *conf.Sync) { s.Stat = "Sync succeeded" })
	resetAutoSyncErrors()
	if events = readEvents(); len(events) != 1 || events[0].Cmd != "cmsg" || events[0].Data.ID != messageID {
		t.Fatalf("successful sync did not clear its pause notice: %+v", events)
	}
	if !checkSync(false, false, false) || autoSyncErrCount.Load() != 0 || Conf.Sync.Load().Stat != "Sync succeeded" {
		t.Fatal("successful sync did not restore the normal state")
	}
	autoSyncErrCount.Store(8)
	checkSync(false, false, false)
	if events = readEvents(); len(events) != 2 || events[1].Data.ID == messageID {
		t.Fatalf("a new failure episode was not announced: %+v", events)
	}
	resetAutoSyncErrors()
	readEvents()
	status.MsgDataSyncDisabled = true
	util.StatusBarCfg.Store(status)
	autoSyncErrCount.Store(8)
	UpdateSyncConf(func(s *conf.Sync) { s.Stat = "DNS failed" })
	checkSync(false, false, false)
	if events = readEvents(); len(events) != 1 || events[0].Cmd != "msg" || !strings.HasPrefix(Conf.Sync.Load().Stat, Conf.Language(125)+" Retry at ") {
		t.Fatalf("disabled status bar lost sync status or received a status message: %+v", events)
	}
	autoSyncPauseNotice.retryAt = time.Now().Add(-time.Second)
	if !checkSync(false, false, false) || autoSyncErrCount.Load() != 7 {
		t.Fatal("automatic retry was blocked after the deadline")
	}
	readEvents()
	autoSyncErrCount.Add(1)
	if checkSync(false, false, false) || time.Until(autoSyncPauseNotice.retryAt) < 63*time.Minute {
		t.Fatal("failed retry did not start a fresh backoff")
	}
	readEvents()
}
