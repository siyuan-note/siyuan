// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package plugin

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gorilla/websocket"
	"github.com/siyuan-note/siyuan/kernel/model"
)

func newTestWsPair(t *testing.T) (serverConn *websocket.Conn, clientConn *websocket.Conn) {
	t.Helper()
	upgrader := websocket.Upgrader{CheckOrigin: func(r *http.Request) bool { return true }}
	serverCh := make(chan *websocket.Conn, 1)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			t.Errorf("upgrade: %v", err)
			return
		}
		serverCh <- conn
	}))
	t.Cleanup(srv.Close)

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http")
	clientConn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	serverConn = <-serverCh
	return
}

func TestWsWrite(t *testing.T) {
	serverConn, clientConn := newTestWsPair(t)
	defer serverConn.Close()
	defer clientConn.Close()

	petal := &model.Petal{Name: "test-wswrite", Kernel: &model.KernelPetal{JS: ``}}
	p := NewKernelPlugin(petal)
	p.TrackSocket(serverConn, true)

	data := []byte(`{"jsonrpc":"2.0","method":"test","params":null}`)
	if err := p.wsWrite(serverConn, data); err != nil {
		t.Fatalf("wsWrite: %v", err)
	}

	_, msg, err := clientConn.ReadMessage()
	if err != nil {
		t.Fatalf("client read: %v", err)
	}
	if string(msg) != string(data) {
		t.Errorf("want %s, got %s", data, msg)
	}
}

func TestWsWriteUntracked(t *testing.T) {
	petal := &model.Petal{Name: "test-wswrite-untracked", Kernel: &model.KernelPetal{JS: ``}}
	p := NewKernelPlugin(petal)
	conn := &websocket.Conn{}
	if err := p.wsWrite(conn, []byte(`{}`)); err != nil {
		t.Errorf("expected nil for untracked conn, got: %v", err)
	}
}

func TestPushNotificationOmitempty(t *testing.T) {
	serverConn, clientConn := newTestWsPair(t)
	defer serverConn.Close()
	defer clientConn.Close()

	if err := PushNotification(serverConn, "test", nil); err != nil {
		t.Fatalf("PushNotification: %v", err)
	}

	_, msg, err := clientConn.ReadMessage()
	if err != nil {
		t.Fatalf("read: %v", err)
	}

	var result map[string]any
	if err := json.Unmarshal(msg, &result); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if _, ok := result["params"]; ok {
		t.Errorf("expected params to be omitted, got: %s", msg)
	}
}
