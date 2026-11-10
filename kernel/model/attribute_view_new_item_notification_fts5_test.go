// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/gorilla/websocket"
	"github.com/olahol/melody"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAttributeViewHiddenDocumentCreationNotifications(t *testing.T) {
	for _, hidden := range []bool{false, true} {
		name := "visible"
		if hidden {
			name = "hidden"
		}
		t.Run(name, func(t *testing.T) {
			fixture := setupTemplateDocTreeTransactionTest(t)
			database := addTemplateAttributeViewTestFixture(t, fixture, ast.NewNodeID())
			itemTemplate := &av.NewItemTemplate{ID: ast.NewNodeID(), Name: "Entry", TargetType: av.NewItemTargetDocument,
				HideInFileTree: hidden, OpenAfterCreate: new(true)}
			database.attrView.NewItemTemplates = []*av.NewItemTemplate{itemTemplate}
			if err := av.SaveAttributeView(database.attrView); err != nil {
				t.Fatal(err)
			}
			push := melody.New()
			connected := make(chan *melody.Session, 1)
			push.HandleConnect(func(session *melody.Session) {
				util.AddPushChan(session)
				connected <- session
			})
			push.HandleDisconnect(util.RemovePushChan)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
				_ = push.HandleRequest(w, request)
			}))
			defer server.Close()
			defer push.Close()
			connection, response, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http")+
				"/?app="+url.QueryEscape(t.Name())+"&id=main&type=main", nil)
			if err != nil {
				t.Fatal(err)
			}
			response.Body.Close()
			defer connection.Close()
			select {
			case session := <-connected:
				defer util.RemovePushChan(session)
			case <-time.After(5 * time.Second):
				t.Fatal("document creation observer did not connect")
			}
			checkCreates := func(docPath string, wantLocate bool) {
				t.Helper()
				if err := push.Broadcast([]byte(`{"cmd":"document-create-barrier"}`)); err != nil {
					t.Fatal(err)
				}
				if err := connection.SetReadDeadline(time.Now().Add(5 * time.Second)); err != nil {
					t.Fatal(err)
				}
				count := 0
				for {
					var event struct {
						Cmd  string
						Data json.RawMessage
					}
					if err := connection.ReadJSON(&event); err != nil {
						t.Fatal(err)
					}
					if event.Cmd == "document-create-barrier" {
						if count != 1 {
							t.Fatalf("received %d document create notifications, want 1", count)
						}
						return
					}
					if event.Cmd != "create" {
						continue
					}
					var data struct {
						Path        string
						ListDocTree bool
					}
					if err := json.Unmarshal(event.Data, &data); err != nil {
						t.Fatal(err)
					}
					if data.Path == docPath {
						count++
						if data.ListDocTree != wantLocate {
							t.Fatalf("document tree location requested: %v, want %v", data.ListDocTree, wantLocate)
						}
					}
				}
			}
			created, err := CreateAttributeViewItem(database.attrView.ID, database.nodes[0].ID,
				database.attrView.Views[0].ID, itemTemplate.ID, "", "")
			if err != nil {
				t.Fatal(err)
			}
			tree, err := LoadTreeByBlockID(created.BlockID)
			if err != nil {
				t.Fatal(err)
			}
			if (tree.Root.IALAttr(DocHiddenAttr) == "true") != hidden {
				t.Fatal("created document did not preserve its template visibility")
			}
			checkCreates(tree.Path, false)
			for range 2 {
				if err = PerformTxSync(&Transaction{DoOperations: created.Transaction.UndoOperations, isReplay: true}); err != nil {
					t.Fatal(err)
				}
				if err = PerformTxSync(&Transaction{DoOperations: created.Transaction.DoOperations, isReplay: true}); err != nil {
					t.Fatal(err)
				}
				checkCreates(tree.Path, !hidden)
			}
			if err = PerformTxSync(&Transaction{DoOperations: created.Transaction.UndoOperations, isReplay: true}); err != nil {
				t.Fatal(err)
			}
			if err = (&Transaction{}).compensateCreatedDocCommit([]*parse.Tree{tree}); err != nil {
				t.Fatal(err)
			}
			checkCreates(tree.Path, !hidden)
		})
	}
}
