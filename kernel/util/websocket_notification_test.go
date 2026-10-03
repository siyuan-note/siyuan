package util

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/olahol/melody"
)

type notificationTestEvent struct {
	Cmd  string
	Code int
	Msg  string
	Data struct {
		ID           string
		CloseTimeout int
	}
}

type notificationTestClient struct {
	connection *websocket.Conn
	session    *melody.Session
}

type notificationTestHub struct {
	push    *melody.Melody
	clients []notificationTestClient
	first   string
	second  string
}

func newNotificationTestHub(t *testing.T) *notificationTestHub {
	t.Helper()
	hub := &notificationTestHub{push: melody.New(), first: t.TempDir() + "-first", second: t.TempDir() + "-second"}
	connected := make(chan *melody.Session, 1)
	hub.push.HandleConnect(func(session *melody.Session) {
		query := session.Request.URL.Query()
		if query.Get("publish") == "true" {
			session.Set("isPublish", true)
		}
		if query.Get("auth") == "true" {
			session.Set("authSession", true)
		}
		AddPushChan(session)
		connected <- session
	})
	hub.push.HandleDisconnect(RemovePushChan)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = hub.push.HandleRequest(w, r)
	}))
	t.Cleanup(func() {
		for _, client := range hub.clients {
			_ = client.connection.Close()
			RemovePushChan(client.session)
		}
		_ = hub.push.Close()
		server.Close()
	})
	for _, query := range []string{
		"app=" + url.QueryEscape(hub.first) + "&id=main&type=main",
		"app=" + url.QueryEscape(hub.second) + "&id=main&type=main",
		"app=" + url.QueryEscape(hub.first) + "&id=publish&type=main&publish=true",
		"app=" + url.QueryEscape(hub.first) + "&id=auth&type=main&auth=true",
		"app=" + url.QueryEscape(hub.first) + "&id=tree&type=filetree",
	} {
		connection, response, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http")+"/ws?"+query, nil)
		if err != nil {
			t.Fatal(err)
		}
		_ = response.Body.Close()
		select {
		case session := <-connected:
			hub.clients = append(hub.clients, notificationTestClient{connection: connection, session: session})
		case <-time.After(5 * time.Second):
			_ = connection.Close()
			t.Fatal("notification connection was not registered")
		}
	}
	return hub
}

func (hub *notificationTestHub) readEvents(t *testing.T) [][]notificationTestEvent {
	t.Helper()
	// 屏障与提示进入同一连接队列，无需等待超时来断言未收到提示。
	if err := hub.push.Broadcast([]byte(`{"cmd":"notification-test-barrier"}`)); err != nil {
		t.Fatal(err)
	}
	result := make([][]notificationTestEvent, len(hub.clients))
	for i, client := range hub.clients {
		if err := client.connection.SetReadDeadline(time.Now().Add(5 * time.Second)); err != nil {
			t.Fatal(err)
		}
		for {
			var event notificationTestEvent
			if err := client.connection.ReadJSON(&event); err != nil {
				t.Fatal(err)
			}
			if event.Cmd == "notification-test-barrier" {
				break
			}
			result[i] = append(result[i], event)
		}
	}
	return result
}

func notificationEvent(cmd string, code int, msg, id string, timeout int) notificationTestEvent {
	event := notificationTestEvent{Cmd: cmd, Code: code, Msg: msg}
	event.Data.ID = id
	event.Data.CloseTimeout = timeout
	return event
}

func TestNotificationAppScopeLifecycle(t *testing.T) {
	for _, target := range []string{"first", "second", "absent", "legacy"} {
		t.Run(target, func(t *testing.T) {
			hub := newNotificationTestHub(t)
			app := map[string]string{"first": hub.first, "second": hub.second, "absent": hub.first + "-closed"}[target]
			id := PushMsgWithApp(app, "started", 1)
			PushUpdateMsgWithApp(app, id, "finished", 7000)
			errID := PushErrMsgWithApp(app, "failed", 5000)
			PushClearMsgWithApp(app, id)
			PushClearMsgWithApp(app, "")
			if id == "" || errID == "" {
				t.Fatal("notification IDs must not be empty")
			}
			want := []notificationTestEvent{
				notificationEvent("msg", 0, "started", id, 1),
				notificationEvent("msg", 0, "finished", id, 7000),
				notificationEvent("msg", -1, "failed", errID, 5000),
				notificationEvent("cmsg", 0, "", id, 0),
			}
			for i, got := range hub.readEvents(t) {
				var expected []notificationTestEvent
				if i == 0 && (target == "first" || target == "legacy") || i == 1 && (target == "second" || target == "legacy") {
					expected = want
				}
				if !reflect.DeepEqual(got, expected) {
					t.Fatalf("client %d received %+v, want %+v", i, got, expected)
				}
			}
		})
	}
}

func TestNotificationGlobalHelpersPreserveBroadcast(t *testing.T) {
	hub := newNotificationTestHub(t)
	id := PushMsg("started", 3000)
	PushUpdateMsg("fixed-global-id", "updated", 7000)
	errID := PushErrMsg("failed", 5000)
	PushClearMsg(id)
	PushClearMsg("")
	want := []notificationTestEvent{
		notificationEvent("msg", 0, "started", id, 3000),
		notificationEvent("msg", 0, "updated", "fixed-global-id", 7000),
		notificationEvent("msg", -1, "failed", errID, 5000),
		notificationEvent("cmsg", 0, "", id, 0),
		notificationEvent("cmsg", 0, "", "", 0),
	}
	for i, got := range hub.readEvents(t) {
		var expected []notificationTestEvent
		if i < 2 {
			expected = want
		}
		if !reflect.DeepEqual(got, expected) {
			t.Fatalf("client %d received %+v, want %+v", i, got, expected)
		}
	}
}

func TestNotificationConcurrentOperationsAndLateUpdates(t *testing.T) {
	hub := newNotificationTestHub(t)
	var workers sync.WaitGroup
	for _, app := range []string{hub.first, hub.second} {
		workers.Go(func() {
			// 同名消息仍须由每次调用携带的实例标识决定接收方。
			PushUpdateMsgWithApp(app, "same-id", app, 1)
			PushClearMsgWithApp(app, "same-id")
			PushUpdateMsgWithApp(app, "same-id", "late-"+app, 7000)
		})
	}
	workers.Wait()
	for i, got := range hub.readEvents(t) {
		var expected []notificationTestEvent
		if i < 2 {
			app := []string{hub.first, hub.second}[i]
			expected = []notificationTestEvent{
				notificationEvent("msg", 0, app, "same-id", 1),
				notificationEvent("cmsg", 0, "", "same-id", 0),
				notificationEvent("msg", 0, "late-"+app, "same-id", 7000),
			}
		}
		if !reflect.DeepEqual(got, expected) {
			t.Fatalf("client %d received %+v, want %+v", i, got, expected)
		}
	}

	// 实例离线后迟到的更新、错误和清理不能退化为广播。
	RemovePushChan(hub.clients[0].session)
	PushUpdateMsgWithApp(hub.first, "same-id", "offline", 7000)
	PushErrMsgWithApp(hub.first, "offline-error", 7000)
	PushClearMsgWithApp(hub.first, "same-id")
	for i, got := range hub.readEvents(t) {
		if len(got) != 0 {
			t.Fatalf("client %d received offline notification: %+v", i, got)
		}
	}
}
