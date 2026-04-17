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
	"time"

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
	if err := p.writeWebSocketMessage(serverConn, data); err != nil {
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
	if err := p.writeWebSocketMessage(conn, []byte(`{}`)); err != nil {
		t.Errorf("expected nil for untracked conn, got: %v", err)
	}
}

func TestBroadcastNotification(t *testing.T) {
	// Two server connections and one client connection.
	// BroadcastNotification must deliver to both server conns and skip the client conn.
	serverConn1, clientConn1 := newTestWsPair(t)
	serverConn2, clientConn2 := newTestWsPair(t)
	serverConn3, clientConn3 := newTestWsPair(t) // tracked as client (isServer=false)
	defer serverConn1.Close()
	defer clientConn1.Close()
	defer serverConn2.Close()
	defer clientConn2.Close()
	defer serverConn3.Close()
	defer clientConn3.Close()

	petal := &model.Petal{Name: "test-broadcast", Kernel: &model.KernelPetal{JS: ``}}
	p := NewKernelPlugin(petal)
	p.TrackSocket(serverConn1, true)
	p.TrackSocket(serverConn2, true)
	p.TrackSocket(serverConn3, false) // outbound — must NOT receive broadcast

	p.BroadcastNotification("ping", map[string]any{"seq": 1})

	readOne := func(c *websocket.Conn) (map[string]any, error) {
		c.SetReadDeadline(time.Now().Add(2 * time.Second))
		_, msg, err := c.ReadMessage()
		if err != nil {
			return nil, err
		}
		var out map[string]any
		return out, json.Unmarshal(msg, &out)
	}

	for i, c := range []*websocket.Conn{clientConn1, clientConn2} {
		got, err := readOne(c)
		if err != nil {
			t.Fatalf("server conn %d: read: %v", i+1, err)
		}
		if got["method"] != "ping" {
			t.Errorf("server conn %d: want method=ping, got %v", i+1, got["method"])
		}
		if got["jsonrpc"] != "2.0" {
			t.Errorf("server conn %d: want jsonrpc=2.0, got %v", i+1, got["jsonrpc"])
		}
	}

	// clientConn3's server side (serverConn3) is tracked as isServer=false — must NOT receive broadcast
	clientConn3.SetReadDeadline(time.Now().Add(200 * time.Millisecond))
	if _, _, err := clientConn3.ReadMessage(); err == nil {
		t.Error("outbound client conn should not have received broadcast")
	}
}
