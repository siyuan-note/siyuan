package server

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/olahol/melody"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestWebSocketRejectsMalformedMessages(t *testing.T) {
	server := melody.New()
	defer server.Close()
	server.HandleConnect(func(s *melody.Session) {
		s.Set("app", "test")
		s.Set("id", "test")
	})
	server.HandleMessage(handleWebSocketMessage)
	httpServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := server.HandleRequest(w, r); err != nil {
			t.Error(err)
		}
	}))
	defer httpServer.Close()
	connection, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(httpServer.URL, "http"), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Close()
	for _, message := range []string{
		`{`, `{}`, `null`, `[]`,
		`{"reqId":1,"param":{}}`, `{"cmd":"ping","param":{}}`, `{"cmd":"ping","reqId":1}`,
		`{"cmd":1,"reqId":1,"param":{}}`, `{"cmd":"ping","reqId":"1","param":{}}`,
		`{"cmd":"ping","reqId":1,"param":null}`, `{"cmd":"ping","reqId":1,"param":[]}`,
		`{"cmd":"ping","reqId":1,"param":{"pushMode":"invalid"}}`,
	} {
		if err = connection.WriteMessage(websocket.TextMessage, []byte(message)); err != nil {
			t.Fatal(err)
		}
		connection.SetReadDeadline(time.Now().Add(5 * time.Second))
		var result util.Result
		if err = connection.ReadJSON(&result); err != nil {
			t.Fatalf("read response to %s: %v", message, err)
		}
		if result.Code != -1 || result.Msg != "Bad Request" {
			t.Fatalf("unexpected response to %s: %#v", message, result)
		}
	}
	if err = connection.WriteMessage(websocket.TextMessage, []byte(`{"cmd":"unknown","reqId":1,"param":{}}`)); err != nil {
		t.Fatal(err)
	}
	var result util.Result
	if err = connection.ReadJSON(&result); err != nil {
		t.Fatal(err)
	}
	if result.Msg != "can not find command [unknown]" {
		t.Fatalf("valid message handling changed: %#v", result)
	}
}
