//go:build fts5

package model

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/88250/lute/parse"
	"github.com/gorilla/websocket"
	"github.com/olahol/melody"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestBlockCollectionBindingNotificationsFollowCommit(t *testing.T) {
	for _, fail := range []bool{false, true} {
		name := "commit"
		if fail {
			name = "rollback"
		}
		t.Run(name, func(t *testing.T) {
			fixture, _, _ := setupBlockCollectionTest(t)
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
				"/?app="+url.QueryEscape(t.Name())+"&id=observer&type=protyle", nil)
			if err != nil {
				t.Fatal(err)
			}
			response.Body.Close()
			defer connection.Close()
			select {
			case session := <-connected:
				defer util.RemovePushChan(session)
			case <-time.After(5 * time.Second):
				t.Fatal("collection observer did not connect")
			}
			countAttrs := func() int {
				t.Helper()
				if err := push.Broadcast([]byte(`{"cmd":"collection-notification-barrier"}`)); err != nil {
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
					if event.Cmd == "collection-notification-barrier" {
						return count
					}
					if event.Cmd != "transactions" {
						continue
					}
					var transactions []*Transaction
					if err := json.Unmarshal(event.Data, &transactions); err != nil {
						t.Fatal(err)
					}
					for _, tx := range transactions {
						for _, operation := range tx.DoOperations {
							if operation.Action == "updateAttrs" && operation.ID == fixture.sourceID {
								count++
							}
						}
					}
				}
			}
			tx := blockCollectionTags(t, fixture.sourceID, "todo")
			tx.writeTransactionTree = func(tree *parse.Tree) error {
				if count := countAttrs(); count != 0 {
					t.Errorf("binding was announced before commit: %d", count)
				}
				if fail {
					return errors.New("injected collection commit failure")
				}
				_, err := filesys.WriteTree(tree)
				return err
			}
			if err = PerformTxSync(tx); (err != nil) != fail {
				t.Fatalf("unexpected commit result: %v", err)
			}
			want := 1
			if fail {
				want = 0
			}
			if count := countAttrs(); count != want {
				t.Fatalf("binding notifications after %s: %d, want %d", name, count, want)
			}
		})
	}
}
