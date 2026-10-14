package api

import (
	"github.com/gorilla/websocket"
	"github.com/olahol/melody"
	"github.com/siyuan-note/siyuan/kernel/util"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/model"
)

func TestBacklinkRequestNotifierSuppressesReadOnly(t *testing.T) {
	for _, role := range []model.Role{model.RoleReader, model.RoleVisitor, model.RoleAdministrator, model.RoleEditor} {
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest("POST", "/api/ref/getBacklink2", nil)
		c.Request.Header.Set(siyuanAppIDHeader, "administrator-window")
		c.Set(model.RoleContextKey, role)
		if got := backlinkRequestNotifier(c); (got == nil) != model.IsReadOnlyRole(role) {
			t.Fatalf("role %d notification suppression mismatch", role)
		}
	}
	if backlinkRequestNotifier(nil) != nil {
		t.Fatal("missing request context must not notify an administrator")
	}
}

func TestBacklinkRequestNotifierCapturesApp(t *testing.T) {
	push := melody.New()
	connected := make(chan *melody.Session, 1)
	push.HandleConnect(func(session *melody.Session) {
		util.AddPushChan(session)
		connected <- session
	})
	push.HandleDisconnect(util.RemovePushChan)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _ = push.HandleRequest(w, r) }))
	t.Cleanup(func() { _ = push.Close(); server.Close() })
	var connections []*websocket.Conn
	for _, app := range []string{"backlink-notification-first", "backlink-notification-second"} {
		connection, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http")+"/?app="+app+"&id=main&type=main", nil)
		if err != nil {
			t.Fatal(err)
		}
		select {
		case session := <-connected:
			t.Cleanup(func() { _ = connection.Close(); util.RemovePushChan(session) })
		case <-time.After(5 * time.Second):
			_ = connection.Close()
			t.Fatal("websocket registration timed out")
		}
		connections = append(connections, connection)
	}
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest("POST", "/api/ref/getBacklink2", nil)
	c.Set(model.RoleContextKey, model.RoleAdministrator)
	c.Request.Header.Set(siyuanAppIDHeader, "backlink-notification-first")
	notify := backlinkRequestNotifier(c)
	c.Request.Header.Set(siyuanAppIDHeader, "backlink-notification-second")
	notify("scoped warning", 5000)
	if err := push.Broadcast([]byte(`{"cmd":"barrier"}`)); err != nil {
		t.Fatal(err)
	}
	for i, connection := range connections {
		if err := connection.SetReadDeadline(time.Now().Add(5 * time.Second)); err != nil {
			t.Fatal(err)
		}
		messages := 0
		for {
			var event struct {
				Cmd string
				Msg string
			}
			if err := connection.ReadJSON(&event); err != nil {
				t.Fatal(err)
			}
			if event.Cmd == "barrier" {
				break
			}
			if event.Cmd == "msg" && event.Msg == "scoped warning" {
				messages++
			}
		}
		want := 0
		if i == 0 {
			want = 1
		}
		if messages != want {
			t.Fatalf("window %d received %d warnings, want %d", i, messages, want)
		}
	}
}
