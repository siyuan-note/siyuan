package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/olahol/melody"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// 使用真实自动收集事务和多个会话，验证发起方保留本地正文，其他客户端最终收到绑定属性。
func testAutomationCollectionBroadcast(t *testing.T, fixture *attributeViewContextFilterAPIFixture) {
	t.Helper()
	push := melody.New()
	connected := make(chan *melody.Session, 3)
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
	clients := map[string]*websocket.Conn{}
	for _, id := range []string{"source", "desktop", "mobile"} {
		connection, response, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http")+
			"/?app=automation-broadcast&id="+id+"&type=protyle", nil)
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		defer connection.Close()
		select {
		case session := <-connected:
			defer util.RemovePushChan(session)
		case <-time.After(5 * time.Second):
			t.Fatal("automation observer did not connect")
		}
		clients[id] = connection
	}
	dom := func(content string) string {
		return fmt.Sprintf(`<div data-node-id="%s" data-type="NodeParagraph"><div contenteditable="true">%s</div></div>`, fixture.paragraphID, content)
	}
	tx := &model.Transaction{
		DoOperations: []*model.Operation{{Action: "update", ID: fixture.paragraphID,
			Data: dom(`Source <span data-type="tag">collect</span>`)}},
		UndoOperations: []*model.Operation{{Action: "update", ID: fixture.paragraphID, Data: dom("not a database")}},
	}
	tx.MarkFromAPI()
	if err := model.PerformTxSync(tx); err != nil {
		t.Fatal(err)
	}
	defer func() {
		undo := &model.Transaction{DoOperations: tx.UndoOperations}
		undo.MarkReplay()
		if err := model.PerformTxSync(undo); err != nil {
			t.Error(err)
		}
	}()
	if shouldBroadcastAttrViewTransactions([]*model.Transaction{tx}) {
		t.Error("automatic collection would replay the source edit in its initiating editor")
	}
	contracts, err := transactionContracts([]*model.Transaction{tx})
	if err != nil || len(contracts) != 1 {
		t.Fatalf("transaction contract conversion failed: %v", err)
	}
	pushTransactions("automation-broadcast", "source", []*model.Transaction{tx})
	if err = push.Broadcast([]byte(`{"cmd":"automation-broadcast-barrier"}`)); err != nil {
		t.Fatal(err)
	}
	for id, connection := range clients {
		if err = connection.SetReadDeadline(time.Now().Add(5 * time.Second)); err != nil {
			t.Fatal(err)
		}
		var operations []*model.Operation
		for {
			var event struct {
				Cmd  string
				Data json.RawMessage
			}
			if err = connection.ReadJSON(&event); err != nil {
				t.Fatal(err)
			}
			if event.Cmd == "automation-broadcast-barrier" {
				break
			}
			if event.Cmd == "transactions" {
				var transactions []*model.Transaction
				if err = json.Unmarshal(event.Data, &transactions); err != nil {
					t.Fatal(err)
				}
				for _, transaction := range transactions {
					operations = append(operations, transaction.DoOperations...)
				}
			}
		}
		var sourceUpdates int
		var finalAttrs map[string]any
		var collected bool
		for _, operation := range operations {
			if operation.Action == "update" && operation.ID == fixture.paragraphID {
				sourceUpdates++
				finalAttrs = nil
			}
			if operation.Action == "insertAttrViewBlock" && operation.AvID == fixture.attrView.ID {
				collected = true
			}
			if operation.Action == "updateAttrs" && operation.ID == fixture.paragraphID {
				finalAttrs = operation.Data.(map[string]any)["new"].(map[string]any)
			}
		}
		wantUpdates := 1
		if id == "source" {
			wantUpdates = 0
		}
		if sourceUpdates != wantUpdates || !collected || finalAttrs[av.NodeAttrNameAvs] != fixture.attrView.ID ||
			finalAttrs[av.NodeAttrViewNames] == nil || finalAttrs[av.NodeAttrViewNames] == "" {
			t.Errorf("%s: source updates=%d, collected=%v, final binding=%v", id, sourceUpdates, collected, finalAttrs)
		}
	}
}
