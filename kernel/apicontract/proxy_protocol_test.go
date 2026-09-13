package apicontract

import (
	"net/http"
	"reflect"
	"strings"
	"testing"
)

func TestProxyProtocolResponses(t *testing.T) {
	previous := definitions
	t.Cleanup(func() { definitions = previous })
	endpoint := define[EmptyRequest, ProxyFailure]("proxyTest", "/test/proxy", RawBody, ProxyOptions(HTTPProxy), "ANY")
	define[EmptyRequest, ProxyFailure]("eventsProxyTest", "/test/eventsProxy", NoBody, ProxyOptions(EventSourceProxy), "GET")
	define[EmptyRequest, ProxyFailure]("wsProxyTest", "/test/wsProxy", NoBody, ProxyOptions(WebSocketProxy), "GET")
	bundle, err := BuildBundle()
	if err != nil {
		t.Fatal(err)
	}
	for _, tt := range []struct {
		method, path string
		status       int
		media, body  string
		valid        bool
	}{
		{"POST", "/test/proxy", 404, "application/octet-stream", "\x00<html>", true},
		{"POST", "/test/proxy", 700, "application/octet-stream", "custom status", true},
		{"POST", "/test/proxy", 999, "application/octet-stream", "custom status", true},
		{"POST", "/test/proxy", 502, "application/octet-stream", "upstream error", true},
		{"POST", "/test/proxy", 400, "application/json", `{"code":-1,"msg":"bad"}`, true},
		{"POST", "/test/proxy", 400, "application/json", `{"code":-1,"msg":"bad","data":null}`, false},
		{"POST", "/test/proxy", 200, "application/json", `{"code":-1,"msg":"bad","data":null}`, true},
		{"POST", "/test/proxy", 200, "application/json", `{"code":0,"msg":"","data":null}`, false},
		{"POST", "/test/proxy", 200, "text/html", "unsafe", false},
		{"HEAD", "/test/proxy", 404, "application/octet-stream", "", true},
		{"HEAD", "/test/proxy", 404, "application/octet-stream", "body", false},
		{"GET", "/test/proxy", 204, "", "", true},
		{"GET", "/test/proxy", 304, "", "", true},
		{"GET", "/test/proxy", 204, "application/octet-stream", "body", false},
		{"GET", "/test/eventsProxy", 403, "text/event-stream; charset=utf-8", ": keepalive\nevent: custom\ndata: not JSON\n\n", true},
		{"GET", "/test/eventsProxy", 200, "text/event-stream-invalid", "", false},
		{"GET", "/test/wsProxy", 101, "", "", true},
		{"GET", "/test/wsProxy", 403, "text/plain; charset=utf-8", "Forbidden\n", true},
		{"GET", "/test/wsProxy", 502, "application/json", `{"code":-1,"msg":"dial failed"}`, true},
		{"GET", "/test/wsProxy", 200, "application/octet-stream", "", false},
	} {
		if err := bundle.ValidateHTTPResponse(tt.method, tt.path, tt.status, tt.media, []byte(tt.body)); (err == nil) != tt.valid {
			t.Errorf("%+v: %v", tt, err)
		}
	}
	for _, frame := range []int{1, 2, 8} {
		if err := bundle.ValidateProxyFrame("GET", "/test/wsProxy", frame, []byte{0, 255}); err != nil {
			t.Fatal(err)
		}
	}
	if err := bundle.ValidateProxyFrame("GET", "/test/wsProxy", 9, nil); err == nil {
		t.Fatal("undeclared frame accepted")
	}
	raw := strings.NewReader("raw bytes")
	if _, err := endpoint.Decode(raw); err != nil || raw.Len() != 9 {
		t.Fatalf("raw decoder consumed payload: %v", err)
	}
	stream := StreamProxy(404, func(http.ResponseWriter, *http.Request) {})
	if endpoint.Status(stream) != 404 || stream.Stream() == nil {
		t.Fatal("upstream status changed")
	}
	if _, err := stream.MarshalJSON(); err == nil {
		t.Fatal("stream serialized")
	}
	reject := RejectProxy(502, "dial failed")
	encoded, err := reject.MarshalJSON()
	if err != nil || string(encoded) != `{"code":-1,"msg":"dial failed"}` {
		t.Fatalf("rejection changed: %s %v", encoded, err)
	}
	if endpoint.Status(reject) != 502 {
		t.Fatal("rejection status changed")
	}
}

func TestProxyDefinitionRejectsUnknownProtocol(t *testing.T) {
	definition := Definition{Name: "invalid", Output: ProxyOutput, Data: reflect.TypeFor[ProxyFailure](), Proxy: &ProxyDefinition{Kind: "unknown"}}
	if err := validateProxyDefinition(definition); err == nil {
		t.Fatal("unknown protocol accepted")
	}
	definition.Proxy = ProxyOptions(HTTPProxy).Proxy
	definition.Proxy.ContentType = "text/html"
	if err := validateProxyDefinition(definition); err == nil {
		t.Fatal("unsafe media accepted")
	}
}
