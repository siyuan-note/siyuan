package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"
	"unsafe"

	"github.com/88250/lute/parse"
	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/olahol/melody"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// 复用真实 HTTP 事务的隔离工作区，验证完成等待、广播元数据及无关事务不会阻塞已完成批次。
func testAPIContractTransactionCompletion(t *testing.T, engine *gin.Engine, docID, paragraphID string) {
	t.Helper()
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
		"/?app=completion-observer&id=main&type=main", nil)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	defer connection.Close()
	select {
	case session := <-connected:
		defer util.RemovePushChan(session)
	case <-time.After(5 * time.Second):
		t.Fatal("transaction observer did not connect")
	}
	dom := func(content string) string {
		return fmt.Sprintf(`<div data-node-id="%s" data-type="NodeParagraph"><div contenteditable="true">%s</div></div>`, paragraphID, content)
	}
	completed := &model.Transaction{DoOperations: []*model.Operation{{Action: "plugin-completion-test"}}}
	if err = model.PerformTxSync(completed); err != nil {
		t.Fatal(err)
	}
	blocked := &model.Transaction{
		DoOperations:   []*model.Operation{{Action: "update", ID: paragraphID, Data: dom("Queued edit")}},
		UndoOperations: []*model.Operation{{Action: "update", ID: paragraphID, Data: dom("Original")}},
	}
	blocked.MarkFromAPI()
	writeStarted, allowWrite := make(chan struct{}), make(chan struct{})
	writeField := reflect.ValueOf(blocked).Elem().FieldByName("writeTransactionTree")
	reflect.NewAt(writeField.Type(), unsafe.Pointer(writeField.UnsafeAddr())).Elem().Set(reflect.ValueOf(func(tree *parse.Tree) error {
		close(writeStarted)
		<-allowWrite
		if _, err := filesys.WriteTree(tree); err != nil {
			return err
		}
		sql.UpsertTreeQueue(tree)
		return nil
	}))
	queued := []*model.Transaction{blocked}
	model.PerformTransactions(&queued)
	defer func() {
		select {
		case <-allowWrite:
		default:
			close(allowWrite)
		}
		model.FlushTxQueue()
	}()
	select {
	case <-writeStarted:
	case <-time.After(5 * time.Second):
		t.Fatal("queued transaction did not reach its write boundary")
	}
	completedPush := make(chan struct{})
	go func() {
		pushTransactions("completion-source", "source", []*model.Transaction{completed})
		close(completedPush)
	}()
	select {
	case <-completedPush:
	case <-time.After(5 * time.Second):
		t.Fatal("completed transaction broadcast waited for an unrelated queued transaction")
	}
	blockedPush := make(chan struct{})
	go func() {
		pushTransactions("completion-source", "source", queued)
		close(blockedPush)
	}()
	select {
	case <-blockedPush:
		t.Fatal("transaction broadcast returned before its write finished")
	case <-time.After(20 * time.Millisecond):
	}
	close(allowWrite)
	select {
	case <-blockedPush:
	case <-time.After(5 * time.Second):
		t.Fatal("completed queued transaction was not broadcast")
	}
	if err = connection.SetReadDeadline(time.Now().Add(5 * time.Second)); err != nil {
		t.Fatal(err)
	}
	for {
		var event struct {
			Cmd     string          `json:"cmd"`
			Data    json.RawMessage `json:"data"`
			Context struct {
				RootIDs   []string                   `json:"rootIDs"`
				UndoState map[string]map[string]bool `json:"undoState"`
			} `json:"context"`
		}
		if err = connection.ReadJSON(&event); err != nil {
			t.Fatal(err)
		}
		if event.Cmd != "transactions" {
			continue
		}
		var transactions []*model.Transaction
		if err = json.Unmarshal(event.Data, &transactions); err != nil {
			t.Fatal(err)
		}
		if len(transactions) != 1 || len(transactions[0].DoOperations) == 0 ||
			transactions[0].DoOperations[0].ID != paragraphID {
			continue
		}
		if len(event.Context.RootIDs) != 1 || event.Context.RootIDs[0] != docID || !event.Context.UndoState[docID]["canUndo"] {
			t.Fatalf("broadcast preceded committed document and undo metadata: %+v", event.Context)
		}
		break
	}
	body, err := json.Marshal(map[string]any{"transactions": []*model.Transaction{{
		DoOperations:   []*model.Operation{{Action: "update", ID: paragraphID, Data: dom("HTTP edit")}},
		UndoOperations: []*model.Operation{{Action: "update", ID: paragraphID, Data: dom("Queued edit")}},
	}}, "reqId": 456, "app": "contract", "session": "contract"})
	if err != nil {
		t.Fatal(err)
	}
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/api/transactions", strings.NewReader(string(body))))
	requireAPIContract(t, http.MethodPost, "/api/transactions", recorder)
	var result struct {
		Code int `json:"code"`
	}
	if err = json.Unmarshal(recorder.Body.Bytes(), &result); err != nil || result.Code != 0 {
		t.Fatalf("editing request failed: %s, %v", recorder.Body.String(), err)
	}
	tree, err := model.LoadTreeByBlockID(paragraphID)
	if err != nil || treenode.GetNodeInTree(tree, paragraphID).Text() != "HTTP edit" {
		t.Fatalf("editing response preceded persisted content: %v", err)
	}
	t.Logf("isolated editing request Server-Timing: %s", recorder.Header().Get("Server-Timing"))
}
