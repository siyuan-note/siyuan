package apicontract

import (
	"net/http"
	"testing"
)

func TestRawBroadcastProtocols(t *testing.T) {
	previous := definitions
	t.Cleanup(func() { definitions = previous })
	ws := define[EmptyRequest, Null]("rawBroadcastWS", "/test/broadcast/ws", NoBody, RawWebSocketOptions(), "GET")
	stream := define[EmptyRequest, Null]("rawBroadcastSSE", "/test/broadcast/es", NoBody, RawSSEOptions(), "GET")
	bundle, err := BuildBundle()
	if err != nil {
		t.Fatal(err)
	}
	for _, tt := range []struct {
		path        string
		status      int
		media, body string
		valid       bool
	}{
		{"/test/broadcast/ws", 101, "", "", true},
		{"/test/broadcast/ws", 200, "", "", true},
		{"/test/broadcast/ws", 403, "text/plain; charset=utf-8", "Forbidden\n", true},
		{"/test/broadcast/ws", 200, "application/json", `{"code":-1,"msg":"denied","data":null}`, true},
		{"/test/broadcast/ws", 404, "text/plain", "not found", false},
		{"/test/broadcast/ws", 101, "", "body", false},
		{"/test/broadcast/es", 200, "text/event-stream", "event: channel\ndata: not JSON\n\n", true},
		{"/test/broadcast/es", 200, "application/json", `{"code":-1,"msg":"denied","data":null}`, true},
		{"/test/broadcast/es", 201, "text/event-stream", "", false},
	} {
		if err := bundle.ValidateHTTPResponse("GET", tt.path, tt.status, tt.media, []byte(tt.body)); (err == nil) != tt.valid {
			t.Errorf("%+v: %v", tt, err)
		}
	}
	for _, name := range []string{"", "dynamic", "channel\nname"} {
		if err := bundle.ValidateRawSSEEvent("GET", "/test/broadcast/es", name, "id\nvalue", 123, []byte{0, 255}); err != nil {
			t.Fatal(err)
		}
	}
	for _, incoming := range []bool{false, true} {
		for _, frame := range []int{1, 2, 8, 9, 10} {
			if err := bundle.ValidateRawWebSocketFrame("GET", "/test/broadcast/ws", incoming, frame, []byte{0, 255}); err != nil {
				t.Fatal(err)
			}
		}
	}
	if err := bundle.ValidateRawWebSocketFrame("GET", "/test/broadcast/ws", false, 3, nil); err == nil {
		t.Fatal("undeclared frame accepted")
	}
	if err := bundle.ValidateRawWebSocketFrame("GET", "/test/broadcast/ws", false, 9, make([]byte, 126)); err == nil {
		t.Fatal("oversized control frame accepted")
	}
	if ws.Status(UpgradeWebSocket[Null](func(http.ResponseWriter, *http.Request) {})) != 101 || stream.Status(StreamSSE[Null](func(http.ResponseWriter, *http.Request) {})) != 200 {
		t.Fatal("stream lifecycle status changed")
	}
	invalid := RawSSEOptions().SSE
	invalid.Events = []SSEEventDefinition{SSEEvent[string]("json")}
	if _, err := rawSSESchema(invalid); err == nil {
		t.Fatal("mixed raw/JSON events accepted")
	}
	invalidWS := RawWebSocketOptions().WebSocket
	invalidWS.Raw.Frames = []int{3}
	if _, err := rawWebSocketSchema(invalidWS); err == nil {
		t.Fatal("invalid frame set accepted")
	}
}
