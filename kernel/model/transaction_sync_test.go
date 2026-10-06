// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

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
	"github.com/siyuan-note/siyuan/kernel/util"
)

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
