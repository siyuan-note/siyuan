// SiYuan - From thought to insight, with agents
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

package proxy

import (
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestPublishReverseProxyPreservesRequestHost(t *testing.T) {
	requestInfo := make(chan http.Header, 1)
	hostInfo := make(chan string, 1)
	backend := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		requestInfo <- request.Header.Clone()
		hostInfo <- request.Host
		writer.WriteHeader(http.StatusNoContent)
	}))
	defer backend.Close()

	proxy := httptest.NewServer(newPublishReverseProxy(mustParseURL(t, backend.URL), http.DefaultTransport))
	defer proxy.Close()

	request, err := http.NewRequest(http.MethodGet, proxy.URL+"/api/system/version", nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Host = "siyuan.example"
	request.Header.Set("Forwarded", "for=192.0.2.1")
	request.Header.Set("X-Forwarded-For", "192.0.2.1")
	request.Header.Set("X-Forwarded-Host", "spoofed.example")
	request.Header.Set("X-Forwarded-Proto", "https")

	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusNoContent {
		t.Fatalf("proxy returned %d, want %d", response.StatusCode, http.StatusNoContent)
	}

	headers := <-requestInfo
	forwardedFor := headers.Get("X-Forwarded-For")
	if ip := net.ParseIP(forwardedFor); ip == nil || !ip.IsLoopback() {
		t.Fatalf("X-Forwarded-For = %q, want proxy client loopback address", forwardedFor)
	}
	if actual := headers.Get("X-Forwarded-Host"); actual != request.Host {
		t.Fatalf("X-Forwarded-Host = %q, want %q", actual, request.Host)
	}
	if actual := headers.Get("X-Forwarded-Proto"); actual != "http" {
		t.Fatalf("X-Forwarded-Proto = %q, want http", actual)
	}
	if actual := headers.Get("Forwarded"); actual != "" {
		t.Fatalf("Forwarded = %q, want empty", actual)
	}
	if actual := <-hostInfo; actual != request.Host {
		t.Fatalf("Host = %q, want %q", actual, request.Host)
	}
}

func TestPublishReverseProxyWebSocketOrigin(t *testing.T) {
	upgrader := websocket.Upgrader{
		CheckOrigin: func(request *http.Request) bool {
			return util.IsSessionOriginAllowed(request.Header.Get("Origin"), request.Host)
		},
	}
	backend := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		connection, err := upgrader.Upgrade(writer, request, nil)
		if err != nil {
			return
		}
		defer connection.Close()
		for {
			if _, _, err = connection.ReadMessage(); err != nil {
				return
			}
		}
	}))
	defer backend.Close()

	proxy := httptest.NewServer(newPublishReverseProxy(mustParseURL(t, backend.URL), http.DefaultTransport))
	defer proxy.Close()
	websocketURL := "ws" + strings.TrimPrefix(proxy.URL, "http") + "/ws"
	dialer := websocket.Dialer{HandshakeTimeout: 5 * time.Second}

	tests := []struct {
		name       string
		origin     string
		wantStatus int
	}{
		{name: "same origin", origin: "https://siyuan.example", wantStatus: http.StatusSwitchingProtocols},
		{name: "cross origin", origin: "https://evil.example", wantStatus: http.StatusForbidden},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			headers := http.Header{
				"Host":   {"siyuan.example"},
				"Origin": {test.origin},
			}
			connection, response, err := dialer.Dial(websocketURL, headers)
			if test.wantStatus == http.StatusSwitchingProtocols {
				if err != nil {
					t.Fatalf("websocket handshake failed: %v", err)
				}
				connection.Close()
				return
			}

			if err == nil {
				connection.Close()
				t.Fatal("cross-origin websocket handshake unexpectedly succeeded")
			}
			if response == nil {
				t.Fatalf("websocket handshake returned no response: %v", err)
			}
			defer response.Body.Close()
			if response.StatusCode != test.wantStatus {
				t.Fatalf("websocket handshake returned %d, want %d", response.StatusCode, test.wantStatus)
			}
		})
	}
}
