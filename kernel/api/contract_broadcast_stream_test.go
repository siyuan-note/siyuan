package api

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/asaskevich/EventBus"
	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
)

type broadcastTestBus struct {
	EventBus.Bus
	subscribed atomic.Int32
}

func (bus *broadcastTestBus) Subscribe(topic string, handler any) error {
	err := bus.Bus.Subscribe(topic, handler)
	if err == nil {
		bus.subscribed.Add(1)
	}
	return err
}

func broadcastTestWait(t *testing.T, ready func() bool) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for !ready() {
		if time.Now().After(deadline) {
			t.Fatal("broadcast lifecycle did not settle")
		}
		time.Sleep(time.Millisecond)
	}
}

func TestAPIContractBroadcastRawSSE(t *testing.T) {
	saved := UnifiedSSE
	bus := &broadcastTestBus{Bus: EventBus.New()}
	UnifiedSSE = &EventSourceServer{EventBus: bus, WaitGroup: &sync.WaitGroup{}, Subscriber: &EventSourceSubscriber{lock: &sync.Mutex{}}}
	channel := "contract-broadcast\nraw"
	engine := gin.New()
	engine.GET("/es/broadcast/subscribe", broadcastSubscribe)
	server := httptest.NewServer(engine)
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	t.Cleanup(func() {
		cancel()
		server.Close()
		UnifiedSSE.WaitGroup.Wait()
		DestroyBroadcastChannel(channel, true)
		UnifiedSSE = saved
	})
	open := func(query string) *http.Response {
		t.Helper()
		request, _ := http.NewRequestWithContext(ctx, "GET", server.URL+"/es/broadcast/subscribe"+query, nil)
		response, err := http.DefaultClient.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { response.Body.Close() })
		return response
	}
	selected := open("?retry=25&channel=" + url.QueryEscape(channel))
	all := open("?retry=invalid")
	broadcastTestWait(t, func() bool {
		return bus.subscribed.Load() == 2
	})
	bundle, err := apicontract.BuildBundle()
	if err != nil {
		t.Fatal(err)
	}
	read := func(response *http.Response, want string) {
		t.Helper()
		body := make([]byte, len(want))
		if _, err := io.ReadFull(response.Body, body); err != nil || string(body) != want {
			t.Fatalf("raw SSE changed: %q want %q (%v)", body, want, err)
		}
		if err := bundle.ValidateHTTPResponse("GET", "/es/broadcast/subscribe", response.StatusCode, response.Header.Get("Content-Type"), body); err != nil {
			t.Fatal(err)
		}
	}
	for _, kind := range []MessageType{MessageTypeString, MessageTypeBinary} {
		UnifiedSSE.SendEvent(&MessageEvent{ID: "id\nraw", Type: kind, Name: channel, Data: []byte{'a', '\n', 0, 255, '\r'}})
		read(selected, "id:id\\nraw\nevent:contract-broadcast\\nraw\nretry:25\ndata:a\ndata:\x00\xff\\r\n\n")
		read(all, "id:id\\nraw\nevent:contract-broadcast\\nraw\ndata:a\ndata:\x00\xff\\r\n\n")
	}
	UnifiedSSE.SendEvent(&MessageEvent{Type: MessageTypeClose, Name: channel})
	if remaining, err := io.ReadAll(selected.Body); err != nil || len(remaining) != 0 {
		t.Fatalf("selected close changed: %q %v", remaining, err)
	}
	UnifiedSSE.SendEvent(&MessageEvent{ID: "after", Type: MessageTypeString, Name: channel, Data: []byte("still subscribed")})
	read(all, "id:after\nevent:contract-broadcast\\nraw\ndata:still subscribed\n\n")
	if selected.Header.Get("Cache-Control") != "no-cache" || selected.Header.Get("Connection") != "keep-alive" {
		t.Fatal("SSE headers changed")
	}
	cancel()
	all.Body.Close()
	broadcastTestWait(t, func() bool { return UnifiedSSE.Subscriber.Count() == 0 })
}

func TestAPIContractBroadcastWebSocket(t *testing.T) {
	channel := "contract-broadcast-ws"
	engine := gin.New()
	engine.GET("/ws/broadcast", broadcast)
	server := httptest.NewServer(engine)
	defer server.Close()
	defer DestroyBroadcastChannel(channel, true)
	endpoint := "ws" + strings.TrimPrefix(server.URL, "http") + "/ws/broadcast?channel=" + channel
	first, response, err := websocket.DefaultDialer.Dial(endpoint, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer first.Close()
	second, _, err := websocket.DefaultDialer.Dial(endpoint, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close()
	broadcastTestWait(t, func() bool {
		current := GetBroadcastChannel(channel)
		return current != nil && current.WebSocket.Len() == 2
	})
	bundle, err := apicontract.BuildBundle()
	if err != nil {
		t.Fatal(err)
	}
	if err = bundle.ValidateHTTPResponse("GET", "/ws/broadcast", response.StatusCode, response.Header.Get("Content-Type"), nil); err != nil {
		t.Fatal(err)
	}
	for _, kind := range []int{websocket.TextMessage, websocket.BinaryMessage} {
		data := []byte("not JSON")
		if kind == websocket.BinaryMessage {
			data = []byte{0, 255, 1}
		}
		if err = first.WriteMessage(kind, data); err != nil {
			t.Fatal(err)
		}
		_ = second.SetReadDeadline(time.Now().Add(5 * time.Second))
		actualKind, actual, err := second.ReadMessage()
		if err != nil || actualKind != kind || !bytes.Equal(actual, data) {
			t.Fatalf("broadcast frame changed: %d %x %v", actualKind, actual, err)
		}
		if err = bundle.ValidateRawWebSocketFrame("GET", "/ws/broadcast", false, actualKind, actual); err != nil {
			t.Fatal(err)
		}
	}
	denied, denial, err := websocket.DefaultDialer.Dial(endpoint, http.Header{"Origin": []string{"https://foreign.invalid"}, "Sec-Fetch-Site": []string{"cross-site"}})
	if denied != nil {
		denied.Close()
	}
	if err == nil || denial == nil {
		t.Fatal("cross-origin broadcast accepted")
	}
	body, _ := io.ReadAll(denial.Body)
	denial.Body.Close()
	if denial.StatusCode != 403 {
		t.Fatalf("upgrade error changed: %d", denial.StatusCode)
	}
	if err = bundle.ValidateHTTPResponse("GET", "/ws/broadcast", denial.StatusCode, denial.Header.Get("Content-Type"), body); err != nil {
		t.Fatal(err)
	}
	first.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(1000, "done"))
	first.Close()
	current := GetBroadcastChannel(channel)
	if current == nil {
		t.Fatal("remaining subscriber lost its channel")
	}
	_, _ = current.BroadcastString("remaining")
	_ = second.SetReadDeadline(time.Now().Add(5 * time.Second))
	_, data, err := second.ReadMessage()
	if err != nil || string(data) != "remaining" {
		t.Fatalf("channel was closed for remaining subscriber: %s %v", data, err)
	}
}
