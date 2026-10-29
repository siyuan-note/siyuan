// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/olahol/melody"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestTransactionTreeLoadErrorPush(t *testing.T) {
	fixture := setupStructureTransactionTest(t)
	path := filepath.Join(util.DataDir, fixture.box.ID, fixture.sourcePath)
	if err := os.WriteFile(path, []byte(`{"Spec":`), 0600); err != nil {
		t.Fatal(err)
	}
	cache.RemoveTreeDataInBox(fixture.sourceID, fixture.box.ID)
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
	endpoint := "ws" + strings.TrimPrefix(server.URL, "http") + "/?app=" + url.QueryEscape(t.TempDir()) + "&id=main&type=main"
	connection, response, err := websocket.DefaultDialer.Dial(endpoint, nil)
	if err != nil {
		t.Fatal(err)
	}
	_ = response.Body.Close()
	select {
	case session := <-connected:
		t.Cleanup(func() { _ = connection.Close(); util.RemovePushChan(session) })
	case <-time.After(5 * time.Second):
		_ = connection.Close()
		t.Fatal("websocket registration timed out")
	}
	tx := &Transaction{DoOperations: []*Operation{{Action: "update", ID: fixture.childID, Data: "<div>updated</div>"}}}
	if err = PerformTransactionSync(tx); err == nil || !strings.Contains(err.Error(), "unexpected end of JSON input") {
		t.Fatalf("transaction did not report parse failure: %v", err)
	}
	if err = connection.SetReadDeadline(time.Now().Add(5 * time.Second)); err != nil {
		t.Fatal(err)
	}
	var event struct {
		Cmd, Msg string
		Code     int
	}
	if err = connection.ReadJSON(&event); err != nil {
		t.Fatal(err)
	}
	if event.Cmd != "txerr" || event.Code != TxErrCodePushMsg || !strings.Contains(event.Msg, "unexpected end of JSON input") || strings.Contains(event.Msg, "block not found") {
		t.Fatalf("frontend error lost its cause: %+v", event)
	}
}

func TestPerformTransactionSyncReturnsTransactionError(t *testing.T) {
	for _, mode := range []string{"sync", "queue"} {
		t.Run(mode, func(t *testing.T) {
			fixture := setupStructureTransactionTest(t)
			listID, itemID := addOrderedListForStructureTest(t, fixture.sourceID)
			path := filepath.Join(util.DataDir, fixture.box.ID, fixture.sourcePath)
			before, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
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
			endpoint := "ws" + strings.TrimPrefix(server.URL, "http") + "/?app=" +
				url.QueryEscape(t.TempDir()) + "&id=main&type=main"
			connection, response, err := websocket.DefaultDialer.Dial(endpoint, nil)
			if err != nil {
				t.Fatal(err)
			}
			_ = response.Body.Close()
			select {
			case session := <-connected:
				t.Cleanup(func() { _ = connection.Close(); util.RemovePushChan(session) })
			case <-time.After(5 * time.Second):
				_ = connection.Close()
				t.Fatal("websocket registration timed out")
			}
			tx := &Transaction{DoOperations: []*Operation{{
				Action: "move", ID: itemID, PreviousID: listID, ParentID: fixture.sourceID,
			}}}
			if mode == "sync" {
				requireStructureTransactionError(t, PerformTransactionSync(tx))
			} else {
				queued := []*Transaction{tx}
				PerformTransactions(&queued)
				FlushTxQueue()
			}
			if err = push.Broadcast([]byte(`{"cmd":"barrier"}`)); err != nil {
				t.Fatal(err)
			}
			if err = connection.SetReadDeadline(time.Now().Add(5 * time.Second)); err != nil {
				t.Fatal(err)
			}
			reloads := 0
			for {
				var event struct{ Cmd string }
				if err = connection.ReadJSON(&event); err != nil {
					t.Fatal(err)
				}
				if event.Cmd == "barrier" {
					break
				}
				if event.Cmd == "reloadui" {
					reloads++
				}
			}
			if reloads != 1 {
				t.Fatalf("expected one reload notification, got %d", reloads)
			}
			after, err := os.ReadFile(path)
			if err != nil || !bytes.Equal(before, after) {
				t.Fatalf("rejected move changed the persisted document: %v", err)
			}
		})
	}
}

func TestPerformTransactionSyncPreservesSkippedMove(t *testing.T) {
	fixture := setupStructureTransactionTest(t)
	path := filepath.Join(util.DataDir, fixture.box.ID, fixture.sourcePath)
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if err = PerformTransactionSync(&Transaction{DoOperations: []*Operation{{
		Action: "move", ID: fixture.childID, PreviousID: fixture.childID,
	}}}); err != nil {
		t.Fatalf("self move must remain a successful no-op: %v", err)
	}
	after, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(before, after) {
		t.Fatalf("self move changed the persisted document: %v", err)
	}
}
